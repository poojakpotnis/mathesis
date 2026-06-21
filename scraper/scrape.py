import asyncio
import json
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from src.browser import get_browser_context, ensure_authenticated
from src.navigator import scrape_assignment, discover_selectors, list_assignments
from src.api_client import MathesisClient

ASSIGNMENTS_JSON = Path(__file__).parent / "storage" / "assignments.json"

console = Console()


def _prompt_grade(default: int | None = None) -> int:
    """Ask once for a grade level; clamp to 1-12. Re-asks on bad input."""
    while True:
        prompt = "Grade level for this batch (1-12)"
        if default is not None:
            prompt += f" [{default}]"
        prompt += ": "
        raw = input(prompt).strip()
        if not raw and default is not None:
            return default
        try:
            g = int(raw)
        except ValueError:
            console.print("[yellow]Enter a number.[/yellow]")
            continue
        if 1 <= g <= 12:
            return g
        console.print("[yellow]Must be between 1 and 12.[/yellow]")


async def _scrape(
    assignment_id: str, dry_run: bool, grade_override: int | None
) -> None:
    pw, context = await get_browser_context()

    try:
        page = await ensure_authenticated(context)
        payload = await scrape_assignment(
            page, assignment_id, grade_override=grade_override
        )

        if dry_run:
            _print_dry_run(payload)
        else:
            client = MathesisClient()
            try:
                client.push_lesson(payload)
            finally:
                client.close()
    finally:
        await context.close()
        await pw.stop()


async def _discover() -> None:
    pw, context = await get_browser_context()
    try:
        page = await ensure_authenticated(context)
        await discover_selectors(page)
    finally:
        await context.close()
        await pw.stop()


async def _list_assignments() -> None:
    pw, context = await get_browser_context()
    try:
        page = await ensure_authenticated(context)
        assignments = await list_assignments(page)
    finally:
        await context.close()
        await pw.stop()

    ASSIGNMENTS_JSON.parent.mkdir(parents=True, exist_ok=True)
    ASSIGNMENTS_JSON.write_text(json.dumps(assignments, indent=2))

    table = Table(title=f"Discovered Assignments ({len(assignments)})")
    table.add_column("Lesson", style="cyan", justify="right")
    table.add_column("Assignment ID")
    table.add_column("Title")
    for a in assignments:
        table.add_row(str(a["lesson_number"]), a["assignment_id"], a["title"])
    console.print(table)
    console.print(f"[green]Saved to {ASSIGNMENTS_JSON}[/green]")


async def _batch_ingest(
    lesson_from: int,
    lesson_to: int,
    skip_existing: bool,
    dry_run: bool,
    grade_override: int | None,
) -> None:
    if not ASSIGNMENTS_JSON.exists():
        console.print(
            f"[red]No assignments cache at {ASSIGNMENTS_JSON}. "
            f"Run `list-assignments` first.[/red]"
        )
        raise SystemExit(1)

    all_assignments = json.loads(ASSIGNMENTS_JSON.read_text())
    targets = [
        a for a in all_assignments
        if lesson_from <= a["lesson_number"] <= lesson_to
    ]

    already_imported: set[int] = set()
    if skip_existing and not dry_run:
        client = MathesisClient()
        try:
            already_imported = {l["lessonNumber"] for l in client.get_lessons()}
        finally:
            client.close()

    queue = [a for a in targets if a["lesson_number"] not in already_imported]
    skipped = [a for a in targets if a["lesson_number"] in already_imported]

    console.print(
        f"[bold]Batch ingest:[/bold] {len(targets)} in range "
        f"{lesson_from}–{lesson_to}, "
        f"{len(skipped)} already imported (skipping), "
        f"{len(queue)} to ingest"
    )
    if skipped:
        skipped_nums = ", ".join(str(a["lesson_number"]) for a in skipped)
        console.print(f"[dim]Skipping: lessons {skipped_nums}[/dim]")

    if not queue:
        console.print("[yellow]Nothing to do.[/yellow]")
        return

    pw, context = await get_browser_context()
    client = None if dry_run else MathesisClient()
    successes: list[int] = []
    failures: list[tuple[int, str]] = []
    try:
        page = await ensure_authenticated(context)
        for idx, a in enumerate(queue, start=1):
            console.rule(
                f"[bold cyan]({idx}/{len(queue)}) Lesson {a['lesson_number']} "
                f"— assignment {a['assignment_id']}[/bold cyan]"
            )
            try:
                payload = await scrape_assignment(
                    page, a["assignment_id"], grade_override=grade_override
                )
                if dry_run:
                    _print_dry_run(payload)
                else:
                    client.push_lesson(payload)
                successes.append(a["lesson_number"])
            except Exception as e:
                console.print(
                    f"[red]Lesson {a['lesson_number']} failed: {e}[/red]"
                )
                failures.append((a["lesson_number"], str(e)))
    finally:
        if client is not None:
            client.close()
        await context.close()
        await pw.stop()

    console.rule("[bold]Batch summary[/bold]")
    console.print(f"[green]Success ({len(successes)}):[/green] {successes}")
    if failures:
        console.print(f"[red]Failures ({len(failures)}):[/red]")
        for ln, err in failures:
            console.print(f"  Lesson {ln}: {err}")


async def _status() -> None:
    client = MathesisClient()
    try:
        lessons = client.get_lessons()
    finally:
        client.close()

    if not lessons:
        console.print("[yellow]No lessons ingested yet.[/yellow]")
        return

    table = Table(title="Ingested Lessons")
    table.add_column("Lesson", style="cyan")
    table.add_column("Title")
    table.add_column("Problems", justify="right")
    table.add_column("Images", justify="right")
    table.add_column("Ingested At")

    for l in lessons:
        table.add_row(
            str(l["lessonNumber"]),
            l["title"],
            str(l["totalProblems"]),
            str(l.get("imageProblemsCount", 0)),
            l.get("scrapedAt", ""),
        )

    console.print(table)


def _print_dry_run(payload) -> None:
    console.print(
        f"\n[bold]Lesson {payload.lesson_number} — {payload.title}[/bold] "
        f"({len(payload.problems)} problems)\n"
    )
    for p in payload.problems:
        img = " 📷" if p.has_image else ""
        th = " [TH]" if p.is_take_home else ""
        fmt = f" ({p.answer_format_type})" if p.answer_format_type else ""
        credit = f" [{p.credit_status}]" if p.credit_status else ""
        console.print(f"  [cyan]{p.problem_number}[/cyan]{th}{img}{fmt}{credit}")
        text = p.problem_text[:140] + ("..." if len(p.problem_text) > 140 else "")
        console.print(f"    {text}")


@click.group()
def cli():
    """Mathesis — lesson importer."""
    pass


@cli.command()
@click.argument("assignment_id", type=str)
@click.option("--dry", is_flag=True, help="Ingest but don't push to server.")
@click.option(
    "--grade",
    "grade",
    type=click.IntRange(1, 12),
    default=None,
    help=(
        "Grade level (1-12). Wins over the page's prefix detector. "
        "If omitted, you'll be prompted."
    ),
)
@click.option(
    "--auto-detect-grade",
    is_flag=True,
    default=False,
    help="Skip the grade prompt; rely on the page-prefix detector only.",
)
def ingest(assignment_id: str, dry: bool, grade: int | None, auto_detect_grade: bool):
    """Ingest an assignment by its ID.

    The assignment ID is the number in the URL when viewing an assignment on the
    curriculum portal.
    """
    console.print(f"[bold]Ingesting assignment {assignment_id}[/bold]")
    if grade is None and not auto_detect_grade:
        grade = _prompt_grade()
    asyncio.run(_scrape(assignment_id, dry, grade))


@cli.command()
def discover():
    """Open browser in discovery mode to identify CSS selectors."""
    asyncio.run(_discover())


@cli.command()
def status():
    """Show which lessons have been ingested."""
    asyncio.run(_status())


@cli.command("list-assignments")
def list_assignments_cmd():
    """Scan the StudentPortal home page and cache all (lesson_number, assignment_id) pairs.

    Writes storage/assignments.json. Run this once per term — then `batch-ingest`
    consumes the cache.
    """
    asyncio.run(_list_assignments())


@cli.command("batch-ingest")
@click.option("--from", "lesson_from", type=int, required=True, help="First lesson number to ingest (inclusive).")
@click.option("--to", "lesson_to", type=int, required=True, help="Last lesson number to ingest (inclusive).")
@click.option(
    "--no-skip-existing",
    is_flag=True,
    default=False,
    help="Re-ingest lessons already in the database (default: skip them).",
)
@click.option("--dry", is_flag=True, help="Scrape but don't push to server.")
@click.option(
    "--grade",
    "grade",
    type=click.IntRange(1, 12),
    default=None,
    help=(
        "Grade level (1-12) applied to every lesson in the batch. "
        "Wins over per-page detection. If omitted, you'll be prompted once."
    ),
)
@click.option(
    "--auto-detect-grade",
    is_flag=True,
    default=False,
    help="Skip the grade prompt; rely on each page's prefix detector only.",
)
def batch_ingest_cmd(
    lesson_from: int,
    lesson_to: int,
    no_skip_existing: bool,
    dry: bool,
    grade: int | None,
    auto_detect_grade: bool,
):
    """Ingest a range of lessons in one browser session.

    Reuses the auth session across lessons. Run `list-assignments` first to
    populate the assignment-ID cache.
    """
    if grade is None and not auto_detect_grade:
        grade = _prompt_grade()
    asyncio.run(
        _batch_ingest(
            lesson_from=lesson_from,
            lesson_to=lesson_to,
            skip_existing=not no_skip_existing,
            dry_run=dry,
            grade_override=grade,
        )
    )


if __name__ == "__main__":
    cli()
