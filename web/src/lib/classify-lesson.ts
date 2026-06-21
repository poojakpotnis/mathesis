import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  lessons,
  scrapedProblems,
  concepts,
  problemConcepts,
} from "@/lib/db/schema";
import { classifyProblems } from "@/lib/claude/classify";

export type ClassifyLessonResult = {
  lessonId: number;
  problemsClassified: number;
  conceptsTotal: number;
  conceptsCreated: number;
  conceptsReused: number;
  mappings: number;
  skipped: { problem_id: number; concept_name: string; reason: string }[];
};

export type ClassifyLessonError =
  | { kind: "not_found" }
  | { kind: "missing_grade" }
  | { kind: "no_problems" };

export class ClassifyLessonFailure extends Error {
  constructor(public detail: ClassifyLessonError) {
    super(detail.kind);
  }
}

export async function classifyLessonById(
  lessonId: number
): Promise<ClassifyLessonResult> {
  const [lesson] = await db()
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);

  if (!lesson) {
    throw new ClassifyLessonFailure({ kind: "not_found" });
  }
  if (lesson.gradeLevel == null) {
    throw new ClassifyLessonFailure({ kind: "missing_grade" });
  }

  const problems = await db()
    .select()
    .from(scrapedProblems)
    .where(eq(scrapedProblems.lessonId, lessonId))
    .orderBy(scrapedProblems.displayOrder);

  if (problems.length === 0) {
    throw new ClassifyLessonFailure({ kind: "no_problems" });
  }

  await db()
    .update(lessons)
    .set({ classificationStatus: "in_progress" })
    .where(eq(lessons.id, lessonId));

  try {
    const problemIds = problems.map((p) => p.id);
    await db()
      .delete(problemConcepts)
      .where(inArray(problemConcepts.scrapedProblemId, problemIds));

    const classifierInput = problems.map((p) => ({
      id: p.id,
      problemNumber: p.problemNumber,
      problemText: p.problemText,
      hintText: p.hintText,
      hasImage: p.hasImage,
      imageDescription: p.imageDescription,
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

    // Phase 5d ablation showed snake_case names alone carry the full classifier
    // signal (B matched A at 25/25); descriptions and displayNames are decoration
    // in this prompt. Shipping "names_only" cuts roughly half the library token
    // weight per classify call with no measured accuracy loss on Lesson 33.
    const result = await classifyProblems(
      classifierInput,
      lesson.title,
      lesson.gradeLevel,
      classifierLibrary,
      "names_only"
    );

    const conceptNames = result.concepts.map((c) => c.name);
    const existingConcepts =
      conceptNames.length > 0
        ? await db()
            .select({ id: concepts.id, name: concepts.name })
            .from(concepts)
            .where(inArray(concepts.name, conceptNames))
        : [];

    const nameToId = new Map<string, number>(
      existingConcepts.map((c) => [c.name, c.id])
    );

    const newConcepts = result.concepts.filter((c) => !nameToId.has(c.name));

    if (newConcepts.length > 0) {
      const inserted = await db()
        .insert(concepts)
        .values(
          newConcepts.map((c) => ({
            name: c.name,
            displayName: c.displayName,
            category: c.category,
            description: c.description,
            createdBy: "claude" as const,
          }))
        )
        .returning({ id: concepts.id, name: concepts.name });
      for (const c of inserted) nameToId.set(c.name, c.id);
    }

    const validProblemIds = new Set(problemIds);
    const mappings: {
      scrapedProblemId: number;
      conceptId: number;
      confidence: number;
    }[] = [];
    const skipped: { problem_id: number; concept_name: string; reason: string }[] =
      [];

    for (const pc of result.problem_classifications) {
      if (!validProblemIds.has(pc.problem_id)) {
        skipped.push({
          problem_id: pc.problem_id,
          concept_name: "",
          reason: "unknown_problem_id",
        });
        continue;
      }
      for (const concept of pc.concepts) {
        const conceptId = nameToId.get(concept.name);
        if (!conceptId) {
          skipped.push({
            problem_id: pc.problem_id,
            concept_name: concept.name,
            reason: "unknown_concept_name",
          });
          continue;
        }
        mappings.push({
          scrapedProblemId: pc.problem_id,
          conceptId,
          confidence: concept.confidence,
        });
      }
    }

    if (mappings.length > 0) {
      await db().insert(problemConcepts).values(mappings);
    }

    await db()
      .update(lessons)
      .set({ classificationStatus: "completed" })
      .where(eq(lessons.id, lessonId));

    return {
      lessonId,
      problemsClassified: problems.length,
      conceptsTotal: result.concepts.length,
      conceptsCreated: newConcepts.length,
      conceptsReused: result.concepts.length - newConcepts.length,
      mappings: mappings.length,
      skipped,
    };
  } catch (err) {
    await db()
      .update(lessons)
      .set({ classificationStatus: "pending" })
      .where(eq(lessons.id, lessonId));
    throw err;
  }
}
