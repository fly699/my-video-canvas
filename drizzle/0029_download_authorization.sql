-- Strict download authorization: every download of an original file (except by
-- admins) must be backed by a consumable grant. Grants come from either a user
-- request that an admin approved, or an admin-initiated batch grant (per-file or
-- per-project). Each grant allows exactly ONE successful download per file —
-- enforced race-safe by the (grantId, storageKey) unique index on consumptions.
--
-- NOTE: drizzle-kit splits a migration file into separate queries on each
-- `--> statement-breakpoint` marker and sends them one at a time (mysql2 has
-- multipleStatements disabled). The two CREATE TABLEs MUST be separated by the
-- marker below, or they get sent as one multi-statement query and MySQL rejects
-- it with a syntax error. IF NOT EXISTS keeps a re-run idempotent even if a
-- prior failed attempt already auto-committed the first table.
CREATE TABLE IF NOT EXISTS `download_grants` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `origin` ENUM('request','admin') NOT NULL,
  `scope` ENUM('asset','project') NOT NULL,
  `storageKey` VARCHAR(512),
  `assetId` INT,
  `projectId` INT,
  `status` ENUM('pending','active','revoked','denied') NOT NULL DEFAULT 'pending',
  `reason` VARCHAR(500),
  `note` VARCHAR(500),
  `createdBy` INT NOT NULL,
  `decidedBy` INT,
  `decidedAt` TIMESTAMP NULL,
  `expiresAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `dl_grant_user_status_idx` (`userId`, `status`),
  INDEX `dl_grant_status_idx` (`status`),
  INDEX `dl_grant_project_idx` (`projectId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `download_consumptions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `grantId` INT NOT NULL,
  `userId` INT NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `assetId` INT,
  `servedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `dl_consume_grant_file_uniq` (`grantId`, `storageKey`),
  INDEX `dl_consume_user_idx` (`userId`)
);
