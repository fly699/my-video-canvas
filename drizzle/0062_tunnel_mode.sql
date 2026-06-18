-- Decouple "tunnel gate" from "run cloudflared": runCloudflared=true → app spawns
-- cloudflared; false → admin已有公网入口(反代/端口转发/外部隧道)，只填公网域名、不起进程，
-- 门控照样按 Host 生效。默认 true（向后兼容）。MySQL 无 ADD COLUMN IF NOT EXISTS → 守卫。
SET @ddl_tun_mode := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `tunnel_settings` ADD COLUMN `runCloudflared` boolean NOT NULL DEFAULT true', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tunnel_settings' AND COLUMN_NAME = 'runCloudflared');
--> statement-breakpoint
PREPARE stmt_tun_mode FROM @ddl_tun_mode;
--> statement-breakpoint
EXECUTE stmt_tun_mode;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_tun_mode;
