import { useEffect, useRef } from "react";
import { createHost } from "@/lib/sim/host.js";

/**
 * Creates the simulation host (physics in a Web Worker, or on the main thread
 * with ?worker=0 or as a fallback) and routes its callbacks to the latest
 * handlers in `handlersRef.current` ({ onLoaded, onResult }), which the caller
 * keeps up to date. Call it before anything that loads a scenario: effects run
 * in order.
 */
export function useSimulationHost(handlers) {
  const hostRef = useRef(null);
  useEffect(() => {
    const preferWorker = new URLSearchParams(window.location.search).get("worker") !== "0";
    const host = createHost({
      preferWorker,
      onLoaded: (m) => handlers.current.onLoaded?.(m),
      onResult: (r) => handlers.current.onResult?.(r),
    });
    hostRef.current = host;
    if (process.env.NODE_ENV !== "production") window.__host = host;
    return () => { host.dispose(); hostRef.current = null; };
  }, [handlers]);
  return hostRef;
}
