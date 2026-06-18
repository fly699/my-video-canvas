-- Built-in public tunnel (cloudflared) settings + its SEPARATE access whitelist.
-- Single-row (id=1). `token` is the optional Cloudflare named-tunnel token (admin infra
-- secret, never returned to clients). Idempotent via CREATE TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `tunnel_settings` (
  `id` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `token` text,
  `publicUrl` text,
  `whitelistUsers` json,
  `whitelistIps` json,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tunnel_settings_id` PRIMARY KEY(`id`)
);
