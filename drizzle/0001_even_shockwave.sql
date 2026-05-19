CREATE TABLE `assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`name` varchar(255) NOT NULL,
	`type` enum('image','video','audio','other') NOT NULL,
	`mimeType` varchar(128),
	`size` int,
	`storageKey` text NOT NULL,
	`url` text NOT NULL,
	`thumbnailUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canvas_edges` (
	`id` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`sourceNodeId` varchar(64) NOT NULL,
	`targetNodeId` varchar(64) NOT NULL,
	`sourcePort` varchar(32) DEFAULT 'output',
	`targetPort` varchar(32) DEFAULT 'input',
	`label` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `canvas_edges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canvas_nodes` (
	`id` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`type` enum('script','storyboard','prompt','asset','video_task','ai_chat','note') NOT NULL,
	`title` varchar(255),
	`data` json,
	`posX` float NOT NULL DEFAULT 0,
	`posY` float NOT NULL DEFAULT 0,
	`width` float NOT NULL DEFAULT 320,
	`height` float NOT NULL DEFAULT 200,
	`zIndex` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `canvas_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nodeId` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`thumbnail` text,
	`viewportState` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`nodeId` varchar(64) NOT NULL,
	`provider` enum('runway','kling','mock') NOT NULL,
	`externalTaskId` varchar(255),
	`status` enum('pending','processing','succeeded','failed') NOT NULL DEFAULT 'pending',
	`prompt` text,
	`negativePrompt` text,
	`referenceImageUrl` text,
	`resultVideoUrl` text,
	`resultStorageKey` text,
	`errorMessage` text,
	`params` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_tasks_id` PRIMARY KEY(`id`)
);
