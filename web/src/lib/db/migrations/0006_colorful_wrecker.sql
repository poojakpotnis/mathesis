DROP INDEX `lessons_lesson_number_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_grade_lesson_number_unique` ON `lessons` (`grade_level`,`lesson_number`);