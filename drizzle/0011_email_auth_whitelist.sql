ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255);

CREATE TABLE `whitelistSettings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `whitelistSettings_id` PRIMARY KEY(`id`)
);

INSERT INTO `whitelistSettings` (`enabled`) VALUES (false);

CREATE TABLE `whitelistEntries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `type` enum('ip','user') NOT NULL,
  `value` varchar(320) NOT NULL,
  `note` text,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `whitelistEntries_id` PRIMARY KEY(`id`),
  UNIQUE KEY `whitelistEntries_type_value_unique` (`type`,`value`)
);
