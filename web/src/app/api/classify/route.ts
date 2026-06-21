import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth";
import {
  classifyLessonById,
  ClassifyLessonFailure,
} from "@/lib/classify-lesson";

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

  try {
    const result = await classifyLessonById(parsed.data.lesson_id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClassifyLessonFailure) {
      if (err.detail.kind === "not_found") {
        return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
      }
      if (err.detail.kind === "missing_grade") {
        return NextResponse.json(
          {
            error: `Lesson ${parsed.data.lesson_id} is missing grade_level. Set it on the lesson before classifying.`,
          },
          { status: 400 }
        );
      }
      if (err.detail.kind === "no_problems") {
        return NextResponse.json(
          { error: "Lesson has no imported problems" },
          { status: 400 }
        );
      }
    }
    throw err;
  }
}
