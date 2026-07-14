-- Transcribe endpoint config (admin-managed, replaces TRANSCRIBE_* env-only setup):
-- a single JSON blob { url, apiKey, model } on the model-settings row. MySQL has no
-- ADD COLUMN IF NOT EXISTS, so guard via information_schema + a prepared statement
-- (idempotent / retry-safe, works on both MySQL and MariaDB).
SET @ddl_tr_ep := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `transcribeEndpoint` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'transcribeEndpoint');
--> statement-breakpoint
PREPARE stmt_tr_ep FROM @ddl_tr_ep;
--> statement-breakpoint
EXECUTE stmt_tr_ep;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_tr_ep;
