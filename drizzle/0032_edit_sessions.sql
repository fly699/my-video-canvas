-- Video editor sessions: one row per saved timeline-editor document. `doc` holds
-- the full edit-decision-list (tracks/clips/effects) the front-end edits; the
-- server renders it in a single ffmpeg pass on export. IF NOT EXISTS keeps a
-- re-run idempotent after a prior partial attempt. Single statement, so no
-- breakpoint marker is needed.
CREATE TABLE IF NOT EXISTS `edit_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `projectId` INT,
  `name` VARCHAR(255) NOT NULL DEFAULT '未命名剪辑',
  `doc` JSON NOT NULL,
  `thumbnailUrl` TEXT,
  `deletedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `edit_sessions_user_idx` (`userId`)
);
