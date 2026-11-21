import { useEffect, useRef, useState } from "react";
import { Icon, styles as s } from "./ui";

// Grouped by what you're trying to do. Each row: [keys or gesture, what it does].
const KEYBOARD = [
  ["Time", [
    ["Space", "Play / pause"],
    ["B", "Rewind / forward"],
    ["R", "Restart from today"],
  ]],
  ["Look around", [
    ["Drag", "Pan"],
    ["Scroll", "Zoom (toward the cursor)"],
    ["Click", "Inspect a planet"],
    ["F", "Follow the selected planet"],
    ["C", "Recenter the view"],
    ["Esc", "Close / deselect"],
  ]],
  ["Scenarios", [
    ["1 – 6", "Load a scenario"],
  ]],
  ["Launch your own", [
    ["L", "Launch mode on / off"],
    ["Drag", "Throw (direction + speed)"],
    ["Click", "Circular orbit"],
    ["Right-drag", "Pan in launch mode"],
  ]],
  ["Show / hide", [
    ["T", "Trails"],
    ["G", "Gravity map"],
    ["A", "Asteroid belt"],
    ["K", "Kuiper belt"],
    ["?", "This list"],
  ]],
];

const TOUCH = [
  ["Look around", [
    ["Drag", "Pan"],
    ["Pinch", "Zoom"],
    ["Tap", "Inspect a planet"],
  ]],
  ["Time", [
    ["▶ ◀◀ ↺", "Play, rewind and restart are in the dock"],
  ]],
  ["Launch your own", [
    ["↗", "Launch mode (in the dock)"],
    ["Drag", "Throw (direction + speed)"],
    ["Tap", "Circular orbit"],
    ["Two fingers", "Pan in launch mode"],
  ]],
];

const SEEN_KEY = "sse.shortcuts.seen";

/** Pull tab on the left edge that slides out the shortcut list. */
export default function ShortcutsDrawer({ open, onToggle, onClose }) {
  const [touch, setTouch] = useState(false);
  const [nudge, setNudge] = useState(false);
  const panelRef = useRef(null);
  const tabRef = useRef(null);

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    // Glow once for first-time visitors so the tab gets noticed.
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) {
        setNudge(true);
        window.localStorage.setItem(SEEN_KEY, "1");
      }
    } catch { /* storage blocked: skip the nudge */ }
  }, []);

  // Close when clicking anywhere outside the panel or tab.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || tabRef.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, onClose]);

  const groups = touch ? TOUCH : KEYBOARD;
  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={s.shortcutsTab}
        data-nudge={nudge && !open ? "true" : undefined}
        aria-expanded={open}
        aria-controls="shortcuts-panel"
        onClick={() => { setNudge(false); onToggle(); }}
        title={touch ? "Gestures" : "Keyboard shortcuts (?)"}
      >
        <Icon.keyboard />
        <span>{touch ? "Gestures" : "Shortcuts"}</span>
      </button>

      <aside
        ref={panelRef}
        id="shortcuts-panel"
        className={`${s.frame} ${s.shortcuts}`}
        data-open={open}
        aria-label={touch ? "Gestures" : "Keyboard shortcuts"}
        aria-hidden={!open}
        inert={!open}
      >
        <header className={s.shortcutsHead}>
          <h2 className={s.sectionTitle} style={{ margin: 0 }}>{touch ? "Gestures" : "Shortcuts"}</h2>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close (Esc)"><Icon.close /></button>
        </header>
        {groups.map(([title, rows]) => (
          <section key={title} className={s.shortcutGroup}>
            <div className={s.eyebrow}>{title}</div>
            <dl className={s.shortcutList}>
              {rows.map(([k, v]) => (
                <div key={k + v} className={s.shortcutRow}>
                  <dt>{k.split(" / ").map((part) => <kbd key={part}>{part}</kbd>)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </aside>
    </>
  );
}
