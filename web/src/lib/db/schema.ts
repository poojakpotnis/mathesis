import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const lessons = sqliteTable(
  "lessons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lessonNumber: integer("lesson_number").notNull(),
    title: text("title").notNull(),
    gradeLevel: integer("grade_level"),
    scrapedAt: text("scraped_at").notNull(),
    totalProblems: integer("total_problems").notNull(),
    imageProblemsCount: integer("image_problems_count").notNull().default(0),
    classificationStatus: text("classification_status", {
      enum: ["pending", "in_progress", "completed"],
    })
      .notNull()
      .default("pending"),
    rawMetadata: text("raw_metadata"),
  },
  (t) => ({
    // Uniqueness is per (grade, lesson_number) — the same lesson number
    // recurs each grade. SQLite treats NULL as distinct in unique indexes,
    // so legacy rows with a null gradeLevel are allowed to coexist.
    gradeLessonUnique: uniqueIndex("lessons_grade_lesson_number_unique").on(
      t.gradeLevel,
      t.lessonNumber,
    ),
  }),
);

export const scrapedProblems = sqliteTable("scraped_problems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  problemNumber: text("problem_number").notNull(),
  displayOrder: integer("display_order").notNull(),
  problemText: text("problem_text").notNull(),
  isTakeHome: integer("is_take_home", { mode: "boolean" })
    .notNull()
    .default(false),
  hasImage: integer("has_image", { mode: "boolean" }).notNull().default(false),
  imageDescription: text("image_description"),
  hintText: text("hint_text"),
  answerFormatType: text("answer_format_type"),
  expectedAnswer: text("expected_answer"),
  creditStatus: text("credit_status"),
  attemptCount: integer("attempt_count"),
  score: real("score"),
  rawHtml: text("raw_html"),
});

export const concepts = sqliteTable("concepts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  parentConceptId: integer("parent_concept_id"),
  createdBy: text("created_by", { enum: ["claude", "parent"] })
    .notNull()
    .default("claude"),
  // How this concept is taught in the imported source: text_dominant (verbal
  // problems), visual_dominant (≥80% of source problems are images — e.g.
  // labeled trapezoid diagrams), mixed. Used only as a UI label now; as of
  // Phase 6.6 visual_dominant concepts generate like any other concept, with
  // the generator emitting an SVG figure alongside self-contained text.
  modalityTag: text("modality_tag", {
    enum: ["text_dominant", "mixed", "visual_dominant"],
  })
    .notNull()
    .default("text_dominant"),
});

export const problemConcepts = sqliteTable("problem_concepts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scrapedProblemId: integer("scraped_problem_id")
    .notNull()
    .references(() => scrapedProblems.id),
  conceptId: integer("concept_id")
    .notNull()
    .references(() => concepts.id),
  confidence: real("confidence").notNull().default(1.0),
  overriddenByParent: integer("overridden_by_parent", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const worksheets = sqliteTable("worksheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  totalProblems: integer("total_problems").notNull(),
  focusConceptIds: text("focus_concept_ids"),
  skipConceptIds: text("skip_concept_ids"),
  // VESTIGIAL as of Phase 6.6: the visual_dominant modality filter and the
  // "Practice from your portal" section it drove were both removed once visual
  // concepts started generating with figures. No code reads or writes this
  // anymore; only Phase-6.5-era rows carry values. Kept to avoid a data-losing
  // column drop; safe to remove in a future migration.
  skippedVisualConceptIds: text("skipped_visual_concept_ids"),
  difficultyLevel: text("difficulty_level", {
    enum: ["easier", "match", "harder", "progressive"],
  })
    .notNull()
    .default("progressive"),
  pdfData: text("pdf_data"),
  status: text("status", {
    enum: ["generated", "in_progress", "scored"],
  })
    .notNull()
    .default("generated"),
  scoredAt: text("scored_at"),
  totalCorrect: integer("total_correct"),
  totalAttempted: integer("total_attempted"),
});

export const generatedProblems = sqliteTable("generated_problems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  worksheetId: integer("worksheet_id")
    .notNull()
    .references(() => worksheets.id),
  displayOrder: integer("display_order").notNull(),
  problemText: text("problem_text").notNull(),
  problemLatex: text("problem_latex"),
  // Self-contained SVG figure for the problem, or NULL. The figure is a
  // *visual restatement* of information that is also fully present in
  // problemText — never the sole carrier of a fact — so the text-only
  // verifier can still re-solve, and a mis-rendered figure degrades to a
  // plain-text problem rather than teaching something wrong. (Phase 6.6)
  figureSvg: text("figure_svg"),
  correctAnswer: text("correct_answer").notNull(),
  answerFormatType: text("answer_format_type").notNull(),
  solutionSteps: text("solution_steps"),
  difficultyRating: integer("difficulty_rating"),
  sourceScrapedProblemId: integer("source_scraped_problem_id").references(
    () => scrapedProblems.id
  ),
  verificationStatus: text("verification_status", {
    enum: ["verified", "flagged", "approved", "confirmed_flagged"],
  })
    .notNull()
    .default("verified"),
  verificationDetails: text("verification_details"),
  // OTel span/trace IDs of the mathesis.verify.solve span that produced this
  // row's verification verdict. Used to push Phoenix annotations back onto
  // the verifier's trace when a parent overrides the verdict (Phase 5e).
  // Nullable: rows generated before Phase 5e shipped don't have them.
  verifySpanId: text("verify_span_id"),
  verifyTraceId: text("verify_trace_id"),
});

export const generatedProblemConcepts = sqliteTable(
  "generated_problem_concepts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    generatedProblemId: integer("generated_problem_id")
      .notNull()
      .references(() => generatedProblems.id),
    conceptId: integer("concept_id")
      .notNull()
      .references(() => concepts.id),
  }
);

export const scores = sqliteTable("scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  worksheetId: integer("worksheet_id")
    .notNull()
    .references(() => worksheets.id),
  generatedProblemId: integer("generated_problem_id")
    .notNull()
    .references(() => generatedProblems.id),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
  scoredAt: text("scored_at").notNull(),
  parentNotes: text("parent_notes"),
});

export const conceptMastery = sqliteTable("concept_mastery", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conceptId: integer("concept_id")
    .notNull()
    .references(() => concepts.id),
  totalAttempted: integer("total_attempted").notNull().default(0),
  totalCorrect: integer("total_correct").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  lastAttemptedAt: text("last_attempted_at"),
  masteryLevel: text("mastery_level", {
    enum: ["not_started", "learning", "practicing", "mastered"],
  })
    .notNull()
    .default("not_started"),
});
