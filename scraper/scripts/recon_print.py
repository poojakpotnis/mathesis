"""Probe what happens when the PRINT HOMEWORK / PRINT QUEST button is clicked.

Opens the homework list, waits for you to navigate into an assignment (either
homework OR quest) and click its PRINT button, then dumps whatever new page or
tab appears — full body HTML, screenshot, and structural probes. Tells us
whether PRINT view is a golden path for extraction.

Usage (from scraper/):
    uv run python -m scripts.recon_print
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.async_api import async_playwright
from rich.console import Console

from src.config import BROWSER_STATE_DIR

console = Console()

HOMEWORK_URL = "https://student.russianschool.com/student-portal/content/homework"
OUT_DIR = Path(__file__).parent.parent / "storage"


async def dump_page(page, tag: str) -> None:
    """Dump URL, HTML, screenshot, and structural probes for one page/tab."""
    console.print(f"\n[bold cyan]--- Page: {tag} ---[/bold cyan]")
    try:
        await page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    await asyncio.sleep(1)

    url = page.url
    title = await page.title()
    console.print(f"  URL:   {url}")
    console.print(f"  Title: {title}")

    body_html = await page.evaluate("document.body.outerHTML")
    html_path = OUT_DIR / f"print_{tag}.html"
    html_path.write_text(body_html)
    console.print(f"  [green]HTML → {html_path}  ({len(body_html)} chars)[/green]")

    shot = OUT_DIR / f"print_{tag}.png"
    try:
        await page.screenshot(path=str(shot), full_page=True)
        console.print(f"  [green]Screenshot → {shot}[/green]")
    except Exception as e:
        console.print(f"  [yellow]Screenshot failed: {e}[/yellow]")

    # Quick structural probe.
    for label, sel in [
        ("data-qa='question-problem'", "[data-qa='question-problem']"),
        (".question-problem", ".question-problem"),
        (".assignment-question", ".assignment-question"),
        (".assignment-item-text", ".assignment-item-text"),
        ("class contains 'problem'", "[class*='problem' i]"),
        ("class contains 'question'", "[class*='question' i]"),
        ("class contains 'answer'", "[class*='answer' i]"),
        ("class contains 'solution'", "[class*='solution' i]"),
        ("class contains 'print'", "[class*='print' i]"),
        ("<img>", "img"),
    ]:
        els = await page.query_selector_all(sel)
        console.print(f"  {label:38s} count={len(els)}")


async def main() -> None:
    BROWSER_STATE_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=str(BROWSER_STATE_DIR),
        headless=False,
        viewport={"width": 1280, "height": 900},
        args=["--disable-blink-features=AutomationControlled"],
    )
    try:
        page = context.pages[0] if context.pages else await context.new_page()

        console.print(f"[bold cyan]Opening:[/bold cyan] {HOMEWORK_URL}")
        await page.goto(HOMEWORK_URL, wait_until="domcontentloaded")

        console.print(
            "\n[bold yellow]In the browser:[/bold yellow]"
        )
        console.print("  1. Click into HOMEWORK 1 (or Quest 1 — your choice).")
        console.print("  2. Click PRINT HOMEWORK (or PRINT QUEST) in the top-right.")
        console.print("  3. Wait for whatever appears (new tab, popup, print dialog…).")
        console.print("  4. If a browser print dialog appears, cancel it — we want the HTML underneath.")
        console.print("  5. Come back here and press Enter.")
        await asyncio.get_event_loop().run_in_executor(None, input)

        # Snapshot every open page/tab — the print button may open a new one.
        console.print(f"\n[bold]Total open pages/tabs: {len(context.pages)}[/bold]")
        for i, p in enumerate(context.pages):
            tag = f"tab{i}"
            await dump_page(p, tag)

        console.print("\n[dim]Press Enter to close browser.[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
