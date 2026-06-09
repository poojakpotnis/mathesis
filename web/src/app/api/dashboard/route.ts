import { NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  worksheets,
  scores,
  conceptMastery,
  concepts,
  lessons,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  // Headline counters: how much work the kid has done overall.
  const allScores = await db()
    .select({ isCorrect: scores.isCorrect })
    .from(scores);
  const totalAttempted = allScores.length;
  const totalCorrect = allScores.filter((s) => s.isCorrect).length;
  const overallAccuracy =
    totalAttempted > 0 ? totalCorrect / totalAttempted : 0;

  const [{ totalWorksheets }] = await db()
    .select({ totalWorksheets: sql<number>`count(*)` })
    .from(worksheets);
  const [{ scoredWorksheets }] = await db()
    .select({ scoredWorksheets: sql<number>`count(*)` })
    .from(worksheets)
    .where(eq(worksheets.status, "scored"));

  // Per-concept mastery grid: every concept that has at least one attempt,
  // plus zeros for the rest of the taxonomy so the dashboard surfaces gaps.
  const masteryRows = await db()
    .select({
      conceptId: concepts.id,
      name: concepts.name,
      displayName: concepts.displayName,
      category: concepts.category,
      totalAttempted: conceptMastery.totalAttempted,
      totalCorrect: conceptMastery.totalCorrect,
      currentStreak: conceptMastery.currentStreak,
      lastAttemptedAt: conceptMastery.lastAttemptedAt,
      masteryLevel: conceptMastery.masteryLevel,
    })
    .from(concepts)
    .leftJoin(conceptMastery, eq(conceptMastery.conceptId, concepts.id))
    .orderBy(concepts.category, concepts.name);

  // Recent scored or in-progress worksheets — what the parent has been doing.
  const recentWorksheets = await db()
    .select({
      id: worksheets.id,
      title: worksheets.title,
      lessonId: worksheets.lessonId,
      lessonNumber: lessons.lessonNumber,
      lessonTitle: lessons.title,
      createdAt: worksheets.createdAt,
      scoredAt: worksheets.scoredAt,
      status: worksheets.status,
      totalProblems: worksheets.totalProblems,
      totalAttempted: worksheets.totalAttempted,
      totalCorrect: worksheets.totalCorrect,
      difficultyLevel: worksheets.difficultyLevel,
    })
    .from(worksheets)
    .innerJoin(lessons, eq(worksheets.lessonId, lessons.id))
    .orderBy(desc(worksheets.createdAt))
    .limit(10);

  return NextResponse.json({
    summary: {
      totalWorksheets: Number(totalWorksheets),
      scoredWorksheets: Number(scoredWorksheets),
      totalAttempted,
      totalCorrect,
      overallAccuracy,
    },
    mastery: masteryRows.map((r) => ({
      conceptId: r.conceptId,
      name: r.name,
      displayName: r.displayName,
      category: r.category,
      totalAttempted: r.totalAttempted ?? 0,
      totalCorrect: r.totalCorrect ?? 0,
      currentStreak: r.currentStreak ?? 0,
      lastAttemptedAt: r.lastAttemptedAt,
      masteryLevel: r.masteryLevel ?? "not_started",
      accuracy:
        r.totalAttempted && r.totalAttempted > 0
          ? (r.totalCorrect ?? 0) / r.totalAttempted
          : 0,
    })),
    recentWorksheets,
  });
}
