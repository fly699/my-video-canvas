import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Download } from "lucide-react";
import { ImageLightbox } from "@/components/canvas/ImageLightbox";
import { downloadMedia } from "@/lib/download";
import { EC } from "./theme";

export interface PreviewAsset {
  id: number;
  url: string;
  name: string;
  kind: "image" | "video" | "audio";
}

/** Enlarge a media asset clicked in the MediaBin. Images reuse the zoom/pan
 *  ImageLightbox; video/audio get a controls modal. Downloads go through the
 *  gated downloadMedia helper, so strict download authorization still applies. */
export function MediaPreview({ asset, onClose }: { asset: PreviewAsset; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (asset.kind === "image") {
    return <ImageLightbox images={[asset.url]} currentIndex={0} onClose={onClose} onNavigate={() => {}} />;
  }

  // The streaming proxy handles audio fine via the video route (audio has no
  // dedicated proxy kind); downloads still pass through the gated helper.
  const proxy = "video" as const;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.88)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        {asset.kind === "video" ? (
          <video src={asset.url} controls autoPlay playsInline style={{ maxWidth: "90vw", maxHeight: "82vh", borderRadius: 8, boxShadow: "0 0 60px oklch(0 0 0 / 0.6)", background: "#000" }} />
        ) : (
          <div style={{ width: "min(520px, 90vw)", padding: 24, borderRadius: 12, background: EC.surface, border: `1px solid ${EC.border}` }}>
            <div style={{ fontSize: 13, color: EC.t2, marginBottom: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</div>
            <audio src={asset.url} controls autoPlay style={{ width: "100%" }} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => downloadMedia(asset.url, asset.name, proxy, asset.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${EC.border}`, background: EC.elevated, color: EC.t1, fontSize: 13, cursor: "pointer" }}>
            <Download size={14} /> 下载
          </button>
          <button onClick={onClose} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${EC.border}`, background: "transparent", color: EC.t2, fontSize: 13, cursor: "pointer" }}>
            <X size={14} /> 关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
