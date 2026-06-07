import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lessons, scrapedProblems, problemConcepts, concepts } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

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
