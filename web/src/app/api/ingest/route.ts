import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
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
  // 'homework' is the one-per-lesson assignment. 'classwork' is one of many
  // per-lesson topic-scoped assignments. Homework updates lesson-level
  // metadata; classwork leaves it alone (each classwork title is sub-topic
  // specific and would clobber the more general homework-derived title).
  source: z.enum(["homework", "classwork"]).default("homework"),
  source_assignment_id: z.string().nullable().optional(),
  source_assignment_title: z.string().nullable().optional(),
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

  // Match on (grade, lesson_number) — the same lesson number recurs each
  // grade. Payloads without a grade only match legacy rows that also lack one.
  const gradeMatch =
    data.grade_level == null
      ? isNull(lessons.gradeLevel)
      : eq(lessons.gradeLevel, data.grade_level);
  const existing = await db()
    .select()
    .from(lessons)
    .where(and(eq(lessons.lessonNumber, data.lesson_number), gradeMatch))
    .limit(1);

  let lessonId: number;

  if (existing.length > 0) {
    lessonId = existing[0].id;
    if (data.source === "homework") {
      // Only homework updates the lesson-level metadata (title, grade). A
      // classwork ingest touches only its own problems and defers to whatever
      // homework already set.
      await db()
        .update(lessons)
        .set({
          title: data.title,
          ...(data.grade_level != null
            ? { gradeLevel: data.grade_level }
            : {}),
          scrapedAt: now,
          classificationStatus: "pending",
        })
        .where(eq(lessons.id, lessonId));
    }
  } else {
    // New lesson — insert with whatever metadata this ingest carries. Ideally
    // the first ingest for a lesson is homework, but a classwork-first ingest
    // still creates the row so its problems have somewhere to live.
    const [inserted] = await db()
      .insert(lessons)
      .values({
        lessonNumber: data.lesson_number,
        title: data.title,
        gradeLevel: data.grade_level ?? null,
        scrapedAt: now,
        totalProblems: 0, // recomputed below after the insert
        imageProblemsCount: 0,
      })
      .returning({ id: lessons.id });
    lessonId = inserted.id;
  }

  // Wipe only the problems this ingest is replacing:
  //   homework  → all homework problems for this lesson
  //   classwork → only the problems for this specific classwork assignment
  //               (leaves the lesson's homework + other classwork intact)
  if (data.source === "homework") {
    await db()
      .delete(scrapedProblems)
      .where(
        and(
          eq(scrapedProblems.lessonId, lessonId),
          eq(scrapedProblems.source, "homework"),
        ),
      );
  } else if (data.source_assignment_id) {
    await db()
      .delete(scrapedProblems)
      .where(
        and(
          eq(scrapedProblems.lessonId, lessonId),
          eq(scrapedProblems.source, "classwork"),
          eq(scrapedProblems.sourceAssignmentId, data.source_assignment_id),
        ),
      );
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
        source: data.source,
        sourceAssignmentId: data.source_assignment_id ?? null,
        sourceAssignmentTitle: data.source_assignment_title ?? null,
      }))
    );
  }

  // Recompute lesson-level totals across ALL sources so the UI count reflects
  // homework + every classwork assignment for this lesson.
  const [totals] = await db()
    .select({
      total: sql<number>`COUNT(*)`.as("total"),
      images: sql<number>`SUM(CASE WHEN ${scrapedProblems.hasImage} THEN 1 ELSE 0 END)`.as("images"),
    })
    .from(scrapedProblems)
    .where(eq(scrapedProblems.lessonId, lessonId));

  await db()
    .update(lessons)
    .set({
      totalProblems: totals.total ?? 0,
      imageProblemsCount: totals.images ?? 0,
    })
    .where(eq(lessons.id, lessonId));

  return NextResponse.json({
    lessonId,
    source: data.source,
    problemCount: data.problems.length,
    imageCount: data.problems.filter((p) => p.has_image).length,
    lessonTotals: { total: totals.total ?? 0, withImages: totals.images ?? 0 },
  });
}
