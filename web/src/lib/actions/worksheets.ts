"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  lessons,
  scrapedProblems,
  concepts,
  problemConcepts,
  worksheets,
  generatedProblems,
  generatedProblemConcepts,
} from "@/lib/db/schema";
import {
  generateProblems,
  type GeneratorInputConcept,
  type GeneratorDifficulty,
} from "@/lib/claude/generate";
import { verifyProblem } from "@/lib/claude/verify";
import { withSpan } from "@/lib/otel/tracer";

const MAX_EXAMPLES_PER_CONCEPT = 3;

export type GenerateWorksheetInput = {
  lessonId: number;
  count: number;
  difficulty: GeneratorDifficulty;
  focusConceptIds?: number[];
  skipConceptIds?: number[];
};

export type GenerateWorksheetResult =
  | { ok: true; worksheetId: number; verifiedCount: number; flaggedCount: number }
  | { ok: false; error: string };

export async function generateWorksheetAction(
  input: GenerateWorksheetInput
): Promise<GenerateWorksheetResult> {
  if (!Number.isInteger(input.lessonId) || input.lessonId <= 0) {
    return { ok: false, error: "Invalid lessonId" };
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 30) {
    return { ok: false, error: "Count must be between 1 and 30" };
  }
  if (!["easier", "match", "harder", "progressive"].includes(input.difficulty)) {
    return { ok: false, error: "Invalid difficulty" };
  }

  const { lessonId, count, difficulty, focusConceptIds, skipConceptIds } = input;

  // Top-level span. Everything below — generator Anthropic call, verifier
  // Anthropic calls, DB writes — runs inside the active context of this span
  // and therefore nests as its children in Phoenix.
  return withSpan(
    "mathesis.worksheet.generate",
    {
      "worksheet.lesson_id": lessonId,
      "worksheet.count": count,
      "worksheet.difficulty": difficulty,
      "worksheet.focus_concept_count": focusConceptIds?.length ?? 0,
      "worksheet.skip_concept_count": skipConceptIds?.length ?? 0,
    },
    async (span): Promise<GenerateWorksheetResult> => {

  const [lesson] = await db()
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);

  if (!lesson) return { ok: false, error: "Lesson not found" };
  if (lesson.classificationStatus !== "completed") {
    return {
      ok: false,
      error: `Lesson classification status is "${lesson.classificationStatus}", must be "completed"`,
    };
  }

  const lessonMappings = await db()
    .select({
      conceptId: concepts.id,
      conceptName: concepts.name,
      conceptDisplay: concepts.displayName,
      conceptCategory: concepts.category,
      scrapedProblemId: scrapedProblems.id,
      problemText: scrapedProblems.problemText,
      hasImage: scrapedProblems.hasImage,
      confidence: problemConcepts.confidence,
    })
    .from(problemConcepts)
    .innerJoin(concepts, eq(problemConcepts.conceptId, concepts.id))
    .innerJoin(
      scrapedProblems,
      eq(problemConcepts.scrapedProblemId, scrapedProblems.id)
    )
    .where(eq(scrapedProblems.lessonId, lessonId));

  if (lessonMappings.length === 0) {
    return { ok: false, error: "Lesson has no classified problem→concept mappings" };
  }

  type Grouped = GeneratorInputConcept & { totalCount: number };
  const byId = new Map<number, Grouped>();
  for (const m of lessonMappings) {
    let entry = byId.get(m.conceptId);
    if (!entry) {
      entry = {
        id: m.conceptId,
        name: m.conceptName,
        displayName: m.conceptDisplay,
        category: m.conceptCategory,
        exampleProblems: [],
        totalCount: 0,
      };
      byId.set(m.conceptId, entry);
    }
    entry.totalCount += 1;
    if (
      !m.hasImage &&
      entry.exampleProblems!.length < MAX_EXAMPLES_PER_CONCEPT
    ) {
      entry.exampleProblems!.push({
        id: m.scrapedProblemId,
        problemText: m.problemText,
      });
    }
  }

  let candidates = [...byId.values()];
  if (skipConceptIds && skipConceptIds.length > 0) {
    const skipSet = new Set(skipConceptIds);
    candidates = candidates.filter((c) => !skipSet.has(c.id));
  }

  if (candidates.length === 0) {
    return { ok: false, error: "No concepts remain after applying skipConceptIds" };
  }

  const focusSet = new Set(focusConceptIds ?? []);
  candidates.sort((a, b) => {
    const aFocus = focusSet.has(a.id) ? 1 : 0;
    const bFocus = focusSet.has(b.id) ? 1 : 0;
    if (aFocus !== bFocus) return bFocus - aFocus;
    return b.totalCount - a.totalCount;
  });

  const selectedConcepts: GeneratorInputConcept[] = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    displayName: c.displayName,
    category: c.category,
    exampleProblems: c.exampleProblems,
  }));

  const genResult = await generateProblems({
    concepts: selectedConcepts,
    count,
    difficulty,
    lessonTitle: lesson.title,
  });

  if (genResult.problems.length === 0) {
    return { ok: false, error: "Generator returned no problems" };
  }

  // Child span around the verifier fan-out. All N parallel Anthropic
  // calls become siblings inside this span, so we can read "total verify
  // time" and "verifier cost per worksheet" at a glance in Phoenix.
  const verifications = await withSpan(
    "mathesis.worksheet.verify",
    { "verify.problem_count": genResult.problems.length },
    () =>
      Promise.all(
        genResult.problems.map((p) =>
          verifyProblem({
            problemText: p.problemText,
            expectedAnswer: p.correctAnswer,
            answerFormatType: p.answerFormatType,
          })
        )
      )
  );

  const nameToId = new Map<string, number>(
    selectedConcepts.map((c) => [c.name, c.id])
  );
  const validScrapedIds = new Set(lessonMappings.map((m) => m.scrapedProblemId));

  const createdAt = new Date().toISOString();
  const [worksheet] = await db()
    .insert(worksheets)
    .values({
      lessonId,
      title: `${lesson.title} — ${difficulty} (${count})`,
      createdAt,
      totalProblems: genResult.problems.length,
      focusConceptIds: focusConceptIds ? JSON.stringify(focusConceptIds) : null,
      skipConceptIds: skipConceptIds ? JSON.stringify(skipConceptIds) : null,
      difficultyLevel: difficulty,
      status: "generated",
    })
    .returning({ id: worksheets.id });

  const problemRows = genResult.problems.map((p, idx) => {
    const v = verifications[idx];
    const sourceId =
      p.sourceScrapedProblemId !== null &&
      validScrapedIds.has(p.sourceScrapedProblemId)
        ? p.sourceScrapedProblemId
        : null;
    return {
      worksheetId: worksheet.id,
      displayOrder: idx + 1,
      problemText: p.problemText,
      problemLatex: p.problemLatex,
      correctAnswer: p.correctAnswer,
      answerFormatType: p.answerFormatType,
      solutionSteps: p.solutionSteps,
      difficultyRating: p.difficultyRating,
      sourceScrapedProblemId: sourceId,
      verificationStatus: v.verificationStatus,
      verificationDetails: v.verificationDetails,
    };
  });

  const insertedProblems = await db()
    .insert(generatedProblems)
    .values(problemRows)
    .returning({
      id: generatedProblems.id,
      displayOrder: generatedProblems.displayOrder,
    });

  const conceptMappings: { generatedProblemId: number; conceptId: number }[] = [];
  for (let i = 0; i < genResult.problems.length; i++) {
    const p = genResult.problems[i];
    const inserted = insertedProblems.find((r) => r.displayOrder === i + 1);
    if (!inserted) continue;
    const seen = new Set<number>();
    for (const name of p.conceptNames) {
      const cid = nameToId.get(name);
      if (!cid) continue;
      if (seen.has(cid)) continue;
      seen.add(cid);
      conceptMappings.push({
        generatedProblemId: inserted.id,
        conceptId: cid,
      });
    }
  }

  if (conceptMappings.length > 0) {
    await db().insert(generatedProblemConcepts).values(conceptMappings);
  }

  const verifiedCount = verifications.filter(
    (v) => v.verificationStatus === "verified"
  ).length;
  const flaggedCount = verifications.length - verifiedCount;

  // Outcome attributes: filterable in Phoenix ("show me all worksheets where
  // flagged_count > 3") and the raw signal a Phase 5d experiment will score.
  span.setAttributes({
    "worksheet.id": worksheet.id,
    "worksheet.verified_count": verifiedCount,
    "worksheet.flagged_count": flaggedCount,
    "worksheet.problems_generated": genResult.problems.length,
    "worksheet.concept_mappings": conceptMappings.length,
  });

  revalidatePath("/worksheets");
  revalidatePath(`/lessons/${lessonId}`);

  return {
    ok: true,
    worksheetId: worksheet.id,
    verifiedCount,
    flaggedCount,
  };
    }
  );
}

export async function setProblemVerificationAction(
  worksheetId: number,
  problemId: number,
  status: "verified" | "flagged"
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(worksheetId) || worksheetId <= 0) {
    return { ok: false, error: "Invalid worksheetId" };
  }
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return { ok: false, error: "Invalid problemId" };
  }
  const updated = await db()
    .update(generatedProblems)
    .set({ verificationStatus: status })
    .where(
      eq(generatedProblems.id, problemId)
    )
    .returning({ id: generatedProblems.id, worksheetId: generatedProblems.worksheetId });

  const row = updated[0];
  if (!row || row.worksheetId !== worksheetId) {
    return { ok: false, error: "Problem not found in worksheet" };
  }
  revalidatePath(`/worksheets/${worksheetId}`);
  return { ok: true };
}
