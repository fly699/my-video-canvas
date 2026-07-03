import React, { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useAuth } from "../lib/auth";
import { getBaseUrlSync, setBaseUrl } from "../lib/config";

export function SettingsScreen() {
  const { signOut } = useAuth();
  const [base, setBase] = useState(getBaseUrlSync());

  const onSaveBase = async () => {
    const u = base.trim();
    if (!/^https?:\/\/.+/i.test(u)) { Alert.alert("地址无效", "请填 http(s):// 开头的完整地址"); return; }
    await setBaseUrl(u);
    // 服务器地址在 tRPC 客户端创建时读取，改后需重登录才生效——直接退出登录，让用户对新服务器登录。
    Alert.alert("已保存", "服务器地址已更新，请重新登录以生效。", [{ text: "去登录", onPress: () => signOut() }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0b0f", paddingTop: 56, padding: 20, gap: 18 }}>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>设置</Text>

      <View style={{ gap: 8 }}>
        <Text style={{ color: "#8b8b95", fontSize: 12 }}>服务器地址</Text>
        <TextInput
          value={base}
          onChangeText={setBase}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://avc.fordhev.store"
          placeholderTextColor="#55555f"
          style={{ color: "#fff", backgroundColor: "#17171d", borderColor: "#2a2a33", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 }}
        />
        <Pressable onPress={onSaveBase} style={{ backgroundColor: "#3b82f6", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>保存服务器地址</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />

      <Pressable onPress={() => signOut()} style={{ borderColor: "#5a2a2a", borderWidth: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" }}>
        <Text style={{ color: "#ff8888", fontWeight: "700" }}>退出登录</Text>
      </Pressable>
    </View>
  );
}
