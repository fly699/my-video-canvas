-- Add networkGroupId to lan_chat_rooms so the chat groups users by their
-- shared NAT gateway (same outbound IP = same "LAN") instead of requiring
-- the server itself to live on a LAN. Idempotent for production replay.

-- Drop the old name-only unique key first (rooms with the same name in
-- different networks must coexist now).
SET @key_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lan_chat_rooms' AND INDEX_NAME = 'lan_chat_rooms_name_unique');
SET @sql := IF(@key_exists > 0, 'ALTER TABLE `lan_chat_rooms` DROP INDEX `lan_chat_rooms_name_unique`', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
-- ADD COLUMN with a sentinel default so existing rows (the seeded "大厅"
-- from 0016) get a deterministic value rather than NULL. Existing legacy
-- rows become invisible to all real networks (no user's clientIp equals
-- '__legacy__') — historical data is preserved but orphaned.
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lan_chat_rooms' AND COLUMN_NAME = 'networkGroupId');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `lan_chat_rooms` ADD `networkGroupId` varchar(64) NOT NULL DEFAULT ''__legacy__''', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--> statement-breakpoint
-- Composite uniqueness so each network can have its own "大厅" without
-- colliding with another network's. Idempotent — only create when not
-- already present.
SET @uniq_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lan_chat_rooms' AND INDEX_NAME = 'lan_rooms_network_name_uniq');
SET @sql := IF(@uniq_exists = 0, 'CREATE UNIQUE INDEX `lan_rooms_network_name_uniq` ON `lan_chat_rooms` (`networkGroupId`, `name`)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
