import { create } from "zustand";
import type { NodeType } from "../../../shared/types";
import { isConnectionValid } from "../lib/connectionRules";

/**
 * Transient state of an in-progress connection drag, used to highlight which
 * handles can legally receive (or feed) the connection. Set on connect-start,
 * cleared on connect-end. Kept in a store (not context) so only the handles that
 * read it re-render during the drag.
 */
interface ConnectingState {
  fromType: NodeType | null;
  fromId: string | null;
  fromHandleType: "source" | "target" | null;
  fromIsAudio: boolean; // 拖拽源是否为音频源（audio 节点或 type=audio 的素材）——驱动剪辑 audio-in/video-in 分辨
  begin: (id: string, type: NodeType, handleType: "source" | "target", isAudio?: boolean) => void;
  end: () => void;
}

export const useConnectingStore = create<ConnectingState>((set) => ({
  fromType: null,
  fromId: null,
  fromHandleType: null,
  fromIsAudio: false,
  begin: (fromId, fromType, fromHandleType, isAudio = false) => set({ fromId, fromType, fromHandleType, fromIsAudio: isAudio }),
  end: () => set({ fromId: null, fromType: null, fromHandleType: null, fromIsAudio: false }),
}));

export type HandleConnectState = "valid" | "invalid" | "muted" | undefined;
export interface ConnectHandleStates { target: HandleConnectState; source: HandleConnectState }

/** Pure decision: given the active drag and a candidate node, how should its
 * target/source handles render. Exported for testing. */
export function computeConnectState(
  drag: { fromType: NodeType | null; fromId: string | null; fromHandleType: "source" | "target" | null },
  nodeId: string,
  nodeType: NodeType,
): ConnectHandleStates {
  if (drag.fromType == null || drag.fromId === nodeId) return { target: undefined, source: undefined };
  if (drag.fromHandleType === "target") {
    // Drag started from a target handle → look for a valid SOURCE on this node.
    return { source: isConnectionValid(nodeType, drag.fromType) ? "valid" : "invalid", target: "muted" };
  }
  // Default (drag from a source handle) → look for a valid TARGET on this node.
  return { target: isConnectionValid(drag.fromType, nodeType) ? "valid" : "invalid", source: "muted" };
}

/**
 * For a candidate node during a connection drag, returns how its target and
 * source handles should look: the handle that could complete the drag lights up
 * "valid"/"invalid" (per the connection matrix), the other is "muted". Returns
 * empty (no override) when no drag is active or for the drag's origin node.
 */
export function useConnectState(nodeId: string, nodeType: NodeType): ConnectHandleStates {
  const fromType = useConnectingStore((s) => s.fromType);
  const fromId = useConnectingStore((s) => s.fromId);
  const fromHandleType = useConnectingStore((s) => s.fromHandleType);
  return computeConnectState({ fromType, fromId, fromHandleType }, nodeId, nodeType);
}

/** 剪辑节点某个具体输入桩(video-in / audio-in)在当前拖拽下的状态：匹配→valid、不匹配→muted。
 *  让「拖音频到剪辑」时只有 audio-in 亮绿、video-in 变暗，而不再两桩同绿误导落错。 */
export function computeClipHandleState(
  drag: { fromType: NodeType | null; fromId: string | null; fromHandleType: "source" | "target" | null; fromIsAudio: boolean },
  nodeId: string,
  handleId: "video-in" | "audio-in",
): HandleConnectState {
  if (drag.fromType == null || drag.fromId === nodeId) return undefined;
  if (drag.fromHandleType === "target") return "muted"; // 从目标桩拖出：剪辑输入不是源，一律 muted
  if (!isConnectionValid(drag.fromType, "clip")) return "invalid";
  const srcAudio = drag.fromType === "audio" || drag.fromIsAudio;
  const wantAudio = handleId === "audio-in";
  return wantAudio === srcAudio ? "valid" : "muted"; // 不匹配的桩 → muted（明确「不是这个」）
}

export function useClipHandleState(nodeId: string, handleId: "video-in" | "audio-in"): HandleConnectState {
  const fromType = useConnectingStore((s) => s.fromType);
  const fromId = useConnectingStore((s) => s.fromId);
  const fromHandleType = useConnectingStore((s) => s.fromHandleType);
  const fromIsAudio = useConnectingStore((s) => s.fromIsAudio);
  return computeClipHandleState({ fromType, fromId, fromHandleType, fromIsAudio }, nodeId, handleId);
}
