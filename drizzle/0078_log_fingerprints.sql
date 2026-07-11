SET @auditlogs_devicefp_ddl := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `auditLogs` ADD COLUMN `deviceFp` varchar(64)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditLogs' AND COLUMN_NAME = 'deviceFp');
--> statement-breakpoint
PREPARE auditlogs_devicefp_stmt FROM @auditlogs_devicefp_ddl;
--> statement-breakpoint
EXECUTE auditlogs_devicefp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE auditlogs_devicefp_stmt;
--> statement-breakpoint
SET @auditlogs_useragent_ddl := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `auditLogs` ADD COLUMN `userAgent` varchar(255)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditLogs' AND COLUMN_NAME = 'userAgent');
--> statement-breakpoint
PREPARE auditlogs_useragent_stmt FROM @auditlogs_useragent_ddl;
--> statement-breakpoint
EXECUTE auditlogs_useragent_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE auditlogs_useragent_stmt;
--> statement-breakpoint
SET @auditlogs_sessionfp_ddl := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `auditLogs` ADD COLUMN `sessionFp` varchar(32)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditLogs' AND COLUMN_NAME = 'sessionFp');
--> statement-breakpoint
PREPARE auditlogs_sessionfp_stmt FROM @auditlogs_sessionfp_ddl;
--> statement-breakpoint
EXECUTE auditlogs_sessionfp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE auditlogs_sessionfp_stmt;
--> statement-breakpoint
SET @comfyusagelogs_devicefp_ddl := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `comfyUsageLogs` ADD COLUMN `deviceFp` varchar(64)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comfyUsageLogs' AND COLUMN_NAME = 'deviceFp');
--> statement-breakpoint
PREPARE comfyusagelogs_devicefp_stmt FROM @comfyusagelogs_devicefp_ddl;
--> statement-breakpoint
EXECUTE comfyusagelogs_devicefp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE comfyusagelogs_devicefp_stmt;
--> statement-breakpoint
SET @comfyusagelogs_useragent_ddl := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `comfyUsageLogs` ADD COLUMN `userAgent` varchar(255)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comfyUsageLogs' AND COLUMN_NAME = 'userAgent');
--> statement-breakpoint
PREPARE comfyusagelogs_useragent_stmt FROM @comfyusagelogs_useragent_ddl;
--> statement-breakpoint
EXECUTE comfyusagelogs_useragent_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE comfyusagelogs_useragent_stmt;
--> statement-breakpoint
SET @comfyusagelogs_sessionfp_ddl := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `comfyUsageLogs` ADD COLUMN `sessionFp` varchar(32)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comfyUsageLogs' AND COLUMN_NAME = 'sessionFp');
--> statement-breakpoint
PREPARE comfyusagelogs_sessionfp_stmt FROM @comfyusagelogs_sessionfp_ddl;
--> statement-breakpoint
EXECUTE comfyusagelogs_sessionfp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE comfyusagelogs_sessionfp_stmt;
