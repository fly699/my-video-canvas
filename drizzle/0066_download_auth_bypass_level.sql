-- 下载门控免受级别：adminLevel >= 此值免门控、低于此值受控。默认 1（= 所有管理员免、普通成员受控，
-- 与原行为一致）。MySQL 无 ADD COLUMN IF NOT EXISTS → information_schema 守卫 + PREPARE/EXECUTE（幂等）。
SET @ddl_dlv := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `storageSettings` ADD COLUMN `downloadAuthBypassLevel` int NOT NULL DEFAULT 1', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storageSettings' AND COLUMN_NAME = 'downloadAuthBypassLevel');
--> statement-breakpoint
PREPARE stmt_dlv FROM @ddl_dlv;
--> statement-breakpoint
EXECUTE stmt_dlv;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_dlv;
