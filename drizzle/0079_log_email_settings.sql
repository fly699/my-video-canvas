CREATE TABLE IF NOT EXISTS `log_email_settings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `recipients` text,
  `zipPassword` varchar(128),
  `includeAudit` boolean NOT NULL DEFAULT true,
  `includeLlm` boolean NOT NULL DEFAULT true,
  `includeComfy` boolean NOT NULL DEFAULT true,
  `rangeDays` int NOT NULL DEFAULT 7,
  `scheduleMode` varchar(16) NOT NULL DEFAULT 'daily',
  `intervalHours` int NOT NULL DEFAULT 24,
  `sendHour` int NOT NULL DEFAULT 3,
  `sendWeekday` int NOT NULL DEFAULT 1,
  `sendMonthday` int NOT NULL DEFAULT 1,
  `lastSentAt` timestamp NULL,
  `lastResult` varchar(512),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `log_email_settings_id` PRIMARY KEY(`id`)
);
