-- Self-hosted LLM config (admin-managed, replaces env-only setup): a single JSON blob
-- { url, apiKey, models:[{id,label}] } on the model-settings row. MySQL has no
-- ADD COLUMN IF NOT EXISTS, so guard via information_schema + a prepared statement
-- (idempotent / retry-safe, works on both MySQL and MariaDB).
SET @ddl_sh_llm := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `selfHostedLlm` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'selfHostedLlm');
--> statement-breakpoint
PREPARE stmt_sh_llm FROM @ddl_sh_llm;
--> statement-breakpoint
EXECUTE stmt_sh_llm;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_sh_llm;
