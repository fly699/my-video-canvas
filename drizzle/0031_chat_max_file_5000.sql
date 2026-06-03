ALTER TABLE `chat_settings`
  MODIFY COLUMN `maxFileMb` int NOT NULL DEFAULT 5000;
--> statement-breakpoint
UPDATE `chat_settings` SET `maxFileMb` = 5000 WHERE `maxFileMb` IN (16, 200);
