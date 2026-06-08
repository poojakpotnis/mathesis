"""concept_accuracy_variants — Phase 5d variant comparison.

What this does
--------------
Runs the same concept_accuracy evaluator against two variant classifier
configurations and logs each as a separately-tagged Phoenix experiment, so
the score gap between variants can be attributed to the variant change
rather than to run-to-run drift in the classifier.

Variant A (full library) is already shipped as Experiment:4 — we trust that
as the baseline rather than re-running it. This script adds:

  - Variant B: libraryMode="names_only"
    Tests: do the descriptions and category labels carry signal, or are the
    snake_case names alone doing all the work?

  - Variant C: libraryMode="categories_only"
    Tests: does structural context alone (category buckets + counts) steer
    the classifier, or does it actively need to see specific names to avoid
    synonym drift?

How to run
----------
    cd scraper && uv run python -m evals.concept_accuracy_variants
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path
from typing import Any

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

VARIANTS = [
    {
        "library_mode": "names_only",
        "experiment_name": "concept_accuracy_eval — variant B (names_only)",
        "description": (
            "Library projected as snake_case names only. Tests whether "
            "descriptions / displayNames carry signal beyond the names themselves."
        ),
    },
    {
        "library_mode": "categories_only",
        "experiment_name": "concept_accuracy_eval — variant C (categories_only)",
        "description": (
            "Library projected as category buckets + counts; no specific concept "
            "names shown. Tests whether structural context alone steers the model."
        ),
    },
]


def _call_classifier(
    examples: list[dict], library_mode: str
) -> dict[int, list[dict[str, Any]]]:
    problems = [
        {
            "id": int(ex["metadata"]["scraped_problem_id"]),
            "problemNumber": ex["metadata"]["rsm_problem_number"],
            "problemText": ex["input"]["problem_text"],
        }
        for ex in examples
    ]
    response = httpx.post(
        f"{MATHESIS_API_URL}/api/classify/run",
        headers={"Authorization": f"Bearer {MATHESIS_API_KEY}"},
        json={
            "lessonTitle": LESSON_TITLE,
            "libraryMode": library_mode,
            "problems": problems,
        },
        timeout=180.0,
    )
    response.raise_for_status()
    data = response.json()
    return {
        entry["problem_id"]: entry["concepts"]
        for entry in data["problem_classifications"]
    }


def _pick_top_concept(concepts: list[dict[str, Any]]) -> str | None:
    if not concepts:
        return None
    _, best = max(
        enumerate(concepts),
        key=lambda pair: (pair[1]["confidence"], -pair[0]),
    )
    return best["name"]


def _parse_tags(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = ast.literal_eval(raw)
            return list(parsed) if isinstance(parsed, (list, tuple)) else []
        except (ValueError, SyntaxError):
            return []
    return []


def _build_concept_match():
    """Returns the same evaluator used in concept_accuracy_eval.py."""

    def concept_match(
        output: dict[str, Any], expected: dict[str, Any]
    ) -> dict[str, Any]:
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
                f"top={top!r}; primary={primary!r}; "
                f"expected_tags={sorted(expected_tags)}"
            ),
        }

    return concept_match


def run_variant(client: Client, dataset, variant: dict) -> dict:
    mode = variant["library_mode"]
    print(f"\n--- Running variant: libraryMode={mode!r} ---")
    classifications = _call_classifier(dataset.examples, mode)
    print(f"Classifier returned predictions for {len(classifications)} problems")

    def task(example: dict[str, Any]) -> dict[str, Any]:
        sid = int(example["metadata"]["scraped_problem_id"])
        concepts = classifications.get(sid, [])
        return {"top_concept": _pick_top_concept(concepts), "all_concepts": concepts}

    concept_match = _build_concept_match()

    experiment = client.experiments.run_experiment(
        dataset=dataset,
        task=task,
        evaluators=[concept_match],
        experiment_name=variant["experiment_name"],
        experiment_description=variant["description"],
        experiment_metadata={
            "classifier_model": CLASSIFIER_MODEL,
            "dataset_version_id": dataset.version_id,
            "library_mode": mode,
            "variant_label": "B" if mode == "names_only" else "C",
        },
        print_summary=False,
    )

    rows = []
    for ex in dataset.examples:
        out = task(ex)
        ev = concept_match(out, ex["output"])
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
    pct = (matches / total * 100) if total else 0.0
    print(f"Score: {matches}/{total} ({pct:.0f}%)")
    misses = [r for r in rows if r["score"] == 0]
    if misses:
        print(f"Misses ({len(misses)}):")
        for r in misses:
            print(
                f"  {r['rsm']:<6} golden={r['primary']:<28} top={r['top']:<28} [{r['label']}]"
            )
    return {
        "variant": variant,
        "experiment_id": getattr(experiment, "id", None),
        "rows": rows,
        "matches": matches,
        "total": total,
        "pct": pct,
    }


def main() -> None:
    if not MATHESIS_API_KEY:
        sys.exit("MATHESIS_API_KEY not set — check scraper/.env")

    client = Client(base_url=PHOENIX_ENDPOINT)
    dataset = client.datasets.get_dataset(dataset=DATASET_NAME)
    print(
        f"Loaded {DATASET_NAME} version={dataset.version_id} "
        f"({len(dataset.examples)} examples)"
    )

    results = []
    for variant in VARIANTS:
        results.append(run_variant(client, dataset, variant))

    print("\n=== Variant comparison summary ===")
    print(f"  A (full)            → 25/25 (100%)   Phoenix Experiment:4 (already shipped)")
    for r in results:
        label = "B (names_only)" if r["variant"]["library_mode"] == "names_only" else "C (categories_only)"
        eid = r["experiment_id"] or "?"
        print(f"  {label:<19} → {r['matches']}/{r['total']} ({r['pct']:.0f}%)   Phoenix Experiment id: {eid}")
    print(
        "\nView side-by-side in Phoenix → Datasets → mathesis-golden-v1 → Experiments tab."
    )


if __name__ == "__main__":
    main()
