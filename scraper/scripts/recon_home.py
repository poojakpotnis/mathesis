"""One-off recon: open StudentPortal home, dump DOM structure so we can
identify selectors for assignment listing.

Usage: from the scraper/ directory:
    uv run python -m scripts.recon_home
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rich.console import Console

from src.browser import get_browser_context, ensure_authenticated

console = Console()

HOME_URL = "https://homework.russianschool.com/StudentPortal/#/home"


async def main() -> None:
    pw, context = await get_browser_context()
    try:
        page = await ensure_authenticated(context)

        console.print(f"\n[bold cyan]Navigating to home:[/bold cyan] {HOME_URL}")
        await page.goto(HOME_URL, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=15000)
        await asyncio.sleep(2)

        console.print(f"\n[bold]Final URL:[/bold] {page.url}")
        console.print(f"[bold]Title:[/bold] {await page.title()}")

        # Look for anchors whose href contains 'assignment' — likely the lesson links
        console.print("\n[bold yellow]=== Anchors with href containing 'assignment' ===[/bold yellow]")
        anchors = await page.query_selector_all("a[href*='assignment']")
        console.print(f"Found {len(anchors)} matching anchors")
        for i, a in enumerate(anchors[:50]):
            href = await a.get_attribute("href") or ""
            text = (await a.text_content() or "").strip()[:120]
            cls = await a.get_attribute("class") or ""
            console.print(f"  [{i}] href={href!r}")
            console.print(f"      class={cls!r}")
            console.print(f"      text={text!r}")

        # Dump elements containing "Lesson <N>"
        console.print("\n[bold yellow]=== Elements with 'Lesson <N>' text ===[/bold yellow]")
        lesson_els = await page.query_selector_all("text=/Lesson \\d+/")
        console.print(f"Found {len(lesson_els)} matching elements")
        for i, el in enumerate(lesson_els[:40]):
            tag = await el.evaluate("el => el.tagName.toLowerCase()")
            text = (await el.text_content() or "").strip()[:120]
            console.print(f"  [{i}] <{tag}> {text!r}")

        # Save full body HTML to a file for offline inspection
        out_path = Path(__file__).parent.parent / "storage" / "home_recon.html"
        body_html = await page.evaluate("document.body.outerHTML")
        out_path.write_text(body_html)
        console.print(f"\n[green]Saved full body HTML to {out_path}[/green]")

        console.print("\n[dim]Press Enter to close browser...[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
