-- Phase 2B tables: invite codes + IP whitelist + LAN chat settings.
-- Idempotent for production replay.

CREATE TABLE IF NOT EXISTS `lan_chat_invites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`groupId` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`usedByNickname` varchar(64),
	`usedByIp` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lan_chat_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `lan_chat_invites_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lan_chat_ip_whitelist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ip` varchar(64) NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lan_chat_ip_whitelist_id` PRIMARY KEY(`id`),
	CONSTRAINT `lan_chat_ip_whitelist_ip_unique` UNIQUE(`ip`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lan_chat_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipWhitelistEnabled` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lan_chat_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Seed singleton settings row.
INSERT IGNORE INTO `lan_chat_settings` (`id`, `ipWhitelistEnabled`) VALUES (1, FALSE);
