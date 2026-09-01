CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_name_uq` ON `assets` (`name`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`item_id` text,
	`type` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `job_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_job_idx` ON `job_events` (`job_id`,`id`);--> statement-breakpoint
CREATE TABLE `generated_files` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `job_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_item_name_uq` ON `generated_files` (`item_id`,`file_name`);--> statement-breakpoint
CREATE TABLE `job_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`heartbeat_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_job_ordinal_uq` ON `job_items` (`job_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `items_queue_idx` ON `job_items` (`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text,
	`asset_name` text NOT NULL,
	`prompt_snapshot` text NOT NULL,
	`options_snapshot` text NOT NULL,
	`requested_count` integer NOT NULL,
	`status` text NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`cancelled_at` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_created_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `llm_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `job_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_item_attempt_uq` ON `llm_requests` (`item_id`,`attempt`);