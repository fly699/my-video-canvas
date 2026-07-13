-- ComfyUI 工作流经验记忆体：沉淀工程智能体成功搭通的工作流，供相似任务召回复用。单条建表，幂等。
CREATE TABLE IF NOT EXISTS `comfy_workflow_memory` (
  `id` int AUTO_INCREMENT NOT NULL,
  `baseUrl` varchar(512) NOT NULL,
  `task` varchar(2000) NOT NULL,
  `workflowJson` longtext NOT NULL,
  `hash` varchar(64) NOT NULL,
  `nodeClasses` json,
  `outputType` varchar(32),
  `meta` json,
  `usageCount` int NOT NULL DEFAULT 0,
  `createdAt` bigint NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `comfy_workflow_memory_id` PRIMARY KEY(`id`)
);
