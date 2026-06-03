-- Add an optional thumbnail URL (the source node's generated image at save time)
-- to the shared ComfyUI node template library. Shown on the library cards; never
-- written to the export file.
--
-- Idempotent + MySQL-compatible: a bare ALTER ... ADD COLUMN with the MariaDB-only
-- "IF NOT EXISTS" clause fails on real MySQL (ER_PARSE_ERROR 1064 / 42000), so we
-- guard with an information_schema check + a prepared statement (same approach as
-- migration 0023). Safe to re-run after a prior partial attempt.
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comfy_node_templates' AND COLUMN_NAME = 'thumbnail');
--> statement-breakpoint
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `comfy_node_templates` ADD COLUMN `thumbnail` TEXT', 'DO 0');
--> statement-breakpoint
PREPARE stmt FROM @sql;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
