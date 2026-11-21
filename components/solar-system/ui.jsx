// Shared UI pieces for the simulator panels.

import s from "./styles.module.css";

export { s as styles };

export function Slider({ label, value, min, max, step, onChange, format, log, hot, className }) {
  const toSlider = (v) => (log ? Math.log10(v) : v);
  const lo = toSlider(min);
  const hi = toSlider(max);
  const pos = toSlider(value);
  const fill = `${Math.max(0, Math.min(100, ((pos - lo) / (hi - lo)) * 100))}%`;
  return (
    <label className={`${s.slider} ${className || ""}`} data-hot={hot || undefined}>
      <div className={s.sliderHead}>
        <span className={s.sliderLabel}>{label}</span>
        <span className={s.sliderValue}>{format ? format(value) : value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={lo}
        max={hi}
        step={log ? 0.01 : step || 0.01}
        value={pos}
        style={{ "--fill": fill }}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(log ? Math.pow(10, v) : v);
        }}
      />
    </label>
  );
}

export function Section({ index, title, children }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.sectionIndex}>{index}</span>
        <h2 className={s.sectionTitle} style={{ margin: 0 }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function Chip({ active, onClick, children, title }) {
  return (
    <button type="button" className={s.chip} aria-pressed={!!active} onClick={onClick} title={title}>
      <span className={s.chipLed} aria-hidden />
      {children}
    </button>
  );
}

// ─── Icons (16px, stroke = currentColor) ─────────────────────────

const svgProps = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const Icon = {
  play: () => <svg {...svgProps} width={18} height={18}><path d="M5 3.2v9.6L13 8z" fill="currentColor" stroke="none" /></svg>,
  pause: () => <svg {...svgProps} width={18} height={18}><path d="M5 3.5v9M11 3.5v9" strokeWidth={2.4} /></svg>,
  rewind: () => <svg {...svgProps}><path d="M8 4 3 8l5 4V4zM14 4 9 8l5 4V4z" fill="currentColor" stroke="none" /></svg>,
  forward: () => <svg {...svgProps}><path d="M8 4l5 4-5 4V4zM2 4l5 4-5 4V4z" fill="currentColor" stroke="none" /></svg>,
  reset: () => <svg {...svgProps}><path d="M3 8a5 5 0 1 0 1.6-3.7" /><path d="M3 2.5v2.8h2.8" /></svg>,
  link: () => <svg {...svgProps}><path d="M6.5 9.5l3-3" /><path d="M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1" /><path d="M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" /></svg>,
  target: () => <svg {...svgProps}><circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1" fill="currentColor" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" /></svg>,
  close: () => <svg {...svgProps} width={12} height={12}><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  sliders: () => <svg {...svgProps}><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" /><circle cx="10.5" cy="4.5" r="1.5" /><circle cx="5.5" cy="11.5" r="1.5" /></svg>,
};

// ─── Scenario glyphs: tiny orbit diagrams (22px) ─────────────────

const g = { width: 22, height: 22, viewBox: "0 0 22 22", fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true };

export function ScenarioGlyph({ id }) {
  switch (id) {
    case "flyby":
      return (
        <svg {...g}>
          <circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="6" opacity="0.45" />
          <path d="M1 4c7 1 14 4 20 13" strokeDasharray="2 2" />
          <circle cx="17.5" cy="11.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "binary":
      return (
        <svg {...g}>
          <ellipse cx="11" cy="11" rx="8.5" ry="5" opacity="0.45" />
          <circle cx="7" cy="11" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="16" cy="11" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "ignite":
      return (
        <svg {...g}>
          <circle cx="11" cy="11" r="3.2" fill="currentColor" stroke="none" />
          <path d="M11 2.5v2.5M11 17v2.5M2.5 11H5M17 11h2.5M5 5l1.8 1.8M15.2 15.2 17 17M17 5l-1.8 1.8M6.8 15.2 5 17" />
        </svg>
      );
    case "halfsun":
      return (
        <svg {...g}>
          <circle cx="11" cy="11" r="5" />
          <path d="M11 6a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" />
          <circle cx="11" cy="11" r="9" strokeDasharray="1.5 2.5" opacity="0.5" />
        </svg>
      );
    case "nosun":
      return (
        <svg {...g}>
          <circle cx="11" cy="11" r="3.5" strokeDasharray="1.6 1.6" />
          <path d="M14.5 5.5l4-3M15 15l4 3M5.5 16l-3.5 3" opacity="0.7" />
          <circle cx="18.5" cy="2.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="19" cy="18" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="2" cy="19" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    default: // today
      return (
        <svg {...g}>
          <circle cx="11" cy="11" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="11" cy="11" r="5.5" opacity="0.5" />
          <circle cx="11" cy="11" r="9" opacity="0.35" />
          <circle cx="16.5" cy="11" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="4.6" cy="4.6" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
