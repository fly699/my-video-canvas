SET @users_disabled_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `users` ADD COLUMN `disabled` boolean NOT NULL DEFAULT false',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'disabled');
--> statement-breakpoint
PREPARE users_disabled_stmt FROM @users_disabled_col;
--> statement-breakpoint
EXECUTE users_disabled_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE users_disabled_stmt;
