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
    We concatenate both, then transform RSM's visual math notation into
    plain-text that preserves the original mathematical meaning.

    Plain-text conventions used in `problem_text`:
    - Standalone fractions:  " (top/bot) "    e.g. "(1/2) of (1/3)"
    - Mixed fractions:       Unicode codepoint if available, else "N_a/b"
                             e.g. "5⅗" or "5_7/16"  (the underscore separator
                             distinguishes a mixed fraction from multiplication;
                             see top of this module for the full table.)
    - Scaling parens like
      (x+1)(x-1):            literal "(...)"  (RSM renders these via PNG
                             images named binom_l.png / binom_r.png inside a
                             div.elastic-wrapper structure; without explicit
                             handling, innerText skips the images entirely)
    - Superscripts: "^N",  subscripts: "_N",  blank answer boxes: " ___ "
    """
    els = await page.query_selector_all(".problem-right-part .problem-question")
    if not els:
        el = await page.query_selector(SELECTORS["problem_right_part"])
        if el:
            return _clean_text(await el.text_content() or "")
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
_RENDER_PROBLEM_TEXT_JS = r"""
(node) => {
    const clone = node.cloneNode(true);

    // Unicode "vulgar fractions" block. Covers ~95% of grade 4–6 fractions.
    // Fractions outside this set fall back to N_a/b in the mixed-fraction case.
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

    // (1) Fraction tables — stacked-fraction visual representation.
    //     Three rendering cases, picked in this priority order:
    //       (a) Mixed-fraction: preceding text ends in a digit (e.g., "5"
    //           before "3/5") → render "5⅗" if Unicode exists, else "5_3/5".
    //           Without this, "5 (3/5)" silently flips meaning from mixed
    //           fraction (5.6) to multiplication (3).
    //       (b) Inside an elastic-wrapper body → render bare "1/5" (no
    //           parens), because the wrapper provides its own outer parens.
    //           Without this, "(1/5)^2" becomes "(15)^2" — see (2) below.
    //       (c) Standalone → " (top/bot) " with surrounding spaces for
    //           natural text flow ("(1/2) of (1/3)").
    //     The underscore in fallback "5_a/b" is visually distinct from " "
    //     (which reads as multiplication) and "+" (which would re-interpret
    //     the math). Trade-off: collides with subscript prefix in theory,
    //     but RSM grade 4–6 problems don't use subscripts.
    clone.querySelectorAll('table.fraction').forEach(tbl => {
        const top = (tbl.querySelector('.fraction-top')?.innerText || '?').trim();
        const bot = (tbl.querySelector('.fraction-bottom')?.innerText || '?').trim();

        // Walk backwards across whitespace-only text nodes to find the real
        // preceding sibling. We only check immediate siblings — if the digit
        // is in a different element, we treat as standalone (acceptable false
        // negative; never produces wrong math, just over-paren'd).
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

    // (2) RSM's image-based scaling parens.
    //     RSM renders parens around expressions using <img src="binom_l.png">
    //     and binom_r.png inside a div.elastic-wrapper > div.elastic-box
    //     structure with empty alt="". innerText therefore drops them and
    //     "(x+1)(x-1)=0" becomes "x+1 x-1 =0" — silently broken math.
    //     We pull the body text out and re-wrap in literal parens. Runs
    //     AFTER fraction handling so the body's fractions are already plain
    //     text (otherwise innerText would concatenate "1" + "5" into "15").
    //     Note: nested elastic-wrappers are not handled — would need
    //     leaves-first traversal. Grade 4 has none, revisit at higher grades.
    clone.querySelectorAll('.elastic-wrapper').forEach(wrapper => {
        const body = wrapper.querySelector('.elastic-body');
        const bodyText = body ? (body.innerText || body.textContent || '').trim() : '';
        wrapper.replaceWith(document.createTextNode('(' + bodyText + ')'));
    });

    // (3) Superscripts and subscripts.
    clone.querySelectorAll('sup').forEach(s => {
        s.replaceWith(document.createTextNode('^' + (s.innerText || s.textContent || '')));
    });
    clone.querySelectorAll('sub').forEach(s => {
        s.replaceWith(document.createTextNode('_' + (s.innerText || s.textContent || '')));
    });

    // (4) RSM blank answer boxes.
    clone.querySelectorAll('.rsm-placeholder').forEach(ph => {
        ph.replaceWith(document.createTextNode(' ___ '));
    });

    return clone.innerText || clone.textContent || '';
}
"""


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
