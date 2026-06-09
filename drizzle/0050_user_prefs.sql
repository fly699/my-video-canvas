CREATE TABLE IF NOT EXISTS `user_prefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`prefKey` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_prefs_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_prefs_user_key_uniq` UNIQUE(`userId`,`prefKey`)
);
