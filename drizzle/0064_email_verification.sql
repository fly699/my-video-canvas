SET @users_email_verified_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `users` ADD COLUMN `emailVerified` boolean NOT NULL DEFAULT true',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'emailVerified');
--> statement-breakpoint
PREPARE users_email_verified_stmt FROM @users_email_verified_col;
--> statement-breakpoint
EXECUTE users_email_verified_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE users_email_verified_stmt;
--> statement-breakpoint
SET @users_verify_code_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `users` ADD COLUMN `verifyCode` varchar(16)',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verifyCode');
--> statement-breakpoint
PREPARE users_verify_code_stmt FROM @users_verify_code_col;
--> statement-breakpoint
EXECUTE users_verify_code_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE users_verify_code_stmt;
--> statement-breakpoint
SET @users_verify_exp_col := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `users` ADD COLUMN `verifyCodeExpiresAt` timestamp NULL',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verifyCodeExpiresAt');
--> statement-breakpoint
PREPARE users_verify_exp_stmt FROM @users_verify_exp_col;
--> statement-breakpoint
EXECUTE users_verify_exp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE users_verify_exp_stmt;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`emailVerificationEnabled` boolean NOT NULL DEFAULT false,
	`smtpHost` varchar(255) NOT NULL DEFAULT '',
	`smtpPort` int NOT NULL DEFAULT 587,
	`smtpSecure` boolean NOT NULL DEFAULT false,
	`smtpUser` varchar(255) NOT NULL DEFAULT '',
	`smtpPass` varchar(255) NOT NULL DEFAULT '',
	`smtpFrom` varchar(320) NOT NULL DEFAULT '',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `auth_settings_id` PRIMARY KEY(`id`)
);
