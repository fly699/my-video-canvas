import { createContext, useContext } from "react";
import type { WorkflowRunState } from "../hooks/useWorkflowRunner";

export type { WorkflowRunState };

const WorkflowRunContext = createContext<WorkflowRunState>({
  running: false,
  currentNodeId: null,
  completedIds: [],
  failedIds: [],
  runnableCount: 0,
  nodeStates: {},
});

export const WorkflowRunProvider = WorkflowRunContext.Provider;

export function useWorkflowRunState(): WorkflowRunState {
  return useContext(WorkflowRunContext);
}
