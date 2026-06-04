-- Add admin-configurable LLM whitelist bypass. When true, text/vision LLM
-- procedures (AI chat, character-consistency check) skip the whitelist check
-- even while the whitelist is globally enabled, so admins can keep cheap LLM
-- features open while gating paid image/video generation. The existing
-- singleton row defaults to false, so the upgrade is non-breaking.
ALTER TABLE `whitelistSettings`
  ADD COLUMN `llmBypass` BOOLEAN NOT NULL DEFAULT false;
