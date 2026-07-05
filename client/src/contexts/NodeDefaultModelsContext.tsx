import { createContext, useContext, useMemo } from "react";
import type { NodeType } from "../../../shared/types";
import {
  resolveNodeModel,
  type NodeDefaultModelsConfig,
  type SystemDefaultModels,
  type ModelSlot,
} from "../../../shared/nodeDefaultModels";

// 模块级活动配置快照：让非 React 代码（zustand store 的 getDefaultPayload）也能读到
// 当前项目的「节点默认模型」配置 + 管理员的「系统默认模型」。Provider 挂载时写入。
let _activeConfig: NodeDefaultModelsConfig | null = null;
let _activeSystem: SystemDefaultModels | null = null;
/** 解析活动项目的节点默认模型（供节点新建工厂等非 React 处调用）。
 *  优先级：项目 perSlot > 项目 category > 系统默认(管理员) > 出厂默认。 */
export function resolveActiveNodeModel(nodeType: NodeType, slot: ModelSlot): string {
  return resolveNodeModel(_activeConfig, nodeType, slot, _activeSystem);
}

/**
 * 项目级「节点默认模型」上下文。
 * - config：当前项目的配置（来自 projects.defaultModels，可为空）。
 * - resolve：解析某节点某槽位应使用的默认模型（perSlot > category > 出厂）。
 * - setConfig：持久化新配置（由 Provider 注入，内部走 trpc.projects.update）。
 * - readOnly：仅查看者不可改。
 *
 * 节点可能渲染在 Provider 之外（组件库 showcase、单测）——此时回退到出厂默认且只读。
 */
interface NodeDefaultModelsCtx {
  config: NodeDefaultModelsConfig | null;
  resolve: (nodeType: NodeType, slot: ModelSlot) => string;
  setConfig: (next: NodeDefaultModelsConfig) => void;
  readOnly: boolean;
}

const Ctx = createContext<NodeDefaultModelsCtx | null>(null);

export function NodeDefaultModelsProvider({
  config,
  systemDefaults = null,
  onChange,
  readOnly,
  children,
}: {
  config: NodeDefaultModelsConfig | null;
  /** 管理员的「系统默认模型」（按槽位），作用于项目配置与出厂默认之间。 */
  systemDefaults?: SystemDefaultModels | null;
  onChange: (next: NodeDefaultModelsConfig) => void;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  // 同步模块级快照（渲染期赋值即可——总是反映最新已加载配置；非 React 工厂读它）。
  _activeConfig = config;
  _activeSystem = systemDefaults;
  const value = useMemo<NodeDefaultModelsCtx>(
    () => ({
      config,
      resolve: (nodeType, slot) => resolveNodeModel(config, nodeType, slot, systemDefaults),
      setConfig: onChange,
      readOnly,
    }),
    [config, systemDefaults, onChange, readOnly],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNodeDefaultModels(): NodeDefaultModelsCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // 出厂默认兜底（无 Provider 时）——仍读模块级系统默认快照，保证与项目内一致。
  return {
    config: null,
    resolve: (nodeType, slot) => resolveNodeModel(null, nodeType, slot, _activeSystem),
    setConfig: () => {},
    readOnly: true,
  };
}
