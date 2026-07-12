import { useEffect } from "react";
import { toast } from "sonner";
import { usePerfStore, sentinelDecide } from "../lib/perfMode";

/**
 * #81 FPS 哨兵：仅在画布页挂载。rAF 数帧 → 每秒采样一次 FPS，auto 模式下按
 * sentinelDecide 的迟滞规则自动进/出 lite。标签页隐藏时不采样（rAF 停转会误判为 0 FPS）；
 * 启动前 3 秒热身不计（加载期抖动不算卡）。手动 lite/quality 模式下只采样不动作。
 */
export function usePerfSentinel() {
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let warmup = 3;
    const samples: number[] = [];
    const loop = () => { frames++; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const timer = setInterval(() => {
      const fps = frames;
      frames = 0;
      if (document.hidden) { samples.length = 0; return; }
      if (warmup > 0) { warmup--; return; }
      samples.push(fps);
      if (samples.length > 20) samples.shift();
      const st = usePerfStore.getState();
      if (st.mode !== "auto") return;
      const d = sentinelDecide(samples, st.autoLite);
      if (d === "enter") {
        st.setAutoLite(true);
        samples.length = 0;
        toast.info("检测到画布帧率偏低，已自动切换到「流畅」渲染（底部工具栏可手动切档）", { id: "perf-auto", duration: 5000 });
      } else if (d === "exit") {
        st.setAutoLite(false);
        samples.length = 0;
      }
    }, 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(timer); };
  }, []);
}
