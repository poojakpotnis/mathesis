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

BASELINES_PATH = Path(__file__).parent / "baselines.json"
EVAL_NAME = "concept_accuracy_eval"


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mathesis concept-accuracy regression gate."
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help=(
            "Overwrite the baseline with the current score even if it is lower. "
            "Required to seed an initial baseline and to intentionally accept a regression."
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
