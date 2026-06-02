import { nanoid } from "nanoid";
import type { ReferenceImage } from "../../../shared/types";

type RefSource = ReferenceImage["source"];

interface RefPayload {
  referenceImageUrl?: string;
  referenceImages?: ReferenceImage[];
}

/**
 * Merge the legacy single `referenceImageUrl` into the multi-image list so
 * that upstream-propagated refs (which still write `referenceImageUrl`) show
 * up in the strip. The legacy entry, when present, is always first — it stays
 * the "primary" that the backend / downstream consume.
 */
export function normalizeRefImages(payload: RefPayload): ReferenceImage[] {
  const list = Array.isArray(payload.referenceImages)
    ? payload.referenceImages.filter((r): r is ReferenceImage => !!r && typeof r.url === "string" && r.url.length > 0)
    : [];
  const legacy = payload.referenceImageUrl?.trim();
  if (legacy && !list.some((r) => r.url === legacy)) {
    return [{ id: "legacy", url: legacy, source: "upstream" }, ...list];
  }
  return list;
}

/** Build the payload patch that keeps `referenceImageUrl` = first entry. */
export function refPatch(next: ReferenceImage[]): { referenceImages: ReferenceImage[]; referenceImageUrl: string | undefined } {
  return { referenceImages: next, referenceImageUrl: next[0]?.url };
}

export function makeRefImage(url: string, source: RefSource = "url"): ReferenceImage {
  return { id: nanoid(8), url: url.trim(), source };
}

/** All reference URLs in display order (primary first) — for backend submission. */
export function refUrls(payload: RefPayload): string[] {
  return normalizeRefImages(payload).map((r) => r.url);
}
