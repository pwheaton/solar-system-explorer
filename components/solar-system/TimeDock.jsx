import { Icon, Slider, styles as s } from "./ui";

/** Format a simulation rate given in years per real second. */
export function formatRate(yrPerSec) {
  const days = yrPerSec * 365.25;
  if (days < 1) return `${(days * 24).toFixed(1)} hr/s`;
  if (days < 60) return `${days < 10 ? days.toFixed(1) : Math.round(days)} days/s`;
  return `${yrPerSec < 10 ? yrPerSec.toFixed(1) : Math.round(yrPerSec)} yr/s`;
}

/** Bottom dock: play/pause, rewind, speed, and the simulation clock. */
export default function TimeDock({ paused, reverse, speed, hud, onTogglePause, onToggleReverse, onSpeed, onReset }) {
  const state = paused ? "paused" : reverse ? "reverse" : "running";
  const label = paused ? "Paused" : reverse ? "Rewinding" : "Running";
  return (
    <div className={`${s.frame} ${s.dock}`} role="group" aria-label="Time controls">
      <div className={s.dockGroup}>
        <button
          type="button"
          className={s.iconBtn}
          aria-pressed={reverse}
          onClick={onToggleReverse}
          title={reverse ? "Run forwards (B)" : "Run time backwards (B)"}
          aria-label={reverse ? "Run forwards" : "Rewind"}
        >
          {reverse ? <Icon.forward /> : <Icon.rewind />}
        </button>
        <button
          type="button"
          className={s.playBtn}
          data-reverse={reverse}
          onClick={onTogglePause}
          title={paused ? "Play (Space)" : "Pause (Space)"}
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <Icon.play /> : <Icon.pause />}
        </button>
        <button type="button" className={s.iconBtn} onClick={onReset} title="Restart from today (R)" aria-label="Restart">
          <Icon.reset />
        </button>
      </div>

      <div className={s.dockDivider} />

      <Slider className={s.dockSpeed} label="Speed" value={speed} min={0.005} max={20} log onChange={onSpeed} format={formatRate} />

      <div className={s.dockDivider} />

      <div className={s.dockTime} aria-live="off">
        <div className={s.dockStatus} data-state={state}>{label}</div>
        <div className={s.dockDate}>{hud.date || "—"}</div>
        <div className={s.dockMeta}>
          {hud.years >= 0 ? "+" : "−"}{Math.abs(hud.years).toFixed(2)} yr
          {!paused && <> · {reverse ? "−" : ""}{formatRate(hud.rate)}</>}
          {hud.limited && !paused && <span className={s.dockWarn}> · max for this device</span>}
        </div>
      </div>
    </div>
  );
}
