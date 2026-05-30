-- Add admin-configurable presigned GET URL validity (seconds) for self-hosted
-- S3/MinIO. Existing singleton row keeps the historical 1h (3600s) behavior, so
-- the upgrade is non-breaking. Admins can tune it from the Storage settings page.
ALTER TABLE `storageSettings`
  ADD COLUMN `presignTtlSec` INT NOT NULL DEFAULT 3600;
