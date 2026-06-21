"""Bulk-classify every lesson currently in `pending` status.

Reads MATHESIS_API_URL + MATHESIS_API_KEY from scraper/.env (via src.config).
Iterates pending lessons in lesson-number order, POSTs /api/classify, prints
per-lesson outcome + timing, and finishes with a summary.

Usage: from the scraper/ directory:
    uv run python -m scripts.bulk_classify
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
from rich.console import Console

from src.config import API_URL, API_KEY

console = Console()


def main() -> None:
    if not API_KEY:
        console.print("[red]MATHESIS_API_KEY not set in scraper/.env[/red]")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=API_URL, headers=headers, timeout=180.0) as client:
        list_resp = client.get("/api/lessons")
        list_resp.raise_for_status()
        lessons = list_resp.json()

        pending = sorted(
            [l for l in lessons if l["classificationStatus"] == "pending"],
            key=lambda l: l["lessonNumber"],
        )
        total = len(pending)
        console.print(
            f"[bold]Bulk classify:[/bold] {total} pending lessons "
            f"(out of {len(lessons)} total)"
        )
        if not pending:
            console.print("[yellow]Nothing to do.[/yellow]")
            return

        successes: list[int] = []
        failures: list[tuple[int, str]] = []

        for idx, lesson in enumerate(pending, start=1):
            lid = lesson["id"]
            ln = lesson["lessonNumber"]
            probs = lesson["totalProblems"]
            console.rule(
                f"[bold cyan]({idx}/{total}) Lesson {ln} "
                f"(id={lid}, {probs} problems)[/bold cyan]"
            )

            start = time.monotonic()
            try:
                resp = client.post("/api/classify", json={"lesson_id": lid})
                elapsed = time.monotonic() - start
                if resp.status_code != 200:
                    err = resp.text[:300]
                    console.print(
                        f"[red]FAIL ({elapsed:.1f}s) — "
                        f"HTTP {resp.status_code}: {err}[/red]"
                    )
                    failures.append((ln, f"HTTP {resp.status_code}: {err}"))
                    continue
                body = resp.json()
                console.print(
                    f"[green]OK ({elapsed:.1f}s)[/green] — "
                    f"{body.get('problemsClassified')} problems classified, "
                    f"{body.get('mappings')} concept mappings, "
                    f"{body.get('conceptsCreated')} new concepts."
                )
                successes.append(ln)
            except httpx.HTTPError as e:
                elapsed = time.monotonic() - start
                console.print(f"[red]FAIL ({elapsed:.1f}s) — {e}[/red]")
                failures.append((ln, str(e)))

        console.rule("[bold]Bulk classify summary[/bold]")
        console.print(f"[green]Success ({len(successes)}):[/green] {successes}")
        if failures:
            console.print(f"[red]Failures ({len(failures)}):[/red]")
            for ln, err in failures:
                console.print(f"  Lesson {ln}: {err}")


if __name__ == "__main__":
    main()
