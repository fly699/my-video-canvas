-- Serverless group room keys, wrapped per-member (server stores ciphertext only, cannot
-- decrypt). One row per (conversation, member). Single statement → no breakpoint needed.
-- IF NOT EXISTS keeps it idempotent / retry-safe on both MySQL 8 and MariaDB.
CREATE TABLE IF NOT EXISTS `chat_room_keys` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversationId` int NOT NULL,
  `memberUserId` int NOT NULL,
  `senderPubJwk` json NOT NULL,
  `wrappedKey` json NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `chat_room_keys_id` PRIMARY KEY(`id`),
  CONSTRAINT `chat_room_keys_conv_member_uniq` UNIQUE(`conversationId`,`memberUserId`)
);
