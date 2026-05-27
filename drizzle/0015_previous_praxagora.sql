CREATE TABLE `project_collaborators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int,
	`email` varchar(320),
	`role` enum('viewer','editor','admin') NOT NULL,
	`invitedBy` int NOT NULL,
	`status` enum('pending','active') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_collaborators_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_share_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`role` enum('viewer','editor','admin') NOT NULL,
	`maxUses` int NOT NULL DEFAULT 1,
	`usesCount` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`createdBy` int NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_share_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_share_links_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `attachments` json;--> statement-breakpoint
ALTER TABLE `projects` ADD `publicReadAccess` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `project_collab_project_user_idx` ON `project_collaborators` (`projectId`,`userId`);--> statement-breakpoint
CREATE INDEX `project_collab_email_idx` ON `project_collaborators` (`email`);--> statement-breakpoint
CREATE INDEX `share_links_project_idx` ON `project_share_links` (`projectId`);