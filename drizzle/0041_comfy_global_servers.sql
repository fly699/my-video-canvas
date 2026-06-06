-- Admin-managed global ComfyUI server registry, shared across all users.
-- Single-row table (id always 1) holding a JSON array of server base URLs.
-- Idempotent CREATE TABLE IF NOT EXISTS; standard MySQL/MariaDB syntax (single
-- statement, so no breakpoint marker is needed).
CREATE TABLE IF NOT EXISTS `comfy_settings` (
	`id` int NOT NULL,
	`servers` text,
	CONSTRAINT `comfy_settings_id` PRIMARY KEY(`id`)
);
