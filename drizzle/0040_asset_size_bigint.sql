-- Widen size columns from signed INT (max ~2.1GB) to BIGINT so multi-GB video
-- uploads don't overflow on insert (MySQL strict mode raises 1264; non-strict
-- silently truncates). Re-MODIFY to BIGINT is a no-op when already widened, so
-- this migration is idempotent. Standard MySQL/MariaDB syntax (no extensions).
ALTER TABLE `assets` MODIFY COLUMN `size` BIGINT;
--> statement-breakpoint
ALTER TABLE `chat_attachments` MODIFY COLUMN `size` BIGINT NOT NULL;
