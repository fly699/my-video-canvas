-- Add an optional thumbnail URL (the source node's generated image at save time)
-- to the shared ComfyUI node template library. Shown on the library cards; never
-- written to the export file. ADD COLUMN IF NOT EXISTS keeps a re-run idempotent
-- after a prior partial attempt. Single statement, so no breakpoint marker.
ALTER TABLE `comfy_node_templates` ADD COLUMN IF NOT EXISTS `thumbnail` TEXT;
