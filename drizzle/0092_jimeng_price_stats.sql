-- #334 即梦实测积分自学习计价库：每次即梦生成成功按 credit_count 聚合一行。
-- 单条幂等语句（CREATE TABLE IF NOT EXISTS），仅用 MySQL 8 核心语法。
CREATE TABLE IF NOT EXISTS `jimeng_price_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`signature` varchar(128) NOT NULL,
	`provider` varchar(48) NOT NULL,
	`modelVersion` varchar(48) NOT NULL DEFAULT '',
	`resolution` varchar(16) NOT NULL DEFAULT '',
	`duration` int NOT NULL DEFAULT 0,
	`lastCredit` int NOT NULL DEFAULT 0,
	`minCredit` int NOT NULL DEFAULT 0,
	`maxCredit` int NOT NULL DEFAULT 0,
	`sampleCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jimeng_price_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `jimeng_price_stats_sig_uniq` UNIQUE(`signature`)
);
