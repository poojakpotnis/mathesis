"""problem_quality_eval — fourth Mathesis evaluator (LLM-as-judge).

What this does
--------------
Scores each generated worksheet problem on three axes using a Claude Opus 4.7
judge with adaptive thinking and structured output:

  - level_match — does the generated problem sit at the same level as same-lesson RSM references?
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

JUDGE_SYSTEM = """You are evaluating generated math worksheet problems that supplement a \
specific curriculum. For each generated problem, you will see real problems from the same \
curriculum lesson, shown as REFERENCE PROBLEMS. Those references DEFINE the level the \
generated problem should match. Do not import any external grade-level expectations \
(Common Core, age norms, generic K-12 standards) — anchor entirely to the references.

Score on three dimensions on a 1-5 scale. Be calibrated: most decent problems should land \
in the 3-5 range. Reserve 1 for genuine breakage and 2 for problems that need rewriting.

LEVEL-MATCH (does the generated problem sit at the same level as the reference problems?)
 5 — Same level. A student who can do the references can do this; nothing in the generated \
problem is meaningfully harder or easier than what the references show. Use of the same \
notation, similar number sizes, and similar reasoning depth is fine and expected.
 4 — Same ballpark with a small drift — slightly larger numbers, one extra step, slightly \
denser wording — but a student doing the references would handle it fine.
 3 — Noticeably out of range vs the references but still defensible as an extension or stretch.
 2 — Meaningfully easier or meaningfully harder than the references. Either trivial relative \
to what the references demand, or requires technique not visible in any reference.
 1 — Wildly out of range. References are clearly at one level; the generated problem is \
clearly at a very different level.

When scoring level-match, ground your explanation in SPECIFIC comparisons to the references \
(e.g., "references all use single-digit numerators; this uses 2x − 1" — not "feels harder"). \
If a generated problem uses notation, structures, or solution techniques that ALSO appear in \
the references, treat that as on-level by default — the references ARE the level.

ON-CONCEPT (does the problem actually exercise the named concept?)
 5 — Solving REQUIRES the named concept. No alternate shortcut trivializes it.
 4 — Central mechanism, but a clever student might find a shortcut.
 3 — Concept is involved but not central; another concept could also solve it.
 2 — Tangential — more naturally about a different topic.
 1 — Wrong concept entirely.

WELL-FORMED (is the problem itself clean?)
 5 — Unambiguous wording, consistent notation, single correct answer. If the prompt asks for \
"find three values that satisfy …" or similar, any valid set is fine — not ambiguity.
 4 — Solvable but minor ambiguity or notational quirk.
 3 — Solvable with a generous reading; one place where a student might pause and guess at intent.
 2 — Multiple reasonable interpretations leading to different answers, OR confusing notation.
 1 — Contradictory premises, no valid solution, or asks for one answer when multiple exist.

For each axis, give the score and a 1-2 sentence explanation referencing SPECIFIC aspects \
of the problem (and, for level-match, specific aspects of the references). Do not pad — \
short, concrete explanations beat long generic ones."""


class AxisVerdict(BaseModel):
    score: int = Field(ge=1, le=5)
    explanation: str = Field(min_length=10, max_length=400)


class JudgeVerdict(BaseModel):
    level_match: AxisVerdict
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
    references = problem.get("reference_problems") or []
    if references:
        ref_block = "\n".join(
            f"  [{r['problem_number']}] (concepts: {', '.join(r['concept_names']) or 'none'})\n"
            f"      {r['problem_text']}"
            for r in references
        )
    else:
        ref_block = "  (no reference problems available for this lesson)"
    return (
        f"REFERENCE PROBLEMS from the same curriculum lesson \n"
        f"(these are the calibration anchor for LEVEL-MATCH — they ARE the right level):\n"
        f"{ref_block}\n\n"
        f"=== Generated problem to evaluate ===\n"
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
        "reference_problem_numbers": [
            r["problem_number"] for r in problem.get("reference_problems") or []
        ],
        "level_match": verdict.level_match.model_dump(),
        "on_concept": verdict.on_concept.model_dump(),
        "well_formed": verdict.well_formed.model_dump(),
    }


def _print_summary(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("No problems scored.")
        return

    axes = ("level_match", "on_concept", "well_formed")
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
    print(f"  {'ws':<4}{'N':<4}{'LM':<8}{'OC':<8}{'WF':<8}{'pass':<6}")
    for ws in sorted(by_ws):
        rs = by_ws[ws]
        means = {a: sum(r[a]["score"] for r in rs) / len(rs) for a in axes}
        pass_ws = sum(1 for r in rs if all(r[a]["score"] >= 4 for a in axes)) / len(rs) * 100
        print(
            f"  {ws:<4}{len(rs):<4}"
            f"{means['level_match']:<8.2f}{means['on_concept']:<8.2f}{means['well_formed']:<8.2f}"
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
            f"LM={verdict.level_match.score} "
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
