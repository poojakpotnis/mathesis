import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  worksheets,
  lessons,
  generatedProblems,
  generatedProblemConcepts,
  concepts,
  scores,
} from "@/lib/db/schema";

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

  return NextResponse.json({ worksheet, problems: problemsWithConcepts });
}
