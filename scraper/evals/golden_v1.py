"""Build and upload `mathesis-golden-v1` — Phoenix dataset of curated Lesson 33 examples.

Why this file exists
--------------------
A *golden dataset* is the contract that downstream evaluators measure against.
Each example records (a) the canonical problem text we'd give to a model,
(b) the concept tags we expect a classifier to return, and (c) the answer-style
label we expect a generator to produce. Phoenix stores it under a versioned
name; eval scripts reference it by that name + version. When the curriculum
expands (Lesson 34, Grade 5, etc.) we cut `mathesis-golden-v2` rather than
mutating v1 — old eval runs stay comparable.

What's in v1
------------
25 examples hand-picked from Lesson 33 (Grade 4, Turso lesson_id=1, scraped
2026-05-26). All 25 carry `source_text_verified=True` — parent/PM cross-checked
each problem's text against the live RSM portal on 2026-06-06. Five of those
(10a, 10b, 12a, 12b, 12d) had scraper-mangled text that was reconstructed from
RSM; for those, the original mangled output is preserved in `scraper_text`
plus a `notes` field explaining the transformation, for audit purposes. The
other 20 were verified-as-faithful (scraper output matched RSM).
See task #6 for the underlying scraper fix.

Skipped from v1: figure-dependent problems (areas, midpoints, angles, geometric
probability — IDs 2, 3, 4, 5, 6, 8a–d, 9, 21) and problem 12c (mixed-fraction
rendering bug, separate scraper concern).

Taxonomy ratified by parent/PM on 2026-06-05: dropped redundant tag
`fraction_of_quantity` (was double-tagging every multiplication/division
problem), renamed `difference_of_squares` → `mental_math_shortcuts` to match
RSM's grade-4 framing, renamed answer style `word_problem_with_units` →
`word_problem_with_context` to cover both units (mph) and labels (chickens vs
lobsters).

Primary concept ratified by parent/PM on 2026-06-06: every example now carries
a `primary_concept` field — the single teaching point of the problem. Eval
scripts score against this; the full `expected_concept_tags` list stays as
context. For problems with one tag, primary equals that tag (forced). For the
seven problems with multiple tags, primary was chosen as "what the lesson is
teaching" (not "what skills are used"):
  - Andria's bear chase → `speed_distance_time`
  - Chickapella → `multi_step_word_problem`
  - 6a/6c exponent T/F → `exponent_evaluation`
  - 7a/7b mental math → `mental_math_shortcuts`
  - 12a fraction-linear → `solving_linear_equations`

Run
---
    cd scraper && uv run python -m evals.golden_v1
"""

from __future__ import annotations

import os
from typing import Literal, TypedDict

import pandas as pd
from phoenix.client import Client

PHOENIX_ENDPOINT = os.environ.get("PHOENIX_ENDPOINT", "http://localhost:6006")
DATASET_NAME = "mathesis-golden-v1"

# Coarse 4-label vocabulary. Kept small on purpose: an LLM-as-judge eval can
# score consistently against four categories. Splitting to 8+ produced
# inter-rater drift in spot-tests.
AnswerStyle = Literal[
    "single_value",
    "multi_value_list",
    "true_false_correction",
    "word_problem_with_context",
]
ANSWER_STYLES: set[str] = {
    "single_value",
    "multi_value_list",
    "true_false_correction",
    "word_problem_with_context",
}


class Example(TypedDict, total=False):
    scraped_problem_id: int
    rsm_problem_number: str
    problem_text: str
    expected_concept_tags: list[str]
    primary_concept: str
    expected_answer_style: AnswerStyle
    source_text_verified: bool
    scraper_text: str
    notes: str


EXAMPLES: list[Example] = [
    # --- word problems ---
    {
        "scraped_problem_id": 1,
        "rsm_problem_number": "1",
        "problem_text": (
            "Andria and Bizina were gathering forest mushrooms 2 miles from their cottage "
            "in Racha when they spotted a bear! The boys dropped everything and began to "
            "run home on the same path. Bizina ran at a speed of 4 miles per hour and "
            "arrived home 10 minutes after Andria. What was Andria's speed?"
        ),
        "expected_concept_tags": ["speed_distance_time", "multi_step_word_problem"],
        "primary_concept": "speed_distance_time",
        "expected_answer_style": "word_problem_with_context",
    },
    {
        "scraped_problem_id": 36,
        "rsm_problem_number": "13",
        "problem_text": (
            "Chickapella the Great is famous for turning rubber chickens into live "
            "chickens. Last night, she turned (3/7) of her rubber chickens into living "
            "ones. But things didn't go as Chickapella planned, and (7/8) of the "
            "remaining rubber chickens turned into live lobsters instead of chickens! "
            "That left only 3 rubber chickens on the stage. Then, after the curtain "
            "closed, (2/3) of the live chickens and (3/7) of the lobsters escaped. "
            "How many live chickens and how many lobsters were left on stage?"
        ),
        "expected_concept_tags": ["fraction_multiplication", "multi_step_word_problem"],
        "primary_concept": "multi_step_word_problem",
        "expected_answer_style": "word_problem_with_context",
    },
    # --- fraction inequality (5a–d) ---
    {
        "scraped_problem_id": 7,
        "rsm_problem_number": "5a",
        "problem_text": "Find three values of x that satisfy the inequality. (12/x) ≤ 3",
        "expected_concept_tags": ["fraction_inequality"],
        "primary_concept": "fraction_inequality",
        "expected_answer_style": "multi_value_list",
    },
    {
        "scraped_problem_id": 8,
        "rsm_problem_number": "5b",
        "problem_text": "Find three values of x that satisfy the inequality. (x/2) ≥ x",
        "expected_concept_tags": ["fraction_inequality"],
        "primary_concept": "fraction_inequality",
        "expected_answer_style": "multi_value_list",
    },
    {
        "scraped_problem_id": 9,
        "rsm_problem_number": "5c",
        "problem_text": "Find three values of x that satisfy the inequality. (1/x) < x",
        "expected_concept_tags": ["fraction_inequality"],
        "primary_concept": "fraction_inequality",
        "expected_answer_style": "multi_value_list",
    },
    {
        "scraped_problem_id": 10,
        "rsm_problem_number": "5d",
        "problem_text": "Find three values of x that satisfy the inequality. (4/x) > x",
        "expected_concept_tags": ["fraction_inequality"],
        "primary_concept": "fraction_inequality",
        "expected_answer_style": "multi_value_list",
    },
    # --- exponent True/False (6a–d) ---
    {
        "scraped_problem_id": 11,
        "rsm_problem_number": "6a",
        "problem_text": "True or False? If a statement is false, fix the mistake. (1/5)^2 = (1/10)",
        "expected_concept_tags": ["exponent_evaluation", "fraction_multiplication"],
        "primary_concept": "exponent_evaluation",
        "expected_answer_style": "true_false_correction",
    },
    {
        "scraped_problem_id": 12,
        "rsm_problem_number": "6b",
        "problem_text": "True or False? If a statement is false, fix the mistake. 3^3 = 9",
        "expected_concept_tags": ["exponent_evaluation"],
        "primary_concept": "exponent_evaluation",
        "expected_answer_style": "true_false_correction",
    },
    {
        "scraped_problem_id": 13,
        "rsm_problem_number": "6c",
        "problem_text": "True or False? If a statement is false, fix the mistake. (1/4)^2 = (1/16)",
        "expected_concept_tags": ["exponent_evaluation", "fraction_multiplication"],
        "primary_concept": "exponent_evaluation",
        "expected_answer_style": "true_false_correction",
    },
    {
        "scraped_problem_id": 14,
        "rsm_problem_number": "6d",
        "problem_text": "True or False? If a statement is false, fix the mistake. 0.002^3 = 0.008",
        "expected_concept_tags": ["exponent_evaluation"],
        "primary_concept": "exponent_evaluation",
        "expected_answer_style": "true_false_correction",
    },
    # --- mental math shortcuts: difference of squares (7a–b) ---
    {
        "scraped_problem_id": 15,
        "rsm_problem_number": "7a",
        "problem_text": "Find an easy way to calculate. 10^2 - 8^2 = ?",
        "expected_concept_tags": ["exponent_evaluation", "mental_math_shortcuts"],
        "primary_concept": "mental_math_shortcuts",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 16,
        "rsm_problem_number": "7b",
        "problem_text": "Find an easy way to calculate. 25^2 - 23^2 = ?",
        "expected_concept_tags": ["exponent_evaluation", "mental_math_shortcuts"],
        "primary_concept": "mental_math_shortcuts",
        "expected_answer_style": "single_value",
    },
    # --- zero-product equations (10a–b) — VERIFIED ---
    {
        "scraped_problem_id": 22,
        "rsm_problem_number": "10a",
        "problem_text": "Solve. (x+1)(x-1) = 0",
        "expected_concept_tags": ["solving_equations_products"],
        "primary_concept": "solving_equations_products",
        "expected_answer_style": "multi_value_list",
        "source_text_verified": True,
        "scraper_text": "Solve. x+1 x–1 =0",
        "notes": "Scraper dropped both paren pairs; canonical text from live RSM.",
    },
    {
        "scraped_problem_id": 23,
        "rsm_problem_number": "10b",
        "problem_text": "Solve. x(x-2)(x-3) = 0",
        "expected_concept_tags": ["solving_equations_products"],
        "primary_concept": "solving_equations_products",
        "expected_answer_style": "multi_value_list",
        "source_text_verified": True,
        "scraper_text": "Solve. x x–2 x–3 =0",
        "notes": "Scraper dropped both paren pairs; canonical text from live RSM.",
    },
    # --- "X of Y" fraction multiplication / division (11a–h) ---
    {
        "scraped_problem_id": 24,
        "rsm_problem_number": "11a",
        "problem_text": "Calculate. (1/2) of (1/3) is ___ .",
        "expected_concept_tags": ["fraction_multiplication"],
        "primary_concept": "fraction_multiplication",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 25,
        "rsm_problem_number": "11b",
        "problem_text": "Calculate. (1/2) of ___ is (1/3) .",
        "expected_concept_tags": ["fraction_division"],
        "primary_concept": "fraction_division",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 26,
        "rsm_problem_number": "11c",
        "problem_text": "Calculate. (1/3) of (2/3) is ___ .",
        "expected_concept_tags": ["fraction_multiplication"],
        "primary_concept": "fraction_multiplication",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 27,
        "rsm_problem_number": "11d",
        "problem_text": "Calculate. (1/3) of ___ is (2/3) .",
        "expected_concept_tags": ["fraction_division"],
        "primary_concept": "fraction_division",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 28,
        "rsm_problem_number": "11e",
        "problem_text": "Calculate. (2/5) of (1/4) is ___ .",
        "expected_concept_tags": ["fraction_multiplication"],
        "primary_concept": "fraction_multiplication",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 29,
        "rsm_problem_number": "11f",
        "problem_text": "Calculate. (2/5) of ___ is (1/4) .",
        "expected_concept_tags": ["fraction_division"],
        "primary_concept": "fraction_division",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 30,
        "rsm_problem_number": "11g",
        "problem_text": "Calculate. (3/4) of (1/2) is ___ .",
        "expected_concept_tags": ["fraction_multiplication"],
        "primary_concept": "fraction_multiplication",
        "expected_answer_style": "single_value",
    },
    {
        "scraped_problem_id": 31,
        "rsm_problem_number": "11h",
        "problem_text": "Calculate. (3/4) of ___ is (1/2) .",
        "expected_concept_tags": ["fraction_division"],
        "primary_concept": "fraction_division",
        "expected_answer_style": "single_value",
    },
    # --- linear equations (12a, 12b, 12d) — VERIFIED. 12c skipped (mixed-fraction). ---
    {
        "scraped_problem_id": 32,
        "rsm_problem_number": "12a",
        "problem_text": "Solve the equation. 1/4(x+2) = 1/6(3x-2)",
        "expected_concept_tags": ["fraction_multiplication", "solving_linear_equations"],
        "primary_concept": "solving_linear_equations",
        "expected_answer_style": "single_value",
        "source_text_verified": True,
        "scraper_text": "Solve the equation. (1/4) x+2 = (1/6) 3x−2 ___",
        "notes": "Scraper dropped parens around binomials, added parens around fractions.",
    },
    {
        "scraped_problem_id": 33,
        "rsm_problem_number": "12b",
        "problem_text": "Solve the equation. 3(5.07 - x) = 6.009",
        "expected_concept_tags": ["solving_linear_equations"],
        "primary_concept": "solving_linear_equations",
        "expected_answer_style": "single_value",
        "source_text_verified": True,
        "scraper_text": "Solve the equation. 3 5.07–x =6.009",
        "notes": "Scraper dropped parens around binomial.",
    },
    {
        "scraped_problem_id": 35,
        "rsm_problem_number": "12d",
        "problem_text": "Solve the equation. (x-3) / 0.6 = 120",
        "expected_concept_tags": ["solving_linear_equations"],
        "primary_concept": "solving_linear_equations",
        "expected_answer_style": "single_value",
        "source_text_verified": True,
        "scraper_text": "Solve the equation. x–3 ÷0.6=120",
        "notes": "Scraper dropped parens; rendered division as ÷.",
    },
]


def build_dataframe() -> pd.DataFrame:
    rows = []
    seen_ids: set[int] = set()
    for e in EXAMPLES:
        sid = e["scraped_problem_id"]
        assert sid not in seen_ids, f"duplicate scraped_problem_id={sid}"
        seen_ids.add(sid)
        assert e["expected_answer_style"] in ANSWER_STYLES, (
            f"unknown answer style {e['expected_answer_style']!r} on id={sid}"
        )
        assert e["expected_concept_tags"], f"empty concept tags on id={sid}"
        assert e["primary_concept"] in e["expected_concept_tags"], (
            f"primary_concept {e['primary_concept']!r} not in tag list on id={sid}"
        )
        # Every example is now human-ratified at both layers: text + labels.
        # Text verification (`source_text_verified`) only flips True for the 5
        # where we cross-checked the canonical text against the live RSM page.
        # Label ratification (`labels_verified`) is True for all 25 — parent/PM
        # reviewed each entry's concept tags + answer style on 2026-06-06.
        rows.append(
            {
                # input columns (what a classifier or generator consumes)
                "problem_text": e["problem_text"],
                "lesson_number": 33,
                "grade_level": 4,
                # output columns (the ground-truth contract)
                "primary_concept": e["primary_concept"],
                "expected_concept_tags": e["expected_concept_tags"],
                "expected_answer_style": e["expected_answer_style"],
                # metadata (traceability + filtering)
                "scraped_problem_id": sid,
                "rsm_problem_number": e["rsm_problem_number"],
                # Default True: every entry was cross-checked against RSM on
                # 2026-06-06. The 5 explicit Trues are entries that *also*
                # carry scraper_text + notes (text was reconstructed because
                # scraper output was wrong).
                "source_text_verified": e.get("source_text_verified", True),
                "labels_verified": True,
                "scraper_text": e.get("scraper_text", ""),
                "notes": e.get("notes", ""),
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    df = build_dataframe()
    text_verified = int(df["source_text_verified"].sum())
    labels_verified = int(df["labels_verified"].sum())
    reconstructed = int((df["scraper_text"].str.len() > 0).sum())
    print(
        f"Built {len(df)} examples — all human-ratified:\n"
        f"  • {text_verified} text-verified vs live RSM "
        f"({reconstructed} of those had scraper-mangled text reconstructed)\n"
        f"  • {labels_verified} label-ratified by parent/PM"
    )
    print(df[["rsm_problem_number", "primary_concept", "expected_answer_style"]])

    client = Client(base_url=PHOENIX_ENDPOINT)
    dataset = client.datasets.create_dataset(
        name=DATASET_NAME,
        dataframe=df,
        input_keys=["problem_text", "lesson_number", "grade_level"],
        output_keys=[
            "primary_concept",
            "expected_concept_tags",
            "expected_answer_style",
        ],
        metadata_keys=[
            "scraped_problem_id",
            "rsm_problem_number",
            "source_text_verified",
            "labels_verified",
            "scraper_text",
            "notes",
        ],
        dataset_description=(
            "Ground-truth answer key for Mathesis evaluators. "
            "25 hand-curated Lesson 33 examples; taxonomy ratified 2026-06-05, "
            "primary_concept ratified 2026-06-06."
        ),
    )
    print(f"\nUploaded as {DATASET_NAME}: {dataset}")


if __name__ == "__main__":
    main()
