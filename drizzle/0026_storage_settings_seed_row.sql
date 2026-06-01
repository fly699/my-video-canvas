-- Seed the singleton storageSettings row (id=1).
-- The journal's migration path never inserts it: 0013 creates the table empty
-- and 0015_consolidate_baseline only adds columns. The INSERT lived in the
-- orphan 0015_storage_settings.sql, which is not registered in the journal and
-- never runs. Without this row, `UPDATE ... WHERE id=1` matches nothing, so the
-- admin storage toggles and presign-TTL changes silently fail to persist.
-- INSERT IGNORE is a no-op if the row already exists. Column defaults apply:
-- minioOnly defaults to true as of migration 0025.
INSERT IGNORE INTO `storageSettings` (`id`) VALUES (1);
