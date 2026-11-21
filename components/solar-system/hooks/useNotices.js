import { useCallback, useEffect, useState } from "react";

/**
 * Toast notices (scenario intros, events, collisions). A notice with higher
 * priority (a warning) isn't bumped by routine toasts until it expires.
 */
export function useNotices() {
  const [notice, setNotice] = useState(null);
  const notify = useCallback((text, ms = 4000, title, priority = 0) => {
    setNotice((current) => {
      if (current && current.priority > priority && performance.now() < current.until) return current;
      return { text, title, id: Math.random(), ms, priority, until: performance.now() + ms };
    });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), notice.ms);
    return () => clearTimeout(id);
  }, [notice]);
  return { notice, notify };
}
