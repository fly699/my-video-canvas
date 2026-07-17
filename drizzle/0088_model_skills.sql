-- #203 model skills library: per-model prompt-technique text maintained in the
-- admin panel; merged with code seeds at read time (DB row overrides same modelId).
-- Single idempotent statement (CREATE TABLE IF NOT EXISTS), MySQL 8 core syntax only.
CREATE TABLE IF NOT EXISTS `model_skills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` varchar(128) NOT NULL,
	`kind` varchar(16) NOT NULL DEFAULT 'other',
	`tips` text NOT NULL,
	`source` varchar(512),
	`enabled` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_skills_modelId_unique` UNIQUE(`modelId`)
);
