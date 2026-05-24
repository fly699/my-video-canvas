CREATE TABLE IF NOT EXISTS `storageSettings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `persistAudio` BOOLEAN NOT NULL DEFAULT TRUE,
  `persistVideo` BOOLEAN NOT NULL DEFAULT TRUE,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
-- Seed the singleton row so reads always succeed
INSERT IGNORE INTO `storageSettings` (`id`, `persistAudio`, `persistVideo`) VALUES (1, TRUE, TRUE);
