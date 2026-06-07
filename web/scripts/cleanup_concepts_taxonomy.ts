/**
 * One-off taxonomy cleanup — aligns Turso `concepts` with the ratified golden_v1.
 *
 * Does three things:
 *   1. Drops `algebraic_expression_simplification` (id=11) — mis-applied per ratification.
 *      One mapping on problem 21 (#9) is removed.
 *   2. Drops `fraction_of_quantity` (id=17) — redundant per ratification. Its 9
 *      mappings (#11a-h + #13) are removed; those problems remain correctly
 *      tagged via `fraction_multiplication` / `multi_step_word_problem`.
 *   3. Renames `difference_of_squares` (id=9) → `mental_math_shortcuts` to match
 *      the grade-4 framing in golden_v1. Mappings preserved (they reference the
 *      same id, the row just gets new name + displayName + description).
 *
 * Surgical UPDATE/DELETE — does not go through `/api/ingest` (which would
 * DELETE+INSERT and orphan all classifications). Run once.
 */

import { db } from "@/lib/db/client";
import {
  concepts,
  problemConcepts,
  generatedProblemConcepts,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

const DROP_IDS = [11, 17] as const;
const RENAME_ID = 9;
const RENAME_TO = {
  name: "mental_math_shortcuts",
  displayName: "Mental Math Shortcuts",
  description:
    "Recognizing a pattern in an arithmetic expression that allows a shortcut calculation (e.g., a²−b²=(a+b)(a−b)).",
};

async function main() {
  const before = await db()
    .select({
      id: concepts.id,
      name: concepts.name,
      displayName: concepts.displayName,
    })
    .from(concepts)
    .where(inArray(concepts.id, [...DROP_IDS, RENAME_ID]));
  console.log("Before cleanup:");
  for (const c of before) console.log(`  id=${c.id}  ${c.name}  ("${c.displayName}")`);
  console.log();

  const droppedMappings = await db()
    .delete(problemConcepts)
    .where(inArray(problemConcepts.conceptId, [...DROP_IDS]))
    .returning({ id: problemConcepts.id });
  console.log(`Deleted ${droppedMappings.length} problem_concepts mappings.`);

  const droppedGpc = await db()
    .delete(generatedProblemConcepts)
    .where(inArray(generatedProblemConcepts.conceptId, [...DROP_IDS]))
    .returning({ id: generatedProblemConcepts.id });
  console.log(
    `Deleted ${droppedGpc.length} generated_problem_concepts mappings.`
  );

  const droppedConcepts = await db()
    .delete(concepts)
    .where(inArray(concepts.id, [...DROP_IDS]))
    .returning({ id: concepts.id, name: concepts.name });
  console.log(`Deleted ${droppedConcepts.length} concepts: ${droppedConcepts.map((c) => c.name).join(", ")}`);

  const renamed = await db()
    .update(concepts)
    .set(RENAME_TO)
    .where(eq(concepts.id, RENAME_ID))
    .returning({ id: concepts.id, name: concepts.name, displayName: concepts.displayName });
  console.log(`Renamed: ${JSON.stringify(renamed[0])}`);
  console.log();

  const after = await db()
    .select({ id: concepts.id, name: concepts.name, displayName: concepts.displayName })
    .from(concepts)
    .orderBy(concepts.name);
  console.log(`After cleanup — ${after.length} concepts total:`);
  for (const c of after) console.log(`  id=${c.id}  ${c.name}  ("${c.displayName}")`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
