import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  lessons,
  scrapedProblems,
  concepts,
  problemConcepts,
} from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";
import { classifyProblems } from "@/lib/claude/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ClassifySchema = z.object({
  lesson_id: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const body = await request.json();
  const parsed = ClassifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { lesson_id: lessonId } = parsed.data;

  const [lesson] = await db()
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  const problems = await db()
    .select()
    .from(scrapedProblems)
    .where(eq(scrapedProblems.lessonId, lessonId))
    .orderBy(scrapedProblems.displayOrder);

  if (problems.length === 0) {
    return NextResponse.json(
      { error: "Lesson has no scraped problems" },
      { status: 400 }
    );
  }

  await db()
    .update(lessons)
    .set({ classificationStatus: "in_progress" })
    .where(eq(lessons.id, lessonId));

  try {
    const problemIds = problems.map((p) => p.id);
    await db()
      .delete(problemConcepts)
      .where(inArray(problemConcepts.scrapedProblemId, problemIds));

    const classifierInput = problems.map((p) => ({
      id: p.id,
      problemNumber: p.problemNumber,
      problemText: p.problemText,
      hintText: p.hintText,
      hasImage: p.hasImage,
      imageDescription: p.imageDescription,
    }));

    const conceptLibrary = await db()
      .select({
        name: concepts.name,
        displayName: concepts.displayName,
        category: concepts.category,
        description: concepts.description,
      })
      .from(concepts);

    const result = await classifyProblems(
      classifierInput,
      lesson.title,
      conceptLibrary
    );

    const conceptNames = result.concepts.map((c) => c.name);
    const existingConcepts =
      conceptNames.length > 0
        ? await db()
            .select({ id: concepts.id, name: concepts.name })
            .from(concepts)
            .where(inArray(concepts.name, conceptNames))
        : [];

    const nameToId = new Map<string, number>(
      existingConcepts.map((c) => [c.name, c.id])
    );

    const newConcepts = result.concepts.filter((c) => !nameToId.has(c.name));

    if (newConcepts.length > 0) {
      const inserted = await db()
        .insert(concepts)
        .values(
          newConcepts.map((c) => ({
            name: c.name,
            displayName: c.displayName,
            category: c.category,
            description: c.description,
            createdBy: "claude" as const,
          }))
        )
        .returning({ id: concepts.id, name: concepts.name });
      for (const c of inserted) nameToId.set(c.name, c.id);
    }

    const validProblemIds = new Set(problemIds);
    const mappings: {
      scrapedProblemId: number;
      conceptId: number;
      confidence: number;
    }[] = [];
    const skipped: { problem_id: number; concept_name: string; reason: string }[] = [];

    for (const pc of result.problem_classifications) {
      if (!validProblemIds.has(pc.problem_id)) {
        skipped.push({
          problem_id: pc.problem_id,
          concept_name: "",
          reason: "unknown_problem_id",
        });
        continue;
      }
      for (const concept of pc.concepts) {
        const conceptId = nameToId.get(concept.name);
        if (!conceptId) {
          skipped.push({
            problem_id: pc.problem_id,
            concept_name: concept.name,
            reason: "unknown_concept_name",
          });
          continue;
        }
        mappings.push({
          scrapedProblemId: pc.problem_id,
          conceptId,
          confidence: concept.confidence,
        });
      }
    }

    if (mappings.length > 0) {
      await db().insert(problemConcepts).values(mappings);
    }

    await db()
      .update(lessons)
      .set({ classificationStatus: "completed" })
      .where(eq(lessons.id, lessonId));

    return NextResponse.json({
      lessonId,
      problemsClassified: problems.length,
      conceptsTotal: result.concepts.length,
      conceptsCreated: newConcepts.length,
      conceptsReused: result.concepts.length - newConcepts.length,
      mappings: mappings.length,
      skipped,
    });
  } catch (err) {
    await db()
      .update(lessons)
      .set({ classificationStatus: "pending" })
      .where(eq(lessons.id, lessonId));
    throw err;
  }
}
