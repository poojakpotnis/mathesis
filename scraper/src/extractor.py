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
    answer_format_type = await _detect_answer_format(page)
    raw_html = await _safe_inner_html(page, SELECTORS["problem_question"])

    return ScrapedProblem(
        problem_number=problem_number,
        display_order=display_order,
        problem_text=problem_text,
        is_take_home=False,
        has_image=has_image,
        image_description=image_description,
        hint_text=None,
        answer_format_type=answer_format_type,
        credit_status=None,
        score=None,
        raw_html=raw_html,
    )


async def _get_problem_text(page: Page) -> str:
    """Pull and clean the problem question text.

    For a top-level problem, only question-problem exists.
    For a subpart problem, both fire in order:
      - question-problem  = umbrella instruction ("Calculate.")
      - question-subproblem = the specific expression for this subpart
    We concatenate both so subparts like 224a and 224b end up distinguishable.

    Runs the math-rendering helper below to preserve fractions, exponents,
    and RSM's image-based scaling parens (.elastic-wrapper) as plain text.
    """
    els = await page.query_selector_all(
        f"{SELECTORS['problem_question']}, {SELECTORS['problem_subproblem']}"
    )
    if not els:
        return ""

    parts: list[str] = []
    for el in els:
        rendered = await el.evaluate(_RENDER_PROBLEM_TEXT_JS)
        cleaned = _clean_text(rendered)
        if cleaned:
            parts.append(cleaned)

    return " ".join(parts)


# JavaScript that runs INSIDE Playwright's browser context. We can't use Python
# string formatting on this safely (curly braces), so the Unicode mixed-fraction
# lookup is embedded directly. Tested DOM patterns are documented inline.
# Same conventions as the old-portal extractor — see docstring of
# _get_problem_text for the plain-text output format.
_RENDER_PROBLEM_TEXT_JS = r"""
(node) => {
    const clone = node.cloneNode(true);

    // Unicode "vulgar fractions" block. Covers ~95% of grade 4–6 fractions.
    const UNICODE_FRACTIONS = {
        '1/2': '½', '1/3': '⅓', '2/3': '⅔',
        '1/4': '¼', '3/4': '¾',
        '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘',
        '1/6': '⅙', '5/6': '⅚',
        '1/7': '⅐',
        '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞',
        '1/9': '⅑',
        '1/10': '⅒'
    };

    clone.querySelectorAll('table.fraction').forEach(tbl => {
        const top = (tbl.querySelector('.fraction-top')?.innerText || '?').trim();
        const bot = (tbl.querySelector('.fraction-bottom')?.innerText || '?').trim();
        let sibling = tbl.previousSibling;
        while (sibling && sibling.nodeType === 3 && !sibling.textContent.trim()) {
            sibling = sibling.previousSibling;
        }
        const prevText = sibling ? (sibling.textContent || '') : '';
        const isMixedFraction = /\d\s*$/.test(prevText);
        const insideElasticBody = tbl.closest('.elastic-body') !== null;
        if (isMixedFraction) {
            const unicode = UNICODE_FRACTIONS[top + '/' + bot];
            tbl.replaceWith(document.createTextNode(
                unicode ? unicode : '_' + top + '/' + bot
            ));
        } else if (insideElasticBody) {
            tbl.replaceWith(document.createTextNode(top + '/' + bot));
        } else {
            tbl.replaceWith(document.createTextNode(' (' + top + '/' + bot + ') '));
        }
    });

    clone.querySelectorAll('.elastic-wrapper').forEach(wrapper => {
        const body = wrapper.querySelector('.elastic-body');
        const bodyText = body ? (body.innerText || body.textContent || '').trim() : '';
        wrapper.replaceWith(document.createTextNode('(' + bodyText + ')'));
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


def _clean_text(text: str) -> str:
    text = text.replace(" ", " ").replace("‍", "")
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


async def _detect_answer_format(page: Page) -> str | None:
    """Best-effort read of the answer input shape.

    New-portal answer inputs live outside the .question-problem container, so
    this is intentionally broad. Returns None if nothing is found — callers
    must treat this field as optional.
    """
    mathquill = await page.query_selector(".mathquill-editable, .mathquill-rendered-math")
    if mathquill:
        return "math"
    textarea = await page.query_selector("textarea")
    if textarea:
        return "free_text"
    text_input = await page.query_selector(SELECTORS["answer_input"])
    if text_input:
        return "short_text"
    return None


async def _safe_inner_html(page: Page, selector: str) -> str | None:
    try:
        el = await page.query_selector(selector)
        if el:
            return await el.inner_html()
    except Exception:
        pass
    return None
