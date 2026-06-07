import re

from playwright.async_api import Page

from .config import SELECTORS
from .models import ScrapedProblem


async def extract_problem(
    page: Page, display_order: int, problem_number: str
) -> ScrapedProblem:
    """Extract a single problem from the currently displayed page."""

    problem_text = await _get_problem_text(page)
    has_image = await _has_images(page)
    image_description = await _get_image_alts(page) if has_image else None
    hint_text = await _get_hint_text(page)
    answer_format_type = await _detect_answer_format(page)
    credit_status, score = await _get_credit_and_score(page)
    is_take_home = await _is_take_home(page)
    raw_html = await _safe_inner_html(page, SELECTORS["problem_right_part"])

    return ScrapedProblem(
        problem_number=problem_number,
        display_order=display_order,
        problem_text=problem_text,
        is_take_home=is_take_home,
        has_image=has_image,
        image_description=image_description,
        hint_text=hint_text,
        answer_format_type=answer_format_type,
        credit_status=credit_status,
        score=score,
        raw_html=raw_html,
    )


async def _get_problem_text(page: Page) -> str:
    """Pull and clean the problem question text.

    Subproblems have TWO .problem-question elements:
    - umbrella (problem.text, e.g. "Calculate.")
    - specific subpart (question.text, e.g. "1/2 of 1/3 is ____.")
    We concatenate both, render fractions as "(top/bottom)", normalize blanks.
    """
    els = await page.query_selector_all(".problem-right-part .problem-question")
    if not els:
        el = await page.query_selector(SELECTORS["problem_right_part"])
        if el:
            return _clean_text(await el.text_content() or "")
        return ""

    parts: list[str] = []
    for el in els:
        rendered = await el.evaluate(
            """
            (node) => {
                const clone = node.cloneNode(true);
                clone.querySelectorAll('table.fraction').forEach(tbl => {
                    const top = (tbl.querySelector('.fraction-top')?.innerText || '?').trim();
                    const bot = (tbl.querySelector('.fraction-bottom')?.innerText || '?').trim();
                    tbl.replaceWith(document.createTextNode(' (' + top + '/' + bot + ') '));
                });
                clone.querySelectorAll('sup').forEach(s => {
                    s.replaceWith(document.createTextNode('^' + (s.innerText || s.textContent || '')));
                });
                clone.querySelectorAll('sub').forEach(s => {
                    s.replaceWith(document.createTextNode('_' + (s.innerText || s.textContent || '')));
                });
                clone.querySelectorAll('.rsm-placeholder').forEach(ph => {
                    ph.replaceWith(document.createTextNode(' ___ '));
                });
                return clone.innerText || clone.textContent || '';
            }
            """
        )
        cleaned = _clean_text(rendered)
        if cleaned:
            parts.append(cleaned)

    return " ".join(parts)


def _clean_text(text: str) -> str:
    text = text.replace(" ", " ").replace("‍", "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"_{3,}", "___", text).strip()
    return text


async def _has_images(page: Page) -> bool:
    imgs = await page.query_selector_all(SELECTORS["problem_images"])
    for img in imgs:
        try:
            box = await img.bounding_box()
            if box and box["width"] >= 30 and box["height"] >= 30:
                return True
        except Exception:
            continue
    return False


async def _get_image_alts(page: Page) -> str | None:
    imgs = await page.query_selector_all(SELECTORS["problem_images"])
    alts = []
    for img in imgs:
        alt = await img.get_attribute("alt")
        if alt and alt.strip():
            alts.append(alt.strip())
    return "; ".join(alts) if alts else None


async def _get_hint_text(page: Page) -> str | None:
    btn = await page.query_selector(SELECTORS["hint_button"])
    if not btn:
        return None
    panel = await page.query_selector(".hint-content, .hint-panel, [class*='hint-text']")
    if panel:
        text = (await panel.text_content() or "").strip()
        if text:
            return text
    return None


async def _detect_answer_format(page: Page) -> str | None:
    mathquill = await page.query_selector(".problem-section .mathquill-editable, .problem-section .mathquill-rendered-math")
    if mathquill:
        return "math"
    textarea = await page.query_selector(SELECTORS["answer_textarea"])
    if textarea:
        return "free_text"
    text_input = await page.query_selector(SELECTORS["answer_input"])
    if text_input:
        step = await text_input.get_attribute("step")
        if step and "." in step:
            return "decimal"
        if step == "1":
            return "integer"
        return "short_text"
    return None


async def _get_credit_and_score(page: Page) -> tuple[str | None, float | None]:
    """Parse credit status + score from `.problem-label`'s class list (e.g., 'correct score-100')."""
    el = await page.query_selector(SELECTORS["problem_label"])
    if not el:
        return None, None
    cls = (await el.get_attribute("class") or "").lower()
    tokens = cls.split()

    score: float | None = None
    for tok in tokens:
        m = re.match(r"score-(\d+)$", tok)
        if m:
            score = float(m.group(1)) / 100.0
            break

    if "correct" in tokens:
        status = "full"
    elif "incorrect" in tokens:
        status = "none"
    elif any("half" in t for t in tokens):
        status = "partial"
    else:
        status = None

    return status, score


async def _is_take_home(page: Page) -> bool:
    th = await page.query_selector(".problems-map .text_number")
    return th is not None


async def _safe_inner_html(page: Page, selector: str) -> str | None:
    try:
        el = await page.query_selector(selector)
        if el:
            return await el.inner_html()
    except Exception:
        pass
    return None
