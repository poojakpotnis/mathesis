import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
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
import { validateApiKey } from "@/lib/auth";
import {
  generateProblems,
  type GeneratorInputConcept,
  type GeneratorDifficulty,
} from "@/lib/claude/generate";
import { verifyProblem } from "@/lib/claude/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WorksheetSchema = z.object({
  lesson_id: z.number().int().positive(),
  count: z.number().int().min(1).max(30),
  difficulty: z.enum(["easier", "match", "harder", "progressive"]),
  focus_concept_ids: z.array(z.number().int().positive()).optional(),
  skip_concept_ids: z.array(z.number().int().positive()).optional(),
});

const MAX_EXAMPLES_PER_CONCEPT = 3;

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const body = await request.json();
  const parsed = WorksheetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    lesson_id: lessonId,
    count,
    difficulty,
    focus_concept_ids: focusIds,
    skip_concept_ids: skipIds,
  } = parsed.data;

  const [lesson] = await db()
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }
  if (lesson.classificationStatus !== "completed") {
    return NextResponse.json(
      { error: `Lesson classification status is "${lesson.classificationStatus}", must be "completed"` },
      { status: 400 }
    );
  }

  // Pull all (problem_concept, scraped_problem, concept) tuples for this lesson
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
    return NextResponse.json(
      { error: "Lesson has no classified problem→concept mappings" },
      { status: 400 }
    );
  }

  // Group by concept; collect example problems (prefer text-only, high confidence)
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
    if (!m.hasImage && entry.exampleProblems!.length < MAX_EXAMPLES_PER_CONCEPT) {
      entry.exampleProblems!.push({
        id: m.scrapedProblemId,
        problemText: m.problemText,
      });
    }
  }

  // Apply skip filter
  let candidates = [...byId.values()];
  if (skipIds && skipIds.length > 0) {
    const skipSet = new Set(skipIds);
    candidates = candidates.filter((c) => !skipSet.has(c.id));
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "No concepts remain after applying skip_concept_ids" },
      { status: 400 }
    );
  }

  // Order: focus concepts first, then by total appearances in the lesson (desc)
  const focusSet = new Set(focusIds ?? []);
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

  // Generate
  const genResult = await generateProblems({
    concepts: selectedConcepts,
    count,
    difficulty: difficulty as GeneratorDifficulty,
    lessonTitle: lesson.title,
  });

  if (genResult.problems.length === 0) {
    return NextResponse.json(
      { error: "Generator returned no problems" },
      { status: 500 }
    );
  }

  // Verify each problem in parallel
  const verifications = await Promise.all(
    genResult.problems.map((p) =>
      verifyProblem({
        problemText: p.problemText,
        expectedAnswer: p.correctAnswer,
        answerFormatType: p.answerFormatType,
      })
    )
  );

  // Build name → id lookup for concept mappings
  const nameToId = new Map<string, number>(
    selectedConcepts.map((c) => [c.name, c.id])
  );
  const validScrapedIds = new Set(
    lessonMappings.map((m) => m.scrapedProblemId)
  );

  // Insert worksheet row
  const createdAt = new Date().toISOString();
  const [worksheet] = await db()
    .insert(worksheets)
    .values({
      lessonId,
      title: `${lesson.title} — ${difficulty} (${count})`,
      createdAt,
      totalProblems: genResult.problems.length,
      focusConceptIds: focusIds ? JSON.stringify(focusIds) : null,
      skipConceptIds: skipIds ? JSON.stringify(skipIds) : null,
      difficultyLevel: difficulty as GeneratorDifficulty,
      status: "generated",
    })
    .returning({ id: worksheets.id });

  // Insert generated_problems
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
    .returning({ id: generatedProblems.id, displayOrder: generatedProblems.displayOrder });

  // Insert generated_problem_concepts
  const conceptMappings: {
    generatedProblemId: number;
    conceptId: number;
  }[] = [];
  const skippedMappings: { displayOrder: number; conceptName: string }[] = [];
  for (let i = 0; i < genResult.problems.length; i++) {
    const p = genResult.problems[i];
    const inserted = insertedProblems.find((r) => r.displayOrder === i + 1);
    if (!inserted) continue;
    const seen = new Set<number>();
    for (const name of p.conceptNames) {
      const cid = nameToId.get(name);
      if (!cid) {
        skippedMappings.push({ displayOrder: i + 1, conceptName: name });
        continue;
      }
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

  return NextResponse.json({
    worksheetId: worksheet.id,
    lessonId,
    title: `${lesson.title} — ${difficulty} (${count})`,
    totalProblems: genResult.problems.length,
    verifiedCount,
    flaggedCount,
    conceptMappings: conceptMappings.length,
    skippedMappings,
  });
}
