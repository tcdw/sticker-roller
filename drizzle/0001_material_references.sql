ALTER TABLE `assets` ADD `category` text;
--> statement-breakpoint
ALTER TABLE `assets` ADD `metadata` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `authored_prompt_snapshot` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `references_snapshot` text NOT NULL DEFAULT '[]';
