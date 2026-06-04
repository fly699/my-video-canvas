-- Add the "agent" (Copilot) node type to the canvas_nodes type enum so agent
-- nodes persist. MODIFY the column to the full enum list with the new value
-- appended; existing rows are unaffected (non-breaking).
ALTER TABLE `canvas_nodes`
  MODIFY COLUMN `type` ENUM(
    'script','storyboard','prompt','image_gen','asset','video_task','ai_chat','note','audio','post_process','group','character','clip','merge','subtitle','overlay','subtitle_motion','smart_cut','pose_control','voice_clone','lip_sync','avatar','comfyui_image','comfyui_video','comfyui_workflow','agent'
  ) NOT NULL;
