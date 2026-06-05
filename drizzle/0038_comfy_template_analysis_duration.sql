-- Per-template video duration capability for agent scene planning. maxFrames /
-- fps let the agent know each video template's per-shot length so it can split a
-- target total duration into enough shots. Null for image-only templates.
-- MySQL has no ADD COLUMN IF NOT EXISTS; guard each add via information_schema +
-- a prepared statement so it works on both MySQL and MariaDB and stays idempotent
-- (retry-safe / no-op when the column already exists).
SET @ddl_maxFrames := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `comfy_template_analysis` ADD COLUMN `maxFrames` INT', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comfy_template_analysis' AND COLUMN_NAME = 'maxFrames');
--> statement-breakpoint
PREPARE stmt_maxFrames FROM @ddl_maxFrames;
--> statement-breakpoint
EXECUTE stmt_maxFrames;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_maxFrames;
--> statement-breakpoint
SET @ddl_fps := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `comfy_template_analysis` ADD COLUMN `fps` INT', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comfy_template_analysis' AND COLUMN_NAME = 'fps');
--> statement-breakpoint
PREPARE stmt_fps FROM @ddl_fps;
--> statement-breakpoint
EXECUTE stmt_fps;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_fps;
