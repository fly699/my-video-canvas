SET @kie_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `whitelistSettings` ADD COLUMN `kieEnabled` boolean NOT NULL DEFAULT false',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whitelistSettings' AND COLUMN_NAME = 'kieEnabled');
--> statement-breakpoint
PREPARE kie_stmt FROM @kie_col;
--> statement-breakpoint
EXECUTE kie_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE kie_stmt;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kieApiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`encryptedKey` varchar(1024) NOT NULL,
	`keyLast4` varchar(8) NOT NULL,
	`keyHash` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kieApiKeys_id` PRIMARY KEY(`id`),
	CONSTRAINT `kieApiKeys_keyHash_uniq` UNIQUE(`keyHash`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kieKeyBindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyId` int NOT NULL,
	`userId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kieKeyBindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `kieKeyBindings_key_user_uniq` UNIQUE(`keyId`,`userId`),
	INDEX `kieKeyBindings_user_idx` (`userId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kieBalanceSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creditsAmount` float NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kieBalanceSnapshots_id` PRIMARY KEY(`id`),
	INDEX `kieBalanceSnapshots_createdAt_idx` (`createdAt`)
);
