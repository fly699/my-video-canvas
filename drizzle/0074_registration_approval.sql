SET @users_approved_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `users` ADD COLUMN `approved` boolean NOT NULL DEFAULT true',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'approved');
--> statement-breakpoint
PREPARE users_approved_stmt FROM @users_approved_col;
--> statement-breakpoint
EXECUTE users_approved_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE users_approved_stmt;
--> statement-breakpoint
SET @auth_reg_approval_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `auth_settings` ADD COLUMN `registrationApprovalEnabled` boolean NOT NULL DEFAULT false',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_settings' AND COLUMN_NAME = 'registrationApprovalEnabled');
--> statement-breakpoint
PREPARE auth_reg_approval_stmt FROM @auth_reg_approval_col;
--> statement-breakpoint
EXECUTE auth_reg_approval_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE auth_reg_approval_stmt;
