-- Multimodal AI chat: store image/file attachments per message.
-- Existing rows keep NULL (treated as text-only at read time).
ALTER TABLE `chat_messages`
  ADD COLUMN `attachments` JSON NULL;
