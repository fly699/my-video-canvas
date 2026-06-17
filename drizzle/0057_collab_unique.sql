-- Enforce one collaborator row per (projectId, userId).
-- Concurrent share-link accepts could race past the app-level "already a member?"
-- check and INSERT two rows for the same (projectId, userId): phantom roster
-- entries + double-consumed link quota. We (1) collapse any existing duplicates
-- (keep the lowest id), (2) drop the old non-unique index, (3) add a UNIQUE index.
-- Pending email invites have userId=NULL; MySQL keeps multiple NULLs distinct, so
-- they are unaffected. All steps are idempotent / retry-safe (guarded by
-- information_schema + prepared statements, works on both MySQL and MariaDB).
DELETE c1 FROM `project_collaborators` c1 JOIN `project_collaborators` c2 ON c1.`projectId` = c2.`projectId` AND c1.`userId` = c2.`userId` AND c1.`userId` IS NOT NULL AND c1.`id` > c2.`id`;
--> statement-breakpoint
SET @ddl_drop_collab_idx := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `project_collab_project_user_idx` ON `project_collaborators`', 'SELECT 1') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_collaborators' AND INDEX_NAME = 'project_collab_project_user_idx');
--> statement-breakpoint
PREPARE stmt_drop_collab_idx FROM @ddl_drop_collab_idx;
--> statement-breakpoint
EXECUTE stmt_drop_collab_idx;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_drop_collab_idx;
--> statement-breakpoint
SET @ddl_collab_uniq := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `project_collaborators` ADD UNIQUE INDEX `project_collab_project_user_uniq` (`projectId`, `userId`)', 'SELECT 1') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_collaborators' AND INDEX_NAME = 'project_collab_project_user_uniq');
--> statement-breakpoint
PREPARE stmt_collab_uniq FROM @ddl_collab_uniq;
--> statement-breakpoint
EXECUTE stmt_collab_uniq;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_collab_uniq;
