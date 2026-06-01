-- Admin-controlled "MinIO/S3 only" switch. When true, the Forge storage
-- fallback is disabled — object storage is restricted to self-hosted MinIO/S3,
-- so no generated/uploaded file is ever written to Manus/Forge storage.
-- Existing singleton row defaults to false → behavior identical to before
-- (non-breaking). Does NOT affect Forge non-storage features (LLM, transcription, etc.).
ALTER TABLE `storageSettings`
  ADD COLUMN `minioOnly` BOOLEAN NOT NULL DEFAULT false;
