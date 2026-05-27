import { useCallback, useEffect, useState } from "react";
import { getCachedMedia } from "./mediaCache";

interface LocalMediaState {
  isLocal: boolean;
  blobUrl: string | null;
  cacheSize: number;
  downloadedAt: number;
}

const EMPTY: LocalMediaState = { isLocal: false, blobUrl: null, cacheSize: 0, downloadedAt: 0 };

export function useLocalMedia(url: string | undefined): LocalMediaState & { refresh: () => void } {
  const [state, setState] = useState<LocalMediaState>(EMPTY);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!url) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    let localBlobUrl: string | null = null;

    getCachedMedia(url)
      .then((entry) => {
        if (cancelled) return;
        if (entry) {
          localBlobUrl = URL.createObjectURL(entry.blob);
          setState({ isLocal: true, blobUrl: localBlobUrl, cacheSize: entry.size, downloadedAt: entry.downloadedAt });
        } else {
          setState(EMPTY);
        }
      })
      .catch(() => {
        if (!cancelled) setState(EMPTY);
      });

    return () => {
      cancelled = true;
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
    };
  }, [url, refreshKey]);

  return { ...state, refresh };
}
