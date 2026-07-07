-- 画布助手对话上下文持久化：按 (projectId, userId) 一行，turns 存整段对话 JSON。
-- 单语句、CREATE TABLE IF NOT EXISTS 幂等/可重跑，MySQL 8 与 MariaDB 通用。
CREATE TABLE IF NOT EXISTS `canvas_agent_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `turns` json,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `canvas_agent_sessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `canvas_agent_sessions_proj_user_uniq` UNIQUE(`projectId`,`userId`)
);
