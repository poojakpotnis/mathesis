"""concept_accuracy_eval — first Mathesis evaluator.

What this does
--------------
Grades the live classifier (POST /api/classify/run) against the
`mathesis-golden-v1` golden dataset. For each of the 25 ratified examples we
hand the classifier the `problem_text`, look at the concept it confidence-ranks
highest, and score 1 if that top pick equals the example's `primary_concept`
(the single teaching point you ratified), 0 otherwise. Misses are bucketed:

  - close_miss      — classifier's top pick is somewhere in expected_concept_tags
                      (right neighborhood, wrong-or-renamed primary)
  - off_topic_miss  — top pick is not in the expected list at all

Why this is the first eval
--------------------------
The classifier sits upstream of every worksheet. Wrong bucket → wrong
worksheet → silently degraded practice. This eval produces the baseline number
("classifier got N/25") that every future prompt change is compared against.

How to run
----------
    cd scraper && uv run python -m evals.concept_accuracy_eval

Requires Phoenix at PHOENIX_ENDPOINT, the Mathesis dev server at MATHESIS_API_URL,
and MATHESIS_API_KEY in scraper/.env.
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path
from typing import Any, Callable

import httpx
from dotenv import load_dotenv
from phoenix.client import Client

load_dotenv(Path(__file__).parent.parent / ".env")

PHOENIX_ENDPOINT = os.environ.get("PHOENIX_ENDPOINT", "http://localhost:6006")
MATHESIS_API_URL = os.environ.get("MATHESIS_API_URL", "http://localhost:3000")
MATHESIS_API_KEY = os.environ.get("MATHESIS_API_KEY", "")
DATASET_NAME = "mathesis-golden-v1"
LESSON_TITLE = "Mathesis golden v1 (Lesson 33 ratified)"
CLASSIFIER_MODEL = "claude-sonnet-4-6"


def _call_classifier(examples: list[dict]) -> dict[int, list[dict[str, Any]]]:
    """Batch all problems into one /api/classify/run call.

    Returns a map from scraped_problem_id → list of {name, confidence}, in the
    classifier's emission order (which we use for tie-breaking).
    """
    problems = [
        {
            "id": int(ex["metadata"]["scraped_problem_id"]),
            "problemNumber": ex["metadata"]["rsm_problem_number"],
            "problemText": ex["input"]["problem_text"],
        }
        for ex in examples
    ]
    # All golden v1 examples come from a single lesson, so they share a grade.
    # Read from the first example's input rather than hardcoding so the eval
    # keeps working when golden_v2 spans multiple lessons / grades.
    grade_level = int(examples[0]["input"]["grade_level"])
    response = httpx.post(
        f"{MATHESIS_API_URL}/api/classify/run",
        headers={"Authorization": f"Bearer {MATHESIS_API_KEY}"},
        json={
            "lessonTitle": LESSON_TITLE,
            "gradeLevel": grade_level,
            "problems": problems,
        },
        timeout=180.0,
    )
    response.raise_for_status()
    data = response.json()
    return {entry["problem_id"]: entry["concepts"] for entry in data["problem_classifications"]}


def _pick_top_concept(concepts: list[dict[str, Any]]) -> str | None:
    """Highest confidence wins. Ties broken by classifier's own array order."""
    if not concepts:
        return None
    # max() is stable; enumerate so earlier index breaks ties in our favor.
    best_index, best = max(enumerate(concepts), key=lambda pair: (pair[1]["confidence"], -pair[0]))
    return best["name"]


def _parse_tags(raw: Any) -> list[str]:
    """expected_concept_tags comes back from Phoenix as the repr of a list."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = ast.literal_eval(raw)
            return list(parsed) if isinstance(parsed, (list, tuple)) else []
        except (ValueError, SyntaxError):
            return []
    return []


def _concept_match(output: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    top = (output or {}).get("top_concept") or ""
    primary = (expected or {}).get("primary_concept") or ""
    expected_tags = _parse_tags((expected or {}).get("expected_concept_tags"))

    top_n = top.strip().lower()
    primary_n = primary.strip().lower()
    tags_n = {t.strip().lower() for t in expected_tags}

    if top_n == primary_n:
        return {
            "score": 1,
            "label": "match",
            "explanation": f"top={top!r} == primary={primary!r}",
        }
    miss = "close_miss" if top_n in tags_n else "off_topic_miss"
    return {
        "score": 0,
        "label": miss,
        "explanation": (
            f"top={top!r}; primary={primary!r}; expected_tags={sorted(expected_tags)}"
        ),
    }


def run_eval(
    *,
    experiment_name: str = "concept_accuracy_eval",
    experiment_description: str = (
        "Live classifier vs golden_v1.primary_concept. "
        "Top concept by confidence; exact-match scoring."
    ),
    extra_metadata: dict[str, Any] | None = None,
    progress: Callable[[str], None] = lambda _msg: None,
) -> dict[str, Any]:
    """Run the concept-accuracy eval and return a result dict.

    Single execution path shared by the CLI (`python -m evals.concept_accuracy_eval`)
    and the regression gate (`python -m evals.gate`). Always pushes a Phoenix
    experiment for history; the caller is responsible for any human-facing print.

    Returns:
      {
        "score": float in [0, 1],        # matches / total
        "matches": int,
        "total": int,
        "rows": list[dict],              # per-example {rsm, primary, top, score, label}
        "experiment_id": str | None,
        "dataset_version_id": str,
        "classifier_model": str,
      }
    """
    if not MATHESIS_API_KEY:
        raise RuntimeError("MATHESIS_API_KEY not set — check scraper/.env")

    client = Client(base_url=PHOENIX_ENDPOINT)
    dataset = client.datasets.get_dataset(dataset=DATASET_NAME)
    progress(
        f"Loaded {DATASET_NAME} version={dataset.version_id} "
        f"({len(dataset.examples)} examples)"
    )

    progress(f"Classifying {len(dataset.examples)} problems in one batch...")
    classifications = _call_classifier(dataset.examples)
    progress(f"Classifier returned predictions for {len(classifications)} problems")

    def task(example: dict[str, Any]) -> dict[str, Any]:
        sid = int(example["metadata"]["scraped_problem_id"])
        concepts = classifications.get(sid, [])
        return {"top_concept": _pick_top_concept(concepts), "all_concepts": concepts}

    metadata: dict[str, Any] = {
        "classifier_model": CLASSIFIER_MODEL,
        "dataset_version_id": dataset.version_id,
    }
    if extra_metadata:
        metadata.update(extra_metadata)

    experiment = client.experiments.run_experiment(
        dataset=dataset,
        task=task,
        evaluators=[_concept_match],
        experiment_name=experiment_name,
        experiment_description=experiment_description,
        experiment_metadata=metadata,
        print_summary=False,
    )

    rows = []
    for ex in dataset.examples:
        out = task(ex)
        ev = _concept_match(out, ex["output"])
        rows.append(
            {
                "rsm": ex["metadata"]["rsm_problem_number"],
                "primary": ex["output"]["primary_concept"],
                "top": out["top_concept"] or "(none)",
                "score": ev["score"],
                "label": ev["label"],
            }
        )

    matches = sum(r["score"] for r in rows)
    total = len(rows)
    return {
        "score": (matches / total) if total else 0.0,
        "matches": matches,
        "total": total,
        "rows": rows,
        "experiment_id": getattr(experiment, "id", None),
        "dataset_version_id": dataset.version_id,
        "classifier_model": CLASSIFIER_MODEL,
    }


def _print_summary(result: dict[str, Any]) -> None:
    rows = result["rows"]
    matches = result["matches"]
    total = result["total"]
    pct = result["score"] * 100
    close = [r for r in rows if r["label"] == "close_miss"]
    off_topic = [r for r in rows if r["label"] == "off_topic_miss"]

    print()
    print(f"=== concept_accuracy_eval (dataset {result['dataset_version_id']}) ===")
    print(f"Accuracy: {matches}/{total} ({pct:.0f}%)")
    print(f"Close misses     ({len(close):2d}): {[r['rsm'] for r in close]}")
    print(f"Off-topic misses ({len(off_topic):2d}): {[r['rsm'] for r in off_topic]}")
    print()
    print(f"{'rsm':<6}{'score':<7}{'label':<18}{'golden_primary':<32}{'classifier_top':<32}")
    print("-" * 95)
    for r in rows:
        print(f"{r['rsm']:<6}{r['score']:<7}{r['label']:<18}{r['primary']:<32}{r['top']:<32}")

    print()
    if result["experiment_id"]:
        print(f"Phoenix experiment id: {result['experiment_id']}")
    print("View results in Phoenix UI under the 'Experiments' tab on mathesis-golden-v1.")


def main() -> None:
    try:
        result = run_eval(progress=print)
    except RuntimeError as exc:
        sys.exit(str(exc))
    _print_summary(result)


if __name__ == "__main__":
    main()
