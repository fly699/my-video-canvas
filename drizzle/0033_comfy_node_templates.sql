-- Shared ComfyUI node template library: one row per saved template. `payload`
-- holds the sanitized node parameters (prompts / models / workflow JSON) so a
-- template re-creates a fully-configured node. Library is shared across all
-- users — any logged-in user may add, everyone may view/use, only the creator
-- (userId) or an admin may edit/delete. IF NOT EXISTS keeps a re-run idempotent
-- after a prior partial attempt. Single statement, so no breakpoint marker.
CREATE TABLE IF NOT EXISTS `comfy_node_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `creatorName` VARCHAR(255),
  `label` VARCHAR(64) NOT NULL,
  `nodeType` VARCHAR(32) NOT NULL,
  `payload` JSON NOT NULL,
  `note` TEXT,
  `useCloud` BOOLEAN,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `comfy_node_templates_type_idx` (`nodeType`)
);
