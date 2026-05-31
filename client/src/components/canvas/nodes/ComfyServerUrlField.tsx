import { useCallback } from "react";
import { RefreshCw, Plus, X } from "lucide-react";
import { toast } from "sonner";

/**
 * ComfyUI 服务器地址录入栏（多地址）。
 * - 输入框 + datalist：可手填或从已保存地址中快速选择。
 * - ＋按钮：把当前地址保存到列表（去重，随节点 payload 持久化）。
 * - 刷新按钮：刷新所有已录入地址的模型并集（由父级的 onRefresh 触发）。
 * - 地址 chips：点击选用、× 移除。
 */
export function ComfyServerUrlField({
  id, value, onChange, serverUrls, onChangeServerUrls,
  isFetching, onRefresh, accent, borderAccent, borderDefault, fieldBase,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  serverUrls: string[];
  onChangeServerUrls: (next: string[]) => void;
  /** 提供则渲染"刷新模型"按钮；工作流节点无模型拉取，可省略。 */
  isFetching?: boolean;
  onRefresh?: () => void;
  accent: string;
  borderAccent: string;
  borderDefault: string;
  fieldBase: React.CSSProperties;
}) {
  const saveCurrent = useCallback(() => {
    const u = value.trim();
    if (!u) { toast.info("请先填写服务器地址"); return; }
    if (serverUrls.includes(u)) { toast.info("该地址已在列表中"); return; }
    onChangeServerUrls([...serverUrls, u]);
    toast.success("已保存到地址列表");
  }, [value, serverUrls, onChangeServerUrls]);

  const remove = useCallback((u: string) => {
    onChangeServerUrls(serverUrls.filter((s) => s !== u));
  }, [serverUrls, onChangeServerUrls]);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <input
          placeholder="http://127.0.0.1:8188（留空使用全局默认）"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          list={`comfy-servers-${id}`}
          className="nodrag flex-1"
          style={fieldBase}
          onFocus={(e) => { e.currentTarget.style.borderColor = borderAccent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = borderDefault; }}
        />
        <datalist id={`comfy-servers-${id}`}>
          {serverUrls.map((u) => <option key={u} value={u} />)}
        </datalist>
        <button
          onClick={saveCurrent}
          className="nodrag flex-shrink-0 flex items-center justify-center rounded-md"
          title="保存当前地址到列表（供快速选择，随节点持久化）"
          style={{ width: 30, height: 30, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: accent, cursor: "pointer" }}
        >
          <Plus className="w-3 h-3" />
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isFetching}
            className="nodrag flex-shrink-0 flex items-center justify-center rounded-md"
            title="刷新模型列表（拉取所有已录入服务器的 checkpoint / lora 等并合并）"
            style={{
              width: 30, height: 30,
              background: "var(--c-surface)",
              border: "1px solid var(--c-bd2)",
              color: isFetching ? "var(--c-t4)" : accent,
              cursor: isFetching ? "wait" : "pointer",
            }}
          >
            <RefreshCw className={isFetching ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
          </button>
        )}
      </div>
      {serverUrls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {serverUrls.map((u) => {
            const active = value.trim() === u;
            return (
              <span key={u} className="inline-flex items-center gap-1 rounded-md"
                style={{ fontSize: 10, padding: "2px 4px 2px 7px", background: active ? `${accent}1f` : "var(--c-surface)", border: `1px solid ${active ? borderAccent : "var(--c-bd2)"}`, color: active ? accent : "var(--c-t2)" }}>
                <button onClick={() => onChange(u)} className="nodrag" style={{ cursor: "pointer", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`使用 ${u}`}>{u}</button>
                <button onClick={() => remove(u)} className="nodrag flex items-center" style={{ cursor: "pointer", color: "var(--c-t4)" }} title="从列表移除"><X style={{ width: 10, height: 10 }} /></button>
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
