// Small shared UI pieces for the simulator panels.

export const FONT = {
  sans: "var(--font-dm-sans), sans-serif",
  mono: "var(--font-code), monospace",
  display: "var(--font-display), sans-serif",
};

export const panelStyle = {
  background: "rgba(10,10,18,0.88)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxSizing: "border-box",
  overflowY: "auto",
  zIndex: 15,
};

export function Slider({ label, value, min, max, step, onChange, format, log }) {
  const display = format ? format(value) : value.toFixed(1);
  const toSlider = (v) => (log ? Math.log10(v) : v);
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, letterSpacing: "0.04em" }}>
        <span style={{ color: "#8a8a9a", fontFamily: FONT.sans, fontWeight: 500 }}>{label}</span>
        <span style={{ color: "#d0c8a8", fontFamily: FONT.mono, fontWeight: 500 }}>{display}</span>
      </div>
      <input
        type="range"
        min={toSlider(min)}
        max={toSlider(max)}
        step={log ? 0.01 : step || 0.01}
        value={toSlider(value)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(log ? Math.pow(10, v) : v);
        }}
        style={{ width: "100%" }}
      />
    </label>
  );
}

export function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, color: "#5a5a6a", fontFamily: FONT.display, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10, marginTop: 8,
    }}>
      {children}
    </div>
  );
}

export function SmallBtn({ children, onClick, active, title }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={active} style={{
      background: active ? "rgba(200,168,78,0.15)" : "rgba(40,40,55,0.5)",
      border: active ? "1px solid rgba(200,168,78,0.3)" : "1px solid rgba(60,60,80,0.4)",
      color: active ? "#C8A84E" : "#7a7a8a", borderRadius: 6, padding: "5px 10px",
      fontSize: 11, cursor: "pointer", fontFamily: FONT.sans, fontWeight: 500,
      transition: "all 0.15s",
    }}>
      {children}
    </button>
  );
}

export function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ fontSize: 9, color: "#5a5a6a", fontFamily: FONT.sans, fontWeight: 600, marginBottom: 1, letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#a0a0b8", fontFamily: FONT.sans, lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}

export function GlobalStyles() {
  return (
    <style>{`
      input[type="range"] {
        -webkit-appearance: none; appearance: none;
        height: 4px; background: rgba(60,60,80,0.5); border-radius: 2px; outline: none;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
        background: #C8A84E; cursor: pointer; border: 2px solid #1a1a2a;
        box-shadow: 0 0 6px rgba(200,168,78,0.3);
      }
      input[type="range"]::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%;
        background: #C8A84E; cursor: pointer; border: 2px solid #1a1a2a;
      }
      input[type="range"]:focus-visible::-webkit-slider-thumb { outline: 2px solid #C8A84E; outline-offset: 2px; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(80,80,100,0.3); border-radius: 2px; }
    `}</style>
  );
}
