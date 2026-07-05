-- 管理员「系统默认模型」：给 model_toggle_settings 增一列 systemDefaultModels（JSON），
-- 存 { llm?, image?, video?, transcribe? }。作用于所有项目，解析优先级排在项目级配置之下、
-- 出厂默认之上。
--
-- 幂等 + MySQL 兼容：裸 ALTER ... ADD COLUMN 的 MariaDB 专属 IF NOT EXISTS 在真实 MySQL 上报
-- ER_PARSE_ERROR(1064/42000)，故用 information_schema 守卫 + 预处理语句（同 0034/0038）。可安全重跑。
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'systemDefaultModels');
--> statement-breakpoint
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `systemDefaultModels` JSON', 'DO 0');
--> statement-breakpoint
PREPARE stmt FROM @sql;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
