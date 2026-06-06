ALTER TABLE `storageSettings`
  ADD COLUMN `forceStorageRelay` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `watermarkEnabled` BOOLEAN NOT NULL DEFAULT false;
