-- Add a third persistence toggle for generated images. Existing rows
-- (singleton id=1) keep the historical "always persist images" behavior
-- so the upgrade is non-breaking; admins can flip it off afterwards if
-- they want to save Manus S3 quota.
ALTER TABLE `storageSettings`
  ADD COLUMN `persistImage` BOOLEAN NOT NULL DEFAULT TRUE;
