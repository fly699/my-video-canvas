-- ComfyUI ops center: SSH-credentialed server registry, shared script library,
-- execution records, and single-row settings. All idempotent via
-- CREATE TABLE IF NOT EXISTS so a half-applied state can resume cleanly.
CREATE TABLE IF NOT EXISTS `comfy_ops_servers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `comfyBaseUrl` VARCHAR(512),
  `sshHost` VARCHAR(255) NOT NULL,
  `sshPort` INT NOT NULL DEFAULT 22,
  `sshUser` VARCHAR(128) NOT NULL,
  `authType` ENUM('password','privateKey') NOT NULL,
  `encryptedSecret` VARCHAR(8192) NOT NULL,
  `encryptedPassphrase` VARCHAR(1024),
  `secretLast4` VARCHAR(8),
  `deployForm` ENUM('docker','bare','systemd') NOT NULL DEFAULT 'bare',
  `dockerContainer` VARCHAR(128),
  `comfyPath` VARCHAR(512),
  `trustMode` BOOLEAN NOT NULL DEFAULT FALSE,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `note` VARCHAR(255),
  `createdBy` INT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `comfy_ops_scripts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `category` VARCHAR(32),
  `description` TEXT,
  `body` TEXT NOT NULL,
  `dangerous` BOOLEAN NOT NULL DEFAULT FALSE,
  `source` ENUM('manual','ai') NOT NULL DEFAULT 'manual',
  `createdByEmail` VARCHAR(255),
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `comfy_ops_records` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `serverId` INT,
  `userId` INT,
  `userEmail` VARCHAR(320),
  `channel` ENUM('api','ssh','terminal') NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `command` TEXT,
  `approvedByAi` BOOLEAN,
  `autoExecuted` BOOLEAN NOT NULL DEFAULT FALSE,
  `status` VARCHAR(16) NOT NULL,
  `exitCode` INT,
  `durationMs` INT,
  `outputTail` TEXT,
  `errorMessage` VARCHAR(1024),
  `detail` JSON,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `comfy_ops_records_serverId_idx` (`serverId`),
  INDEX `comfy_ops_records_createdAt_idx` (`createdAt`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `comfy_ops_settings` (
  `id` INT PRIMARY KEY,
  `globalTrustMode` BOOLEAN NOT NULL DEFAULT FALSE,
  `autoExecWhitelist` JSON,
  `readOnlyOpenToWhitelist` BOOLEAN NOT NULL DEFAULT TRUE
);
