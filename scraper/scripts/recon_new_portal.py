"""Recon the *new* RSM student portal (student.russianschool.com).

Opens a headed browser, waits for you to log in and land on the homework page,
then dumps the DOM so we can figure out selectors for homework problems and
quest questions.

Usage (from scraper/):
    uv run python -m scripts.recon_new_portal
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.async_api import async_playwright
from rich.console import Console

from src.config import BROWSER_STATE_DIR

console = Console()

TARGET_URL = "https://student.russianschool.com/student-portal/content/homework"
OUT_DIR = Path(__file__).parent.parent / "storage"


async def dump_matches(page, label: str, selector: str, cap: int = 40) -> None:
    console.print(f"\n[bold yellow]=== {label} ===[/bold yellow]")
    els = await page.query_selector_all(selector)
    console.print(f"Selector: [dim]{selector}[/dim]  matches: {len(els)}")
    for i, el in enumerate(els[:cap]):
        tag = await el.evaluate("el => el.tagName.toLowerCase()")
        cls = (await el.get_attribute("class") or "")[:120]
        text = (await el.text_content() or "").strip().replace("\n", " ")[:160]
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

        console.print(f"[bold cyan]Navigating to:[/bold cyan] {TARGET_URL}")
        await page.goto(TARGET_URL, wait_until="domcontentloaded")

        console.print(
            "\n[yellow]If a login page appears, log in in the browser window.[/yellow]"
        )
        console.print(
            "[yellow]Once you see the 5th-grade homework list, press Enter here.[/yellow]"
        )
        await asyncio.get_event_loop().run_in_executor(None, input)

        # Give the SPA a beat to render whatever the user just navigated to.
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1.5)

        console.print(f"\n[bold]Final URL:[/bold] {page.url}")
        console.print(f"[bold]Title:[/bold] {await page.title()}")

        # High-level structural probes.
        await dump_matches(page, "Anchors with 'homework' in href", "a[href*='homework']", cap=40)
        await dump_matches(page, "Anchors with 'assignment' in href", "a[href*='assignment']", cap=40)
        await dump_matches(page, "Anchors with 'quest' in href", "a[href*='quest' i]", cap=40)
        await dump_matches(page, "Anchors with 'lesson' in href", "a[href*='lesson' i]", cap=40)
        await dump_matches(page, "Anchors with 'problem' in href", "a[href*='problem' i]", cap=40)

        # Text-based probes.
        await dump_matches(page, "Elements matching /Lesson \\d+/", "text=/Lesson\\s+\\d+/i", cap=40)
        await dump_matches(page, "Elements matching /Quest/", "text=/quest/i", cap=40)
        await dump_matches(page, "Elements matching /Homework/", "text=/homework/i", cap=40)
        await dump_matches(page, "Elements matching /Problem\\s*\\d+/", "text=/problem\\s*\\d+/i", cap=40)
        await dump_matches(page, "Elements matching /Grade\\s*5/", "text=/grade\\s*5/i", cap=20)

        # Common class-name hunts for problem/question containers.
        await dump_matches(page, "Class contains 'problem'", "[class*='problem' i]", cap=25)
        await dump_matches(page, "Class contains 'question'", "[class*='question' i]", cap=25)
        await dump_matches(page, "Class contains 'quest'", "[class*='quest' i]", cap=25)
        await dump_matches(page, "Class contains 'assignment'", "[class*='assignment' i]", cap=25)
        await dump_matches(page, "Class contains 'homework'", "[class*='homework' i]", cap=25)
        await dump_matches(page, "Class contains 'lesson'", "[class*='lesson' i]", cap=25)
        await dump_matches(page, "Class contains 'card'", "[class*='card' i]", cap=25)

        # List / grid containers that might hold the assignment cards.
        await dump_matches(page, "role=list / role=listitem", "[role='list'], [role='listitem']", cap=20)

        # Any images (often diagrams for math problems).
        imgs = await page.query_selector_all("img")
        console.print(f"\n[bold yellow]=== <img> elements ===[/bold yellow] count={len(imgs)}")
        for i, img in enumerate(imgs[:15]):
            src = await img.get_attribute("src") or ""
            alt = await img.get_attribute("alt") or ""
            console.print(f"  [{i}] src={src[:180]!r} alt={alt[:60]!r}")

        # Dump full body HTML for offline inspection.
        body_html = await page.evaluate("document.body.outerHTML")
        html_out = OUT_DIR / "new_portal_homework.html"
        html_out.write_text(body_html)
        console.print(f"\n[green]Saved body HTML → {html_out}[/green]")

        # Also screenshot for visual reference.
        shot_out = OUT_DIR / "new_portal_homework.png"
        await page.screenshot(path=str(shot_out), full_page=True)
        console.print(f"[green]Saved screenshot → {shot_out}[/green]")

        console.print(
            "\n[bold cyan]Now (optional) click into ONE homework assignment "
            "and ONE quest, so we can see problem-page structure too.[/bold cyan]"
        )
        console.print(
            "[dim]Press Enter here after opening a homework assignment page "
            "(or immediately, to skip).[/dim]"
        )
        await asyncio.get_event_loop().run_in_executor(None, input)

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        console.print(f"\n[bold]Assignment page URL:[/bold] {page.url}")
        body_html2 = await page.evaluate("document.body.outerHTML")
        html_out2 = OUT_DIR / "new_portal_assignment.html"
        html_out2.write_text(body_html2)
        console.print(f"[green]Saved body HTML → {html_out2}[/green]")

        await dump_matches(page, "Class contains 'problem' (assignment page)", "[class*='problem' i]", cap=30)
        await dump_matches(page, "Class contains 'question' (assignment page)", "[class*='question' i]", cap=30)
        await dump_matches(page, "Class contains 'answer' (assignment page)", "[class*='answer' i]", cap=20)
        await dump_matches(page, "Class contains 'choice' (assignment page)", "[class*='choice' i]", cap=20)
        await dump_matches(page, "Elements matching /Problem\\s*\\d+/ (assignment page)", "text=/problem\\s*\\d+/i", cap=40)

        shot_out2 = OUT_DIR / "new_portal_assignment.png"
        await page.screenshot(path=str(shot_out2), full_page=True)
        console.print(f"[green]Saved screenshot → {shot_out2}[/green]")

        console.print(
            "\n[dim]Optionally navigate to a QUEST now, then press Enter. "
            "(Or just press Enter to finish.)[/dim]"
        )
        await asyncio.get_event_loop().run_in_executor(None, input)

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        console.print(f"\n[bold]Quest page URL:[/bold] {page.url}")
        body_html3 = await page.evaluate("document.body.outerHTML")
        html_out3 = OUT_DIR / "new_portal_quest.html"
        html_out3.write_text(body_html3)
        console.print(f"[green]Saved body HTML → {html_out3}[/green]")

        shot_out3 = OUT_DIR / "new_portal_quest.png"
        await page.screenshot(path=str(shot_out3), full_page=True)
        console.print(f"[green]Saved screenshot → {shot_out3}[/green]")

        console.print("\n[dim]Press Enter to close browser.[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
