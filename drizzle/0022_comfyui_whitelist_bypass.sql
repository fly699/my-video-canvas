-- Add admin-configurable ComfyUI whitelist bypass. When true, ComfyUI node
-- procedures skip the whitelist check even while the whitelist is globally
-- enabled — ComfyUI is the user's own self-hosted server (no cloud quota), so
-- admins can free it up independently. Existing singleton row defaults to
-- false, so the upgrade is non-breaking (behavior identical to before).
ALTER TABLE `whitelistSettings`
  ADD COLUMN `comfyuiBypass` BOOLEAN NOT NULL DEFAULT false;
