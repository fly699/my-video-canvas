-- Consolidation baseline: aligns _journal.json snapshot with the columns
-- and tables that the previously hand-written migrations 0015-0019 added
-- (storage_settings was already in snapshot 0014; the rest were never
-- tracked by drizzle-kit). Idempotent so this single migration can be
-- safely applied to:
--   * fresh dev DBs (creates everything from scratch)
--   * existing production where the columns/tables were added manually
--     via raw ALTER/CREATE (becomes a no-op per column/table)

CREATE TABLE IF NOT EXISTS `project_collaborators` (
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
CREATE TABLE IF NOT EXISTS `project_share_links` (
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
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'attachments');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `chat_messages` ADD `attachments` json', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'publicReadAccess');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `projects` ADD `publicReadAccess` boolean DEFAULT false NOT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storageSettings' AND COLUMN_NAME = 'persistImage');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `storageSettings` ADD `persistImage` boolean DEFAULT true NOT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_collaborators' AND INDEX_NAME = 'project_collab_project_user_idx');
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX `project_collab_project_user_idx` ON `project_collaborators` (`projectId`,`userId`)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_collaborators' AND INDEX_NAME = 'project_collab_email_idx');
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX `project_collab_email_idx` ON `project_collaborators` (`email`)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_share_links' AND INDEX_NAME = 'share_links_project_idx');
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX `share_links_project_idx` ON `project_share_links` (`projectId`)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
