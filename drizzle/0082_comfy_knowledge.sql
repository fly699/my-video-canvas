-- ComfyUI 知识记忆体持久化（跨重启复用资源清单 + 节点 schema）。单条建表，幂等（IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS `comfy_knowledge` (
  `baseUrl` varchar(512) NOT NULL,
  `objectInfo` longtext,
  `resources` json,
  `fetchedAt` bigint NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `comfy_knowledge_baseUrl` PRIMARY KEY(`baseUrl`)
);
