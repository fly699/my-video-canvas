import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import type { Socket } from "socket.io-client";
import { trpc } from "../lib/trpc";
import { connectChatSocket } from "../lib/socket";

export function ChatScreen() {
  const [convId, setConvId] = useState<number | null>(null);
  const [assistantId, setAssistantId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<FlatList>(null);

  const openAssistant = trpc.chat.openAssistant.useMutation();
  const send = trpc.chat.sendToAssistant.useMutation();
  const msgs = trpc.chat.getMessages.useQuery(
    { conversationId: convId!, limit: 60 },
    { enabled: convId != null, refetchOnWindowFocus: false },
  );

  // 进入即打开（或新建）与 AI 助手的会话。
  useEffect(() => {
    (async () => {
      try {
        const r = await openAssistant.mutateAsync();
        setConvId(r.id);
        setAssistantId(r.assistantUserId);
      } catch { /* 顶层 UI 会显示重试 */ }
    })();
  }, []);

  // socket：连上后 join 会话房间，收到新消息就从服务器权威重载（不单押 socket，见项目血泪教训）。
  useEffect(() => {
    if (convId == null) return;
    const s = connectChatSocket();
    socketRef.current = s;
    s.on("connect", () => s.emit("chat:join", { conversationId: convId }));
    const onNew = (m: { conversationId: number }) => { if (m.conversationId === convId) void msgs.refetch(); };
    s.on("chat:message:new", onNew);
    s.on("conversation:cleared", (p: { conversationId: number }) => { if (p.conversationId === convId) void msgs.refetch(); });
    return () => { try { s.emit("chat:leave", { conversationId: convId }); s.off("chat:message:new", onNew); s.disconnect(); } catch { /* ignore */ } };
  }, [convId]);

  useEffect(() => {
    if ((msgs.data?.length ?? 0) > 0) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [msgs.data?.length]);

  const onSend = async () => {
    const content = text.trim();
    if (!content || convId == null || send.isPending) return;
    setText("");
    try {
      await send.mutateAsync({ conversationId: convId, content });
      await msgs.refetch(); // 兜底重载，显示自己刚发的；AI 回复稍后经 socket 触发再次重载
    } catch { setText(content); }
  };

  if (convId == null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0f" }}>
        {openAssistant.isError ? <Text style={{ color: "#ff6b6b" }}>打开助手失败，请稍后重试</Text> : <ActivityIndicator color="#6ea8fe" />}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0b0b0f", paddingTop: 56 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700", paddingHorizontal: 20, paddingBottom: 10 }}>AI 助手</Text>
      <FlatList
        ref={listRef}
        data={msgs.data ?? []}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item }) => {
          const mine = item.senderId !== assistantId;
          return (
            <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", backgroundColor: mine ? "#3b82f6" : "#17171d", borderColor: "#2a2a33", borderWidth: mine ? 0 : 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 }}>
              <Text style={{ color: mine ? "#fff" : "#e6e6ea", fontSize: 15, lineHeight: 21 }}>{item.content}</Text>
            </View>
          );
        }}
        ListEmptyComponent={msgs.isLoading ? <ActivityIndicator color="#6ea8fe" style={{ marginTop: 40 }} /> : <Text style={{ color: "#55555f", textAlign: "center", marginTop: 40 }}>和 AI 助手说点什么吧</Text>}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopColor: "#1c1c22", borderTopWidth: 1 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="输入消息…"
          placeholderTextColor="#55555f"
          multiline
          style={{ flex: 1, color: "#fff", backgroundColor: "#17171d", borderColor: "#2a2a33", borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120, fontSize: 15 }}
        />
        <Pressable onPress={onSend} disabled={send.isPending || !text.trim()} style={{ backgroundColor: text.trim() ? "#3b82f6" : "#2a2a33", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11 }}>
          {send.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>发送</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
