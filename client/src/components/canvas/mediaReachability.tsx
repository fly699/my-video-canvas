import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * 参考图"上游可达性"预警工具。
 *
 * 背景：本项目真正用参考图的两家上游 Poyo / Higgsfield 都是 URL-only —— 没有上传接口，
 * 只接受一个它们自己去 fetch 的 URL。若部署的存储未对公网开放（既未配 S3_PUBLIC_ENDPOINT，
 * 也非 Forge 后端），上游就拉不到我们下发的参考图 URL，带参考图的生成必然失败且扣积分。
 * 这里在前端给出预警，避免用户白花积分。
 */

/**
 * 该模型是否依赖"上游能 fetch 我们的媒体 URL"。
 * - poyo* / hf_*：URL-only 上游，需要公网可达。
 * - manus_forge：Forge 图像返回 base64 内联，不下发 URL，豁免。
 * - ComfyUI 等自建：由用户自己的 ComfyUI 拉取，豁免。
 */
export function providerNeedsPublicMedia(model: string | undefined | null): boolean {
  if (!model) return false;
  return model.startsWith("poyo") || model.startsWith("hf_");
}

/**
 * 该 URL 是否已是"上游能直接 fetch"的外部公网地址。
 * `resolveToAbsoluteUrl`（server/storage.ts）对任何 http(s) 绝对地址原样放行，
 * 所以指向**非本应用源**的 http(s) URL（AI 平台 CDN、用户粘贴的公网链接等）上游能拉，
 * 无需警告。内部代理路径（`/manus-storage/...`、同源、相对路径）和 `data:` / `blob:`
 * 则不保证公网可达 —— 这些才需要按部署可达性判断。
 */
export function isExternalPublicUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false; // 相对路径 / data: / blob:
  try {
    const u = new URL(url);
    if (typeof window !== "undefined" && u.origin === window.location.origin) return false; // 同源 = 走内部代理
    return true;
  } catch {
    return false;
  }
}

/**
 * 是否应针对这次"带参考图"的生成给出预警。
 * 仅当：模型是 URL-only 上游 + 参考图是内部存储路径（非外部公网）+ 部署存储不可达。
 */
export function shouldWarnRefImage(args: {
  model: string | undefined | null;
  refImageUrl: string | undefined | null;
  reachable: boolean;
}): boolean {
  return (
    Boolean(args.refImageUrl) &&
    providerNeedsPublicMedia(args.model) &&
    !isExternalPublicUrl(args.refImageUrl) &&
    !args.reachable
  );
}

/**
 * 查询部署级"上游可拉取媒体"标志。部署期内基本不变，故 staleTime 设长、不重复请求。
 * 查询失败时按"可达"处理（reachable=true），以免误拦正常部署（Forge / 已配公网端点）。
 */
export function useMediaReachability(): { reachable: boolean; isLoading: boolean } {
  const q = trpc.config.mediaReachability.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return {
    reachable: q.data?.upstreamCanFetchMedia ?? true,
    isLoading: q.isLoading,
  };
}

const WARN_TEXT =
  "当前部署的存储未对公网开放，上游 AI（Poyo / Higgsfield）可能无法读取参考图，生成可能失败并扣积分。";

/**
 * 节点上的琥珀色预警指示灯。仅当 shouldWarnRefImage 为真时渲染，否则返回 null。
 */
export function RefImageReachabilityBadge(props: {
  model: string | undefined | null;
  refImageUrl: string | undefined | null;
  reachable: boolean;
  className?: string;
}) {
  if (!shouldWarnRefImage(props)) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={
            "inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 " +
            (props.className ?? "")
          }
        >
          <AlertTriangle className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left">{WARN_TEXT}</TooltipContent>
    </Tooltip>
  );
}

export const REF_IMAGE_UNREACHABLE_CONFIRM = WARN_TEXT + "\n\n仍要继续生成吗？";

/**
 * 生成前预警守卫。各节点把生成回调交给 `guard()`：
 *   const { guard, dialog } = useRefImageGuard();
 *   ... onClick={() => guard({ model, hasRefImage }, doGenerate)}
 *   ... 在 JSX 里渲染 {dialog}
 * 当 shouldWarnRefImage 为真时弹确认框，确认才执行；否则直接执行。
 */
export function useRefImageGuard(): {
  reachable: boolean;
  guard: (args: { model: string | undefined | null; refImageUrl: string | undefined | null }, proceed: () => void) => void;
  dialog: ReactNode;
} {
  const { reachable } = useMediaReachability();
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  const guard = (
    args: { model: string | undefined | null; refImageUrl: string | undefined | null },
    proceed: () => void,
  ) => {
    if (shouldWarnRefImage({ model: args.model, refImageUrl: args.refImageUrl, reachable })) {
      pendingRef.current = proceed;
      setOpen(true);
    } else {
      proceed();
    }
  };

  const dialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            参考图可能无法被上游读取
          </AlertDialogTitle>
          <AlertDialogDescription>{REF_IMAGE_UNREACHABLE_CONFIRM}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              pendingRef.current = null;
            }}
          >
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const fn = pendingRef.current;
              pendingRef.current = null;
              fn?.();
            }}
          >
            仍要生成
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { reachable, guard, dialog };
}

// ── C：切换为 AI 平台临时链接 ─────────────────────────────────────────────────
//
// 参考图若由 AI 平台（Poyo / Higgsfield）生成，生成时我们已把原始上游 CDN URL 存到了产出
// 节点（imageUrlSource(s)）。当 re-host 到本地存储的副本对上游不可达时，可让用户一键改用该
// 公网临时链接 —— 前提是它**当前仍有效**。链接是否有效用「主动探测」判断，而非时间戳猜测。

/**
 * 在画布图中查找：当前消费节点（nodeId）的 referenceImageUrl 来自哪个上游产出节点，
 * 并取出该产出节点保存的原始 AI 平台 URL（仅当它是外部公网地址时返回）。
 */
export function useRefImageSource(
  nodeId: string,
  refImageUrl: string | undefined | null,
): { sourceUrl?: string } {
  const sourceUrl = useCanvasStore((s) => {
    if (!refImageUrl) return "";
    for (const e of s.edges) {
      if (e.target !== nodeId) continue;
      const src = s.nodes.find((n) => n.id === e.source);
      if (!src) continue;
      const p = src.data.payload as {
        imageUrl?: string;
        imageUrls?: string[];
        imageUrlSource?: string;
        imageUrlSources?: string[];
      };
      let su: string | undefined;
      if (p.imageUrl === refImageUrl) su = p.imageUrlSource;
      else if (Array.isArray(p.imageUrls)) {
        const idx = p.imageUrls.indexOf(refImageUrl);
        if (idx >= 0) su = p.imageUrlSources?.[idx] ?? p.imageUrlSource;
      }
      if (su && isExternalPublicUrl(su)) return su;
    }
    return "";
  });
  return { sourceUrl: sourceUrl || undefined };
}

/**
 * 主动探测一个图片 URL 当前是否仍可用。用 `new Image()` 跨域加载（图片加载无需 CORS）：
 * onload 成功 = CDN 仍公开服务该图，上游几乎必然也能 fetch；onerror / 超时 = 已失效。
 * 比时间戳猜测准确得多。
 */
type Liveness = "idle" | "checking" | "alive" | "dead";
export function useImageUrlLiveness(url: string | undefined | null): Liveness {
  const [state, setState] = useState<Liveness>("idle");
  useEffect(() => {
    if (!url || !isExternalPublicUrl(url)) {
      setState("idle");
      return;
    }
    setState("checking");
    let settled = false;
    const img = new Image();
    const finish = (next: Liveness) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      setState(next);
    };
    const timer = setTimeout(() => finish("dead"), 8000);
    img.onload = () => finish("alive");
    img.onerror = () => finish("dead");
    img.src = url;
    return () => {
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      img.src = "";
    };
  }, [url]);
  return state;
}

/**
 * "切换为 AI 平台临时链接"按钮。仅当：该次生成会触发警告 + 找到了原始 AI 平台公网 URL +
 * 主动探测确认它当前仍可用 时，才显示可点击按钮。探测中显示「检测链接…」，探测失败则不显示。
 * 点击后把 referenceImageUrl 改为该公网链接，A 的逻辑随即熄灯。
 */
export function RefImageSwitchButton(props: {
  nodeId: string;
  model: string | undefined | null;
  refImageUrl: string | undefined | null;
  reachable: boolean;
  onSwitch: (sourceUrl: string) => void;
  className?: string;
}) {
  const { sourceUrl } = useRefImageSource(props.nodeId, props.refImageUrl);
  const warn = shouldWarnRefImage({ model: props.model, refImageUrl: props.refImageUrl, reachable: props.reachable });
  // 仅在会警告时才探测，避免无谓加载
  const liveness = useImageUrlLiveness(warn ? sourceUrl : undefined);

  if (!warn || !sourceUrl) return null;

  if (liveness === "checking") {
    return (
      <span
        className={
          "inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground " +
          (props.className ?? "")
        }
      >
        <Link2 className="h-3 w-3 animate-pulse" /> 检测 AI 平台链接…
      </span>
    );
  }
  if (liveness !== "alive") return null; // dead / idle → 不提供切换

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onSwitch(sourceUrl);
          }}
          className={
            "nodrag inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 " +
            (props.className ?? "")
          }
        >
          <Link2 className="h-3 w-3" /> 切换为 AI 平台链接
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-left">
        检测到该参考图由 AI 平台生成、其公网临时链接当前仍可访问。点击改用该链接，上游即可直接读取（链接随时可能失效，失效后此项会自动消失）。
      </TooltipContent>
    </Tooltip>
  );
}
