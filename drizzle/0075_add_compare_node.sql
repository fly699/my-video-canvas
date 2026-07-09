-- 画布节点类型新增「图片对比」compare（滑块 A/B 对比查看，纯前端）。
-- MODIFY COLUMN 重定义 enum 是 MySQL 8 / MariaDB 通用核心语法（非 MariaDB 专属扩展）。
-- 单条语句，无需 statement-breakpoint。重跑设为相同 enum 定义，天然幂等。
ALTER TABLE `canvas_nodes` MODIFY COLUMN `type` ENUM('script','storyboard','prompt','image_gen','asset','video_task','ai_chat','note','audio','post_process','group','character','clip','merge','subtitle','overlay','subtitle_motion','smart_cut','pose_control','voice_clone','lip_sync','avatar','comfyui_image','comfyui_video','comfyui_workflow','image_edit','director','agent','super_agent','compare') NOT NULL;
