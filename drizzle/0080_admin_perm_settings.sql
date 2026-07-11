CREATE TABLE IF NOT EXISTS `admin_perm_settings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `permsJson` text,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `admin_perm_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
SET @promote_l5_ddl := (SELECT IF(
  (SELECT COUNT(*) FROM `users` WHERE `adminLevel` >= 5) = 0,
  'UPDATE `users` SET `adminLevel` = 5 WHERE `adminLevel` = 4',
  'SELECT 1'));
--> statement-breakpoint
PREPARE promote_l5_stmt FROM @promote_l5_ddl;
--> statement-breakpoint
EXECUTE promote_l5_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE promote_l5_stmt;
