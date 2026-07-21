import { makeImageProxyFallback } from "@/lib/utils";

/**
 * Canonical image preview: renders an <img> that, on a load failure (CORS /
 * expired external URL), automatically retries through the server image proxy.
 * This was previously open-coded as `onError={makeImageProxyFallback(src)}` on
 * many nodes (and missing entirely on some raw previews). Use this everywhere a
 * media URL — possibly external — is shown so the fallback is uniform.
 *
 * Any caller-supplied onError runs after the proxy retry.
 */
type MediaImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | undefined };

export function MediaImage({ src, onError, ...rest }: MediaImageProps) {
  const retry = src ? makeImageProxyFallback(src) : undefined;
  return (
    <img
      src={src}
      // #325 性能默认值：离屏不加载（lazy）、解码不阻塞主线程（async）。放在
      // {...rest} 之前——调用方显式传入同名属性时以调用方为准，行为可逐处覆盖。
      loading="lazy"
      decoding="async"
      onError={(e) => { retry?.(e); onError?.(e); }}
      {...rest}
    />
  );
}
