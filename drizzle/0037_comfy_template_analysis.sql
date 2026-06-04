-- Per-template functional analysis produced by the LLM, read by the agent for
-- planning. One row per template (unique templateId). Idempotent create.
CREATE TABLE IF NOT EXISTS `comfy_template_analysis` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `templateId` INT NOT NULL UNIQUE,
  `functionSummary` TEXT,
  `capabilities` JSON,
  `outputType` VARCHAR(16),
  `hasVideoOutput` BOOLEAN,
  `modelNames` JSON,
  `analysisVersion` INT NOT NULL DEFAULT 1,
  `model` VARCHAR(64),
  `analyzedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
