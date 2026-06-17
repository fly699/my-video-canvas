import { describe, it, expect } from "vitest";
import { devInsertChatAttachment, devLinkAttachments, devListConversationAttachments } from "./_core/devStore";

// Regression for the write-IDOR: chat.sendMessage's linkAttachmentsToMessage took the
// raw client-supplied attachmentIds, so a member of conversation B could re-home
// conversation A's attachment rows (corrupting A's message↔attachment links and
// surfacing the file under B). The link must be scoped to the message's conversation.
describe("devLinkAttachments — 附件重链跨会话作用域（写-IDOR 回归）", () => {
  it("只重链属于目标会话的附件，拒绝改写他会话附件归属", () => {
    const aA = devInsertChatAttachment({ conversationId: 1, uploaderId: 7, storageKey: "chat/1/a", url: "/u", name: "a", mimeType: "image/png", size: 1, kind: "image" } as never);
    const aB = devInsertChatAttachment({ conversationId: 2, uploaderId: 7, storageKey: "chat/2/b", url: "/u", name: "b", mimeType: "image/png", size: 1, kind: "image" } as never);
    // 攻击者在会话 2 发消息(msgId=999)，企图把会话 1 的附件 aA 一并重链过来
    devLinkAttachments(999, [aA.id, aB.id], 2);
    const listB = devListConversationAttachments(2);
    const listA = devListConversationAttachments(1);
    expect(listB.find((x) => x.id === aB.id)!.messageId).toBe(999); // 本会话附件已链到消息
    expect(listA.find((x) => x.id === aA.id)!.messageId).toBeNull(); // 他会话附件未被改写
  });
});
