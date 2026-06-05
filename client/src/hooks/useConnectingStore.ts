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
  begin: (id: string, type: NodeType, handleType: "source" | "target") => void;
  end: () => void;
}

export const useConnectingStore = create<ConnectingState>((set) => ({
  fromType: null,
  fromId: null,
  fromHandleType: null,
  begin: (fromId, fromType, fromHandleType) => set({ fromId, fromType, fromHandleType }),
  end: () => set({ fromId: null, fromType: null, fromHandleType: null }),
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
