-- VoxCPM (local Gradio TTS) global-default endpoint (admin-managed, replaces VOXCPM_BASE_URL
-- env-only setup): a single JSON blob { baseUrl } on the model-settings row. MySQL has no
-- ADD COLUMN IF NOT EXISTS, so guard via information_schema + a prepared statement
-- (idempotent / retry-safe, works on both MySQL and MariaDB).
SET @ddl_vox_ep := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `voxcpmEndpoint` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'voxcpmEndpoint');
--> statement-breakpoint
PREPARE stmt_vox_ep FROM @ddl_vox_ep;
--> statement-breakpoint
EXECUTE stmt_vox_ep;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_vox_ep;
