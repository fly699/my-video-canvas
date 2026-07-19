-- #252 canvas-assistant planning jobs persisted to DB so a server restart no
-- longer loses finished results or leaves the client polling a ghost job.
-- Single idempotent statement (CREATE TABLE IF NOT EXISTS), MySQL 8 core syntax only.
CREATE TABLE IF NOT EXISTS `agent_chat_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`prompt` varchar(512) NOT NULL DEFAULT '',
	`status` varchar(16) NOT NULL DEFAULT 'running',
	`result` json,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_chat_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_chat_jobs_jobid_uniq` UNIQUE(`jobId`),
	INDEX `agent_chat_jobs_project_idx` (`projectId`)
);
