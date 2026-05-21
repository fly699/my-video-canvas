import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function makeImageProxyFallback(url: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (url.startsWith("http") && !img.src.includes("/api/image-proxy")) {
      img.src = `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
  };
}
