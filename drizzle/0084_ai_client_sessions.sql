-- AI 客户端「会话索引」随账号持久化（#174）。单条建表，幂等；MySQL 8 与 MariaDB 通用语法。
CREATE TABLE IF NOT EXISTS `ai_client_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`model` varchar(64),
	`contextNodeIds` json,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `ai_client_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_client_sessions_user_proj_sess_unique` UNIQUE(`userId`,`projectId`,`sessionId`)
);
