-- 隧道类型偏好：在保留已保存 Token 的同时仍可临时改用「快速隧道」。preferQuick=true 时，即便
-- 存了命名隧道 Token 也走快速隧道(自动 trycloudflare 网址)，切回命名隧道无需重新粘贴 Token。
-- 默认 false（向后兼容：有 Token 即命名隧道）。MySQL 无 ADD COLUMN IF NOT EXISTS → 守卫 + PREPARE/EXECUTE。
SET @ddl_tun_pq := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `tunnel_settings` ADD COLUMN `preferQuick` boolean NOT NULL DEFAULT false', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tunnel_settings' AND COLUMN_NAME = 'preferQuick');
--> statement-breakpoint
PREPARE stmt_tun_pq FROM @ddl_tun_pq;
--> statement-breakpoint
EXECUTE stmt_tun_pq;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_tun_pq;
