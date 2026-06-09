"""problem_quality_eval — fourth Mathesis evaluator (LLM-as-judge).

What this does
--------------
Scores each generated worksheet problem on three axes using a Claude Opus 4.7
judge with adaptive thinking and structured output:

  - grade_appropriate — is the difficulty/wording right for the target grade?
  - on_concept        — does solving it actually require the named concept?
  - well_formed       — is the problem itself clean (unambiguous, single-answer)?

Each axis gets a 1-5 score plus a one- or two-sentence explanation. Aggregate
metrics: mean per axis across the corpus, and pass-rate at threshold 4
(% of problems where all three axes ≥ 4 — i.e. "would a teacher accept this
without revision?").

Why this is the fourth eval
---------------------------
The verifier checks "is the math right." This eval checks "is the problem
itself good?" — calibration, concept coverage, clarity. Different question,
different signal. Together they give the generator a two-axis quality bar
before anything ships to a student.

How to run
----------
    cd scraper && uv run python -m evals.problem_quality_eval                  # full corpus
    cd scraper && uv run python -m evals.problem_quality_eval --limit 3        # cheap smoke test
    cd scraper && uv run python -m evals.problem_quality_eval --out path.jsonl # save full per-row output

Requires ANTHROPIC_API_KEY + MATHESIS_API_KEY in scraper/.env, the Next.js dev
server running for /api/evals/generated-problems, and the `anthropic` SDK.

V1 caveats
----------
* Cost ~$3-5 per full corpus run (Opus 4.7 + adaptive thinking).
* Not in evals.gate yet — judge variance run-to-run needs measuring first.
* No Phoenix experiment in V1. The metric works as Python-only output for now;
  push to Phoenix once we have a multi-run baseline.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import anthropic
import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).parent.parent / ".env")

MATHESIS_API_URL = os.environ.get("MATHESIS_API_URL", "http://localhost:3000")
MATHESIS_API_KEY = os.environ.get("MATHESIS_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

JUDGE_MODEL = "claude-opus-4-7"

JUDGE_SYSTEM = """You are evaluating math worksheet problems for a student in a specific grade. \
For each problem you'll be given the problem text, the expected answer, the solution steps, \
the target grade level, and the concept(s) the problem is supposed to exercise.

Score the problem on three dimensions on a 1-5 scale. Be calibrated: most decent problems \
should land in the 3-5 range. Reserve 1 for genuine breakage and 2 for problems that need rewriting.

GRADE-APPROPRIATE (does the difficulty and language match the target grade?)
 5 — Perfectly calibrated. Numbers, vocabulary, and required reasoning all fit the grade level. \
For elementary grades that means arithmetic, basic fractions, and informal algebraic thinking; \
no formal algebra, no symbols a student at that grade has not been taught.
 4 — Mostly right. One element is slightly above or below grade level (e.g., one larger-than-typical \
number, slightly advanced phrasing) but a typical student at the target grade can still solve it.
 3 — Notable mismatch but a student at the target grade could solve it with effort.
 2 — Significantly mismatched. Either trivial for the target grade or requires concepts not yet taught.
 1 — Wildly inappropriate for the target grade.

ON-CONCEPT (does the problem actually exercise the named concept?)
 5 — Solving the problem REQUIRES the named concept. No alternate shortcut trivializes it.
 4 — The named concept is the central mechanism, but a clever student might find a shortcut.
 3 — The concept is involved but not central; another concept could also solve it.
 2 — The concept is tangential — the problem is more naturally about a different topic.
 1 — Wrong concept entirely. The problem does not meaningfully exercise the named concept.

WELL-FORMED (is the problem itself clean?)
 5 — Unambiguous wording, consistent notation, single correct answer. If the prompt explicitly asks \
for "find three values that satisfy …" or similar, any valid set is fine — that is not ambiguity.
 4 — Solvable but has a minor ambiguity or notational quirk.
 3 — Solvable with a generous reading; one place where a student might pause and guess at intent.
 2 — Multiple reasonable interpretations leading to different answers, OR notation that would confuse \
a student at the target grade.
 1 — Contradictory premises, no valid solution, or asks for a single answer when multiple exist \
without saying so.

For each axis, give the score and a 1-2 sentence explanation referencing SPECIFIC aspects of the \
problem (e.g., "uses the number 247 which is reasonable for grade 4," not "the numbers seem fine"). \
Do not pad — short, concrete explanations are better than long generic ones."""


class AxisVerdict(BaseModel):
    score: int = Field(ge=1, le=5)
    explanation: str = Field(min_length=10, max_length=400)


class JudgeVerdict(BaseModel):
    grade_appropriate: AxisVerdict
    on_concept: AxisVerdict
    well_formed: AxisVerdict


def fetch_problems() -> list[dict[str, Any]]:
    response = httpx.get(
        f"{MATHESIS_API_URL}/api/evals/generated-problems",
        headers={"Authorization": f"Bearer {MATHESIS_API_KEY}"},
        timeout=60.0,
    )
    response.raise_for_status()
    return response.json()["problems"]


def _format_user_prompt(problem: dict[str, Any]) -> str:
    concept_lines = [
        f"  - {c['name']} ({c['displayName']})" for c in problem["concepts"]
    ] or ["  (none)"]
    return (
        f"Target grade: {problem['lesson_grade_level']}\n"
        f"Source lesson: {problem['lesson_title']!r}\n"
        f"Named concept(s):\n" + "\n".join(concept_lines) + "\n\n"
        f"Problem text:\n{problem['problem_text']}\n\n"
        f"Expected answer:\n{problem['correct_answer']}\n\n"
        f"Solution steps (for context — judge the problem, not the solution):\n"
        f"{problem.get('solution_steps') or '(none)'}\n"
    )


def judge_problem(client: anthropic.Anthropic, problem: dict[str, Any]) -> JudgeVerdict:
    response = client.messages.parse(
        model=JUDGE_MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        system=JUDGE_SYSTEM,
        messages=[{"role": "user", "content": _format_user_prompt(problem)}],
        output_format=JudgeVerdict,
    )
    if response.parsed_output is None:
        raise RuntimeError(
            f"Judge returned no parsed output for problem "
            f"{problem['generated_problem_id']} (stop_reason={response.stop_reason})"
        )
    return response.parsed_output


def _scored_row(problem: dict[str, Any], verdict: JudgeVerdict) -> dict[str, Any]:
    return {
        "generated_problem_id": problem["generated_problem_id"],
        "worksheet_id": problem["worksheet_id"],
        "lesson_id": problem["lesson_id"],
        "grade_level": problem["lesson_grade_level"],
        "problem_text": problem["problem_text"],
        "concept_names": [c["name"] for c in problem["concepts"]],
        "grade_appropriate": verdict.grade_appropriate.model_dump(),
        "on_concept": verdict.on_concept.model_dump(),
        "well_formed": verdict.well_formed.model_dump(),
    }


def _print_summary(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("No problems scored.")
        return

    axes = ("grade_appropriate", "on_concept", "well_formed")
    print()
    print(f"=== problem_quality_eval (N={len(rows)}, judge={JUDGE_MODEL}) ===")
    print()
    print("Aggregate scores:")
    print(f"  {'axis':<22}{'mean':<8}{'% ≥ 4':<10}{'min':<5}")
    for axis in axes:
        scores = [r[axis]["score"] for r in rows]
        mean = sum(scores) / len(scores)
        pass4 = sum(1 for s in scores if s >= 4) / len(scores) * 100
        print(f"  {axis:<22}{mean:<8.2f}{pass4:<10.0f}{min(scores):<5}")

    overall_pass = sum(
        1 for r in rows if all(r[a]["score"] >= 4 for a in axes)
    ) / len(rows) * 100
    print()
    print(f"Overall pass-rate (all 3 axes ≥ 4): {overall_pass:.0f}% ({sum(1 for r in rows if all(r[a]['score'] >= 4 for a in axes))}/{len(rows)})")

    by_ws: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ws[r["worksheet_id"]].append(r)
    print()
    print("Per-worksheet rollup:")
    print(f"  {'ws':<4}{'N':<4}{'GA':<8}{'OC':<8}{'WF':<8}{'pass':<6}")
    for ws in sorted(by_ws):
        rs = by_ws[ws]
        means = {a: sum(r[a]["score"] for r in rs) / len(rs) for a in axes}
        pass_ws = sum(1 for r in rs if all(r[a]["score"] >= 4 for a in axes)) / len(rs) * 100
        print(
            f"  {ws:<4}{len(rs):<4}"
            f"{means['grade_appropriate']:<8.2f}{means['on_concept']:<8.2f}{means['well_formed']:<8.2f}"
            f"{pass_ws:<6.0f}"
        )

    print()
    print("Lowest-scored problems (any axis ≤ 2):")
    troubled = [r for r in rows if any(r[a]["score"] <= 2 for a in axes)]
    if not troubled:
        print("  (none)")
    else:
        for r in troubled:
            scores = " / ".join(f"{a[0].upper()}{a.split('_')[1][0].upper()}={r[a]['score']}" for a in axes)
            snippet = (r["problem_text"] or "").replace("\n", " ").strip()[:80]
            print(f"  pid={r['generated_problem_id']:<4} ws={r['worksheet_id']:<3} [{scores}] {snippet}")
            for a in axes:
                if r[a]["score"] <= 2:
                    print(f"    {a}: {r[a]['explanation']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Mathesis LLM-as-judge problem quality eval.")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Score only the first N problems (cheap iteration / smoke test).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional path to write per-problem verdicts as JSONL.",
    )
    args = parser.parse_args()

    if not MATHESIS_API_KEY:
        print("[eval] FAIL: MATHESIS_API_KEY not set — check scraper/.env")
        return 2
    if not ANTHROPIC_API_KEY:
        print("[eval] FAIL: ANTHROPIC_API_KEY not set — check scraper/.env")
        return 2

    print(f"[eval] fetching generated problems from {MATHESIS_API_URL}...")
    problems = fetch_problems()
    if args.limit is not None:
        problems = problems[: args.limit]
    print(f"[eval] scoring {len(problems)} problems with {JUDGE_MODEL}...")

    client = anthropic.Anthropic()
    rows: list[dict[str, Any]] = []
    for i, problem in enumerate(problems, 1):
        try:
            verdict = judge_problem(client, problem)
        except Exception as exc:
            print(f"  [{i:>3}/{len(problems)}] pid={problem['generated_problem_id']} ERROR: {exc}")
            continue
        rows.append(_scored_row(problem, verdict))
        print(
            f"  [{i:>3}/{len(problems)}] pid={problem['generated_problem_id']:<4} "
            f"ws={problem['worksheet_id']:<3} "
            f"GA={verdict.grade_appropriate.score} "
            f"OC={verdict.on_concept.score} "
            f"WF={verdict.well_formed.score}"
        )

    _print_summary(rows)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        print()
        print(f"[eval] wrote {len(rows)} verdicts to {args.out}")
        print(f"[eval] recorded_at={datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
