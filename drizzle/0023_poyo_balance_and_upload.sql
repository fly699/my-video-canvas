-- Poyo integration additions (non-breaking).
-- 1) Admin-configurable "Poyo stream-upload fallback": when MinIO/S3 isn't
--    publicly reachable, stage reference media on Poyo for a public URL.
--    Existing singleton row defaults to false, behavior identical to before.
-- 2) poyoBalanceSnapshots: periodic snapshots of the platform Poyo credit
--    balance (the balance API has no history), used to chart consumption.
--
-- NOTE: written idempotently (column/table existence checks) because an earlier
-- release of this file shipped without the breakpoint separators, so MySQL
-- rejected the whole batch (ER_PARSE_ERROR 1064) and some deployments may have
-- partially applied it. These guards make a re-run safe.
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storageSettings' AND COLUMN_NAME = 'poyoUploadFallback');
--> statement-breakpoint
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `storageSettings` ADD COLUMN `poyoUploadFallback` BOOLEAN NOT NULL DEFAULT false', 'DO 0');
--> statement-breakpoint
PREPARE stmt FROM @sql;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `poyoBalanceSnapshots` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `creditsAmount` FLOAT NOT NULL,
  `email` VARCHAR(320),
  `createdAt` TIMESTAMP NOT NULL DEFAULT (now()),
  CONSTRAINT `poyoBalanceSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
SET @idx_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poyoBalanceSnapshots' AND INDEX_NAME = 'poyoBalanceSnapshots_createdAt_idx');
--> statement-breakpoint
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX `poyoBalanceSnapshots_createdAt_idx` ON `poyoBalanceSnapshots` (`createdAt`)', 'DO 0');
--> statement-breakpoint
PREPARE stmt FROM @sql;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
