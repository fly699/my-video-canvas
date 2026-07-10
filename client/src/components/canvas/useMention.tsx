import { useCallback, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { User, Mountain, Music, Film, Image as ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { uploadAssetFileForUrl, assetKindOf } from "@/lib/assetUpload";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getLibraryCharacters } from "../../lib/characterConditioning";
import { listCanvasMediaSources } from "../../lib/comfyWorkflowParams";

export interface MentionItem {
  name: string;
  kind: "person" | "scene" | "audio" | "video" | "image" | "upload";
  fromLibrary?: boolean;
  /** 素材库条目：选中时物化为画布素材节点再插入 @名字（@解析基于节点标题）。 */
  asset?: { name: string; url: string; type: "image" | "video" | "audio"; mimeType?: string; size?: number };
}

// ── 素材库候选缓存（模块级，30s TTL）─────────────────────────────────────────
// probe 是同步的，素材列表异步取：首次 @ 触发拉取，返回后若下拉仍开着由回调刷新。
// 检索方案：取最近 200 条（服务端按时间倒序），本地按「@关键词」子串过滤——素材再多
// 也是边输边搜秒级收敛；命中项带缩略图便于确认。
type LibAsset = { name: string; type: "image" | "video" | "audio"; url: string; mimeType?: string; size?: number };
let assetCache: { projectId: number | null; at: number; items: LibAsset[] } | null = null;
let assetFetching = false;
function getCachedAssets(projectId: number | null, onFresh: () => void, fetchList: (projectId: number | null) => Promise<LibAsset[]>): LibAsset[] {
  const fresh = assetCache && assetCache.projectId === projectId && Date.now() - assetCache.at < 30_000;
  if (!fresh && !assetFetching) {
    assetFetching = true;
    fetchList(projectId)
      .then((items) => { assetCache = { projectId, at: Date.now(), items }; onFresh(); })
      .catch(() => { /* 素材库不可用不影响角色引用 */ })
      .finally(() => { assetFetching = false; });
  }
  return assetCache && assetCache.projectId === projectId ? assetCache.items : [];
}

/** 标题须能当 @token 用（@探测按空白断词）：去空白、去扩展名、限长。 */
function sanitizeMentionTitle(raw: string): string {
  const base = raw.replace(/\.[a-zA-Z0-9]{1,5}$/, "").replace(/\s+/g, "_").trim();
  return (base || "素材").slice(0, 20);
}

/** 把素材物化为画布素材节点（同名同 URL 复用；重名冲突自动加序号），返回最终可 @ 的标题。 */
function materializeAssetNode(a: LibAsset): string {
  const store = useCanvasStore.getState();
  const want = sanitizeMentionTitle(a.name);
  // 已有同 URL 的素材节点 → 直接复用其标题（不重复建节点）
  for (const n of store.nodes) {
    const p = (n.data.payload ?? {}) as { url?: string };
    if (n.data.nodeType === "asset" && p.url === a.url && (n.data.title ?? "").trim()) return n.data.title!.trim();
  }
  const titles = new Set(store.nodes.map((n) => (n.data.title ?? "").trim()).filter(Boolean));
  let title = want; let i = 2;
  while (titles.has(title)) title = `${want}-${i++}`;
  // 摆位：现有节点包围盒右侧一列，避免压住内容
  let x = 120, y = 120;
  if (store.nodes.length) {
    x = Math.max(...store.nodes.map((n) => n.position.x)) + 420;
    y = Math.min(...store.nodes.map((n) => n.position.y));
  }
  const node = store.addNode("asset", { x, y });
  store.updateNodeTitle(node.id, title);
  store.updateNodeData(node.id, { name: title, type: a.type, url: a.url, mimeType: a.mimeType, size: a.size }, true);
  return title;
}

/** 可被「@」引用的角色 / 场景 + 独立音/视频节点：画布上的角色节点 + 全局角色库 + 画布上
 *  有标题的音/视频媒体节点。去重，画布优先。用快照读取，仅在用户输入「@」触发下拉时调用。 */
function listCanvasCharacters(): MentionItem[] {
  const nodes = useCanvasStore.getState().nodes;
  const out: MentionItem[] = [];
  const seen = new Set<string>();
  const add = (p: { characterKind?: string; name?: string; sceneName?: string }, fromLibrary: boolean) => {
    const kind: MentionItem["kind"] = (p.characterKind ?? "person") === "scene" ? "scene" : "person";
    const name = (kind === "scene" ? p.sceneName : p.name)?.trim();
    if (name && !seen.has(name)) { seen.add(name); out.push({ name, kind, fromLibrary }); }
  };
  for (const n of nodes) {
    if (n.data.nodeType !== "character") continue;
    add(n.data.payload as { characterKind?: string; name?: string; sceneName?: string }, false);
  }
  // 角色库补充：画布上没有同名节点时，也能 @ 引用库里的角色（无需先拖到画布）。
  for (const n of getLibraryCharacters()) {
    add(n.data.payload as { characterKind?: string; name?: string; sceneName?: string }, true);
  }
  // 独立音/视频媒体节点：@音频名 / @视频名（标题去重，已被角色占用的名字不再加）。
  for (const m of listCanvasMediaSources(nodes)) {
    if (!seen.has(m.name)) { seen.add(m.name); out.push({ name: m.name, kind: m.kind }); }
  }
  return out;
}

interface MentionState { open: boolean; query: string; start: number; items: MentionItem[]; active: number; rect: DOMRect | null }
const CLOSED: MentionState = { open: false, query: "", start: -1, items: [], active: 0, rect: null };

/**
 * 在文本框里输入「@」自动弹出角色/场景列表，方向键/回车选择后把名字插入文本。
 * 适配 textarea 与 input；与 NodeTextInput 的 IME 安全逻辑配合（select 通过 commit 写回）。
 */
export function useMention(
  enabled: boolean,
  elRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  commit: (next: string) => void,
) {
  const [st, setSt] = useState<MentionState>(CLOSED);
  const stRef = useRef(st); stRef.current = st;
  const utils = trpc.useUtils();

  const close = useCallback(() => setSt((s) => (s.open ? CLOSED : s)), []);

  const probeRef = useRef<() => void>(() => {});
  const fetchAssets = useCallback(async (projectId: number | null): Promise<LibAsset[]> => {
    // 项目素材 + 个人素材两路合并（项目内上传带 projectId、首页/其它项目上传入个人库，
    // 都应可 @ 引用），按 URL 去重、项目素材优先。
    const [proj, personal] = await Promise.all([
      projectId != null ? utils.client.assets.list.query({ projectId }).catch(() => []) : Promise.resolve([]),
      utils.client.assets.list.query({}).catch(() => []),
    ]);
    const seen = new Set<string>();
    const out: LibAsset[] = [];
    for (const r of [...proj, ...personal]) {
      if (r.type !== "image" && r.type !== "video" && r.type !== "audio") continue;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ name: r.name, type: r.type as LibAsset["type"], url: r.url, mimeType: r.mimeType ?? undefined, size: r.size ?? undefined });
      if (out.length >= 200) break;
    }
    return out;
  }, [utils]);

  // 探测光标前的「@查询」：从光标往回到最近的 @（中间不含空白/@），用它过滤候选。
  const probe = useCallback(() => {
    const el = elRef.current;
    if (!enabled || !el) { close(); return; }
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) { close(); return; }
    const query = m[1];
    const q = query.toLowerCase();
    const chars = listCanvasCharacters();
    // 素材库候选：排除画布上已能 @ 到的同名项（画布优先），标题按 token 规则清洗后展示。
    const projectId = useCanvasStore.getState().projectId ?? null;
    const lib = getCachedAssets(projectId, () => { if (stRef.current.open) probeRef.current(); }, fetchAssets);
    const canvasNames = new Set(chars.map((i) => i.name));
    // 同名素材（重复上传/项目+个人两库同名）只展示第一条——@token 是名字，重名无法区分引用。
    const libSeen = new Set<string>();
    const libItems: MentionItem[] = [];
    for (const a of lib) {
      const name = sanitizeMentionTitle(a.name);
      if (canvasNames.has(name) || libSeen.has(name)) continue;
      libSeen.add(name);
      libItems.push({ name, kind: a.type, fromLibrary: true, asset: a });
    }
    const pool = [...chars, ...libItems];
    // 限 7 条：候选区不出滚动条，固定底部的「上传」与全部候选同屏可见；再多靠输入过滤收敛。
    const filtered = (q ? pool.filter((i) => i.name.toLowerCase().includes(q)) : pool).slice(0, 7);
    // 「上传媒体」入口常驻最后一项：免先进素材库，上传即引用。
    const items: MentionItem[] = [...filtered, { name: "上传图片 / 媒体…", kind: "upload" }];
    setSt({ open: true, query, start: caret - m[0].length, items, active: 0, rect: el.getBoundingClientRect() });
  }, [enabled, elRef, close, fetchAssets]);
  probeRef.current = probe;

  /** 在（可能已闭合下拉的）当前光标处插入「@名字 」——覆盖 probe 时记录的 @查询段。 */
  const insertToken = useCallback((name: string, start: number) => {
    const el = elRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const from = start >= 0 && start <= el.value.length && el.value[start] === "@" ? start : caret;
    const insert = "@" + name + " ";
    const next = el.value.slice(0, from) + insert + el.value.slice(Math.max(caret, from));
    commit(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = from + insert.length;
      try { el.setSelectionRange(pos, pos); } catch { /* input type may not support */ }
    });
  }, [elRef, commit]);

  const select = useCallback((item: MentionItem) => {
    const el = elRef.current; const s = stRef.current;
    if (!el || s.start < 0) { close(); return; }
    // 「上传媒体」：文件选择 → 上传入素材库 → 物化素材节点 → 插入 @标题（异步完成后插入）。
    if (item.kind === "upload") {
      const start = s.start;
      close();
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,video/*,audio/*";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const kind = assetKindOf(file.type || "");
        if (kind === "other") { toast.error("仅支持图片 / 视频 / 音频"); return; }
        const tid = toast.loading(`上传「${file.name}」…`);
        const projectId = useCanvasStore.getState().projectId ?? undefined;
        const url = await uploadAssetFileForUrl(utils.client, file, projectId);
        toast.dismiss(tid);
        if (!url) return; // uploadAssetFileForUrl 已自带错误 toast
        const title = materializeAssetNode({ name: file.name, type: kind, url, mimeType: file.type || undefined, size: file.size });
        assetCache = null; // 让下次 @ 立即看到新素材
        insertToken(title, start);
        toast.success(`已引用 @${title}（素材已入库并生成画布素材节点）`);
      };
      input.click();
      return;
    }
    // 素材库条目：物化为画布素材节点（@解析基于节点标题），再插入其最终标题。
    if (item.asset) {
      const title = materializeAssetNode(item.asset);
      const start = s.start;
      close();
      insertToken(title, start);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    // 保留「@」前缀，插入成 @角色名（s.start 指向「@」位置，覆盖原「@查询」）
    const insert = "@" + item.name + " ";
    const next = el.value.slice(0, s.start) + insert + el.value.slice(caret);
    commit(next);
    close();
    requestAnimationFrame(() => {
      el.focus();
      const pos = s.start + insert.length;
      try { el.setSelectionRange(pos, pos); } catch { /* input type may not support */ }
    });
  }, [elRef, commit, close, insertToken, utils]);

  // 下拉打开时拦截上下/回车/Tab/Esc 做导航与选择。
  const onKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    const s = stRef.current;
    if (!s.open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setSt((x) => ({ ...x, active: (x.active + 1) % x.items.length })); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSt((x) => ({ ...x, active: (x.active - 1 + x.items.length) % x.items.length })); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(s.items[s.active]); return true; }
    if (e.key === "Escape") { e.preventDefault(); close(); return true; }
    return false;
  }, [select, close]);

  // 视口下方空间不足时向上翻，避免靠近屏幕底部的节点其下拉被裁切、看不到也选不了。
  const MENTION_MENU_MAX = 310;
  const flipUp = !!st.rect && typeof window !== "undefined" && st.rect.bottom + MENTION_MENU_MAX + 8 > window.innerHeight && st.rect.top > MENTION_MENU_MAX;
  const dropdown = st.open && st.rect ? createPortal(
    <div
      className="nodrag nowheel"
      onMouseDown={(e) => e.preventDefault()} // 防止输入框失焦
      style={{
        position: "fixed", left: st.rect.left, zIndex: 100002,
        ...(flipUp ? { bottom: window.innerHeight - st.rect.top + 4 } : { top: st.rect.bottom + 4 }),
        minWidth: Math.max(180, st.rect.width), maxWidth: 320, maxHeight: MENTION_MENU_MAX,
        // 「上传」项 sticky 固定底部：容器不滚，候选列表单独滚——上传入口始终可见。
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 10,
        boxShadow: "0 12px 36px oklch(0 0 0 / 0.45)", padding: 4,
      }}
    >
      <div style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "3px 8px 4px", flexShrink: 0 }}>选择角色 / 素材引用，或直接上传（输入即搜索）</div>
      <div className="nowheel" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {st.items.filter((it) => it.kind !== "upload").map((it, i) => (
        <button
          key={it.kind + it.name + (it.asset?.url ?? "")}
          onClick={() => select(it)}
          onMouseEnter={() => setSt((x) => ({ ...x, active: i }))}
          className="nodrag flex items-center gap-2 w-full text-left"
          style={{
            padding: "6px 8px", borderRadius: 7, cursor: "pointer", border: "none",
            background: i === st.active ? "oklch(0.66 0.18 30 / 0.14)" : "transparent",
            color: it.kind === "upload" ? "oklch(0.72 0.16 250)" : "var(--c-t1)", fontSize: 12,
            ...(it.kind === "upload" ? { borderTop: "1px solid var(--c-bd2)", borderRadius: 0, marginTop: 2 } : {}),
          }}
        >
          {it.kind === "upload"
            ? <Upload className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.72 0.16 250)" }} />
            : it.asset && it.kind === "image"
            ? <img src={it.asset.url} alt="" className="flex-shrink-0" style={{ width: 22, height: 22, objectFit: "cover", borderRadius: 4, border: "1px solid var(--c-bd2)" }} loading="lazy" />
            : it.kind === "scene"
            ? <Mountain className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
            : it.kind === "audio"
            ? <Music className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.66 0.18 30)" }} />
            : it.kind === "video"
            ? <Film className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.62 0.16 240)" }} />
            : it.kind === "image"
            ? <ImageIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.72 0.20 330)" }} />
            : <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.66 0.18 30)" }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
          <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--c-t4)", flexShrink: 0 }}>
            {it.kind === "upload" ? "本地文件" :
              (it.asset ? "库·" : "") + (it.kind === "scene" ? "场景" : it.kind === "audio" ? "音频" : it.kind === "video" ? "视频" : it.kind === "image" ? "图像" : "人物")}
          </span>
        </button>
      ))}
      </div>
      {/* 「上传」入口固定在底部（不随候选列表滚动，始终可见） */}
      {(() => {
        const upIdx = st.items.findIndex((x) => x.kind === "upload");
        if (upIdx < 0) return null;
        const it = st.items[upIdx];
        return (
          <button
            onClick={() => select(it)}
            onMouseEnter={() => setSt((x) => ({ ...x, active: upIdx }))}
            className="nodrag flex items-center gap-2 w-full text-left"
            style={{
              flexShrink: 0, padding: "6px 8px", cursor: "pointer", border: "none", borderTop: "1px solid var(--c-bd2)", marginTop: 2,
              background: upIdx === st.active ? "oklch(0.66 0.18 30 / 0.14)" : "transparent",
              color: "oklch(0.72 0.16 250)", fontSize: 12,
            }}
          >
            <Upload className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.72 0.16 250)" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
            <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--c-t4)", flexShrink: 0 }}>本地文件</span>
          </button>
        );
      })()}
    </div>,
    document.body,
  ) : null;

  return { probe, onKeyDown, close, dropdown, open: st.open };
}
