import { useEffect, useRef } from "react";

/**
 * A ref that always holds the latest value, updated after each render (never
 * during it). Lets long-lived listeners and loops call the current callbacks
 * and read the current state without being re-created.
 */
export function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}
