import { useEffect } from "react";
import { SCENARIOS } from "@/lib/sim/scenarios.js";
import { useLatest } from "./useLatest";

/**
 * Global keyboard shortcuts. `actions` says what each one does; this hook
 * only maps keys to them (and ignores keys typed into text fields).
 */
export function useKeyboardShortcuts(actions) {
  const latest = useLatest(actions);
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "TEXTAREA" || (tag === "INPUT" && e.target.type !== "range")) return;
      const a = latest.current;
      if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { e.preventDefault(); a.toggleShortcuts(); return; }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && SCENARIOS[digit[1] - 1]) { a.loadScenario(SCENARIOS[digit[1] - 1].id); return; }
      switch (e.code) {
        case "Space": e.preventDefault(); a.togglePause(); break;
        case "KeyB": a.toggleReverse(); break;
        case "KeyR": a.reset(); break;
        case "KeyG": a.toggleGravity(); break;
        case "KeyT": a.toggleTrails(); break;
        case "KeyA": a.toggleBelt("asteroids"); break;
        case "KeyK": a.toggleBelt("kuiper"); break;
        case "KeyC": a.recenter(); break;
        case "KeyF": a.toggleFollow(); break;
        case "KeyL": a.toggleLaunchMode(); break;
        case "Escape": a.escape(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [latest]);
}
