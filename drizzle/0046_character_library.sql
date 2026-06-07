CREATE TABLE IF NOT EXISTS `character_library` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`creatorName` varchar(255),
	`name` varchar(120) NOT NULL,
	`characterKind` varchar(16) NOT NULL DEFAULT 'person',
	`payload` json NOT NULL,
	`thumbnail` text,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `character_library_id` PRIMARY KEY(`id`),
	INDEX `character_library_user_idx` (`userId`),
	INDEX `character_library_kind_idx` (`characterKind`)
);
