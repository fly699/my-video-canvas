import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { trpc } from "../lib/trpc";
import { getBaseUrlSync } from "../lib/config";

// 拍照 / 相册 → 上传到 upload.uploadImage（base64，无 data: 前缀，正好是 expo-image-picker 的产物）。
export function UploadScreen() {
  const upload = trpc.upload.uploadImage.useMutation();
  const [items, setItems] = useState<{ url: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const pickAndUpload = async (source: "camera" | "library") => {
    try {
      const perm = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("需要权限", source === "camera" ? "请允许使用相机" : "请允许访问相册"); return; }

      const res = source === "camera"
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset?.base64) { Alert.alert("失败", "未取到图片数据"); return; }

      setBusy(true);
      const r = await upload.mutateAsync({
        base64: asset.base64,
        mimeType: asset.mimeType || "image/jpeg",
        filename: asset.fileName || undefined,
      });
      // 相对路径补成绝对，便于预览
      const url = /^https?:\/\//i.test(r.url) ? r.url : `${getBaseUrlSync()}${r.url.startsWith("/") ? "" : "/"}${r.url}`;
      setItems((prev) => [{ url }, ...prev]);
    } catch (e) {
      Alert.alert("上传失败", (e as Error).message.slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0b0f", paddingTop: 56 }}>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700", paddingHorizontal: 20, paddingBottom: 12 }}>上传素材</Text>
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Btn label="拍照" onPress={() => pickAndUpload("camera")} disabled={busy} />
        <Btn label="从相册选" onPress={() => pickAndUpload("library")} disabled={busy} />
        {busy ? <ActivityIndicator color="#6ea8fe" style={{ marginLeft: 6 }} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {items.length === 0 ? (
          <Text style={{ color: "#55555f", textAlign: "center", marginTop: 40 }}>拍张照或从相册选一张，上传为素材</Text>
        ) : (
          items.map((it, i) => (
            <View key={i} style={{ borderRadius: 12, overflow: "hidden", borderColor: "#2a2a33", borderWidth: 1 }}>
              <Image source={{ uri: it.url }} style={{ width: "100%", height: 220, backgroundColor: "#17171d" }} resizeMode="cover" />
              <Text style={{ color: "#55555f", fontSize: 10.5, padding: 8 }} numberOfLines={1}>{it.url}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ backgroundColor: disabled ? "#2a2a33" : "#3b82f6", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 }}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}
