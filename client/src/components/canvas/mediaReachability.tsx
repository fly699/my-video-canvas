import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
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

/** 是否应针对"带参考图"的这次生成给出预警。 */
export function shouldWarnRefImage(args: {
  model: string | undefined | null;
  hasRefImage: boolean;
  reachable: boolean;
}): boolean {
  return args.hasRefImage && providerNeedsPublicMedia(args.model) && !args.reachable;
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
  hasRefImage: boolean;
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
  guard: (args: { model: string | undefined | null; hasRefImage: boolean }, proceed: () => void) => void;
  dialog: ReactNode;
} {
  const { reachable } = useMediaReachability();
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  const guard = (
    args: { model: string | undefined | null; hasRefImage: boolean },
    proceed: () => void,
  ) => {
    if (shouldWarnRefImage({ model: args.model, hasRefImage: args.hasRefImage, reachable })) {
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
