import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  lessons,
  scrapedProblems,
  problemConcepts,
  concepts,
  worksheets,
  generatedProblems,
  generatedProblemConcepts,
  scores,
} from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  grade_level: z.number().int().min(1).max(12).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const { lessonId } = await params;
  const id = parseInt(lessonId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid lesson id" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates: Partial<typeof lessons.$inferInsert> = {};
  if (parsed.data.grade_level != null) {
    updates.gradeLevel = parsed.data.grade_level;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const result = await db()
    .update(lessons)
    .set(updates)
    .where(eq(lessons.id, id))
    .returning({ id: lessons.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  return NextResponse.json({ updated: result[0].id, ...updates });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params;
  const id = parseInt(lessonId, 10);

  const [lesson] = await db()
    .select()
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  const problems = await db()
    .select()
    .from(scrapedProblems)
    .where(eq(scrapedProblems.lessonId, id))
    .orderBy(scrapedProblems.displayOrder);

  const problemIds = problems.map((p) => p.id);
  let conceptMappings: Array<{
    scrapedProblemId: number;
    conceptId: number;
    confidence: number;
    conceptName: string;
    conceptDisplayName: string;
    conceptCategory: string;
    conceptDescription: string | null;
  }> = [];

  if (problemIds.length > 0) {
    conceptMappings = await db()
      .select({
        scrapedProblemId: problemConcepts.scrapedProblemId,
        conceptId: problemConcepts.conceptId,
        confidence: problemConcepts.confidence,
        conceptName: concepts.name,
        conceptDisplayName: concepts.displayName,
        conceptCategory: concepts.category,
        conceptDescription: concepts.description,
      })
      .from(problemConcepts)
      .innerJoin(concepts, eq(problemConcepts.conceptId, concepts.id));
  }

  const problemsWithConcepts = problems.map((p) => ({
    ...p,
    concepts: conceptMappings
      .filter((m) => m.scrapedProblemId === p.id)
      .map((m) => ({
        id: m.conceptId,
        name: m.conceptName,
        displayName: m.conceptDisplayName,
        category: m.conceptCategory,
        description: m.conceptDescription,
        confidence: m.confidence,
      })),
  }));

  return NextResponse.json({ lesson, problems: problemsWithConcepts });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params;
  const id = parseInt(lessonId, 10);

  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid lesson id" }, { status: 400 });
  }

  const [lesson] = await db()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  const problemRows = await db()
    .select({ id: scrapedProblems.id })
    .from(scrapedProblems)
    .where(eq(scrapedProblems.lessonId, id));
  const scrapedIds = problemRows.map((p) => p.id);

  const worksheetRows = await db()
    .select({ id: worksheets.id })
    .from(worksheets)
    .where(eq(worksheets.lessonId, id));
  const worksheetIds = worksheetRows.map((w) => w.id);

  let generatedIds: number[] = [];
  if (worksheetIds.length > 0) {
    const generatedRows = await db()
      .select({ id: generatedProblems.id })
      .from(generatedProblems)
      .where(inArray(generatedProblems.worksheetId, worksheetIds));
    generatedIds = generatedRows.map((g) => g.id);
  }

  if (generatedIds.length > 0) {
    await db()
      .delete(scores)
      .where(inArray(scores.generatedProblemId, generatedIds));
    await db()
      .delete(generatedProblemConcepts)
      .where(inArray(generatedProblemConcepts.generatedProblemId, generatedIds));
  }
  if (worksheetIds.length > 0) {
    await db()
      .delete(generatedProblems)
      .where(inArray(generatedProblems.worksheetId, worksheetIds));
    await db().delete(worksheets).where(inArray(worksheets.id, worksheetIds));
  }
  if (scrapedIds.length > 0) {
    await db()
      .delete(problemConcepts)
      .where(inArray(problemConcepts.scrapedProblemId, scrapedIds));
    await db()
      .delete(scrapedProblems)
      .where(inArray(scrapedProblems.id, scrapedIds));
  }
  await db().delete(lessons).where(eq(lessons.id, id));

  return NextResponse.json({
    deletedLessonId: id,
    deletedScrapedProblems: scrapedIds.length,
    deletedWorksheets: worksheetIds.length,
    deletedGeneratedProblems: generatedIds.length,
  });
}
