import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { concepts } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";
import { classifyProblems } from "@/lib/claude/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RunSchema = z.object({
  lessonTitle: z.string().min(1),
  gradeLevel: z.number().int().min(1).max(12),
  libraryMode: z
    .enum(["full", "names_only", "categories_only"])
    .optional()
    .default("full"),
  problems: z
    .array(
      z.object({
        id: z.number().int(),
        problemNumber: z.string(),
        problemText: z.string(),
        hintText: z.string().nullish(),
        hasImage: z.boolean().optional().default(false),
        imageDescription: z.string().nullish(),
      })
    )
    .min(1),
});

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const body = await request.json();
  const parsed = RunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data.problems.map((p) => ({
    id: p.id,
    problemNumber: p.problemNumber,
    problemText: p.problemText,
    hintText: p.hintText ?? null,
    hasImage: p.hasImage,
    imageDescription: p.imageDescription ?? null,
  }));

  const conceptLibrary = await db()
    .select({
      name: concepts.name,
      displayName: concepts.displayName,
      category: concepts.category,
      description: concepts.description,
    })
    .from(concepts);

  const classifierLibrary = conceptLibrary.map((c) => ({
    ...c,
    description: c.description ?? "",
  }));

  const result = await classifyProblems(
    input,
    parsed.data.lessonTitle,
    parsed.data.gradeLevel,
    classifierLibrary,
    parsed.data.libraryMode
  );
  return NextResponse.json(result);
}
