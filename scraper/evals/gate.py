"""gate — Phase 5f regression gate.

What this does
--------------
Runs the concept_accuracy eval against the golden dataset and compares the
fresh score against a baseline checked into the repo (`baselines.json`).
Exits 0 if the score holds or improves; non-zero if it regresses.

Treat it like a CI quality gate: any change that lowers classifier accuracy
on the golden set has to either fix what it broke or be intentionally
accepted with `--update-baseline`.

Behavior
--------
- No recorded baseline yet → refuse to gate; tell the user to run with
  `--update-baseline` to seed one.
- Score >= baseline → exit 0. If score > baseline, baseline auto-ratchets
  upward (the bar rises silently as accuracy improves).
- Score < baseline → exit non-zero. Prints a per-row diff of which examples
  flipped (match → miss, or miss → match). Use `--update-baseline` to
  accept the drop and overwrite the baseline.

How to run
----------
    cd scraper && uv run python -m evals.gate
    cd scraper && uv run python -m evals.gate --update-baseline
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from evals.concept_accuracy_eval import run_eval
from evals.problem_quality_eval import (
    AXES as PQ_AXES,
    run_eval as run_problem_quality_eval,
)

BASELINES_PATH = Path(__file__).parent / "baselines.json"
EVAL_NAME = "concept_accuracy_eval"
PQ_EVAL_NAME = "problem_quality_eval"

# Tolerances on the LLM judge: anything within this band of the baseline counts
# as "no regression." Calibrated against the Phase 5i variance run (v2 vs v3):
# LM and OC moved 0.000 across 65 problems; WF moved on 3 problems; pass-rate
# moved 1.6pt. 0.1 / 0.05 are generous enough to absorb that noise without
# masking a real degradation.
PQ_TOLERANCES = {
    "level_match_mean": 0.1,
    "on_concept_mean": 0.1,
    "well_formed_mean": 0.1,
    "pass_rate": 0.05,
}
PQ_METRIC_LABELS = {
    "level_match_mean": "LEVEL-MATCH mean",
    "on_concept_mean": "ON-CONCEPT mean",
    "well_formed_mean": "WELL-FORMED mean",
    "pass_rate": "pass-rate (all ≥4)",
}


def _load_baselines() -> dict[str, Any]:
    if not BASELINES_PATH.exists():
        return {}
    return json.loads(BASELINES_PATH.read_text() or "{}")


def _save_baselines(baselines: dict[str, Any]) -> None:
    BASELINES_PATH.write_text(json.dumps(baselines, indent=2) + "\n")


def _rows_by_rsm(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {r["rsm"]: r for r in rows}


def _print_diff(baseline: dict[str, Any], current: dict[str, Any]) -> None:
    base_rows = _rows_by_rsm(baseline.get("rows", []))
    curr_rows = _rows_by_rsm(current["rows"])
    flips: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    for rsm, curr in curr_rows.items():
        base = base_rows.get(rsm)
        if base is None:
            continue
        if base["score"] != curr["score"]:
            flips.append((rsm, base, curr))

    regressions = [(rsm, b, c) for rsm, b, c in flips if b["score"] == 1 and c["score"] == 0]
    improvements = [(rsm, b, c) for rsm, b, c in flips if b["score"] == 0 and c["score"] == 1]

    if regressions:
        print(f"\nRegressed ({len(regressions)}):")
        print(f"  {'rsm':<6}{'golden_primary':<32}{'baseline_top':<28}→ {'current_top':<28}")
        for rsm, b, c in regressions:
            print(
                f"  {rsm:<6}{c['primary']:<32}{b['top']:<28}→ {c['top']:<28}"
                f"  [{b['label']} → {c['label']}]"
            )
    if improvements:
        print(f"\nImproved ({len(improvements)}):")
        print(f"  {'rsm':<6}{'golden_primary':<32}{'baseline_top':<28}→ {'current_top':<28}")
        for rsm, b, c in improvements:
            print(
                f"  {rsm:<6}{c['primary']:<32}{b['top']:<28}→ {c['top']:<28}"
                f"  [{b['label']} → {c['label']}]"
            )
    if not flips:
        print("\nNo per-example changes since baseline.")


def _format_baseline_entry(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "score": result["score"],
        "matches": result["matches"],
        "total": result["total"],
        "model": result["classifier_model"],
        "dataset_version_id": result["dataset_version_id"],
        "phoenix_experiment_id": result["experiment_id"],
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rows": result["rows"],
    }


def _fmt_pct(score: float) -> str:
    return f"{score * 100:.1f}%"


def _format_pq_baseline(result: dict[str, Any], n_rows: int) -> dict[str, Any]:
    metrics = result["metrics"]
    return {
        "level_match_mean": round(metrics["level_match_mean"], 4),
        "on_concept_mean": round(metrics["on_concept_mean"], 4),
        "well_formed_mean": round(metrics["well_formed_mean"], 4),
        "pass_rate": round(metrics["pass_rate"], 4),
        "n": n_rows,
        "tolerances": PQ_TOLERANCES,
        "judge_model": result["judge_model"],
        "recorded_at": result["recorded_at"],
    }


def _check_pq_regression(
    prior: dict[str, Any], current: dict[str, float]
) -> list[str]:
    """Return list of human-readable regression lines, empty if pass."""
    regressions: list[str] = []
    tolerances = prior.get("tolerances", PQ_TOLERANCES)
    for key in PQ_METRIC_LABELS:
        baseline_val = float(prior[key])
        current_val = float(current[key])
        tol = float(tolerances.get(key, PQ_TOLERANCES[key]))
        floor = baseline_val - tol
        if current_val < floor:
            regressions.append(
                f"  {PQ_METRIC_LABELS[key]:<22} "
                f"current={current_val:.4f}  baseline={baseline_val:.4f}  "
                f"floor={floor:.4f} (tol={tol})  →  REGRESSION"
            )
    return regressions


def _run_pq_gate(baselines: dict[str, Any], update: bool) -> int:
    """Returns process exit code for the problem_quality_eval gate."""
    prior = baselines.get(PQ_EVAL_NAME)
    print()
    print("=== problem_quality_eval (LLM-as-judge) ===")
    print("[gate] running LLM-as-judge eval (cost ~$3-5, several minutes)...")

    try:
        result = run_problem_quality_eval(progress=lambda m: print(f"[gate]   {m}"))
    except RuntimeError as exc:
        print(f"[gate] FAIL: {exc}")
        return 2

    metrics = result["metrics"]
    print()
    print(
        f"[gate] eval metrics: N={metrics['n']}, "
        f"LM={metrics['level_match_mean']:.3f}, "
        f"OC={metrics['on_concept_mean']:.3f}, "
        f"WF={metrics['well_formed_mean']:.3f}, "
        f"pass={metrics['pass_rate'] * 100:.1f}%"
    )

    if prior is None:
        if update:
            baselines[PQ_EVAL_NAME] = _format_pq_baseline(result, metrics["n"])
            _save_baselines(baselines)
            print(
                f"[gate] baseline seeded for {PQ_EVAL_NAME!r} → {BASELINES_PATH.name}"
            )
            return 0
        print(
            f"[gate] FAIL: no baseline recorded for {PQ_EVAL_NAME!r}. "
            f"Run with --update-baseline to seed one."
        )
        return 1

    print(
        f"[gate] baseline:    N={prior['n']}, "
        f"LM={prior['level_match_mean']:.3f}, "
        f"OC={prior['on_concept_mean']:.3f}, "
        f"WF={prior['well_formed_mean']:.3f}, "
        f"pass={prior['pass_rate'] * 100:.1f}%  "
        f"(recorded {prior.get('recorded_at', '?')})"
    )

    regressions = _check_pq_regression(prior, metrics)
    if regressions:
        print("\n[gate] REGRESSION on one or more metrics:")
        for line in regressions:
            print(line)
        if update:
            baselines[PQ_EVAL_NAME] = _format_pq_baseline(result, metrics["n"])
            _save_baselines(baselines)
            print(
                f"\n[gate] --update-baseline set; baseline for {PQ_EVAL_NAME!r} overwritten."
            )
            return 0
        print(
            "\n[gate] Pass --update-baseline to accept the regression and overwrite the baseline."
        )
        return 1

    # Improvement → ratchet upward silently (matches concept_accuracy_eval behavior).
    improved = (
        metrics["pass_rate"] > float(prior["pass_rate"])
        or metrics["level_match_mean"] > float(prior["level_match_mean"])
        or metrics["on_concept_mean"] > float(prior["on_concept_mean"])
        or metrics["well_formed_mean"] > float(prior["well_formed_mean"])
    )
    if improved:
        baselines[PQ_EVAL_NAME] = _format_pq_baseline(result, metrics["n"])
        _save_baselines(baselines)
        print(f"\n[gate] PASS: improved on at least one axis — baseline ratcheted up.")
    else:
        print("\n[gate] PASS: within tolerances of baseline.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mathesis regression gate. Runs concept_accuracy_eval by default; "
        "use --include-llm-judge to also run problem_quality_eval (~$3-5 per run)."
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help=(
            "Overwrite the baseline with the current score even if it is lower. "
            "Required to seed an initial baseline and to intentionally accept a regression."
        ),
    )
    parser.add_argument(
        "--include-llm-judge",
        action="store_true",
        help=(
            "Also run problem_quality_eval (LLM-as-judge, costs ~$3-5 per run). "
            "Skipped by default to keep the gate cheap."
        ),
    )
    args = parser.parse_args()

    baselines = _load_baselines()
    prior = baselines.get(EVAL_NAME)

    try:
        result = run_eval(
            experiment_name=f"{EVAL_NAME} (gate)",
            experiment_description=(
                "Regression-gate invocation. Same eval as concept_accuracy_eval; "
                "tagged so gate runs are distinguishable from interactive runs."
            ),
            extra_metadata={"invocation": "gate"},
            progress=lambda msg: print(f"[gate] {msg}"),
        )
    except RuntimeError as exc:
        print(f"[gate] FAIL: {exc}")
        return 2

    print()
    print(f"[gate] eval score: {result['matches']}/{result['total']} ({_fmt_pct(result['score'])})")

    # No baseline recorded yet.
    if prior is None:
        if args.update_baseline:
            baselines[EVAL_NAME] = _format_baseline_entry(result)
            _save_baselines(baselines)
            print(f"[gate] baseline seeded at {_fmt_pct(result['score'])} → {BASELINES_PATH.name}")
            return 0
        print(
            f"[gate] FAIL: no baseline recorded for {EVAL_NAME!r}. "
            f"Run with --update-baseline to seed one."
        )
        return 1

    prior_score = float(prior["score"])
    current_score = float(result["score"])
    print(f"[gate] baseline:   {prior['matches']}/{prior['total']} ({_fmt_pct(prior_score)})  recorded {prior.get('recorded_at', '?')}")

    if current_score < prior_score:
        print(f"\n[gate] REGRESSION: {_fmt_pct(current_score)} < baseline {_fmt_pct(prior_score)}")
        _print_diff(prior, result)
        if args.update_baseline:
            baselines[EVAL_NAME] = _format_baseline_entry(result)
            _save_baselines(baselines)
            print(
                f"\n[gate] --update-baseline set; baseline overwritten "
                f"to {_fmt_pct(current_score)}."
            )
            return 0
        print(
            "\n[gate] Pass --update-baseline to accept the regression and overwrite the baseline."
        )
        return 1

    # Equal or improvement.
    _print_diff(prior, result)
    if current_score > prior_score:
        baselines[EVAL_NAME] = _format_baseline_entry(result)
        _save_baselines(baselines)
        print(
            f"\n[gate] PASS: {_fmt_pct(current_score)} > baseline {_fmt_pct(prior_score)} "
            f"— baseline ratcheted up."
        )
    else:
        print(f"\n[gate] PASS: {_fmt_pct(current_score)} == baseline.")

    if args.include_llm_judge:
        # Re-read baselines because _save_baselines may have updated the file.
        baselines = _load_baselines()
        pq_exit = _run_pq_gate(baselines, update=args.update_baseline)
        if pq_exit != 0:
            return pq_exit

    return 0


if __name__ == "__main__":
    sys.exit(main())
