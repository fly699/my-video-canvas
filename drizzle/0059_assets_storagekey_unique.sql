-- Enforce one asset row per (userId, storageKey). recordGeneratedAsset runs from both
-- the video poller and the request path for the same completed generation; its
-- SELECT-then-INSERT could race and create duplicate media-library rows. storageKey is
-- TEXT so the unique index uses a 255-char prefix (keys embed a random uuid and are far
-- shorter, so the prefix is effectively the full key). We first collapse any existing
-- duplicates — keeping the visible (non-deleted) row with the lowest id per group — then
-- add the UNIQUE index. Both steps idempotent / retry-safe (guard via information_schema).
DELETE FROM `assets` WHERE `id` IN (SELECT `id` FROM (SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `userId`, LEFT(`storageKey`, 255) ORDER BY (`deletedAt` IS NULL) DESC, `id` ASC) AS rn FROM `assets`) t WHERE t.rn > 1);
--> statement-breakpoint
SET @ddl_assets_uniq := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `assets` ADD UNIQUE INDEX `assets_user_storagekey_uniq` (`userId`, `storageKey`(255))', 'SELECT 1') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND INDEX_NAME = 'assets_user_storagekey_uniq');
--> statement-breakpoint
PREPARE stmt_assets_uniq FROM @ddl_assets_uniq;
--> statement-breakpoint
EXECUTE stmt_assets_uniq;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_assets_uniq;
