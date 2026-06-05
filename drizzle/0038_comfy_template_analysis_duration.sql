-- Per-template video duration capability for agent scene planning. maxFrames /
-- fps let the agent know each video template's per-shot length so it can split a
-- target total duration into enough shots. Null for image-only templates.
-- Single idempotent statement (MariaDB supports ADD COLUMN IF NOT EXISTS).
ALTER TABLE `comfy_template_analysis` ADD COLUMN IF NOT EXISTS `maxFrames` INT, ADD COLUMN IF NOT EXISTS `fps` INT;
