import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    // 主动退出 → 设置一次性标记，登录页本次跳过「自动登录」，
    // 否则会立刻又自动登录回去，导致无法切换账号。
    try { sessionStorage.setItem("avc:login:skipAuto", "1"); } catch { /* ignore */ }
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // 把当前用户信息同步给 Manus 运行时宿主。必须在 effect 里做（副作用不该进 useMemo，StrictMode 会
  // 重算两次）；且加载中 meQuery.data 为 undefined 时 JSON.stringify 得到 JS undefined，setItem 会写成
  // 字面量 "undefined"——非法 JSON，宿主 JSON.parse 会抛错。故未确定前跳过，登出/无用户写 null。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (meQuery.data === undefined) return; // 仍在加载，别写非法 "undefined"
    try { localStorage.setItem("manus-runtime-user-info", JSON.stringify(meQuery.data ?? null)); } catch { /* ignore */ }
  }, [meQuery.data]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (!redirectPath || redirectPath === "#") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
