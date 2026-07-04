import { NextRequest, NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  lessons,
  worksheets,
  generatedProblems,
} from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";
import { generateWorksheetAction } from "@/lib/actions/worksheets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WorksheetSchema = z.object({
  lesson_id: z.number().int().positive(),
  count: z.number().int().min(1).max(30),
  difficulty: z.enum(["easier", "match", "harder", "progressive"]),
  focus_concept_ids: z.array(z.number().int().positive()).optional(),
  skip_concept_ids: z.array(z.number().int().positive()).optional(),
  figures_only: z.boolean().optional(),
});

const WorksheetListQuerySchema = z.object({
  lesson_id: z.coerce.number().int().positive().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = WorksheetListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const filter = parsed.data.lesson_id
    ? eq(worksheets.lessonId, parsed.data.lesson_id)
    : undefined;

  // Phase 5e: parent overrides land as 'approved' / 'confirmed_flagged' rather
  // than flipping back to 'verified' / 'flagged'. Roll them up to keep the
  // headline counts intuitive ("X verified" includes parent-approved).
  const verifiedCol = sql<number>`sum(case when ${generatedProblems.verificationStatus} in ('verified', 'approved') then 1 else 0 end)`;
  const flaggedCol = sql<number>`sum(case when ${generatedProblems.verificationStatus} in ('flagged', 'confirmed_flagged') then 1 else 0 end)`;

  const rows = await db()
    .select({
      id: worksheets.id,
      lessonId: worksheets.lessonId,
      lessonNumber: lessons.lessonNumber,
      lessonTitle: lessons.title,
      title: worksheets.title,
      createdAt: worksheets.createdAt,
      totalProblems: worksheets.totalProblems,
      difficultyLevel: worksheets.difficultyLevel,
      status: worksheets.status,
      scoredAt: worksheets.scoredAt,
      totalCorrect: worksheets.totalCorrect,
      totalAttempted: worksheets.totalAttempted,
      verifiedCount: verifiedCol,
      flaggedCount: flaggedCol,
    })
    .from(worksheets)
    .innerJoin(lessons, eq(worksheets.lessonId, lessons.id))
    .leftJoin(
      generatedProblems,
      eq(generatedProblems.worksheetId, worksheets.id)
    )
    .where(filter)
    .groupBy(worksheets.id)
    .orderBy(desc(worksheets.createdAt));

  return NextResponse.json(rows);
}

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

  // Delegate to the server action so the bearer-auth API path and the UI
  // dialog path share one implementation — and both get the same OTel spans.
  const result = await generateWorksheetAction({
    lessonId: parsed.data.lesson_id,
    count: parsed.data.count,
    difficulty: parsed.data.difficulty,
    focusConceptIds: parsed.data.focus_concept_ids,
    skipConceptIds: parsed.data.skip_concept_ids,
    figuresOnly: parsed.data.figures_only,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
