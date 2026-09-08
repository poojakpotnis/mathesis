import re

from playwright.async_api import Page
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from .config import HOMEWORK_LIST_URL, RSM_BASE_URL, SELECTORS, NAV_TIMEOUT_MS
from .extractor import extract_problem
from .models import LessonPayload, ScrapedProblem


CLASSWORK_LIST_URL_TEMPLATE = (
    RSM_BASE_URL + "/student-portal/content/classwork?classId={class_id}"
)
ASSIGNMENT_URL_TEMPLATE = RSM_BASE_URL + "/student-portal/content/assignment/{assignment_id}"

console = Console()


async def list_assignments(page: Page) -> list[dict]:
    """Scan the homework list page for every homework assignment visible.

    Returns [{lesson_number, assignment_id, title}, ...].

    On the new student portal each row exposes:
      - a "HOMEWORK N" label (lesson number)
      - the row wrapper carries data-id="assignment-<ID>"
      - a title line below the label
    Quests live in a separate column and are skipped in this pass.
    """
    await page.goto(HOMEWORK_LIST_URL, wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)
    # Row rendering is async — wait for at least one assignment card.
    try:
        await page.wait_for_selector("[data-id^='assignment-']", timeout=NAV_TIMEOUT_MS)
    except Exception:
        raise RuntimeError(
            "No assignments visible on the homework list. "
            "Either the page didn't render or the selector changed."
        )

    rows = await page.evaluate(
        """() => {
            // Walk every element that declares itself as an assignment. Filter to
            // homework-only by locating the ancestor row that has a HOMEWORK label.
            const out = [];
            const seen = new Set();
            const els = document.querySelectorAll("[data-id^='assignment-']");
            for (const el of els) {
                const id = (el.getAttribute('data-id') || '').replace('assignment-', '');
                if (!id || seen.has(id)) continue;

                // Find the ancestor row (broadest container that also holds the
                // HOMEWORK N label). We walk up until we find an element whose
                // text contains "HOMEWORK <num>".
                let row = el;
                let hwMatch = null;
                for (let i = 0; i < 8 && row; i++) {
                    const t = (row.innerText || '').trim();
                    hwMatch = t.match(/HOMEWORK\\s+(\\d+)/i);
                    if (hwMatch) break;
                    row = row.parentElement;
                }
                if (!hwMatch) continue;  // not a homework row (e.g. a quest-only element)
                seen.add(id);

                const lessonNumber = parseInt(hwMatch[1], 10);
                // Title is the line right after "HOMEWORK N" in the row's text.
                const rowText = (row.innerText || '').replace(/\\s+/g, ' ').trim();
                const titleMatch = rowText.match(/HOMEWORK\\s+\\d+\\s*(?:→|->)?\\s*([^→]+?)(?:\\s+see classwork|$)/i);
                const title = titleMatch ? titleMatch[1].trim() : rowText.slice(0, 200);

                out.push({ lessonNumber, assignmentId: id, title });
            }
            return out;
        }"""
    )

    results = [
        {
            "lesson_number": r["lessonNumber"],
            "assignment_id": r["assignmentId"],
            "title": r["title"],
        }
        for r in rows
    ]
    results.sort(key=lambda r: r["lesson_number"])
    return results


async def scrape_assignment(
    page: Page,
    assignment_id: str,
    grade_override: int | None = None,
    source: str = "homework",
    source_assignment_title: str | None = None,
) -> LessonPayload:
    """Open an assignment on the new portal, walk each problem, extract them.

    Works for both homework and classwork — the DOM is identical. `source`
    tags the resulting payload so the ingest handler can route it correctly
    (homework = updates lesson metadata; classwork = attaches problems
    without overwriting the lesson's title/grade).
    """

    await _navigate_to_assignment(page, assignment_id)

    lesson_number, title = await _extract_lesson_info(page)
    grade_level = grade_override  # new portal has no reliable page-side grade signal
    grade_str = f" (Grade {grade_override}, user-set)" if grade_override else " (grade not set)"
    source_str = f" [{source}]" if source != "homework" else ""
    console.print(
        f"[green]Loaded: Lesson {lesson_number} — {title}{grade_str}{source_str}[/green]"
    )

    problem_labels = await _collect_problem_labels(page)
    console.print(
        f"[cyan]Found {len(problem_labels)} problems: {', '.join(problem_labels)}[/cyan]"
    )

    problems: list[ScrapedProblem] = []

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Extracting problems...", total=len(problem_labels))

        for display_order, label in enumerate(problem_labels, start=1):
            await _click_problem(page, label)
            await _wait_for_problem(page)

            problem = await extract_problem(
                page, display_order=display_order, problem_number=label
            )
            problems.append(problem)

            img_marker = "📷 " if problem.has_image else ""
            progress.update(
                task,
                advance=1,
                description=f"Extracted {img_marker}problem {label} ({display_order}/{len(problem_labels)})",
            )

    image_count = sum(1 for p in problems if p.has_image)
    console.print(
        f"[green]Done! Extracted {len(problems)} problems ({image_count} with images).[/green]"
    )

    return LessonPayload(
        lesson_number=lesson_number,
        title=title,
        grade_level=grade_level,
        source=source,
        source_assignment_id=assignment_id if source == "classwork" else None,
        source_assignment_title=source_assignment_title if source == "classwork" else None,
        problems=problems,
    )


async def _navigate_to_assignment(page: Page, assignment_id: str) -> None:
    """Get from the current page to the assignment view for `assignment_id`.

    Try direct URL navigation first (works for both homework and classwork on
    the new portal). If the assignment page doesn't render for some reason,
    fall back to the homework-list click path.
    """
    direct_url = ASSIGNMENT_URL_TEMPLATE.format(assignment_id=assignment_id)
    await page.goto(direct_url, wait_until="domcontentloaded")
    try:
        await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)
        await page.wait_for_selector(SELECTORS["problems_map_items"], timeout=10000)
        return
    except Exception:
        # Direct URL didn't land on the assignment view — fall back to the
        # homework-list click-through.
        pass

    await page.goto(HOMEWORK_LIST_URL, wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)
    await page.wait_for_selector(
        f"[data-id='assignment-{assignment_id}']", timeout=NAV_TIMEOUT_MS
    )

    # Click the "HOMEWORK N →" link inside the target row.
    clicked = await page.evaluate(
        """(id) => {
            const anchor = document.querySelector(`[data-id='assignment-${id}']`);
            if (!anchor) return false;
            // Walk up to find the row, then find the clickable homework link inside.
            let row = anchor;
            for (let i = 0; i < 8 && row; i++) {
                const t = (row.innerText || '');
                if (/HOMEWORK\\s+\\d+/i.test(t)) break;
                row = row.parentElement;
            }
            if (!row) return false;
            // Anything clickable whose text starts with 'HOMEWORK'.
            const candidates = row.querySelectorAll('a, button, [role="link"], [role="button"]');
            for (const c of candidates) {
                const txt = (c.innerText || c.textContent || '').trim();
                if (/^HOMEWORK\\s+\\d+/i.test(txt)) {
                    c.click();
                    return true;
                }
            }
            // Fallback: click the row wrapper itself.
            row.click();
            return true;
        }""",
        assignment_id,
    )
    if not clicked:
        raise RuntimeError(f"Couldn't find clickable HOMEWORK link for assignment {assignment_id}")

    # Wait until we're on the assignment view (problem-map buttons render there).
    await page.wait_for_selector(SELECTORS["problems_map_items"], timeout=NAV_TIMEOUT_MS)
    await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)


async def _extract_lesson_info(page: Page) -> tuple[int, str]:
    """Pull (lesson_number, title) from the assignment page header.

    Two header formats are in play:
      - Homework: "Homework 1 | Natural, Whole, and Integer Numbers…"
      - Classwork: "Lesson 1 | Consecutive Numbers"
    Both encode the lesson number the same way; we strip whichever prefix
    matches and keep the descriptive part as the title.
    """
    header_text = ""
    el = await page.query_selector(SELECTORS["assignment_title"])
    if el:
        header_text = (await el.text_content() or "").strip()

    if not header_text:
        header_text = (await page.title() or "").strip()

    match = re.search(r"(?:Homework|Lesson)\s+(\d+)", header_text, re.IGNORECASE)
    if not match:
        raise RuntimeError(
            f"Could not find 'Homework <N>' or 'Lesson <N>' in header: {header_text!r}"
        )
    lesson_number = int(match.group(1))
    title = re.sub(
        r"^\s*(?:Homework|Lesson)\s+\d+\s*[|:-]\s*", "", header_text
    ).strip()
    if not title:
        title = header_text
    return lesson_number, title


async def _collect_problem_labels(page: Page) -> list[str]:
    """Return the ordered list of problem labels (e.g. ['19','20','30',...,'51a','51b',...])."""
    buttons = await page.query_selector_all(SELECTORS["problems_map_items"])
    labels: list[str] = []
    for btn in buttons:
        text_el = await btn.query_selector(SELECTORS["problems_map_item_label"])
        target = text_el or btn
        text = (await target.text_content() or "").strip()
        text = re.sub(r"\s+", "", text)
        if text:
            labels.append(text)
    return labels


async def _click_problem(page: Page, label: str) -> None:
    """Click the problem-map button whose label matches `label` exactly."""
    clicked = await page.evaluate(
        """({selector, labelSelector, label}) => {
            const btns = document.querySelectorAll(selector);
            for (const b of btns) {
                const lbl = b.querySelector(labelSelector);
                const t = ((lbl || b).textContent || '').replace(/\\s+/g, '');
                if (t === label) { b.click(); return true; }
            }
            return false;
        }""",
        {
            "selector": SELECTORS["problems_map_items"],
            "labelSelector": SELECTORS["problems_map_item_label"],
            "label": label,
        },
    )
    if not clicked:
        raise RuntimeError(f"Could not find problem-map button for label {label!r}")


async def _wait_for_problem(page: Page) -> None:
    """Wait for the problem's question content to render after a nav click."""
    try:
        await page.wait_for_selector(SELECTORS["problem_question"], timeout=NAV_TIMEOUT_MS)
    except Exception:
        await page.wait_for_timeout(1500)
    # Give Angular a beat to swap the question text after the router settles.
    await page.wait_for_timeout(400)


async def list_classwork(
    page: Page, lesson_number: int, class_id: str
) -> list[dict]:
    """Return the classwork assignments for a given lesson number.

    Each result: {lesson_number, assignment_id, title}.

    Classwork list entries expose no assignment ID in the DOM — only a
    click handler. We navigate to the list, click each entry that matches
    "Lesson <N> | ...", capture the resulting URL to pull the assignment
    ID out, then goto the list again for the next entry.
    """
    list_url = CLASSWORK_LIST_URL_TEMPLATE.format(class_id=class_id)

    async def _load_list() -> list[dict]:
        await page.goto(list_url, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)
        await page.wait_for_selector(
            "[data-qa='classwork-assignment-navigate-link']", timeout=NAV_TIMEOUT_MS
        )
        return await page.evaluate(
            """(lessonNum) => {
                const items = document.querySelectorAll(
                    "[data-qa='classwork-assignment-navigate-link']"
                );
                const out = [];
                items.forEach((el, index) => {
                    const titleEl = el.querySelector('.classwork-title');
                    const raw = ((titleEl || el).textContent || '').replace(/\\s+/g, ' ').trim();
                    const m = raw.match(/^Lesson\\s+(\\d+)\\s*\\|\\s*(.+)$/i);
                    if (m && parseInt(m[1], 10) === lessonNum) {
                        out.push({ index, fullTitle: raw, subTitle: m[2].trim() });
                    }
                });
                return out;
            }""",
            lesson_number,
        )

    initial = await _load_list()
    if not initial:
        console.print(
            f"[yellow]No classwork found for lesson {lesson_number} at {list_url}[/yellow]"
        )
        return []

    console.print(
        f"[cyan]Discovering {len(initial)} classwork assignments for lesson {lesson_number}...[/cyan]"
    )

    results: list[dict] = []
    for i, entry in enumerate(initial):
        if i > 0:
            # Re-load the list before each click; the SPA state doesn't
            # survive an assignment navigation.
            await _load_list()

        # Click by INDEX into the querySelectorAll result. Title matching
        # doesn't work: the classwork list sometimes has two entries with
        # identical titles ("How Many Numbers?") that resolve to different
        # assignment IDs; endsWith would collapse them.
        clicked = await page.evaluate(
            """({index}) => {
                const items = document.querySelectorAll(
                    "[data-qa='classwork-assignment-navigate-link']"
                );
                if (index >= items.length) return false;
                items[index].click();
                return true;
            }""",
            {"index": entry["index"]},
        )
        if not clicked:
            console.print(
                f"[yellow]Skipped classwork {entry['subTitle']!r}: couldn't click[/yellow]"
            )
            continue

        # Wait for the URL to change to an assignment page.
        try:
            await page.wait_for_url(
                re.compile(r"/student-portal/content/assignment/\d+"),
                timeout=NAV_TIMEOUT_MS,
            )
        except Exception:
            console.print(
                f"[yellow]Skipped classwork {entry['subTitle']!r}: no URL change[/yellow]"
            )
            continue

        m = re.search(r"/assignment/(\d+)", page.url)
        if not m:
            console.print(
                f"[yellow]Skipped classwork {entry['subTitle']!r}: no assignment id in {page.url}[/yellow]"
            )
            continue

        results.append(
            {
                "lesson_number": lesson_number,
                "assignment_id": m.group(1),
                "title": entry["subTitle"],
            }
        )
        console.print(
            f"  [dim]→[/dim] [cyan]{m.group(1)}[/cyan]  {entry['subTitle']!r}"
        )

    return results


async def discover_selectors(page: Page) -> None:
    """Interactive dump of the currently-loaded assignment page.

    Kept as a debugging tool — navigate manually to whatever page you want
    to inspect, press Enter, and the visible-DOM probes fire.
    """
    console.print("[bold cyan]Discovery Mode[/bold cyan]")
    console.print("Navigate to an assignment page in the browser, then press Enter here.")

    import asyncio
    await asyncio.get_event_loop().run_in_executor(None, input)

    console.print("\n[bold]Page URL:[/bold]", page.url)
    console.print("[bold]Page title:[/bold]", await page.title())

    async def dump(label: str, selector: str, limit: int = 2000) -> None:
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

    await dump("assignment title", SELECTORS["assignment_title"])
    await dump("problem question", SELECTORS["problem_question"], 3000)
    await dump("first problem-map button", SELECTORS["problems_map_items"])

    labels = await _collect_problem_labels(page)
    console.print(f"\n[bold]Problem labels ({len(labels)}):[/bold] {', '.join(labels)}")
