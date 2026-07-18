-- #234 通用暂存通道：storageSettings 加 uploadStagingProvider 列（"poyo"/"kie"/"off"，
-- 空串=未设置沿用旧 poyoUploadFallback 布尔语义）。MySQL 8 没有 ADD COLUMN IF NOT
-- EXISTS，用 information_schema 守卫 + 预处理语句实现幂等（MySQL/MariaDB 通用、可重跑）。
SET @ddl_staging_provider := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `storageSettings` ADD COLUMN `uploadStagingProvider` VARCHAR(8) NOT NULL DEFAULT ''''', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storageSettings' AND COLUMN_NAME = 'uploadStagingProvider');
--> statement-breakpoint
PREPARE stmt_staging_provider FROM @ddl_staging_provider;
--> statement-breakpoint
EXECUTE stmt_staging_provider;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_staging_provider;
