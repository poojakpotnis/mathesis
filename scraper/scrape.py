import asyncio

import click
from rich.console import Console
from rich.table import Table

from src.browser import get_browser_context, ensure_authenticated
from src.navigator import scrape_assignment, discover_selectors
from src.api_client import MathesisClient

console = Console()


async def _scrape(assignment_id: str, dry_run: bool) -> None:
    pw, context = await get_browser_context()

    try:
        page = await ensure_authenticated(context)
        payload = await scrape_assignment(page, assignment_id)

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


async def _status() -> None:
    client = MathesisClient()
    try:
        lessons = client.get_lessons()
    finally:
        client.close()

    if not lessons:
        console.print("[yellow]No lessons scraped yet.[/yellow]")
        return

    table = Table(title="Scraped Lessons")
    table.add_column("Lesson", style="cyan")
    table.add_column("Title")
    table.add_column("Problems", justify="right")
    table.add_column("Images", justify="right")
    table.add_column("Scraped At")

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
    """Mathesis — RSM homework scraper."""
    pass


@cli.command()
@click.argument("assignment_id", type=str)
@click.option("--dry", is_flag=True, help="Scrape but don't push to server.")
def scrape(assignment_id: str, dry: bool):
    """Scrape an assignment by its ID.

    The assignment ID is the number in the URL when viewing an assignment, e.g.
    https://homework.russianschool.com/#/assignment/155914328 → assignment_id is 155914328.
    """
    console.print(f"[bold]Scraping assignment {assignment_id}[/bold]")
    asyncio.run(_scrape(assignment_id, dry))


@cli.command()
def discover():
    """Open browser in discovery mode to identify CSS selectors."""
    asyncio.run(_discover())


@cli.command()
def status():
    """Show which lessons have been scraped."""
    asyncio.run(_status())


if __name__ == "__main__":
    cli()
