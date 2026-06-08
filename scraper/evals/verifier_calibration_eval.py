"""verifier_calibration_eval — third Mathesis evaluator.

What this does
--------------
Grades the auto-verifier against parent ground truth. Pulls every
parent-reviewed flagged problem from Turso via `/api/evals/verifier-reviews`:
the verifier flagged the problem, then a parent either confirmed the flag
was correct (`confirmed_flagged`) or overrode it as actually fine
(`approved`). Computes flag precision: of the times the verifier raised a
flag, how often was the flag correct?

Why this is the third eval
--------------------------
The verifier is a quality gate on generated worksheets. If flag precision
is too low, parents see noise and stop trusting the badge; if too few flags
ever fire we'd never know real bugs are slipping through (recall is out of
scope here — we only have parent labels on flagged problems, not on the
"verified" majority).

How to run
----------
    cd scraper && uv run python -m evals.verifier_calibration_eval

Requires the Next.js dev server (MATHESIS_API_URL) running with a
populated `generated_problems` table; MATHESIS_API_KEY in scraper/.env.

V1 caveats
----------
* N is small (~10s today). Treat numbers as directional until the labeled
  set grows. Not gated by `evals.gate` for the same reason.
* Recall not computable: parents only review flagged problems; there is no
  ground truth on "verifier said verified, was it actually correct?"
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

MATHESIS_API_URL = os.environ.get("MATHESIS_API_URL", "http://localhost:3000")
MATHESIS_API_KEY = os.environ.get("MATHESIS_API_KEY", "")


def fetch_reviews() -> list[dict[str, Any]]:
    response = httpx.get(
        f"{MATHESIS_API_URL}/api/evals/verifier-reviews",
        headers={"Authorization": f"Bearer {MATHESIS_API_KEY}"},
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()["reviews"]


def score_review(review: dict[str, Any]) -> int:
    """1 if the verifier was right to flag, 0 if it was a false positive."""
    return 1 if review["parent_verdict"] == "confirmed_flagged" else 0


def run_eval() -> dict[str, Any]:
    if not MATHESIS_API_KEY:
        raise RuntimeError("MATHESIS_API_KEY not set — check scraper/.env")
    reviews = fetch_reviews()
    scored = [{**r, "verifier_was_right": score_review(r)} for r in reviews]
    total = len(scored)
    true_positives = sum(r["verifier_was_right"] for r in scored)
    false_positives = total - true_positives
    precision = (true_positives / total) if total else 0.0
    return {
        "precision": precision,
        "true_positives": true_positives,
        "false_positives": false_positives,
        "total_reviewed": total,
        "reviews": scored,
    }


def _print_summary(result: dict[str, Any]) -> None:
    total = result["total_reviewed"]
    tp = result["true_positives"]
    fp = result["false_positives"]
    precision = result["precision"]
    reviews = result["reviews"]

    print()
    print("=== verifier_calibration_eval ===")
    if total == 0:
        print("No parent-reviewed flagged problems found yet.")
        print("Generate a worksheet, flag a problem in the UI, and try again.")
        return

    print(
        f"Flag precision: {tp}/{total} = {precision * 100:.1f}% "
        f"(TP={tp}, FP={fp})"
    )

    by_worksheet: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in reviews:
        by_worksheet[r["worksheet_id"]].append(r)

    print()
    print("Per-worksheet rollup:")
    print(f"  {'ws':<4}{'reviewed':<10}{'TP':<4}{'FP':<4}{'precision':<10}")
    for ws in sorted(by_worksheet):
        rs = by_worksheet[ws]
        ws_tp = sum(r["verifier_was_right"] for r in rs)
        ws_fp = len(rs) - ws_tp
        ws_prec = (ws_tp / len(rs)) if rs else 0.0
        print(f"  {ws:<4}{len(rs):<10}{ws_tp:<4}{ws_fp:<4}{ws_prec * 100:>6.1f}%")

    print()
    print("Per-row breakdown:")
    print(
        f"  {'prob_id':<8}{'ws':<4}{'parent':<19}{'verifier_was':<14}{'text snippet'}"
    )
    for r in reviews:
        snippet = (r["problem_text"] or "").replace("\n", " ").strip()
        if len(snippet) > 60:
            snippet = snippet[:57] + "..."
        verdict_label = "RIGHT" if r["verifier_was_right"] else "wrong (FP)"
        print(
            f"  {r['generated_problem_id']:<8}{r['worksheet_id']:<4}"
            f"{r['parent_verdict']:<19}{verdict_label:<14}{snippet}"
        )

    print()
    print(
        "Phoenix annotations for these flags are visible under project "
        "`mathesis` → Spans → name=mathesis.verify.solve → Annotations tab."
    )


def main() -> None:
    try:
        result = run_eval()
    except RuntimeError as exc:
        sys.exit(str(exc))
    _print_summary(result)


if __name__ == "__main__":
    main()
