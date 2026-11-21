import { LAUNCH_TYPES } from "@/lib/sim/sandbox.js";
import { Icon, styles as s } from "./ui";

/** Floating bar above the dock in launch mode: what to throw, and a clear button. */
export default function LaunchBar({ type, onType, count, max, onClear, onClose }) {
  return (
    <div className={`${s.frame} ${s.launchBar}`} role="toolbar" aria-label="Launch">
      <span className={s.eyebrow} style={{ color: "var(--amber)" }}>Launch</span>
      <div className={s.launchTypes}>
        {Object.entries(LAUNCH_TYPES).map(([key, def]) => (
          <button
            key={key}
            type="button"
            className={s.launchType}
            aria-pressed={type === key}
            onClick={() => onType(key)}
          >
            <span
              className={s.launchSwatch}
              style={{
                width: 4 + def.displayRadius * 1.3,
                height: 4 + def.displayRadius * 1.3,
                background: def.colors[0],
                boxShadow: def.isStar ? `0 0 10px ${def.colors[0]}` : undefined,
              }}
            />
            {def.label}
          </button>
        ))}
      </div>
      <span className={s.launchCount}>{count}/{max}</span>
      {count > 0 && (
        <button type="button" className={s.chip} onClick={onClear} title="Remove everything you've launched">
          Clear
        </button>
      )}
      <button type="button" className={s.close} onClick={onClose} aria-label="Leave launch mode (Esc)"><Icon.close /></button>
    </div>
  );
}
