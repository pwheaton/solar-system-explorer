import { useCallback, useEffect } from "react";
import { useLatest } from "./useLatest";

/** Keep developer switches (?perf=1, ?worker=0) when the URL is rewritten. */
function withDevParams(qs) {
  const now = new URLSearchParams(window.location.search);
  const keep = ["perf", "worker"].filter((k) => now.has(k)).map((k) => `${k}=${now.get(k)}`);
  if (!keep.length) return qs;
  return qs ? `${qs}&${keep.join("&")}` : `?${keep.join("&")}`;
}

/**
 * Keep the address bar a shareable link. `getQuery()` returns the query
 * string for the current setup ("" for the default view, null if not ready);
 * the URL is rewritten shortly after `key` changes. Returns copyLink().
 */
export function useUrlSync(getQuery, key) {
  const latest = useLatest(getQuery);
  const current = useCallback(() => {
    const qs = latest.current();
    return qs == null ? null : withDevParams(qs);
  }, [latest]);

  useEffect(() => {
    const id = setTimeout(() => {
      const qs = current();
      if (qs != null && qs !== window.location.search) window.history.replaceState(null, "", window.location.pathname + qs);
    }, 400);
    return () => clearTimeout(id);
  }, [key, current]);

  return useCallback(async () => {
    const qs = current();
    if (qs != null) window.history.replaceState(null, "", window.location.pathname + qs);
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch {
      return false;
    }
  }, [current]);
}
