-- #328 即梦（dreamina）CLI 本机桥接视频 provider 的后台配置（替代 JIMENG_CLI_* env-only）：
-- 在 model_toggle_settings 单行上加一个 JSON 列 { enabled, bin, sessionId }。
-- MySQL 8 无 ADD COLUMN IF NOT EXISTS，用 information_schema 守卫 + 预处理语句（幂等 / 可重试，
-- MySQL 与 MariaDB 通用）。
SET @ddl_jimeng_cli := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `jimengCli` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'jimengCli');
--> statement-breakpoint
PREPARE stmt_jimeng_cli FROM @ddl_jimeng_cli;
--> statement-breakpoint
EXECUTE stmt_jimeng_cli;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_jimeng_cli;
