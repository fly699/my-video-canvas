-- Private rooms: passwordHash column on lan_chat_rooms.
-- Null = public room (anyone in the group can enter).
-- Set = scrypt hash; enterRoom must supply matching password.
-- Idempotent for production replay.

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lan_chat_rooms' AND COLUMN_NAME = 'passwordHash');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `lan_chat_rooms` ADD `passwordHash` varchar(255)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
