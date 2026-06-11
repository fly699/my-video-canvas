-- Project-level "default model per node type" config. A JSON blob on projects:
--   { categories?: { llm?, image?, video? }, perSlot?: { "storyboard.image": "...", ... } }
-- Drives the default model new nodes pick up; editable from the canvas toolbar.
-- MySQL has no ADD COLUMN IF NOT EXISTS; guard the add via information_schema + a
-- prepared statement so it runs on both MySQL and MariaDB and stays idempotent
-- (retry-safe / no-op when the column already exists).
SET @ddl_defaultModels := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `projects` ADD COLUMN `defaultModels` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'defaultModels');
--> statement-breakpoint
PREPARE stmt_defaultModels FROM @ddl_defaultModels;
--> statement-breakpoint
EXECUTE stmt_defaultModels;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_defaultModels;
