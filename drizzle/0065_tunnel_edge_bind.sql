-- 出口专线绑定：服务器有多条上行专线时，填某条线路本机网卡的源 IP，cloudflared 出到
-- Cloudflare 边缘的连接绑定到该 IP（--edge-bind-address），即走指定那条专线。空=系统默认路由。
-- MySQL 无 ADD COLUMN IF NOT EXISTS → information_schema 守卫 + PREPARE/EXECUTE（幂等，MySQL/MariaDB 通用）。
SET @ddl_tun_edge := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `tunnel_settings` ADD COLUMN `edgeBindAddress` text', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tunnel_settings' AND COLUMN_NAME = 'edgeBindAddress');
--> statement-breakpoint
PREPARE stmt_tun_edge FROM @ddl_tun_edge;
--> statement-breakpoint
EXECUTE stmt_tun_edge;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_tun_edge;
