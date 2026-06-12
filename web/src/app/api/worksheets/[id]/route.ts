import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  worksheets,
  lessons,
  generatedProblems,
  generatedProblemConcepts,
  concepts,
  problemConcepts,
  scores,
  scrapedProblems,
} from "@/lib/db/schema";

const PORTAL_PROBLEMS_PER_CONCEPT = 3;

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [worksheet] = await db()
    .select({
      id: worksheets.id,
      lessonId: worksheets.lessonId,
      lessonNumber: lessons.lessonNumber,
      lessonTitle: lessons.title,
      title: worksheets.title,
      createdAt: worksheets.createdAt,
      totalProblems: worksheets.totalProblems,
      focusConceptIds: worksheets.focusConceptIds,
      skipConceptIds: worksheets.skipConceptIds,
      skippedVisualConceptIds: worksheets.skippedVisualConceptIds,
      difficultyLevel: worksheets.difficultyLevel,
      status: worksheets.status,
      scoredAt: worksheets.scoredAt,
      totalCorrect: worksheets.totalCorrect,
      totalAttempted: worksheets.totalAttempted,
    })
    .from(worksheets)
    .innerJoin(lessons, eq(worksheets.lessonId, lessons.id))
    .where(eq(worksheets.id, id))
    .limit(1);

  if (!worksheet) {
    return NextResponse.json({ error: "Worksheet not found" }, { status: 404 });
  }

  const problems = await db()
    .select()
    .from(generatedProblems)
    .where(eq(generatedProblems.worksheetId, id))
    .orderBy(generatedProblems.displayOrder);

  const problemIds = problems.map((p) => p.id);
  const conceptRows = problemIds.length
    ? await db()
        .select({
          generatedProblemId: generatedProblemConcepts.generatedProblemId,
          conceptId: concepts.id,
          conceptName: concepts.name,
          conceptDisplayName: concepts.displayName,
          conceptCategory: concepts.category,
        })
        .from(generatedProblemConcepts)
        .innerJoin(
          concepts,
          eq(generatedProblemConcepts.conceptId, concepts.id)
        )
        .where(inArray(generatedProblemConcepts.generatedProblemId, problemIds))
    : [];

  const scoreRows = problemIds.length
    ? await db()
        .select({
          generatedProblemId: scores.generatedProblemId,
          isCorrect: scores.isCorrect,
          parentNotes: scores.parentNotes,
          scoredAt: scores.scoredAt,
        })
        .from(scores)
        .where(inArray(scores.generatedProblemId, problemIds))
    : [];

  const scoreByProblemId = new Map(
    scoreRows.map((s) => [
      s.generatedProblemId,
      {
        isCorrect: s.isCorrect,
        parentNotes: s.parentNotes,
        scoredAt: s.scoredAt,
      },
    ])
  );

  const problemsWithConcepts = problems.map((p) => ({
    ...p,
    concepts: conceptRows
      .filter((c) => c.generatedProblemId === p.id)
      .map((c) => ({
        id: c.conceptId,
        name: c.conceptName,
        displayName: c.conceptDisplayName,
        category: c.conceptCategory,
      })),
    score: scoreByProblemId.get(p.id) ?? null,
  }));

  // Portal practice is scoped to skippedVisualConceptIds stored on the
  // worksheet at generation time. NULL = pre-Phase-6.5 (filter hadn't
  // shipped); [] = filter ran but didn't drop anything for this worksheet.
  // Either way: nothing to surface.
  let skippedIds: number[] = [];
  if (worksheet.skippedVisualConceptIds) {
    try {
      const parsed: unknown = JSON.parse(worksheet.skippedVisualConceptIds);
      if (Array.isArray(parsed)) {
        skippedIds = parsed.filter((x): x is number => typeof x === "number");
      }
    } catch {
      // Malformed JSON — treat as no skipped concepts. The worksheet still
      // renders; only the portal section is silently empty.
    }
  }

  const visualConceptRows = skippedIds.length
    ? await db()
        .select({
          conceptId: concepts.id,
          conceptName: concepts.name,
          conceptDisplayName: concepts.displayName,
          problemId: scrapedProblems.id,
          problemNumber: scrapedProblems.problemNumber,
          problemText: scrapedProblems.problemText,
          hasImage: scrapedProblems.hasImage,
          imageDescription: scrapedProblems.imageDescription,
          displayOrder: scrapedProblems.displayOrder,
        })
        .from(problemConcepts)
        .innerJoin(concepts, eq(problemConcepts.conceptId, concepts.id))
        .innerJoin(
          scrapedProblems,
          eq(problemConcepts.scrapedProblemId, scrapedProblems.id)
        )
        .where(
          and(
            eq(scrapedProblems.lessonId, worksheet.lessonId),
            inArray(concepts.id, skippedIds)
          )
        )
        .orderBy(asc(concepts.id), asc(scrapedProblems.displayOrder))
    : [];

  type PortalProblem = {
    id: number;
    problemNumber: string;
    problemText: string;
    hasImage: boolean;
    imageDescription: string | null;
  };
  type PortalConcept = {
    conceptId: number;
    conceptName: string;
    conceptDisplayName: string;
    problems: PortalProblem[];
  };
  const portalByConcept = new Map<number, PortalConcept>();
  const seenProblemIds = new Set<number>();
  for (const row of visualConceptRows) {
    if (seenProblemIds.has(row.problemId)) continue;
    let entry = portalByConcept.get(row.conceptId);
    if (!entry) {
      entry = {
        conceptId: row.conceptId,
        conceptName: row.conceptName,
        conceptDisplayName: row.conceptDisplayName,
        problems: [],
      };
      portalByConcept.set(row.conceptId, entry);
    }
    if (entry.problems.length >= PORTAL_PROBLEMS_PER_CONCEPT) continue;
    seenProblemIds.add(row.problemId);
    entry.problems.push({
      id: row.problemId,
      problemNumber: row.problemNumber,
      problemText: row.problemText,
      hasImage: row.hasImage,
      imageDescription: row.imageDescription,
    });
  }
  const portalPractice = [...portalByConcept.values()].filter(
    (e) => e.problems.length > 0
  );

  return NextResponse.json({
    worksheet,
    problems: problemsWithConcepts,
    portalPractice,
  });
}
