"""One-off: repair Lesson 33's scraped_problems.problem_text using the patched extractor.

Why a one-off script (not `scrape.py scrape`)
---------------------------------------------
/api/ingest is destructive: it DELETEs all scraped_problems for the lesson and
re-INSERTs with fresh IDs. That would orphan 55 problem_concepts rows, break
generated_problems.source_scraped_problem_id references in Worksheets 1–5, and
reset classification_status to "pending". Three sessions of human-ratified
work gone in one re-scrape.

This script does surgical UPDATEs that preserve all FK references. It touches
ONLY the problems whose text actually changed (compared to current Turso) and
leaves everything else (concepts, classifications, worksheets) intact.

Task #14 tracks fixing /api/ingest to be non-destructive (UPSERT by lesson_id +
problem_number). Once that lands, this script can be retired.

Run
---
    cd scraper && uv run python -m scripts.repair_lesson_text

Reads TURSO_DATABASE_URL + TURSO_AUTH_TOKEN from web/.env.local. Will open a
Playwright browser; log in to RSM if prompted. Shows a before/after diff for
every change and waits for explicit `y` before writing.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from rich.console import Console

from src.browser import get_browser_context, ensure_authenticated
from src.navigator import scrape_assignment

# Turso credentials live in web/.env.local (same as the Next app uses).
load_dotenv(Path(__file__).parent.parent.parent / "web" / ".env.local")

TURSO_URL = os.environ["TURSO_DATABASE_URL"]
TURSO_TOKEN = os.environ["TURSO_AUTH_TOKEN"]
TURSO_HTTP = TURSO_URL.replace("libsql://", "https://")

LESSON_NUMBER = 33
ASSIGNMENT_ID = "155914328"

console = Console()


def turso_pipeline(requests: list[dict]) -> dict:
    """POST a batch of statements to Turso's HTTP API. Closes connection at end."""
    response = httpx.post(
        f"{TURSO_HTTP}/v2/pipeline",
        headers={"Authorization": f"Bearer {TURSO_TOKEN}"},
        json={"requests": requests + [{"type": "close"}]},
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()


def fetch_current_text(lesson_number: int) -> dict[str, str]:
    """Return {problem_number: problem_text} for the lesson's current state in Turso."""
    payload = turso_pipeline([
        {
            "type": "execute",
            "stmt": {
                "sql": (
                    "SELECT sp.problem_number, sp.problem_text "
                    "FROM scraped_problems sp "
                    "JOIN lessons l ON l.id = sp.lesson_id "
                    "WHERE l.lesson_number = ? "
                    "ORDER BY sp.display_order"
                ),
                "args": [{"type": "integer", "value": str(lesson_number)}],
            },
        },
    ])
    rows = payload["results"][0]["response"]["result"]["rows"]
    return {row[0]["value"]: row[1]["value"] for row in rows}


def apply_updates(lesson_number: int, updates: list[tuple[str, str]]) -> None:
    """Apply UPDATEs as a single pipeline (atomic per Turso semantics)."""
    requests = [
        {
            "type": "execute",
            "stmt": {
                "sql": (
                    "UPDATE scraped_problems SET problem_text = ? "
                    "WHERE lesson_id = (SELECT id FROM lessons WHERE lesson_number = ?) "
                    "AND problem_number = ?"
                ),
                "args": [
                    {"type": "text", "value": new_text},
                    {"type": "integer", "value": str(lesson_number)},
                    {"type": "text", "value": problem_number},
                ],
            },
        }
        for problem_number, new_text in updates
    ]
    turso_pipeline(requests)


async def main() -> None:
    console.print("[bold cyan]Lesson 33 text repair[/bold cyan]")
    console.print(f"Source: live RSM assignment {ASSIGNMENT_ID} → Turso lesson {LESSON_NUMBER}\n")

    console.print("[1/3] Scraping 36 problems with patched extractor...")
    pw, context = await get_browser_context()
    try:
        page = await ensure_authenticated(context)
        payload = await scrape_assignment(page, ASSIGNMENT_ID)
    finally:
        await context.close()
        await pw.stop()
    console.print(f"      → {len(payload.problems)} problems extracted.\n")

    console.print("[2/3] Fetching current Turso text for diff...")
    current = fetch_current_text(LESSON_NUMBER)
    console.print(f"      → {len(current)} current rows.\n")

    diffs: list[tuple[str, str, str]] = []
    for p in payload.problems:
        old = current.get(p.problem_number, "<NOT IN TURSO>")
        new = p.problem_text
        if old != new:
            diffs.append((p.problem_number, old, new))

    if not diffs:
        console.print("[green]No text changes detected. Turso is already up to date.[/green]")
        return

    console.print(f"[bold yellow]{len(diffs)} problem(s) would be updated:[/bold yellow]\n")
    for num, old, new in diffs:
        console.print(f"  [bold]{num}[/bold]")
        console.print(f"    [red]- {old}[/red]")
        console.print(f"    [green]+ {new}[/green]\n")

    response = input(f"Apply {len(diffs)} UPDATEs to Turso? [y/N]: ").strip().lower()
    if response != "y":
        console.print("[yellow]Aborted. No changes written.[/yellow]")
        return

    console.print("\n[3/3] Applying updates...")
    apply_updates(LESSON_NUMBER, [(num, new) for num, _, new in diffs])
    console.print(f"[bold green]✓ {len(diffs)} problems updated.[/bold green]")
    console.print("\nNext: re-upload golden_v1 to refresh the Phoenix dataset.")


if __name__ == "__main__":
    asyncio.run(main())
