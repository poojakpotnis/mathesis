"""Focused recon of a Quest page on the new RSM portal.

Opens the homework list, waits for you to click into Quest 1 (from the Quests
column), then dumps the resulting page's DOM, URL, screenshots, and click-target
handlers so we can figure out how quests are structured and how to navigate them.

Usage (from scraper/):
    uv run python -m scripts.recon_quest
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


async def dump_matches(page, label: str, selector: str, cap: int = 40) -> None:
    console.print(f"\n[bold yellow]=== {label} ===[/bold yellow]")
    els = await page.query_selector_all(selector)
    console.print(f"Selector: [dim]{selector}[/dim]  matches: {len(els)}")
    for i, el in enumerate(els[:cap]):
        tag = await el.evaluate("el => el.tagName.toLowerCase()")
        cls = (await el.get_attribute("class") or "")[:120]
        text = (await el.text_content() or "").strip().replace("\n", " ")[:200]
        console.print(f"  [{i}] <{tag} class={cls!r}> {text!r}")


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
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass

        # ---- Dump the Quest link on the homework list before you click it. ----
        console.print("\n[bold cyan]Inspecting the Quest cell on the homework list...[/bold cyan]")
        quest_wrapper = await page.query_selector(".quest-wrapper")
        if quest_wrapper:
            html = await quest_wrapper.evaluate("el => el.outerHTML")
            (OUT_DIR / "quest_cell.html").write_text(html)
            console.print(f"[green]Saved quest cell HTML → {OUT_DIR / 'quest_cell.html'}[/green]")
            # Also dump click-y descendants so we can see the target.
            clickables = await quest_wrapper.query_selector_all(
                "a, button, [role='link'], [role='button'], [ng-click], [click], [routerlink]"
            )
            console.print(f"  Found {len(clickables)} click targets in .quest-wrapper")
            for i, c in enumerate(clickables):
                tag = await c.evaluate("el => el.tagName.toLowerCase()")
                cls = (await c.get_attribute("class") or "")[:120]
                text = (await c.text_content() or "").strip()[:120]
                # Grab any attribute that hints at nav intent
                attrs = await c.evaluate(
                    "el => Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value]))"
                )
                interesting = {
                    k: v for k, v in attrs.items()
                    if any(s in k.lower() for s in ("click", "href", "route", "id", "data-"))
                }
                console.print(f"  [{i}] <{tag}> {text!r}")
                console.print(f"      class={cls!r}")
                console.print(f"      attrs={interesting}")
        else:
            console.print("[red]No .quest-wrapper on the page.[/red]")

        console.print(
            "\n[bold yellow]NOW click 'Quest 1. Backwards to the...' in the browser.[/bold yellow]"
        )
        console.print(
            "[yellow]Wait for the quest page to fully render, then press Enter here.[/yellow]"
        )
        await asyncio.get_event_loop().run_in_executor(None, input)

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        console.print(f"\n[bold]Quest page URL:[/bold] {page.url}")
        console.print(f"[bold]Title:[/bold] {await page.title()}")

        # Full body dump.
        body_html = await page.evaluate("document.body.outerHTML")
        html_out = OUT_DIR / "quest_page.html"
        html_out.write_text(body_html)
        console.print(f"[green]Saved body HTML → {html_out}  ({len(body_html)} chars)[/green]")

        shot = OUT_DIR / "quest_page.png"
        await page.screenshot(path=str(shot), full_page=True)
        console.print(f"[green]Saved screenshot → {shot}[/green]")

        # Structural probes.
        await dump_matches(page, "data-id containing quest/assignment", "[data-id*='quest' i], [data-id*='assignment' i]", cap=20)
        await dump_matches(page, "data-qa attributes", "[data-qa]", cap=40)
        await dump_matches(page, "class contains 'quest'", "[class*='quest' i]", cap=25)
        await dump_matches(page, "class contains 'question'", "[class*='question' i]", cap=25)
        await dump_matches(page, "class contains 'problem'", "[class*='problem' i]", cap=25)
        await dump_matches(page, "class contains 'assignment'", "[class*='assignment' i]", cap=25)
        await dump_matches(page, "class contains 'answer'", "[class*='answer' i]", cap=20)
        await dump_matches(page, "class contains 'choice'", "[class*='choice' i]", cap=20)
        await dump_matches(page, "class contains 'option'", "[class*='option' i]", cap=20)

        # Look at any left-panel item list (like the assignment problem map).
        await dump_matches(page, "assignment-item-text (problem map labels)", ".assignment-item-text", cap=40)

        # Look for images (quests might be diagram-heavy).
        imgs = await page.query_selector_all("img")
        console.print(f"\n[bold yellow]=== <img> ===[/bold yellow] count={len(imgs)}")
        for i, img in enumerate(imgs[:15]):
            src = await img.get_attribute("src") or ""
            alt = await img.get_attribute("alt") or ""
            console.print(f"  [{i}] src={src[:180]!r} alt={alt[:60]!r}")

        console.print("\n[dim]Press Enter to close browser.[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
