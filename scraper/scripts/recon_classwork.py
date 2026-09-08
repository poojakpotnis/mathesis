"""Recon the classwork surface on the new RSM student portal.

Two-step probe:
  1. Navigate to the classwork listing (from a homework page's "Lesson N
     Classwork" dropdown, or wherever it lives), then dump the list DOM so
     we can extract each assignment's ID + title.
  2. Click one classwork assignment and dump its page to confirm the walker
     pattern matches homework (same [data-qa='assignment-item-selector-btn'],
     same [data-qa='question-problem'] shape).

Usage (from scraper/):
    uv run python -m scripts.recon_classwork
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.async_api import async_playwright
from rich.console import Console

from src.config import BROWSER_STATE_DIR

console = Console()

HOMEWORK_URL = "https://student.russianschool.com/student-portal/content/homework"
OUT_DIR = Path(__file__).parent.parent / "storage"


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
            "\n[bold yellow]Step 1 — navigate to the classwork listing.[/bold yellow]"
        )
        console.print(
            "  Click HOMEWORK 1, then click LESSON 1 CLASSWORK in the top-right dropdown,"
        )
        console.print(
            "  OR go via 'My Class And I' → classwork — whichever path works."
        )
        console.print(
            "  You should end up on a page listing 7 assignments (CONSECUTIVE NUMBERS, etc.)."
        )
        console.print("[dim]Press Enter here once the classwork list is fully rendered.[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        console.print(f"\n[bold]Classwork list URL:[/bold] {page.url}")
        console.print(f"[bold]Title:[/bold] {await page.title()}")

        # Full dump of the listing.
        body_html = await page.evaluate("document.body.outerHTML")
        (OUT_DIR / "classwork_list.html").write_text(body_html)
        console.print(
            f"[green]Saved list HTML → {OUT_DIR / 'classwork_list.html'} "
            f"({len(body_html)} chars)[/green]"
        )
        await page.screenshot(
            path=str(OUT_DIR / "classwork_list.png"), full_page=True
        )

        # Probe for assignment IDs and titles on the list.
        console.print("\n[bold yellow]=== Assignment IDs found in the list ===[/bold yellow]")
        # Reuse the same trick as list_assignments — data-id="assignment-<ID>".
        rows = await page.evaluate(
            """() => {
                const out = [];
                const seen = new Set();
                for (const el of document.querySelectorAll("[data-id^='assignment-']")) {
                    const id = (el.getAttribute('data-id') || '').replace('assignment-', '');
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    // Walk up to grab the row's visible label.
                    let row = el;
                    for (let i = 0; i < 8 && row; i++) {
                        const t = (row.innerText || '').trim();
                        if (t.length > 5) { break; }
                        row = row.parentElement;
                    }
                    const text = row ? (row.innerText || '').trim().slice(0, 200) : '';
                    out.push({ id, text });
                }
                return out;
            }"""
        )
        console.print(f"Found {len(rows)} assignments:")
        for r in rows[:20]:
            console.print(f"  [cyan]{r['id']}[/cyan]  {r['text'][:140]!r}")

        # Also probe row-label class names since classwork may have different wrappers.
        for label, sel in [
            ("class contains 'classwork'", "[class*='classwork' i]"),
            ("class contains 'assignment-title'", "[class*='assignment-title' i]"),
            ("class contains 'homework-name'", "[class*='homework-name' i]"),
            ("data-qa attrs", "[data-qa]"),
        ]:
            els = await page.query_selector_all(sel)
            console.print(f"  [dim]{label:40s}[/dim] count={len(els)}")

        console.print(
            "\n[bold yellow]Step 2 — click into ONE classwork assignment "
            "(e.g. CONSECUTIVE NUMBERS).[/bold yellow]"
        )
        console.print(
            "  Wait for it to render (should look like the homework assignment page),"
            " then press Enter here."
        )
        await asyncio.get_event_loop().run_in_executor(None, input)

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        console.print(f"\n[bold]Classwork assignment URL:[/bold] {page.url}")

        body_html2 = await page.evaluate("document.body.outerHTML")
        (OUT_DIR / "classwork_assignment.html").write_text(body_html2)
        await page.screenshot(
            path=str(OUT_DIR / "classwork_assignment.png"), full_page=True
        )
        console.print(
            f"[green]Saved assignment HTML → {OUT_DIR / 'classwork_assignment.html'} "
            f"({len(body_html2)} chars)[/green]"
        )

        # Check that the walker's homework selectors still work here.
        for label, sel in [
            ("problem-map buttons", "[data-qa='assignment-item-selector-btn']"),
            ("problem-map labels", ".assignment-item-text"),
            ("current problem's question", "[data-qa='question-problem']"),
            ("current problem's subproblem", "[data-qa='question-subproblem']"),
            ("assignment title", "[data-qa='assignment-title']"),
            ("print button", "[data-qa='print-assignment-button']"),
        ]:
            els = await page.query_selector_all(sel)
            console.print(f"  [cyan]{label:35s}[/cyan] count={len(els)}  ← {sel}")

        # Also grab the current-problem number for context.
        title_el = await page.query_selector("[data-qa='assignment-title']")
        if title_el:
            console.print(f"\n  Header title: {(await title_el.text_content() or '').strip()!r}")

        # Extract data-id on the assignment root — proves same shape as homework.
        assignment_id = await page.evaluate(
            """() => {
                const el = document.querySelector("[data-id^='assignment-']");
                return el ? (el.getAttribute('data-id') || '').replace('assignment-', '') : null;
            }"""
        )
        console.print(f"  Assignment root data-id: {assignment_id!r}")

        console.print("\n[dim]Press Enter to close browser.[/dim]")
        await asyncio.get_event_loop().run_in_executor(None, input)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
