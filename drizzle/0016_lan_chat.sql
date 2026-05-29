-- LAN chat tables. Idempotent-safe so production can re-run without conflict
-- if the rows ever exist already (consistent with the 0015 baseline pattern).

CREATE TABLE IF NOT EXISTS `lan_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int NOT NULL,
	`nickname` varchar(64) NOT NULL,
	`color` varchar(16) NOT NULL,
	`content` text NOT NULL,
	`attachments` json,
	`clientIp` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lan_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lan_chat_rooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lan_chat_rooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `lan_chat_rooms_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
SET @idx_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lan_chat_messages' AND INDEX_NAME = 'lan_chat_msgs_room_created_idx');
--> statement-breakpoint
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX `lan_chat_msgs_room_created_idx` ON `lan_chat_messages` (`roomId`,`createdAt`)', 'DO 0');
--> statement-breakpoint
PREPARE stmt FROM @sql;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
-- Seed the default "大厅" (lobby) room so first-time visitors always land
-- somewhere — INSERT IGNORE skips on re-runs and on rooms with the same name.
INSERT IGNORE INTO `lan_chat_rooms` (`name`) VALUES ('大厅');
