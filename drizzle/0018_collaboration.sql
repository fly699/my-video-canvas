-- Multi-user collaboration: add public read toggle, collaborators, and share links.
-- The project owner remains in projects.userId; this migration introduces
-- additional member roles (viewer/editor/admin) and one-time invite tokens.

ALTER TABLE `projects`
  ADD COLUMN `publicReadAccess` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE `project_collaborators` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `projectId` INT NOT NULL,
  `userId` INT NULL,
  `email` VARCHAR(320) NULL,
  `role` ENUM('viewer','editor','admin') NOT NULL,
  `invitedBy` INT NOT NULL,
  `status` ENUM('pending','active') NOT NULL DEFAULT 'active',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `project_collab_project_user_idx` (`projectId`, `userId`),
  INDEX `project_collab_email_idx` (`email`)
);

CREATE TABLE `project_share_links` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL,
  `projectId` INT NOT NULL,
  `role` ENUM('viewer','editor','admin') NOT NULL,
  `maxUses` INT NOT NULL DEFAULT 1,
  `usesCount` INT NOT NULL DEFAULT 0,
  `expiresAt` TIMESTAMP NOT NULL,
  `createdBy` INT NOT NULL,
  `revokedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `share_links_token_unique` (`token`),
  INDEX `share_links_project_idx` (`projectId`)
);
