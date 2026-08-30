"""Recon a subpart-style problem to find where the specific-text element lives.

Opens the browser, waits for you to navigate to a subpart problem (e.g. 224a —
which shows "Calculate." as the umbrella text plus a specific expression), then
dumps everything around the question area so we can figure out the selector.

Usage (from scraper/):
    uv run python -m scripts.recon_subpart
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


async def dump(page, label: str, selector: str, cap: int = 30) -> None:
    console.print(f"\n[bold yellow]=== {label} ===[/bold yellow]")
    els = await page.query_selector_all(selector)
    console.print(f"Selector: [dim]{selector}[/dim]  matches: {len(els)}")
    for i, el in enumerate(els[:cap]):
        tag = await el.evaluate("el => el.tagName.toLowerCase()")
        cls = (await el.get_attribute("class") or "")[:120]
        text = (await el.text_content() or "").strip().replace("\n", " ")[:180]
        console.print(f"  [{i}] <{tag} class={cls!r}>")
        console.print(f"      text={text!r}")


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
        console.print("  1. Click HOMEWORK 1.")
        console.print("  2. In the left problem map, click 224a (or 51a — any subpart).")
        console.print("  3. Wait for it to render, then press Enter here.")
        await asyncio.get_event_loop().run_in_executor(None, input)

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        console.print(f"\n[bold]Page URL:[/bold] {page.url}")

        # The right pane wraps the whole problem view. Find it and dump.
        # Try broad structural probes.
        await dump(page, "question-problem containers", "[data-qa='question-problem']", cap=6)
        await dump(page, "class contains 'question'", "[class*='question' i]", cap=25)
        await dump(page, "class contains 'subproblem' / 'subpart' / 'part'", "[class*='subproblem' i], [class*='subpart' i], [class*='part' i]:not(.assignment-item-selector-btn)", cap=25)
        await dump(page, "class contains 'assignment-question'", "[class*='assignment-question' i]", cap=15)
        await dump(page, "class contains 'answer' (upper pane)", "[class*='answer' i]", cap=15)
        await dump(page, "elements matching 'Calculate.'", "text=/^Calculate\\.?$/i", cap=8)
        await dump(page, "elements matching 'a\\)', 'b\\)', 'c\\)' letter labels", "text=/^\\s*[a-e]\\s*\\)?\\s*$/i", cap=20)

        # Dump the FULL right pane, wrapped up in a size-capped snippet.
        # Try a couple candidate wrappers.
        for wrapper_sel in [
            "[data-qa='assignment-view']",
            ".assignment-view",
            ".assignment-content",
            "main",
            "body",
        ]:
            el = await page.query_selector(wrapper_sel)
            if el:
                html = await el.evaluate("el => el.outerHTML")
                path = OUT_DIR / f"subpart_wrapper_{wrapper_sel.replace('[', '').replace(']', '').replace('=', '').replace(chr(39), '').replace('.', 'dot')}.html"
                path.write_text(html)
                console.print(f"\n[green]Saved {wrapper_sel}: {len(html)} chars → {path}[/green]")
                break

        # Also save the full body.
        body_html = await page.evaluate("document.body.outerHTML")
        (OUT_DIR / "subpart_body.html").write_text(body_html)
        console.print(f"[green]Saved full body → {OUT_DIR / 'subpart_body.html'}  ({len(body_html)} chars)[/green]")

        shot = OUT_DIR / "subpart_page.png"
        await page.screenshot(path=str(shot), full_page=True)
        console.print(f"[green]Screenshot → {shot}[/green]")

        console.print("\n[dim]Press Enter to close browser.[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
