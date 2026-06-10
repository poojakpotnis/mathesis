import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  concepts,
  problemConcepts,
  scrapedProblems,
  generatedProblemConcepts,
  conceptMastery,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const allConcepts = await db()
    .select({
      id: concepts.id,
      name: concepts.name,
      displayName: concepts.displayName,
      category: concepts.category,
      description: concepts.description,
      createdBy: concepts.createdBy,
    })
    .from(concepts)
    .orderBy(concepts.category, concepts.name);

  // Per-concept source-problem usage: how many distinct scraped problems
  // and how many distinct lessons reference this concept.
  const sourceCounts = await db()
    .select({
      conceptId: problemConcepts.conceptId,
      sourceProblemCount: sql<number>`count(distinct ${problemConcepts.scrapedProblemId})`,
      lessonCount: sql<number>`count(distinct ${scrapedProblems.lessonId})`,
    })
    .from(problemConcepts)
    .innerJoin(
      scrapedProblems,
      eq(problemConcepts.scrapedProblemId, scrapedProblems.id)
    )
    .groupBy(problemConcepts.conceptId);

  const generatedCounts = await db()
    .select({
      conceptId: generatedProblemConcepts.conceptId,
      generatedProblemCount: sql<number>`count(distinct ${generatedProblemConcepts.generatedProblemId})`,
    })
    .from(generatedProblemConcepts)
    .groupBy(generatedProblemConcepts.conceptId);

  // Up to 2 example source problems per concept for the expanded view.
  // Keep it cheap: one query, app-side group.
  const exampleRows = await db()
    .select({
      conceptId: problemConcepts.conceptId,
      problemNumber: scrapedProblems.problemNumber,
      problemText: scrapedProblems.problemText,
      hasImage: scrapedProblems.hasImage,
    })
    .from(problemConcepts)
    .innerJoin(
      scrapedProblems,
      eq(problemConcepts.scrapedProblemId, scrapedProblems.id)
    );

  const mastery = await db().select().from(conceptMastery);

  const sourceById = new Map(sourceCounts.map((r) => [r.conceptId, r]));
  const genById = new Map(generatedCounts.map((r) => [r.conceptId, r]));
  const masteryById = new Map(mastery.map((r) => [r.conceptId, r]));

  const examplesById = new Map<
    number,
    { problemNumber: string; problemText: string }[]
  >();
  for (const row of exampleRows) {
    if (row.hasImage) continue;
    const list = examplesById.get(row.conceptId) ?? [];
    if (list.length < 2) {
      list.push({
        problemNumber: row.problemNumber,
        problemText: row.problemText,
      });
    }
    examplesById.set(row.conceptId, list);
  }

  return NextResponse.json({
    concepts: allConcepts.map((c) => {
      const sc = sourceById.get(c.id);
      const gc = genById.get(c.id);
      const m = masteryById.get(c.id);
      return {
        ...c,
        sourceProblemCount: Number(sc?.sourceProblemCount ?? 0),
        lessonCount: Number(sc?.lessonCount ?? 0),
        generatedProblemCount: Number(gc?.generatedProblemCount ?? 0),
        mastery: m
          ? {
              level: m.masteryLevel,
              totalAttempted: m.totalAttempted,
              totalCorrect: m.totalCorrect,
              currentStreak: m.currentStreak,
              lastAttemptedAt: m.lastAttemptedAt,
            }
          : null,
        examples: examplesById.get(c.id) ?? [],
      };
    }),
  });
}
