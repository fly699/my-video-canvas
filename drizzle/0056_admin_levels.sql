-- Admin levels: add `adminLevel` (0=user · 1=viewer · 2=operator · 3=admin · 4=super)
-- and promote every existing role='admin' row to level 4 (super) so no current
-- admin is locked out of admin-management after this rolls out.
-- MySQL has no ADD COLUMN IF NOT EXISTS; guard the add via information_schema + a
-- prepared statement (works on both MySQL and MariaDB, idempotent / retry-safe).
SET @ddl_adminLevel := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `users` ADD COLUMN `adminLevel` INT NOT NULL DEFAULT 0', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'adminLevel');
--> statement-breakpoint
PREPARE stmt_adminLevel FROM @ddl_adminLevel;
--> statement-breakpoint
EXECUTE stmt_adminLevel;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_adminLevel;
--> statement-breakpoint
UPDATE `users` SET `adminLevel` = 4 WHERE `role` = 'admin' AND `adminLevel` = 0;
