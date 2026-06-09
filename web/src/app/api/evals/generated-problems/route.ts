import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  generatedProblems,
  generatedProblemConcepts,
  scrapedProblems,
  problemConcepts,
  worksheets,
  lessons,
  concepts,
} from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

const REFERENCE_LIMIT = 5;

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

  // Pull all scraped problems for the lessons we touch — text + concept tags.
  // Then we'll pick same-lesson references with concept overlap per row.
  const lessonIds = [...new Set(rows.map((r) => r.lessonId))];
  const scrapedRows = lessonIds.length
    ? await db()
        .select({
          id: scrapedProblems.id,
          lessonId: scrapedProblems.lessonId,
          problemNumber: scrapedProblems.problemNumber,
          problemText: scrapedProblems.problemText,
          hasImage: scrapedProblems.hasImage,
        })
        .from(scrapedProblems)
        .where(inArray(scrapedProblems.lessonId, lessonIds))
    : [];
  const scrapedIds = scrapedRows.map((s) => s.id);
  const scrapedConceptRows = scrapedIds.length
    ? await db()
        .select({
          scrapedProblemId: problemConcepts.scrapedProblemId,
          conceptName: concepts.name,
        })
        .from(problemConcepts)
        .innerJoin(concepts, eq(problemConcepts.conceptId, concepts.id))
        .where(inArray(problemConcepts.scrapedProblemId, scrapedIds))
    : [];
  const conceptsByScraped = new Map<number, Set<string>>();
  for (const c of scrapedConceptRows) {
    const set = conceptsByScraped.get(c.scrapedProblemId) ?? new Set<string>();
    set.add(c.conceptName);
    conceptsByScraped.set(c.scrapedProblemId, set);
  }
  const scrapedByLesson = new Map<number, typeof scrapedRows>();
  for (const s of scrapedRows) {
    const list = scrapedByLesson.get(s.lessonId) ?? [];
    list.push(s);
    scrapedByLesson.set(s.lessonId, list);
  }

  function pickReferences(
    lessonId: number,
    genConceptNames: Set<string>
  ): { problem_number: string; problem_text: string; concept_names: string[] }[] {
    const pool = scrapedByLesson.get(lessonId) ?? [];
    const scored = pool
      .filter((s) => !s.hasImage)
      .map((s) => {
        const tags = conceptsByScraped.get(s.id) ?? new Set<string>();
        let overlap = 0;
        for (const t of tags) if (genConceptNames.has(t)) overlap += 1;
        return { s, tags, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap || a.s.id - b.s.id);
    return scored.slice(0, REFERENCE_LIMIT).map(({ s, tags }) => ({
      problem_number: s.problemNumber,
      problem_text: s.problemText,
      concept_names: [...tags].sort(),
    }));
  }

  const problems = rows.map((r) => {
    const conceptList = conceptsByProblem.get(r.generatedProblemId) ?? [];
    const genConceptNames = new Set(conceptList.map((c) => c.name));
    return {
      generated_problem_id: r.generatedProblemId,
      worksheet_id: r.worksheetId,
      lesson_id: r.lessonId,
      lesson_title: r.lessonTitle,
      lesson_grade_level: r.lessonGradeLevel,
      problem_text: r.problemText,
      correct_answer: r.correctAnswer,
      answer_format_type: r.answerFormatType,
      solution_steps: r.solutionSteps,
      concepts: conceptList,
      reference_problems: pickReferences(r.lessonId, genConceptNames),
    };
  });

  return NextResponse.json({ problems });
}
