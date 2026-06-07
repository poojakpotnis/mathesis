CREATE TABLE `concept_mastery` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`concept_id` integer NOT NULL,
	`total_attempted` integer DEFAULT 0 NOT NULL,
	`total_correct` integer DEFAULT 0 NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`last_attempted_at` text,
	`mastery_level` text DEFAULT 'not_started' NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`parent_concept_id` integer,
	`created_by` text DEFAULT 'claude' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_name_unique` ON `concepts` (`name`);--> statement-breakpoint
CREATE TABLE `generated_problem_concepts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`generated_problem_id` integer NOT NULL,
	`concept_id` integer NOT NULL,
	FOREIGN KEY (`generated_problem_id`) REFERENCES `generated_problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `generated_problems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`worksheet_id` integer NOT NULL,
	`display_order` integer NOT NULL,
	`problem_text` text NOT NULL,
	`problem_latex` text,
	`correct_answer` text NOT NULL,
	`answer_format_type` text NOT NULL,
	`solution_steps` text,
	`difficulty_rating` integer,
	`source_scraped_problem_id` integer,
	`verification_status` text DEFAULT 'verified' NOT NULL,
	`verification_details` text,
	FOREIGN KEY (`worksheet_id`) REFERENCES `worksheets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_scraped_problem_id`) REFERENCES `scraped_problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_number` integer NOT NULL,
	`title` text NOT NULL,
	`scraped_at` text NOT NULL,
	`total_problems` integer NOT NULL,
	`image_problems_count` integer DEFAULT 0 NOT NULL,
	`classification_status` text DEFAULT 'pending' NOT NULL,
	`raw_metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_lesson_number_unique` ON `lessons` (`lesson_number`);--> statement-breakpoint
CREATE TABLE `problem_concepts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scraped_problem_id` integer NOT NULL,
	`concept_id` integer NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`overridden_by_parent` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`scraped_problem_id`) REFERENCES `scraped_problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`worksheet_id` integer NOT NULL,
	`generated_problem_id` integer NOT NULL,
	`is_correct` integer NOT NULL,
	`scored_at` text NOT NULL,
	`parent_notes` text,
	FOREIGN KEY (`worksheet_id`) REFERENCES `worksheets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generated_problem_id`) REFERENCES `generated_problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scraped_problems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`problem_number` text NOT NULL,
	`display_order` integer NOT NULL,
	`problem_text` text NOT NULL,
	`is_take_home` integer DEFAULT false NOT NULL,
	`has_image` integer DEFAULT false NOT NULL,
	`image_description` text,
	`hint_text` text,
	`answer_format_type` text,
	`expected_answer` text,
	`credit_status` text,
	`attempt_count` integer,
	`score` real,
	`raw_html` text,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `worksheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`total_problems` integer NOT NULL,
	`focus_concept_ids` text,
	`skip_concept_ids` text,
	`difficulty_level` text DEFAULT 'progressive' NOT NULL,
	`pdf_data` text,
	`status` text DEFAULT 'generated' NOT NULL,
	`scored_at` text,
	`total_correct` integer,
	`total_attempted` integer,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
