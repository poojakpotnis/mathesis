import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth";
import { classifyProblems } from "@/lib/claude/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RunSchema = z.object({
  lessonTitle: z.string().min(1),
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

  const result = await classifyProblems(input, parsed.data.lessonTitle);
  return NextResponse.json(result);
}
