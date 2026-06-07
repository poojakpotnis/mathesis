import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { lessons, scrapedProblems } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ProblemSchema = z.object({
  problem_number: z.string(),
  display_order: z.number(),
  problem_text: z.string(),
  is_take_home: z.boolean().default(false),
  has_image: z.boolean().default(false),
  image_description: z.string().nullable().optional(),
  hint_text: z.string().nullable().optional(),
  answer_format_type: z.string().nullable().optional(),
  expected_answer: z.string().nullable().optional(),
  credit_status: z.string().nullable().optional(),
  attempt_count: z.number().nullable().optional(),
  score: z.number().nullable().optional(),
  raw_html: z.string().nullable().optional(),
});

const IngestSchema = z.object({
  lesson_number: z.number(),
  title: z.string(),
  grade_level: z.number().int().min(1).max(12).nullable().optional(),
  problems: z.array(ProblemSchema),
});

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const body = await request.json();
  const parsed = IngestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const now = new Date().toISOString();
  const imageCount = data.problems.filter((p) => p.has_image).length;

  const existing = await db()
    .select()
    .from(lessons)
    .where(eq(lessons.lessonNumber, data.lesson_number))
    .limit(1);

  let lessonId: number;

  if (existing.length > 0) {
    lessonId = existing[0].id;
    await db()
      .update(lessons)
      .set({
        title: data.title,
        // Only overwrite grade if the new payload has it. Preserves prior
        // backfills when a re-scrape happens to fail grade extraction.
        ...(data.grade_level != null
          ? { gradeLevel: data.grade_level }
          : {}),
        scrapedAt: now,
        totalProblems: data.problems.length,
        imageProblemsCount: imageCount,
        classificationStatus: "pending",
      })
      .where(eq(lessons.id, lessonId));

    await db()
      .delete(scrapedProblems)
      .where(eq(scrapedProblems.lessonId, lessonId));
  } else {
    const [inserted] = await db()
      .insert(lessons)
      .values({
        lessonNumber: data.lesson_number,
        title: data.title,
        gradeLevel: data.grade_level ?? null,
        scrapedAt: now,
        totalProblems: data.problems.length,
        imageProblemsCount: imageCount,
      })
      .returning({ id: lessons.id });
    lessonId = inserted.id;
  }

  if (data.problems.length > 0) {
    await db().insert(scrapedProblems).values(
      data.problems.map((p) => ({
        lessonId,
        problemNumber: p.problem_number,
        displayOrder: p.display_order,
        problemText: p.problem_text,
        isTakeHome: p.is_take_home,
        hasImage: p.has_image,
        imageDescription: p.image_description ?? null,
        hintText: p.hint_text ?? null,
        answerFormatType: p.answer_format_type ?? null,
        expectedAnswer: p.expected_answer ?? null,
        creditStatus: p.credit_status ?? null,
        attemptCount: p.attempt_count ?? null,
        score: p.score ?? null,
        rawHtml: p.raw_html ?? null,
      }))
    );
  }

  return NextResponse.json({
    lessonId,
    problemCount: data.problems.length,
    imageCount,
  });
}
