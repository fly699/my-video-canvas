-- Bridge MCP config (admin-managed, replaces CLAUDE_BRIDGE_* env-only setup): a single
-- JSON blob { mcpConfig, skills, strict, permissionMode, allowedTools } on the
-- model-settings row. MySQL 8 has no ADD COLUMN IF NOT EXISTS, so guard via
-- information_schema + a prepared statement (idempotent / retry-safe, works on both
-- MySQL and MariaDB).
SET @ddl_bridge_mcp := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `model_toggle_settings` ADD COLUMN `bridgeMcp` JSON', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_toggle_settings' AND COLUMN_NAME = 'bridgeMcp');
--> statement-breakpoint
PREPARE stmt_bridge_mcp FROM @ddl_bridge_mcp;
--> statement-breakpoint
EXECUTE stmt_bridge_mcp;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_bridge_mcp;
