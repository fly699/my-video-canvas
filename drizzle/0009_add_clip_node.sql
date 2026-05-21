ALTER TABLE `canvas_nodes` MODIFY COLUMN `type` enum('script','storyboard','prompt','image_gen','asset','video_task','ai_chat','note','audio','post_process','group','character','clip') NOT NULL;
