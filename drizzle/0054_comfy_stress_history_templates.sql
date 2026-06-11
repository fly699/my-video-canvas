-- ComfyUI stress-test persistence: run history (auto-saved when a job finishes)
-- and reusable parameter templates. Both idempotent via CREATE TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `comfy_stress_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `jobId` VARCHAR(64) NOT NULL UNIQUE,
  `status` VARCHAR(16) NOT NULL,
  `startedByEmail` VARCHAR(255),
  `config` JSON,
  `result` JSON NOT NULL,
  `startedAt` TIMESTAMP NOT NULL,
  `finishedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `comfy_stress_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `config` JSON NOT NULL,
  `createdByEmail` VARCHAR(255),
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
