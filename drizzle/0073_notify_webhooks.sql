-- 用户个人产物推送 webhook 配置：按 userId 一行（唯一）。单语句、CREATE TABLE IF NOT EXISTS
-- 幂等/可重跑，仅用 MySQL 8 与 MariaDB 通用语法（boolean=tinyint、timestamp default now）。
CREATE TABLE IF NOT EXISTS `notify_webhooks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `kind` varchar(32) NOT NULL DEFAULT 'generic',
  `url` text,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `notify_webhooks_id` PRIMARY KEY(`id`),
  CONSTRAINT `notify_webhooks_user_uniq` UNIQUE(`userId`)
);
