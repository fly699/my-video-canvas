import React from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { trpc } from "../lib/trpc";

type NodePayload = { status?: string; progress?: number; errorMessage?: string };

const STATUS_COLOR: Record<string, string> = {
  pending: "#8b8b95",
  processing: "#6ea8fe",
  done: "#4ade80",
  failed: "#ff6b6b",
};
const STATUS_LABEL: Record<string, string> = { pending: "排队中", processing: "生成中", done: "已完成", failed: "失败" };

export function ProjectDetailScreen({ projectId, projectName, onBack }: { projectId: number; projectName?: string; onBack: () => void }) {
  // 每 4s 刷新，实时看生成进度（简单可靠，v1 不接主命名空间 socket）。
  const q = trpc.nodes.list.useQuery({ projectId }, { refetchInterval: 4000 });

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0b0f", paddingTop: 56 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Pressable onPress={onBack} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "#2a2a33" }}>
          <Text style={{ color: "#8b8b95", fontSize: 13 }}>返回</Text>
        </Pressable>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", flex: 1 }} numberOfLines={1}>{projectName || `作品 #${projectId}`}</Text>
      </View>

      {q.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#6ea8fe" /></View>
      ) : q.isError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: "#ff6b6b" }}>加载失败：{q.error.message}</Text>
        </View>
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor="#6ea8fe" />}
          ListEmptyComponent={<Text style={{ color: "#55555f", textAlign: "center", marginTop: 40 }}>这个作品还没有节点</Text>}
          renderItem={({ item }) => {
            const payload = ((item.data as { payload?: NodePayload })?.payload) ?? {};
            const st = payload.status;
            const prog = typeof payload.progress === "number" ? Math.max(0, Math.min(100, payload.progress <= 1 ? payload.progress * 100 : payload.progress)) : null;
            return (
              <View style={{ backgroundColor: "#17171d", borderColor: "#2a2a33", borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600", flex: 1 }} numberOfLines={1}>{item.title || item.type}</Text>
                  {st ? <Text style={{ color: STATUS_COLOR[st] || "#8b8b95", fontSize: 12, fontWeight: "700" }}>{STATUS_LABEL[st] || st}</Text> : null}
                </View>
                <Text style={{ color: "#55555f", fontSize: 11 }}>{item.type}</Text>
                {st === "processing" && prog != null ? (
                  <View style={{ height: 6, backgroundColor: "#2a2a33", borderRadius: 3, overflow: "hidden" }}>
                    <View style={{ width: `${prog}%`, height: "100%", backgroundColor: "#6ea8fe" }} />
                  </View>
                ) : null}
                {st === "failed" && payload.errorMessage ? (
                  <Text style={{ color: "#ff8888", fontSize: 11 }} numberOfLines={2}>{payload.errorMessage}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
