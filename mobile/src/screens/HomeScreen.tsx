import React, { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { getBaseUrlSync } from "../lib/config";
import { ProjectDetailScreen } from "./ProjectDetailScreen";

export function HomeScreen() {
  const { signOut } = useAuth();
  const [opened, setOpened] = useState<{ id: number; name?: string } | null>(null);
  if (opened) return <ProjectDetailScreen projectId={opened.id} projectName={opened.name} onBack={() => setOpened(null)} />;
  // 这个受保护查询能成功返回，就证明 Bearer 鉴权端到端打通了（同时是「作品浏览」v1 的起点）。
  // 注意：画布/作品路由在 appRouter 里挂为 `projects`（文件名是 canvas.ts，但挂载键是 projects）。
  const q = trpc.projects.list.useQuery(undefined, { retry: 1 });

  const projects = [
    ...(q.data?.owned ?? []).map((p) => ({ ...p, _mine: true })),
    ...(q.data?.shared ?? []).map((p) => ({ ...p, _mine: false })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0b0f", paddingTop: 56 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 }}>
        <View>
          <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>我的作品</Text>
          <Text style={{ color: "#55555f", fontSize: 11 }}>{getBaseUrlSync()}</Text>
        </View>
        <Pressable onPress={signOut} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#2a2a33" }}>
          <Text style={{ color: "#8b8b95", fontSize: 12 }}>退出登录</Text>
        </Pressable>
      </View>

      {q.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#6ea8fe" />
        </View>
      ) : q.isError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
          <Text style={{ color: "#ff6b6b", fontSize: 14, textAlign: "center" }}>加载失败：{q.error.message}</Text>
          <Text style={{ color: "#55555f", fontSize: 12, textAlign: "center" }}>请检查服务器地址、网络，或重新登录。</Text>
          <Pressable onPress={() => q.refetch()} style={{ marginTop: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: "#3b82f6" }}>
            <Text style={{ color: "#fff", fontSize: 13 }}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor="#6ea8fe" />}
          ListEmptyComponent={<Text style={{ color: "#55555f", textAlign: "center", marginTop: 40 }}>还没有作品。去电脑端画布新建一个吧。</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => setOpened({ id: item.id, name: item.name })} style={{ backgroundColor: "#17171d", borderColor: "#2a2a33", borderWidth: 1, borderRadius: 12, padding: 14 }}>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }} numberOfLines={1}>{item.name || "未命名"}</Text>
              <Text style={{ color: "#55555f", fontSize: 11, marginTop: 4 }}>{item._mine ? "我的" : "共享给我"} · #{item.id} · 查看生成进度 ›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
