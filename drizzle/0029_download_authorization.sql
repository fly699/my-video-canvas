-- Strict download authorization: every download of an original file (except by
-- admins) must be backed by a consumable grant. Grants come from either a user
-- request that an admin approved, or an admin-initiated batch grant (per-file or
-- per-project). Each grant allows exactly ONE successful download per file —
-- enforced race-safe by the (grantId, storageKey) unique index on consumptions.
CREATE TABLE `download_grants` (
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

CREATE TABLE `download_consumptions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `grantId` INT NOT NULL,
  `userId` INT NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `assetId` INT,
  `servedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `dl_consume_grant_file_uniq` (`grantId`, `storageKey`),
  INDEX `dl_consume_user_idx` (`userId`)
);
