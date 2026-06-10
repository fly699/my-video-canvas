CREATE TABLE IF NOT EXISTS `model_toggle_settings` (
	`id` int NOT NULL,
	`disabledModels` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_toggle_settings_id` PRIMARY KEY(`id`)
);
