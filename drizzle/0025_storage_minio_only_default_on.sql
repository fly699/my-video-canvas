-- Default the "MinIO/S3 only" switch to ON.
-- Object storage is restricted to self-hosted MinIO/S3 by default now; the
-- Forge storage fallback is opt-out rather than opt-in. Deployments that have
-- not configured MinIO/S3 can turn it back off in the admin panel.
ALTER TABLE `storageSettings`
  ALTER COLUMN `minioOnly` SET DEFAULT true;
--> statement-breakpoint
UPDATE `storageSettings` SET `minioOnly` = true WHERE `minioOnly` = false;
