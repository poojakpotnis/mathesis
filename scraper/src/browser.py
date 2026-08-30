from playwright.async_api import async_playwright, BrowserContext, Page
from rich.console import Console

from .config import (
    BROWSER_STATE_DIR,
    HOMEWORK_LIST_URL,
    SELECTORS,
    LOGIN_TIMEOUT_SECONDS,
)

console = Console()


async def get_browser_context() -> tuple:
    """Launch Playwright with persistent context for session reuse."""
    BROWSER_STATE_DIR.mkdir(parents=True, exist_ok=True)

    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=str(BROWSER_STATE_DIR),
        headless=False,
        viewport={"width": 1280, "height": 900},
        args=["--disable-blink-features=AutomationControlled"],
    )
    return pw, context


async def ensure_authenticated(context: BrowserContext) -> Page:
    """Navigate to the homework list and ensure the session is logged in.

    Prompts the user to log in in the visible browser if the session expired.
    """
    page = context.pages[0] if context.pages else await context.new_page()
    await page.goto(HOMEWORK_LIST_URL, wait_until="domcontentloaded")
    try:
        await page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

    try:
        await page.wait_for_selector(
            SELECTORS["authenticated_indicator"], timeout=3000
        )
        console.print("[green]Session active — already logged in.[/green]")
        return page
    except Exception:
        pass

    console.print(
        "[yellow]Please log in to the RSM portal in the browser window.[/yellow]"
    )
    console.print(
        f"[yellow]Waiting up to {LOGIN_TIMEOUT_SECONDS}s for login...[/yellow]"
    )

    try:
        await page.wait_for_selector(
            SELECTORS["authenticated_indicator"],
            timeout=LOGIN_TIMEOUT_SECONDS * 1000,
        )
        console.print("[green]Login successful![/green]")
        return page
    except Exception:
        console.print("[red]Login timed out. Please try again.[/red]")
        raise SystemExit(1)
