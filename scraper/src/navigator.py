import re

from playwright.async_api import Page
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from .config import RSM_BASE_URL, SELECTORS, NAV_TIMEOUT_MS
from .extractor import extract_problem
from .models import LessonPayload, ScrapedProblem

console = Console()


HOME_URL = "https://homework.russianschool.com/StudentPortal/#/home"


async def list_assignments(page: Page) -> list[dict]:
    """Navigate to the StudentPortal home and extract every visible assignment.

    Returns a list of dicts: {lesson_number, assignment_id, title}.
    """
    await page.goto(HOME_URL, wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)

    anchors = await page.query_selector_all("a[href*='assignment']")
    results: list[dict] = []
    seen_ids: set[str] = set()
    for a in anchors:
        href = await a.get_attribute("href") or ""
        text = (await a.text_content() or "").strip()

        m_id = re.search(r"assignment/(\d+)", href)
        m_ln = re.search(r"Lesson\s+(\d+)", text)
        if not (m_id and m_ln):
            continue
        assignment_id = m_id.group(1)
        if assignment_id in seen_ids:
            continue
        seen_ids.add(assignment_id)
        results.append({
            "lesson_number": int(m_ln.group(1)),
            "assignment_id": assignment_id,
            "title": text,
        })

    results.sort(key=lambda r: r["lesson_number"])
    return results


async def scrape_assignment(page: Page, assignment_id: str) -> LessonPayload:
    """Navigate to an assignment and extract all problems by URL-based navigation."""
    base_url = f"{RSM_BASE_URL}/#/assignment/{assignment_id}"

    await page.goto(f"{base_url}?q=1", wait_until="domcontentloaded")
    await page.wait_for_selector(SELECTORS["problems_map_items"], timeout=NAV_TIMEOUT_MS)
    await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)

    lesson_number, title, grade_level = await _extract_lesson_info(page)
    grade_str = f" (Grade {grade_level})" if grade_level else " (grade not detected)"
    console.print(f"[green]Loaded: Lesson {lesson_number} — {title}{grade_str}[/green]")

    problem_entries = await _collect_problem_labels(page)
    labels_only = [label for _, label in problem_entries]
    console.print(f"[cyan]Found {len(problem_entries)} problems: {', '.join(labels_only)}[/cyan]")

    problems: list[ScrapedProblem] = []

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Extracting problems...", total=len(problem_entries))

        for display_order, (q_value, label) in enumerate(problem_entries, start=1):
            await page.goto(f"{base_url}?q={q_value}", wait_until="domcontentloaded")
            await _wait_for_selected(page, label)
            await _wait_for_problem(page)

            problem = await extract_problem(
                page, display_order=display_order, problem_number=label
            )
            problems.append(problem)

            img_marker = "📷 " if problem.has_image else ""
            progress.update(
                task,
                advance=1,
                description=f"Extracted {img_marker}problem {label} ({display_order}/{len(problem_entries)})",
            )

    image_count = sum(1 for p in problems if p.has_image)
    console.print(
        f"[green]Done! Extracted {len(problems)} problems ({image_count} with images).[/green]"
    )

    return LessonPayload(
        lesson_number=lesson_number,
        title=title,
        grade_level=grade_level,
        problems=problems,
    )


async def _wait_for_problem(page: Page) -> None:
    """Wait for the problem content area to appear after URL nav."""
    try:
        await page.wait_for_selector(SELECTORS["problem_right_part"], timeout=NAV_TIMEOUT_MS)
    except Exception:
        await page.wait_for_timeout(1500)
    # Give Angular a beat to render the question text.
    await page.wait_for_timeout(400)


async def _wait_for_selected(page: Page, expected_label: str) -> None:
    """Wait until the selected link in problems-map matches the expected label.

    Hash-based navigation (?q=N) doesn't trigger a real page load, so we can't rely
    on wait_for_load_state. The 'selected' class on the sidebar link is the cleanest
    Angular-side signal that the router has caught up to the new q value.
    """
    try:
        await page.wait_for_function(
            """label => {
                const sel = document.querySelector('.problems-map a.problem_number.selected');
                if (!sel) return false;
                return (sel.textContent || '').replace(/\\s+/g, '') === label;
            }""",
            arg=expected_label,
            timeout=5000,
        )
    except Exception:
        # Don't fail the whole scrape — just press on with a buffer.
        await page.wait_for_timeout(800)


async def _extract_lesson_info(page: Page) -> tuple[int, str, int | None]:
    """Pull lesson number, title, and grade from the page.

    The 'Lesson N' text and the 'GrXX_Y--' grade prefix may appear in different
    DOM elements (the existing selector strips the prefix). We extract lesson
    number + title from the targeted selector, then scan the wider body text
    for the grade prefix as a separate signal.

    Returns (lesson_number, title, grade_level). grade_level is None if not
    detectable; the worksheet generator will reject lessons without a grade.
    """
    lesson_number: int | None = None
    title: str | None = None

    candidates = await page.query_selector_all(SELECTORS["lesson_title"])
    for el in candidates:
        text = (await el.text_content() or "").strip()
        match = re.search(r"Lesson\s+(\d+)", text, re.IGNORECASE)
        if match:
            lesson_number = int(match.group(1))
            title = text
            break

    if lesson_number is None:
        # Fallback: scan body text for 'Lesson N'.
        body_text = await page.inner_text("body")
        match = re.search(r"Lesson\s+(\d+)[^\n]{0,80}", body_text, re.IGNORECASE)
        if match:
            lesson_number = int(match.group(1))
            title = match.group(0).strip().splitlines()[0]

    if lesson_number is None or title is None:
        raise RuntimeError(
            "Could not find 'Lesson <N>' on the page — selector may have changed."
        )

    # Grade prefix: 'Gr04_3--Lesson 34 Homework' style. Scan whole page body
    # since the prefix is often outside the lesson-title selector.
    body_text = await page.inner_text("body")
    grade_match = re.search(r"\bGr(\d{1,2})_\d+", body_text, re.IGNORECASE)
    grade_level = int(grade_match.group(1)) if grade_match else None

    return lesson_number, title, grade_level


async def _collect_problem_labels(page: Page) -> list[tuple[int, str]]:
    """Return [(q_value, label), ...] for each navigable problem.

    Angular's ng-repeat indexes `questions` starting at 0, and `go($index+1)` maps
    to ?q=N. The first item is often a TH section header (text="TH", class includes
    'text_number'); we skip it but its position still counts toward the q index.
    """
    items = await page.query_selector_all(SELECTORS["problems_map_items"])
    label_class = SELECTORS["problems_map_label_class"]

    entries: list[tuple[int, str]] = []
    for q_index, item in enumerate(items, start=1):
        cls = await item.get_attribute("class") or ""
        if label_class in cls.split():
            continue  # skip TH header (still occupies a q slot)
        text = (await item.text_content() or "").strip()
        text = re.sub(r"\s+", "", text)
        if text:
            entries.append((q_index, text))

    return entries


async def discover_selectors(page: Page) -> None:
    """Interactive mode: dump DOM structure to help identify correct selectors."""
    console.print("[bold cyan]Discovery Mode[/bold cyan]")
    console.print("Navigate to a lesson problem page in the browser, then press Enter here.")

    import asyncio
    await asyncio.get_event_loop().run_in_executor(None, input)

    console.print("\n[bold]Page URL:[/bold]", page.url)
    console.print("\n[bold]Page title:[/bold]", await page.title())

    async def dump(label: str, selector: str, limit: int = 1500) -> None:
        el = await page.query_selector(selector)
        if not el:
            console.print(f"\n[red]<{label}> NOT FOUND ({selector})[/red]")
            return
        html = await el.inner_html()
        snippet = html[:limit].replace("\n", " ").replace("  ", " ")
        console.print(f"\n[bold yellow]=== {label} ({selector}) ===[/bold yellow]")
        console.print(snippet)
        if len(html) > limit:
            console.print(f"[dim]... (truncated, {len(html) - limit} more chars)[/dim]")

    await dump("problems-map", ".problems-map")
    # For subproblem debugging — dump LOTS more content
    await dump("problem-section", ".problem-section", 6000)
    await dump("problem-text", ".problem-text", 3000)
    await dump("problem-right-part", ".problem-right-part", 4000)
    await dump("problem-question", ".problem-right-part .problem-question", 2000)

    # Look for math expressions / specific subpart content
    console.print("\n[bold]MathML / KaTeX / math elements in problem area:[/bold]")
    math_els = await page.query_selector_all(
        ".problem-section math, .problem-section .katex, .problem-section [class*='math'], .problem-section [class*='formula'], .problem-section [class*='expression']"
    )
    for el in math_els[:10]:
        tag = await el.evaluate("el => el.tagName.toLowerCase()")
        cls = await el.get_attribute("class") or ""
        text = (await el.text_content() or "").strip()[:100]
        console.print(f"  <{tag} class='{cls}'> text={text!r}")

    # Inputs and their immediate context (label / preceding text)
    console.print("\n[bold]All inputs/textareas with surrounding text:[/bold]")
    all_inputs = await page.query_selector_all(
        ".problem-section input, .problem-section textarea, .problem-section select"
    )
    for inp in all_inputs[:15]:
        tag = await inp.evaluate("el => el.tagName.toLowerCase()")
        cls = await inp.get_attribute("class") or ""
        # Get the parent's text content to see what label/expression surrounds it
        parent_text = await inp.evaluate("""el => {
            const p = el.closest('div, span, label, td, li');
            return p ? (p.innerText || p.textContent || '').slice(0, 200) : '';
        }""")
        console.print(f"  <{tag} class='{cls}'>")
        console.print(f"    parent text: {parent_text!r}")

    # Any element near the problem area with "subproblem", "subpart", "letter", "part" in class
    console.print("\n[bold]Possible subpart container elements:[/bold]")
    subpart_els = await page.query_selector_all(
        ".problem-section [class*='subproblem'], .problem-section [class*='subpart'], .problem-section [class*='letter'], .problem-section [class*='part'], .problem-section [class*='question-part']"
    )
    for el in subpart_els[:10]:
        cls = await el.get_attribute("class") or ""
        text = (await el.text_content() or "").strip()[:150]
        console.print(f"  class='{cls}' text={text!r}")

    inputs = await page.query_selector_all(
        ".problem-section input, .problem-section select, .problem-section textarea"
    )
    console.print(f"\n[bold]Inputs inside .problem-section: {len(inputs)}[/bold]")
    for inp in inputs[:10]:
        tag = await inp.evaluate("el => el.tagName.toLowerCase()")
        type_attr = await inp.get_attribute("type") or ""
        name = await inp.get_attribute("name") or ""
        cls = await inp.get_attribute("class") or ""
        placeholder = await inp.get_attribute("placeholder") or ""
        console.print(f"  <{tag} type='{type_attr}' name='{name}' class='{cls}' placeholder='{placeholder}'>")

    imgs = await page.query_selector_all(".problem-section img, .problem-right-part img")
    console.print(f"\n[bold]Images in problem area: {len(imgs)}[/bold]")
    for img in imgs[:5]:
        src = await img.get_attribute("src") or ""
        alt = await img.get_attribute("alt") or ""
        console.print(f"  src={src[:120]} alt={alt}")

    console.print("\n[bold]Elements containing 'Lesson':[/bold]")
    lesson_els = await page.query_selector_all("text=/Lesson \\d+/")
    for el in lesson_els[:10]:
        tag = await el.evaluate("el => el.tagName.toLowerCase()")
        text = (await el.text_content() or "").strip()[:80]
        console.print(f"  <{tag}> {text}")

    console.print("\n[bold]Children of .problems-map (first 5):[/bold]")
    map_children = await page.query_selector_all(".problems-map > *")
    for i, child in enumerate(map_children[:5]):
        tag = await child.evaluate("el => el.tagName.toLowerCase()")
        cls = await child.get_attribute("class") or ""
        text = (await child.text_content() or "").strip()[:80]
        console.print(f"  [{i}] <{tag} class='{cls}'> text={text!r}")

    buttons = await page.query_selector_all("button, a[role='button']")
    console.print(f"\n[bold]Found {len(buttons)} buttons:[/bold]")
    for btn in buttons:
        text = (await btn.text_content() or "").strip()
        classes = await btn.get_attribute("class") or ""
        if text:
            console.print(f"  [{classes}] {text}")
