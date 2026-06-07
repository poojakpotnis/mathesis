import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const lessons = sqliteTable("lessons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonNumber: integer("lesson_number").notNull().unique(),
  title: text("title").notNull(),
  // RSM grade level (1-12), parsed from the page heading "Gr04_3--Lesson 34…"
  // pattern by the scraper. Nullable for backward-compat on lessons scraped
  // before this column existed; the worksheet generator throws if missing.
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
});

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
  correctAnswer: text("correct_answer").notNull(),
  answerFormatType: text("answer_format_type").notNull(),
  solutionSteps: text("solution_steps"),
  difficultyRating: integer("difficulty_rating"),
  sourceScrapedProblemId: integer("source_scraped_problem_id").references(
    () => scrapedProblems.id
  ),
  verificationStatus: text("verification_status", {
    enum: ["verified", "flagged"],
  })
    .notNull()
    .default("verified"),
  verificationDetails: text("verification_details"),
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
