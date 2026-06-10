CREATE TABLE IF NOT EXISTS `prompt_library` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`label` varchar(120) NOT NULL,
	`text` text NOT NULL,
	`category` varchar(120) NOT NULL DEFAULT '通用',
	`slot` int,
	`slotKind` varchar(16),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prompt_library_id` PRIMARY KEY(`id`),
	INDEX `prompt_library_user_idx` (`userId`)
);
