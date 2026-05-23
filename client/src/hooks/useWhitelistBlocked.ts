import { create } from "zustand";
import { TRPCClientError } from "@trpc/client";

interface WhitelistBlockedStore {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useWhitelistBlocked = create<WhitelistBlockedStore>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));

/** Returns true when the error is a whitelist FORBIDDEN rejection from the server. */
export function isWhitelistError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TRPCClientError) {
    return (
      (error.data?.code === "FORBIDDEN" || error.message?.includes("FORBIDDEN")) &&
      error.message?.includes("白名单")
    );
  }
  if (error instanceof Error) {
    return error.message.includes("白名单");
  }
  return false;
}

/** Call from anywhere (outside React) to trigger the dialog when a whitelist error is detected. */
export function handleWhitelistError(error: unknown): boolean {
  if (!isWhitelistError(error)) return false;
  useWhitelistBlocked.getState().show();
  return true;
}
