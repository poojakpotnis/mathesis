import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generatedProblems, worksheets } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PARENT_REVIEW_STATUSES = ["approved", "confirmed_flagged"] as const;

export async function GET(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const rows = await db()
    .select({
      generatedProblemId: generatedProblems.id,
      worksheetId: generatedProblems.worksheetId,
      lessonId: worksheets.lessonId,
      problemText: generatedProblems.problemText,
      correctAnswer: generatedProblems.correctAnswer,
      verificationStatus: generatedProblems.verificationStatus,
      verificationDetails: generatedProblems.verificationDetails,
      verifySpanId: generatedProblems.verifySpanId,
      verifyTraceId: generatedProblems.verifyTraceId,
    })
    .from(generatedProblems)
    .innerJoin(worksheets, eq(generatedProblems.worksheetId, worksheets.id))
    .where(
      inArray(
        generatedProblems.verificationStatus,
        PARENT_REVIEW_STATUSES as unknown as string[]
      )
    )
    .orderBy(generatedProblems.id);

  // Parent reviews only fire on flagged → approved | confirmed_flagged.
  // The original verifier verdict was always "flagged" for any row in this set.
  const reviews = rows.map((r) => ({
    generated_problem_id: r.generatedProblemId,
    worksheet_id: r.worksheetId,
    lesson_id: r.lessonId,
    problem_text: r.problemText,
    correct_answer: r.correctAnswer,
    verifier_verdict: "flagged" as const,
    verifier_details: r.verificationDetails,
    parent_verdict: r.verificationStatus,
    verify_span_id: r.verifySpanId,
    verify_trace_id: r.verifyTraceId,
  }));

  return NextResponse.json({ reviews });
}
