ALTER TABLE `scraped_problems` ADD `source` text DEFAULT 'homework' NOT NULL;--> statement-breakpoint
ALTER TABLE `scraped_problems` ADD `source_assignment_id` text;--> statement-breakpoint
ALTER TABLE `scraped_problems` ADD `source_assignment_title` text;