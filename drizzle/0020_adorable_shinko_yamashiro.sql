CREATE TABLE IF NOT EXISTS `chat_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`messageId` int,
	`uploaderId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`url` text NOT NULL,
	`name` varchar(255) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`size` int NOT NULL,
	`kind` enum('image','video','file') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_bans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`scope` enum('global','conversation') NOT NULL,
	`conversationId` int,
	`reason` varchar(255),
	`bannedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_bans_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_bans_user_scope_conv_uniq` UNIQUE(`userId`,`scope`,`conversationId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('lobby','group','dm') NOT NULL,
	`mode` enum('server','serverless') NOT NULL DEFAULT 'server',
	`title` varchar(120),
	`passwordHash` varchar(255),
	`createdBy` int,
	`dmKey` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_conv_dmkey_uniq` UNIQUE(`dmKey`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','member') NOT NULL DEFAULT 'member',
	`lastReadMessageId` int NOT NULL DEFAULT 0,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_members_conv_user_uniq` UNIQUE(`conversationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serverlessAllowed` boolean NOT NULL DEFAULT true,
	`lobbyEnabled` boolean NOT NULL DEFAULT true,
	`maxFileMb` int NOT NULL DEFAULT 200,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_user_keys` (
	`userId` int NOT NULL,
	`publicKeyJwk` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_user_keys_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`senderId` int NOT NULL,
	`senderName` varchar(120) NOT NULL,
	`content` text NOT NULL,
	`attachments` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `chat_attach_conv_idx` ON `chat_attachments` (`conversationId`);--> statement-breakpoint
CREATE INDEX `chat_attach_msg_idx` ON `chat_attachments` (`messageId`);--> statement-breakpoint
CREATE INDEX `chat_conv_type_mode_idx` ON `chat_conversations` (`type`,`mode`);--> statement-breakpoint
CREATE INDEX `chat_members_user_idx` ON `chat_members` (`userId`);--> statement-breakpoint
CREATE INDEX `conv_msgs_conv_created_idx` ON `conversation_messages` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `conv_msgs_conv_id_idx` ON `conversation_messages` (`conversationId`,`id`);--> statement-breakpoint
INSERT IGNORE INTO `chat_settings` (`id`, `serverlessAllowed`, `lobbyEnabled`, `maxFileMb`) VALUES (1, true, true, 200);--> statement-breakpoint
INSERT IGNORE INTO `chat_conversations` (`id`, `type`, `mode`, `title`) VALUES (1, 'lobby', 'server', '大厅');
