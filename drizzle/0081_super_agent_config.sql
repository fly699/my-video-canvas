-- Super-agent permission config (admin-managed, replaces SUPER_AGENT_* env-only setup):
-- a single JSON blob { codeEnabled, allowBash, autoInstall } on the model-settings row.
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS, so guard via information_schema + a prepared
-- statement (idempotent / retry-safe, works on both MySQL and MariaDB).
SET @ddl_super_agent := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `superAgent` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'superAgent');
--> statement-breakpoint
PREPARE stmt_super_agent FROM @ddl_super_agent;
--> statement-breakpoint
EXECUTE stmt_super_agent;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_super_agent;
