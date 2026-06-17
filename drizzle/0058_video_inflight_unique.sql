-- Enforce at most one IN-FLIGHT (pending/processing) video task per (projectId, nodeId).
-- Two concurrent / cross-user / multi-process submits could each pass the app-level
-- in-flight check and INSERT a separate task row, each getting claimed and submitted
-- upstream = real double charge. MySQL has no partial index, so we add a STORED
-- generated column that equals `projectId-nodeId` only while the task is in-flight
-- (NULL once finished) and put a UNIQUE index on it. Finished tasks collapse to NULL
-- (multiple NULLs allowed), freeing the node for a legitimate re-generation.
-- Steps: (1) collapse existing in-flight duplicates to 'failed' keeping the newest,
-- (2) add the generated column, (3) add the UNIQUE index. All idempotent / retry-safe.
UPDATE `video_tasks` v JOIN (SELECT `projectId`, `nodeId`, MAX(`id`) AS keepId FROM `video_tasks` WHERE `status` IN ('pending', 'processing') GROUP BY `projectId`, `nodeId` HAVING COUNT(*) > 1) d ON v.`projectId` = d.`projectId` AND v.`nodeId` = d.`nodeId` SET v.`status` = 'failed', v.`errorMessage` = COALESCE(v.`errorMessage`, 'auto-failed: duplicate in-flight task collapsed by migration 0058') WHERE v.`status` IN ('pending', 'processing') AND v.`id` <> d.keepId;
--> statement-breakpoint
SET @ddl_inflight_col := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `video_tasks` ADD COLUMN `inflightKey` VARCHAR(96) GENERATED ALWAYS AS (CASE WHEN `status` IN (''pending'', ''processing'') THEN CONCAT(`projectId`, ''-'', `nodeId`) ELSE NULL END) STORED', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_tasks' AND COLUMN_NAME = 'inflightKey');
--> statement-breakpoint
PREPARE stmt_inflight_col FROM @ddl_inflight_col;
--> statement-breakpoint
EXECUTE stmt_inflight_col;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_inflight_col;
--> statement-breakpoint
SET @ddl_inflight_uniq := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `video_tasks` ADD UNIQUE INDEX `video_tasks_inflight_uniq` (`inflightKey`)', 'SELECT 1') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_tasks' AND INDEX_NAME = 'video_tasks_inflight_uniq');
--> statement-breakpoint
PREPARE stmt_inflight_uniq FROM @ddl_inflight_uniq;
--> statement-breakpoint
EXECUTE stmt_inflight_uniq;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_inflight_uniq;
