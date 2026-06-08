import { useCallback, type ReactNode } from "react";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import type { ReferenceImage } from "../../../shared/types";
import { useCanvasStore } from "./useCanvasStore";
import { usePersistentState } from "./usePersistentState";
import { trpc } from "@/lib/trpc";
import { ReferenceImageStrip, type StripItem } from "../components/canvas/ReferenceImageStrip";
import { openNodeImage } from "../components/canvas/NodeImageLightbox";

interface Payload { referenceImageUrl?: string; additionalImageUrls?: string[] }

/**
 * 给「非 useReferenceImages 数据模型」的节点（角色 / ComfyUI 图像·视频）接同款
 * 左侧吸附参考图预览窗 ReferenceImageStrip，与节点原有内嵌预览**并存且同源同步**。
 *
 * - mode "multi"：读写 referenceImageUrl(主图) + additionalImageUrls(备用视角)。拖动排序＝
 *   改变主图/优先级，图片集合不变（characterReferenceImages 取去重集合，顺序只决定优先级），
 *   与内嵌「备用视角网格」同读同写、互不破坏。改主图时清掉 referenceStorageKey（与原有
 *   onAssetImageDrop 行为一致）。
 * - mode "single"：只读写 referenceImageUrl（单张参考；插入即替换，排序无意义）。绝不触碰
 *   IPAdapter 多图 / img2img 模板等其它逻辑。
 *
 * 返回 { images, toggle(放 BaseNode headerRight), strip(渲染为 BaseNode 子节点) }。
 */
export function useSimpleRefStrip(
  id: string,
  payload: Payload,
  mode: "multi" | "single",
  opts?: { accent?: string; maxAdditional?: number; open?: boolean; onOpenChange?: (v: boolean) => void; onHoverChange?: (hovering: boolean) => void; onPin?: () => void; title?: string; mainLabel?: string; extraItems?: StripItem[] },
): { images: StripItem[]; open: boolean; toggle: ReactNode; strip: ReactNode } {
  const accent = opts?.accent ?? "oklch(0.72 0.20 330)";
  const maxAdditional = opts?.maxAdditional ?? 8;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // 吸附窗展开/收起状态持久化（按节点 id 存 localStorage），刷新/折叠后保留。
  // 受控模式（传入 open/onOpenChange）下交由外部统一管理（用于「参考图/提示词」循环按钮）。
  const [openInternal, setOpenInternal] = usePersistentState<boolean>(`ui:refstrip:${id}`, false, { crossTab: false });
  const controlled = opts?.open !== undefined;
  const open = controlled ? (opts!.open as boolean) : openInternal;
  const setOpen = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === "function" ? (v as (p: boolean) => boolean)(open) : v;
    if (controlled) opts!.onOpenChange?.(next); else setOpenInternal(next);
  }, [controlled, opts, open, setOpenInternal]);
  const uploadMut = trpc.upload.uploadImage.useMutation();

  const combine = (p: Payload): string[] => {
    const main = (p.referenceImageUrl ?? "").trim();
    const extra = mode === "multi" ? (p.additionalImageUrls ?? []).map((u) => (u ?? "").trim()).filter(Boolean) : [];
    return Array.from(new Set([main, ...extra].filter(Boolean)));
  };

  const mainLabel = opts?.mainLabel ?? "参考图";
  const ownImages: StripItem[] = combine(payload).map((u) => ({ id: u, url: u, source: "url", label: mainLabel, removable: true }));
  // 自有参考图 + 「参与本节点」的角色/场景图（extraItems，只读不可删），统一展示。
  const images: StripItem[] = [...ownImages, ...(opts?.extraItems ?? [])];
  const stripTitle = opts?.title ?? "参考图";

  const live = useCallback((): string[] => {
    const p = (useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.payload ?? payload) as Payload;
    return combine(p);
  }, [id, payload, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeBack = useCallback((next: string[]) => {
    const dedup = Array.from(new Set(next.filter(Boolean)));
    if (mode === "multi") {
      // 主图变了 → 清掉旧 storageKey（与 onAssetImageDrop 一致）。
      updateNodeData(id, { referenceImageUrl: dedup[0], additionalImageUrls: dedup.slice(1, 1 + maxAdditional), referenceStorageKey: undefined });
    } else {
      updateNodeData(id, { referenceImageUrl: dedup[0] });
    }
  }, [id, mode, maxAdditional, updateNodeData]);

  const removeId = useCallback((rid: string) => writeBack(live().filter((u) => u !== rid)), [live, writeBack]);

  const moveId = useCallback((rid: string, to: number) => {
    if (mode === "single") return; // 单张无排序
    const cur = live();
    const from = cur.indexOf(rid);
    if (from < 0) return;
    const n = cur.slice();
    const [x] = n.splice(from, 1);
    n.splice(Math.max(0, Math.min(to, n.length)), 0, x);
    writeBack(n);
  }, [live, writeBack, mode]);

  const insertUrls = useCallback((urls: string[], index: number) => {
    const cur = live();
    const add = urls.map((u) => (u ?? "").trim()).filter((u) => u.length > 0 && !cur.includes(u));
    if (!add.length) return;
    if (mode === "single") { writeBack([add[0]]); return; }
    const at = Math.max(0, Math.min(index, cur.length));
    writeBack([...cur.slice(0, at), ...add, ...cur.slice(at)]);
  }, [live, writeBack, mode]);

  const onDropFiles = useCallback(async (files: File[], index: number) => {
    const out: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 16 * 1024 * 1024) { toast.error("图片不能超过 16MB"); continue; }
      try {
        const base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(",")[1]);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        const up = await uploadMut.mutateAsync({ base64, mimeType: f.type, filename: f.name });
        if (up.url) out.push(up.url);
      } catch (e) { toast.error("上传失败：" + (e instanceof Error ? e.message : String(e))); }
    }
    if (out.length) insertUrls(out, index);
  }, [uploadMut, insertUrls]);

  const toggle: ReactNode = images.length >= 1 ? (
    <button
      onClick={() => setOpen((v) => !v)}
      className="nodrag flex items-center gap-1"
      style={{ fontSize: 10, color: open ? accent : "var(--c-t3)", border: `1px solid ${open ? accent : "var(--c-bd2)"}`, borderRadius: 6, padding: "1px 6px" }}
      title="展开/收起左侧参考图列表"
    >
      <Layers style={{ width: 11, height: 11 }} /> {images.length}
    </button>
  ) : null;

  const strip: ReactNode = (
    <ReferenceImageStrip
      images={images}
      open={open}
      accent={accent}
      title={stripTitle}
      onClose={() => setOpen(false)}
      onRemove={removeId}
      onMove={moveId}
      onInsertUrls={(urls, index) => insertUrls(urls, index)}
      onDropFiles={(files, index) => void onDropFiles(files, index)}
      onZoom={(i) => { const u = images[i]?.url; if (u) openNodeImage(u); }}
      onHoverChange={opts?.onHoverChange}
      onPin={opts?.onPin}
    />
  );

  return { images, open, toggle, strip };
}
