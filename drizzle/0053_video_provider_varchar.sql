-- video_tasks.provider was a MySQL ENUM frozen at the providers known when the
-- last enum migration (0013) ran. Every provider added since (all kie_*, newer
-- poyo_*) was rejected on INSERT ("生成失败"), because the value wasn't in the
-- enum. Convert to VARCHAR so the column accepts any provider; the API layer
-- still validates against VIDEO_PROVIDERS (Zod). MODIFY COLUMN is a no-op when
-- the column is already VARCHAR(64), so this migration is safe to re-run.
ALTER TABLE `video_tasks` MODIFY COLUMN `provider` VARCHAR(64) NOT NULL;
