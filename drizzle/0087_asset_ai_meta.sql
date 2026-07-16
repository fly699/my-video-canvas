-- E2 semantic asset search: AI tagging payload on assets ({ aiTags, aiDesc, aiModel,
-- taggedAt }, helpers in shared/assetMeta.ts). MySQL 8 has no ADD COLUMN IF NOT
-- EXISTS, so guard via information_schema + a prepared statement (idempotent /
-- retry-safe, works on both MySQL and MariaDB).
SET @ddl_asset_meta := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `assets` ADD COLUMN `meta` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'meta');
--> statement-breakpoint
PREPARE stmt_asset_meta FROM @ddl_asset_meta;
--> statement-breakpoint
EXECUTE stmt_asset_meta;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_asset_meta;
