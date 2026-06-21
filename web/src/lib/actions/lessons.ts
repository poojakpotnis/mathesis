"use server";

import { revalidatePath } from "next/cache";
import {
  classifyLessonById,
  ClassifyLessonFailure,
} from "@/lib/classify-lesson";

export type ClassifyLessonActionResult =
  | { ok: true; problemsClassified: number; conceptsTotal: number }
  | { ok: false; error: string };

export async function classifyLessonAction(
  lessonId: number
): Promise<ClassifyLessonActionResult> {
  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    return { ok: false, error: "Invalid lessonId" };
  }

  try {
    const result = await classifyLessonById(lessonId);
    revalidatePath("/lessons");
    revalidatePath(`/lessons/${lessonId}`);
    return {
      ok: true,
      problemsClassified: result.problemsClassified,
      conceptsTotal: result.conceptsTotal,
    };
  } catch (err) {
    if (err instanceof ClassifyLessonFailure) {
      const map: Record<typeof err.detail.kind, string> = {
        not_found: "Lesson not found",
        missing_grade: "Lesson is missing a grade level",
        no_problems: "Lesson has no imported problems",
      };
      return { ok: false, error: map[err.detail.kind] };
    }
    console.error("classifyLessonAction failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Classification failed",
    };
  }
}
