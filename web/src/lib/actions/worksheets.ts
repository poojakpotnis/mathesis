"use server";

import { eq, inArray, sql } from "drizzle-orm";
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
  scores,
  conceptMastery,
} from "@/lib/db/schema";
import {
  generateProblems,
  type GeneratorInputConcept,
  type GeneratorDifficulty,
} from "@/lib/claude/generate";
import { partitionByDuplicates, type SourceProblem } from "@/lib/claude/dedupe";
import { verifyProblem } from "@/lib/claude/verify";
import { withSpan } from "@/lib/otel/tracer";
import { pushSpanAnnotation } from "@/lib/phoenix/annotations";

const MAX_EXAMPLES_PER_CONCEPT = 3;

export type GenerateWorksheetInput = {
  lessonId: number;
  count: number;
  difficulty: GeneratorDifficulty;
  focusConceptIds?: number[];
  skipConceptIds?: number[];
  // When true, candidates are hard-filtered to focusConceptIds (instead of
  // just sorted with them first). Used by concept-drill generation where
  // the parent picks one concept and wants only that concept's problems.
  focusOnly?: boolean;
  // When true, EVERY generated problem must carry a figure (non-figure problems
  // are dropped). Used for figure stress-tests.
  figuresOnly?: boolean;
};

export type GenerateWorksheetResult =
  | {
      ok: true;
      worksheetId: number;
      verifiedCount: number;
      flaggedCount: number;
    }
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

  const { lessonId, count, difficulty, focusConceptIds, skipConceptIds, focusOnly, figuresOnly } = input;

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
  if (lesson.gradeLevel == null) {
    return {
      ok: false,
      error: `Lesson ${lesson.id} is missing grade_level. Set it on the lesson before generating worksheets.`,
    };
  }
  const gradeLevel = lesson.gradeLevel;
  // Tag the parent span so all worksheets for grade N are filterable in Phoenix.
  span.setAttribute("worksheet.grade_level", gradeLevel);

  const lessonMappings = await db()
    .select({
      conceptId: concepts.id,
      conceptName: concepts.name,
      conceptDisplay: concepts.displayName,
      conceptCategory: concepts.category,
      conceptModalityTag: concepts.modalityTag,
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

  type Grouped = GeneratorInputConcept & {
    totalCount: number;
    modalityTag: string;
  };
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
        modalityTag: m.conceptModalityTag,
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

  // Apply skipConceptIds (concepts the parent explicitly removed). Visual
  // concepts are now generated (with figures) like any other concept — there
  // is no modality-based skip anymore (Phase 6.6 removed portal practice).
  let candidates = [...byId.values()];
  if (skipConceptIds && skipConceptIds.length > 0) {
    const skipSet = new Set(skipConceptIds);
    candidates = candidates.filter((c) => !skipSet.has(c.id));
  }

  // Concept-drill mode: hard-restrict candidates to the focused concept(s).
  // Used by the concepts page "Generate" button — parent picks one concept,
  // worksheet contains only that concept's problems.
  if (focusOnly && focusConceptIds && focusConceptIds.length > 0) {
    const focusSet = new Set(focusConceptIds);
    candidates = candidates.filter((c) => focusSet.has(c.id));
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      error: "No concepts remain after applying skipConceptIds",
    };
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
    gradeLevel,
    figuresOnly,
  });

  if (genResult.problems.length === 0) {
    return { ok: false, error: "Generator returned no problems" };
  }

  // Dedup against the full lesson source set. The Phase 5h v2 LLM judge
  // surfaced ~5% verbatim duplicates of source problems; the generator's
  // own sourceScrapedProblemId field is unreliable (the duplicates we
  // observed all claimed a different source than the one they copied).
  // Compare against every unique source problem text for this lesson.
  const seenSourceIds = new Set<number>();
  const lessonSourceProblems: SourceProblem[] = [];
  for (const m of lessonMappings) {
    if (!seenSourceIds.has(m.scrapedProblemId)) {
      seenSourceIds.add(m.scrapedProblemId);
      lessonSourceProblems.push({
        id: m.scrapedProblemId,
        problemText: m.problemText,
      });
    }
  }

  const firstPass = partitionByDuplicates(
    genResult.problems,
    lessonSourceProblems
  );

  let finalProblems = firstPass.accepted;
  let regeneratedCount = 0;
  if (firstPass.dropped.length > 0) {
    const retry = await generateProblems({
      concepts: selectedConcepts,
      count: firstPass.dropped.length,
      difficulty,
      lessonTitle: lesson.title,
      gradeLevel,
      avoidProblems: lessonSourceProblems,
      figuresOnly,
    });
    const retryPartition = partitionByDuplicates(
      retry.problems,
      lessonSourceProblems
    );
    finalProblems = [...firstPass.accepted, ...retryPartition.accepted];
    regeneratedCount = retryPartition.accepted.length;
  }

  if (finalProblems.length === 0) {
    return { ok: false, error: "Generator returned only duplicates of source problems" };
  }

  // figuresOnly: keep only problems that actually carry a figure (belt-and-
  // suspenders on top of the prompt), so a stress-test worksheet is all figures.
  if (figuresOnly) {
    finalProblems = finalProblems.filter((p) => p.figureSvg);
    if (finalProblems.length === 0) {
      return {
        ok: false,
        error: "figuresOnly: generator produced no figure-bearing problems",
      };
    }
  }

  span.setAttributes({
    "worksheet.dedup.initial_dropped": firstPass.dropped.length,
    "worksheet.dedup.dropped_source_ids": JSON.stringify(
      firstPass.dropped.map((d) => d.matchedSourceId)
    ),
    "worksheet.dedup.regenerated_count": regeneratedCount,
  });

  // Child span around the verifier fan-out. All N parallel Anthropic
  // calls become siblings inside this span, so we can read "total verify
  // time" and "verifier cost per worksheet" at a glance in Phoenix.
  const verifications = await withSpan(
    "mathesis.worksheet.verify",
    { "verify.problem_count": finalProblems.length },
    () =>
      Promise.all(
        finalProblems.map((p) =>
          verifyProblem({
            problemText: p.problemText,
            expectedAnswer: p.correctAnswer,
            answerFormatType: p.answerFormatType,
            gradeLevel,
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
      totalProblems: finalProblems.length,
      focusConceptIds: focusConceptIds ? JSON.stringify(focusConceptIds) : null,
      skipConceptIds: skipConceptIds ? JSON.stringify(skipConceptIds) : null,
      difficultyLevel: difficulty,
      status: "generated",
    })
    .returning({ id: worksheets.id });

  const problemRows = finalProblems.map((p, idx) => {
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
      figureSvg: p.figureSvg,
      correctAnswer: p.correctAnswer,
      answerFormatType: p.answerFormatType,
      solutionSteps: p.solutionSteps,
      difficultyRating: p.difficultyRating,
      sourceScrapedProblemId: sourceId,
      verificationStatus: v.verificationStatus,
      verificationDetails: v.verificationDetails,
      verifySpanId: v.verifySpanId,
      verifyTraceId: v.verifyTraceId,
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
  for (let i = 0; i < finalProblems.length; i++) {
    const p = finalProblems[i];
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
    "worksheet.problems_generated": finalProblems.length,
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

// Concept drill. Picks the lesson where the concept has the most source
// problems (richest reference set for the generator), then calls
// generateWorksheetAction with focusOnly so the worksheet contains only
// that concept's problems. Defaults to "progressive" — the kid is often
// here because they're struggling, so ramp them up — but the dialog can
// request "harder" for a kid who has the concept down and wants a stretch.
const DEFAULT_CONCEPT_DRILL_DIFFICULTY: GeneratorDifficulty = "progressive";
const ALLOWED_CONCEPT_DRILL_DIFFICULTIES: GeneratorDifficulty[] = [
  "progressive",
  "harder",
];

export async function generateConceptWorksheetAction(
  conceptId: number,
  count: number,
  lessonId?: number,
  difficulty: GeneratorDifficulty = DEFAULT_CONCEPT_DRILL_DIFFICULTY
): Promise<GenerateWorksheetResult> {
  if (!Number.isInteger(conceptId) || conceptId <= 0) {
    return { ok: false, error: "Invalid conceptId" };
  }
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    return { ok: false, error: "Count must be between 1 and 30" };
  }
  if (!ALLOWED_CONCEPT_DRILL_DIFFICULTIES.includes(difficulty)) {
    return { ok: false, error: "Unsupported difficulty" };
  }
  if (lessonId !== undefined && (!Number.isInteger(lessonId) || lessonId <= 0)) {
    return { ok: false, error: "Invalid lessonId" };
  }

  const [concept] = await db()
    .select({
      id: concepts.id,
      name: concepts.name,
    })
    .from(concepts)
    .where(eq(concepts.id, conceptId))
    .limit(1);
  if (!concept) return { ok: false, error: "Concept not found" };

  const lessonCounts = await db()
    .select({
      lessonId: scrapedProblems.lessonId,
      n: sql<number>`count(distinct ${scrapedProblems.id})`,
    })
    .from(problemConcepts)
    .innerJoin(
      scrapedProblems,
      eq(problemConcepts.scrapedProblemId, scrapedProblems.id)
    )
    .where(eq(problemConcepts.conceptId, conceptId))
    .groupBy(scrapedProblems.lessonId);
  if (lessonCounts.length === 0) {
    return {
      ok: false,
      error: `No source problems classified to "${concept.name}" — nothing to drill.`,
    };
  }

  let chosenLessonId: number;
  if (lessonId !== undefined) {
    const match = lessonCounts.find((r) => r.lessonId === lessonId);
    if (!match) {
      return {
        ok: false,
        error: `"${concept.name}" has no source problems on lesson id ${lessonId}.`,
      };
    }
    chosenLessonId = lessonId;
  } else {
    const top = lessonCounts.reduce((best, r) =>
      Number(r.n) > Number(best.n) ? r : best
    );
    chosenLessonId = top.lessonId;
  }

  return generateWorksheetAction({
    lessonId: chosenLessonId,
    count,
    difficulty,
    focusConceptIds: [conceptId],
    focusOnly: true,
  });
}

export type ProblemVerificationStatus =
  | "verified"
  | "flagged"
  | "approved"
  | "confirmed_flagged";

export async function setProblemVerificationAction(
  worksheetId: number,
  problemId: number,
  status: ProblemVerificationStatus,
  reason?: string
): Promise<
  | { ok: true; annotation?: { pushed: boolean; error?: string } }
  | { ok: false; error: string }
> {
  if (!Number.isInteger(worksheetId) || worksheetId <= 0) {
    return { ok: false, error: "Invalid worksheetId" };
  }
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return { ok: false, error: "Invalid problemId" };
  }

  // Read the prior row so we can detect "flagged -> approved/confirmed_flagged"
  // (the only transitions that push a Phoenix annotation per the Phase 5e
  // design) and grab the verifier's span id for the annotation target.
  const [prior] = await db()
    .select({
      id: generatedProblems.id,
      worksheetId: generatedProblems.worksheetId,
      verificationStatus: generatedProblems.verificationStatus,
      verifySpanId: generatedProblems.verifySpanId,
    })
    .from(generatedProblems)
    .where(eq(generatedProblems.id, problemId))
    .limit(1);

  if (!prior || prior.worksheetId !== worksheetId) {
    return { ok: false, error: "Problem not found in worksheet" };
  }

  await db()
    .update(generatedProblems)
    .set({ verificationStatus: status })
    .where(eq(generatedProblems.id, problemId));

  const isOverride =
    prior.verificationStatus === "flagged" &&
    (status === "approved" || status === "confirmed_flagged");

  let annotation: { pushed: boolean; error?: string } | undefined;
  if (isOverride) {
    if (!prior.verifySpanId) {
      // Rows generated before Phase 5e shipped don't have a span id. Skip
      // the push but still let the status update succeed.
      annotation = {
        pushed: false,
        error: "No verify_span_id on this problem (pre-Phase-5e row).",
      };
    } else {
      // score 1 = parent approved (verifier was wrong about flagging).
      // score 0 = parent confirmed the flag (verifier was right). The exact
      // semantics live alongside the schema/spec, not as a magic number.
      const score = status === "approved" ? 1 : 0;
      const res = await pushSpanAnnotation({
        spanId: prior.verifySpanId,
        name: "parent_review",
        label: status,
        score,
        explanation: reason,
        // One annotation per problem: re-clicks upsert in place rather than
        // accumulating duplicates on the same verify span.
        identifier: `problem-${problemId}`,
        metadata: { worksheet_id: worksheetId, problem_id: problemId },
      });
      annotation = res.ok ? { pushed: true } : { pushed: false, error: res.error };
    }
  }

  revalidatePath(`/worksheets/${worksheetId}`);
  return { ok: true, annotation };
}

export type MasteryLevel = "not_started" | "learning" | "practicing" | "mastered";

// Threshold rule (Phase 6): not_started -> learning (any attempt)
// -> practicing (>=5 attempts AND >=70% accuracy)
// -> mastered (>=10 attempts AND >=85% accuracy AND last 3 attempts all correct).
// Demotes back down if those thresholds stop holding (e.g. a streak break drops
// "mastered" to "practicing"). Conservative: a kid who guesses right twice then
// blanks shouldn't show "mastered".
function computeMasteryLevel(
  totalAttempted: number,
  totalCorrect: number,
  recentResults: boolean[] // most-recent-first, length<=3
): MasteryLevel {
  if (totalAttempted === 0) return "not_started";
  const accuracy = totalCorrect / totalAttempted;
  const lastThreeAllCorrect =
    recentResults.length >= 3 && recentResults.slice(0, 3).every((r) => r);
  if (totalAttempted >= 10 && accuracy >= 0.85 && lastThreeAllCorrect) {
    return "mastered";
  }
  if (totalAttempted >= 5 && accuracy >= 0.7) {
    return "practicing";
  }
  return "learning";
}

// Recompute concept_mastery rows from the full scores table for the given
// concept ids. Idempotent: safe to call on every score submission, whether
// the score is new or a correction. Slower than delta-arithmetic but
// removes whole classes of double-counting bugs.
async function recomputeConceptMastery(conceptIds: number[]): Promise<void> {
  if (conceptIds.length === 0) return;

  for (const conceptId of conceptIds) {
    // Every score row whose problem maps to this concept.
    const rows = await db()
      .select({
        isCorrect: scores.isCorrect,
        scoredAt: scores.scoredAt,
      })
      .from(scores)
      .innerJoin(
        generatedProblemConcepts,
        eq(scores.generatedProblemId, generatedProblemConcepts.generatedProblemId)
      )
      .where(eq(generatedProblemConcepts.conceptId, conceptId));

    const totalAttempted = rows.length;
    const totalCorrect = rows.filter((r) => r.isCorrect).length;
    const sorted = [...rows].sort((a, b) =>
      b.scoredAt.localeCompare(a.scoredAt)
    );
    const recentResults = sorted.slice(0, 3).map((r) => r.isCorrect);
    const lastAttemptedAt = sorted[0]?.scoredAt ?? null;

    // currentStreak: count of consecutive correct answers walking backward
    // from most recent. Resets to 0 on any wrong.
    let currentStreak = 0;
    for (const r of sorted) {
      if (r.isCorrect) currentStreak += 1;
      else break;
    }

    const masteryLevel = computeMasteryLevel(
      totalAttempted,
      totalCorrect,
      recentResults
    );

    const [existing] = await db()
      .select({ id: conceptMastery.id })
      .from(conceptMastery)
      .where(eq(conceptMastery.conceptId, conceptId))
      .limit(1);

    if (existing) {
      await db()
        .update(conceptMastery)
        .set({
          totalAttempted,
          totalCorrect,
          currentStreak,
          lastAttemptedAt,
          masteryLevel,
        })
        .where(eq(conceptMastery.id, existing.id));
    } else {
      await db().insert(conceptMastery).values({
        conceptId,
        totalAttempted,
        totalCorrect,
        currentStreak,
        lastAttemptedAt,
        masteryLevel,
      });
    }
  }
}

export type SubmitScoreResult =
  | {
      ok: true;
      totalCorrect: number;
      totalAttempted: number;
      worksheetStatus: "in_progress" | "scored";
    }
  | { ok: false; error: string };

export async function submitScoreAction(
  worksheetId: number,
  problemId: number,
  isCorrect: boolean,
  parentNotes?: string
): Promise<SubmitScoreResult> {
  if (!Number.isInteger(worksheetId) || worksheetId <= 0) {
    return { ok: false, error: "Invalid worksheetId" };
  }
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return { ok: false, error: "Invalid problemId" };
  }

  const [problem] = await db()
    .select({
      id: generatedProblems.id,
      worksheetId: generatedProblems.worksheetId,
    })
    .from(generatedProblems)
    .where(eq(generatedProblems.id, problemId))
    .limit(1);
  if (!problem || problem.worksheetId !== worksheetId) {
    return { ok: false, error: "Problem not found in worksheet" };
  }

  const scoredAt = new Date().toISOString();

  // Upsert: one score row per problem. Re-submission overwrites.
  const [existing] = await db()
    .select({ id: scores.id })
    .from(scores)
    .where(eq(scores.generatedProblemId, problemId))
    .limit(1);

  if (existing) {
    await db()
      .update(scores)
      .set({
        isCorrect,
        scoredAt,
        parentNotes: parentNotes ?? null,
      })
      .where(eq(scores.id, existing.id));
  } else {
    await db().insert(scores).values({
      worksheetId,
      generatedProblemId: problemId,
      isCorrect,
      scoredAt,
      parentNotes: parentNotes ?? null,
    });
  }

  // Recompute worksheet rollup from all scores for this worksheet.
  const allScores = await db()
    .select({ isCorrect: scores.isCorrect })
    .from(scores)
    .where(eq(scores.worksheetId, worksheetId));
  const totalAttempted = allScores.length;
  const totalCorrect = allScores.filter((s) => s.isCorrect).length;

  const [ws] = await db()
    .select({ totalProblems: worksheets.totalProblems })
    .from(worksheets)
    .where(eq(worksheets.id, worksheetId))
    .limit(1);

  const worksheetStatus: "in_progress" | "scored" =
    ws && totalAttempted >= ws.totalProblems ? "scored" : "in_progress";

  await db()
    .update(worksheets)
    .set({
      totalCorrect,
      totalAttempted,
      status: worksheetStatus,
      scoredAt: worksheetStatus === "scored" ? scoredAt : null,
    })
    .where(eq(worksheets.id, worksheetId));

  // Recompute concept_mastery for every concept linked to this problem.
  const linkedConceptIds = await db()
    .select({ conceptId: generatedProblemConcepts.conceptId })
    .from(generatedProblemConcepts)
    .where(eq(generatedProblemConcepts.generatedProblemId, problemId));
  await recomputeConceptMastery(linkedConceptIds.map((r) => r.conceptId));

  revalidatePath(`/worksheets/${worksheetId}`);
  revalidatePath("/");
  return { ok: true, totalCorrect, totalAttempted, worksheetStatus };
}

export type DeleteWorksheetResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteWorksheetAction(
  worksheetId: number
): Promise<DeleteWorksheetResult> {
  if (!Number.isInteger(worksheetId) || worksheetId <= 0) {
    return { ok: false, error: "Invalid worksheetId" };
  }

  const [worksheet] = await db()
    .select({ id: worksheets.id })
    .from(worksheets)
    .where(eq(worksheets.id, worksheetId))
    .limit(1);
  if (!worksheet) return { ok: false, error: "Worksheet not found" };

  // Capture affected concepts before deleting so we can recompute mastery
  // after the score rows are gone. Phoenix annotations on verifier spans
  // are not touched — they live in Phoenix, not Turso, and the verifier
  // trace ids on the deleted problem rows would no longer resolve anyway.
  const problemRows = await db()
    .select({ id: generatedProblems.id })
    .from(generatedProblems)
    .where(eq(generatedProblems.worksheetId, worksheetId));
  const pids = problemRows.map((p) => p.id);

  let affectedConceptIds: number[] = [];
  if (pids.length > 0) {
    const conceptRows = await db()
      .select({ conceptId: generatedProblemConcepts.conceptId })
      .from(generatedProblemConcepts)
      .where(inArray(generatedProblemConcepts.generatedProblemId, pids));
    affectedConceptIds = [...new Set(conceptRows.map((r) => r.conceptId))];
  }

  // SQLite/Turso doesn't enforce FKs by default — do dependency-order
  // deletes explicitly.
  await db().delete(scores).where(eq(scores.worksheetId, worksheetId));
  if (pids.length > 0) {
    await db()
      .delete(generatedProblemConcepts)
      .where(inArray(generatedProblemConcepts.generatedProblemId, pids));
  }
  await db()
    .delete(generatedProblems)
    .where(eq(generatedProblems.worksheetId, worksheetId));
  await db().delete(worksheets).where(eq(worksheets.id, worksheetId));

  if (affectedConceptIds.length > 0) {
    await recomputeConceptMastery(affectedConceptIds);
  }

  revalidatePath("/worksheets");
  revalidatePath("/");
  return { ok: true };
}
