-- Poyo integration additions (non-breaking).
-- 1) Admin-configurable "Poyo stream-upload fallback": when MinIO/S3 isn't
--    publicly reachable, stage reference media on Poyo for a public URL.
--    Existing singleton row defaults to false → behavior identical to before.
-- 2) poyoBalanceSnapshots: periodic snapshots of the platform Poyo credit
--    balance (the balance API has no history), used to chart consumption.
ALTER TABLE `storageSettings`
  ADD COLUMN `poyoUploadFallback` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `poyoBalanceSnapshots` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `creditsAmount` FLOAT NOT NULL,
  `email` VARCHAR(320),
  `createdAt` TIMESTAMP NOT NULL DEFAULT (now()),
  CONSTRAINT `poyoBalanceSnapshots_id` PRIMARY KEY(`id`)
);

CREATE INDEX `poyoBalanceSnapshots_createdAt_idx` ON `poyoBalanceSnapshots` (`createdAt`);
