import React, { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { login, useAuth } from "../lib/auth";
import { getBaseUrlSync, loadBaseUrl, setBaseUrl } from "../lib/config";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [base, setBase] = useState(getBaseUrlSync());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadBaseUrl().then(setBase); }, []);

  const onLogin = async () => {
    setError(null);
    if (!email.trim() || !password) { setError("请填写邮箱和密码"); return; }
    setBusy(true);
    try {
      await setBaseUrl(base);
      const r = await login(email, password);
      if (r.ok && r.token) signIn(r.token);
      else setError(r.error || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0b0b0f" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 }}>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 8 }}>AI Video Canvas</Text>
        <Text style={{ color: "#8b8b95", fontSize: 13, marginBottom: 12 }}>登录你的账号</Text>

        <Field label="服务器地址" value={base} onChangeText={setBase} placeholder="https://avc.fordhev.store" autoCapitalize="none" keyboardType="url" />
        <Field label="邮箱" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
        <Field label="密码" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />

        {error ? <Text style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</Text> : null}

        <Pressable
          onPress={onLogin}
          disabled={busy}
          style={{ marginTop: 6, backgroundColor: busy ? "#2a4a8a" : "#3b82f6", borderRadius: 12, paddingVertical: 14, alignItems: "center" }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>登录</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#8b8b95", fontSize: 12 }}>{label}</Text>
      <TextInput
        placeholderTextColor="#55555f"
        style={{ color: "#fff", backgroundColor: "#17171d", borderColor: "#2a2a33", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 }}
        {...rest}
      />
    </View>
  );
}
