-- Email-on-new-tunnel-URL config (quick tunnels change URL on each restart): one JSON blob
-- { to, host, port, user, pass, secure, from } on the tunnel_settings row. Sensitive
-- (SMTP pass) — never returned to clients. Idempotent (information_schema guard).
SET @ddl_tun_email := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `tunnel_settings` ADD COLUMN `emailNotify` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tunnel_settings' AND COLUMN_NAME = 'emailNotify');
--> statement-breakpoint
PREPARE stmt_tun_email FROM @ddl_tun_email;
--> statement-breakpoint
EXECUTE stmt_tun_email;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_tun_email;
