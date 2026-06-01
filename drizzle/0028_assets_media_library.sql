-- Unified media library: extend `assets` so it can index uploads, AI-generated
-- results and external imports per user, with multi-facet filtering and soft
-- delete. All additive/nullable (or defaulted) so existing rows are unaffected.
ALTER TABLE `assets`
  ADD COLUMN `source` ENUM('upload','generated','external') NOT NULL DEFAULT 'upload',
  ADD COLUMN `provider` VARCHAR(32),
  ADD COLUMN `model` VARCHAR(128),
  ADD COLUMN `nodeId` VARCHAR(64),
  ADD COLUMN `deletedAt` TIMESTAMP NULL;
