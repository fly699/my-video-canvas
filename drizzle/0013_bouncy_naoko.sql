CREATE TABLE `storageSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`persistAudio` boolean NOT NULL DEFAULT true,
	`persistVideo` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storageSettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `video_tasks` MODIFY COLUMN `provider` enum('mock','poyo_seedance','poyo_veo','poyo_kling26','poyo_kling_o3_std','poyo_kling_o3_pro','poyo_kling_o3_4k','poyo_wan25_t2v','poyo_wan25_i2v','poyo_runway45','hf_dop_standard','hf_dop_lite','hf_dop_turbo') NOT NULL;