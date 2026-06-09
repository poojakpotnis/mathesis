import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  generatedProblems,
  generatedProblemConcepts,
  worksheets,
  lessons,
  concepts,
} from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  const rows = await db()
    .select({
      generatedProblemId: generatedProblems.id,
      worksheetId: generatedProblems.worksheetId,
      lessonId: worksheets.lessonId,
      lessonTitle: lessons.title,
      lessonGradeLevel: lessons.gradeLevel,
      problemText: generatedProblems.problemText,
      correctAnswer: generatedProblems.correctAnswer,
      solutionSteps: generatedProblems.solutionSteps,
      answerFormatType: generatedProblems.answerFormatType,
    })
    .from(generatedProblems)
    .innerJoin(worksheets, eq(generatedProblems.worksheetId, worksheets.id))
    .innerJoin(lessons, eq(worksheets.lessonId, lessons.id))
    .orderBy(generatedProblems.id);

  const problemIds = rows.map((r) => r.generatedProblemId);
  const conceptRows = problemIds.length
    ? await db()
        .select({
          generatedProblemId: generatedProblemConcepts.generatedProblemId,
          conceptName: concepts.name,
          conceptDisplayName: concepts.displayName,
        })
        .from(generatedProblemConcepts)
        .innerJoin(
          concepts,
          eq(generatedProblemConcepts.conceptId, concepts.id)
        )
        .where(inArray(generatedProblemConcepts.generatedProblemId, problemIds))
    : [];

  const conceptsByProblem = new Map<
    number,
    { name: string; displayName: string }[]
  >();
  for (const c of conceptRows) {
    const list = conceptsByProblem.get(c.generatedProblemId) ?? [];
    list.push({ name: c.conceptName, displayName: c.conceptDisplayName });
    conceptsByProblem.set(c.generatedProblemId, list);
  }

  const problems = rows.map((r) => ({
    generated_problem_id: r.generatedProblemId,
    worksheet_id: r.worksheetId,
    lesson_id: r.lessonId,
    lesson_title: r.lessonTitle,
    lesson_grade_level: r.lessonGradeLevel,
    problem_text: r.problemText,
    correct_answer: r.correctAnswer,
    answer_format_type: r.answerFormatType,
    solution_steps: r.solutionSteps,
    concepts: conceptsByProblem.get(r.generatedProblemId) ?? [],
  }));

  return NextResponse.json({ problems });
}
