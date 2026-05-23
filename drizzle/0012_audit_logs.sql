CREATE TABLE `auditLogs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int,
  `userEmail` varchar(320),
  `userName` varchar(255),
  `ip` varchar(64) NOT NULL,
  `country` varchar(64),
  `region` varchar(128),
  `city` varchar(128),
  `action` varchar(64) NOT NULL,
  `detail` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);

CREATE INDEX `auditLogs_userId_idx` ON `auditLogs` (`userId`);
CREATE INDEX `auditLogs_action_idx` ON `auditLogs` (`action`);
CREATE INDEX `auditLogs_createdAt_idx` ON `auditLogs` (`createdAt`);
