import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function makeImageProxyFallback(url: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src.includes("/api/image-proxy")) return;
    const absoluteUrl = url.startsWith("/")
      ? `${window.location.origin}${url}`
      : url;
    if (absoluteUrl.startsWith("https://")) {
      img.src = `/api/image-proxy?url=${encodeURIComponent(absoluteUrl)}`;
    }
  };
}
