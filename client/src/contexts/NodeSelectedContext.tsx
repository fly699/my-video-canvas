import { createContext, useContext } from "react";

/** Provided by BaseNode; consumed by child node components to auto-collapse params when deselected */
export const NodeSelectedContext = createContext<boolean>(false);

export function useNodeSelected() {
  return useContext(NodeSelectedContext);
}
