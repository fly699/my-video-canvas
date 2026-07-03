import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, makeTrpcClient } from "./src/lib/trpc";
import { AuthContext, clearToken, loadToken, saveToken } from "./src/lib/auth";
import { loadBaseUrl } from "./src/lib/config";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";

export default function App() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // tRPC/react-query 客户端。token 变化后重建，让新请求带上新的 Bearer（headers 每次读内存令牌即可，
  // 但重建可顺带清缓存、避免旧登录态残留）。
  const queryClient = useMemo(() => new QueryClient(), [token]);
  const trpcClient = useMemo(() => makeTrpcClient(), [token]);

  useEffect(() => {
    (async () => {
      await loadBaseUrl();
      const t = await loadToken();
      setToken(t);
      setReady(true);
    })();
  }, []);

  const auth = useMemo(
    () => ({
      token,
      signIn: (t: string) => { void saveToken(t); setToken(t); },
      signOut: () => { void clearToken(); setToken(null); },
    }),
    [token],
  );

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0f" }}>
        <ActivityIndicator color="#6ea8fe" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          {token ? <HomeScreen /> : <LoginScreen />}
        </QueryClientProvider>
      </trpc.Provider>
    </AuthContext.Provider>
  );
}
