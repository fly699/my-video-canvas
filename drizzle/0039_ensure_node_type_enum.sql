-- Defensive, idempotent: ensure canvas_nodes.type enum contains every current
-- node type — notably 'agent'. 0036 first added 'agent', but some production DBs
-- ended up without it after the 0038 migration trouble (or 0036 recorded without
-- effectively applying), which made agent nodes fail to insert ("Data truncated
-- for column 'type'") so they vanished on reload. drizzle only runs UNRECORDED
-- migrations, so a fresh migration is the only way to force the enum back to the
-- full list. Re-MODIFY to the complete enum is a no-op when already correct.
-- Single statement; standard MySQL/MariaDB syntax (no MariaDB-only extensions).
ALTER TABLE `canvas_nodes` MODIFY COLUMN `type` ENUM('script','storyboard','prompt','image_gen','asset','video_task','ai_chat','note','audio','post_process','group','character','clip','merge','subtitle','overlay','subtitle_motion','smart_cut','pose_control','voice_clone','lip_sync','avatar','comfyui_image','comfyui_video','comfyui_workflow','agent') NOT NULL;
