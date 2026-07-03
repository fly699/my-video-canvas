import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { HomeScreen } from "./HomeScreen";
import { ChatScreen } from "./ChatScreen";
import { UploadScreen } from "./UploadScreen";

type Tab = "works" | "chat" | "upload";

// 轻量底部 tab（不引 react-navigation，减小依赖）。v1 三页：作品 / AI 助手 / 上传素材。
export function Main() {
  const [tab, setTab] = useState<Tab>("works");
  return (
    <View style={{ flex: 1, backgroundColor: "#0b0b0f" }}>
      <View style={{ flex: 1 }}>{tab === "works" ? <HomeScreen /> : tab === "chat" ? <ChatScreen /> : <UploadScreen />}</View>
      <View style={{ flexDirection: "row", borderTopColor: "#1c1c22", borderTopWidth: 1, backgroundColor: "#0b0b0f", paddingBottom: 22, paddingTop: 8 }}>
        <TabButton label="作品" active={tab === "works"} onPress={() => setTab("works")} />
        <TabButton label="AI 助手" active={tab === "chat"} onPress={() => setTab("chat")} />
        <TabButton label="上传素材" active={tab === "upload"} onPress={() => setTab("upload")} />
      </View>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}>
      <Text style={{ color: active ? "#6ea8fe" : "#55555f", fontSize: 13, fontWeight: active ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}
