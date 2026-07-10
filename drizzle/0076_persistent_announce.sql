SET @chat_persist_announce_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `chat_settings` ADD COLUMN `persistentAnnounceJson` text',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_settings' AND COLUMN_NAME = 'persistentAnnounceJson');
--> statement-breakpoint
PREPARE chat_persist_announce_stmt FROM @chat_persist_announce_col;
--> statement-breakpoint
EXECUTE chat_persist_announce_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE chat_persist_announce_stmt;
