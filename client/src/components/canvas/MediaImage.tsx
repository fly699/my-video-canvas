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
      onError={(e) => { retry?.(e); onError?.(e); }}
      {...rest}
    />
  );
}
