import { useState } from "react";
import { BELTS } from "@/lib/sim/physics.js";
import { SCENARIOS } from "@/lib/sim/scenarios.js";
import { DT, STAR_THRESHOLD_JUPITERS } from "@/lib/sim/constants.js";
import { FONT, SectionLabel, Slider, SmallBtn, panelStyle } from "./ui";

export const PANEL_WIDTH = 268;

/** Format a simulation rate given in years per real second. */
export function formatRate(yrPerSec) {
  const days = yrPerSec * 365.25;
  if (days < 1) return `${(days * 24).toFixed(1)} hr/s`;
  if (days < 60) return `${days < 10 ? days.toFixed(1) : Math.round(days)} days/s`;
  return `${yrPerSec < 10 ? yrPerSec.toFixed(1) : Math.round(yrPerSec)} yr/s`;
}

export default function ControlPanel({
  open, scenarioId, onScenario, settings, set, hud, selected, follow, onSelect, onReset, onRecenter, onCopyLink,
}) {
  const s = settings;
  const [copied, setCopied] = useState(null);
  const copy = async () => {
    setCopied((await onCopyLink()) ? "Link copied" : "Copy failed — use the address bar");
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <div style={{
      ...panelStyle,
      position: "absolute", top: 0, right: 0, height: "100%",
      width: `min(${PANEL_WIDTH}px, 85vw)`,
      transform: open ? "none" : "translateX(105%)",
      borderLeft: "1px solid rgba(60,60,80,0.3)", padding: "48px 16px 16px",
      transition: "transform 0.3s ease",
    }}>
      <SectionLabel>Scenarios</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        {SCENARIOS.map((sc, i) => (
          <button key={sc.id} onClick={() => onScenario(sc.id)} title={`${sc.blurb} (key ${i + 1})`} aria-pressed={scenarioId === sc.id} style={{
            display: "flex", alignItems: "center", gap: 6, textAlign: "left", cursor: "pointer",
            padding: "6px 8px", borderRadius: 6, fontSize: 11, lineHeight: 1.25, fontFamily: FONT.sans,
            background: scenarioId === sc.id ? "rgba(200,168,78,0.15)" : "rgba(40,40,55,0.5)",
            border: scenarioId === sc.id ? "1px solid rgba(200,168,78,0.35)" : "1px solid rgba(60,60,80,0.4)",
            color: scenarioId === sc.id ? "#d8c070" : "#8a8a9a",
          }}>
            <span aria-hidden style={{ fontSize: 13 }}>{sc.icon}</span>{sc.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <SmallBtn onClick={copy} title="Copy a link to exactly this setup">🔗 Copy link</SmallBtn>
        {copied && <span style={{ fontSize: 10, color: "#8a9a70", fontFamily: FONT.mono }}>{copied}</span>}
      </div>

      <SectionLabel>Time</SectionLabel>
      <Slider label="Speed" value={s.speed} min={0.005} max={20} log onChange={set.speed} format={formatRate} />
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <SmallBtn active={s.paused} onClick={() => set.paused((p) => !p)} title="Space">{s.paused ? "▶ Play" : "⏸ Pause"}</SmallBtn>
        <SmallBtn active={s.reverse} onClick={() => set.reverse((r) => !r)} title="Run time backwards (B)">{s.reverse ? "▶ Forward" : "◀◀ Rewind"}</SmallBtn>
        <SmallBtn onClick={onReset} title="Restart this scenario from today (R)">↺ Reset</SmallBtn>
      </div>

      <SectionLabel>Chaos Controls</SectionLabel>
      <Slider label="☀ Sun Mass" value={s.sunMass} min={0.1} max={10} log onChange={set.sunMass} format={(v) => v.toFixed(2) + "×"} />
      <Slider
        label={s.jupMass >= STAR_THRESHOLD_JUPITERS ? "♃ Jupiter Mass — it's a star!" : "♃ Jupiter Mass"}
        value={s.jupMass} min={0.1} max={1000} log onChange={set.jupMass}
        format={(v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + "×"}
      />

      <SectionLabel>Belts</SectionLabel>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {Object.entries(BELTS).map(([key, def]) => (
          <SmallBtn key={key} active={s.belts[key]} onClick={() => set.belt(key, !s.belts[key])}>
            {key === "asteroids" ? "◌ " : "❄ "}{def.label}
          </SmallBtn>
        ))}
      </div>
      {Object.entries(hud.belts).map(([key, b]) => (
        <div key={key} style={{ fontSize: 10, color: "#6a6a7a", fontFamily: FONT.mono, lineHeight: 1.6 }}>
          {BELTS[key].label}: {b.alive.toLocaleString()} left
          {b.ejected > 0 && <span style={{ color: "#a07050" }}> · {b.ejected} ejected</span>}
          {b.swallowed > 0 && <span style={{ color: "#c09040" }}> · {b.swallowed} into Sun</span>}
        </div>
      ))}
      <div style={{ height: 14 }} />

      <SectionLabel>View</SectionLabel>
      <Slider label="Distance Warp" value={s.distExp} min={0.2} max={1} step={0.01} onChange={set.distExp}
        format={(v) => (v >= 0.95 ? "Linear" : v <= 0.25 ? "Max Log" : (v * 100).toFixed(0) + "%")} />
      <Slider label="Planet Scale" value={s.sizeMult} min={0.3} max={4} step={0.1} onChange={set.sizeMult}
        format={(v) => v.toFixed(1) + "×"} />
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <SmallBtn active={s.showGrav} onClick={() => set.showGrav((g) => !g)}>◎ Gravity</SmallBtn>
        <SmallBtn active={s.showTrails} onClick={() => set.showTrails((t) => !t)}>〰 Trails</SmallBtn>
        <SmallBtn onClick={onRecenter} title="Reset zoom and pan">⌖ Recenter</SmallBtn>
      </div>

      <SectionLabel>Bodies</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {hud.bodies.map((d, i) => !d.isSun && (
          <button key={d.name} onClick={() => onSelect(i)} aria-label={`Inspect ${d.name}`} aria-pressed={selected === i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4,
            cursor: "pointer", border: "none", textAlign: "left",
            background: selected === i ? "rgba(60,60,80,0.3)" : "transparent", transition: "background 0.15s",
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: d.isStar ? "#c0a888" : d.isDwarf ? "#6a6a7a" : "#8a8a9a", fontFamily: FONT.sans }}>
              {d.name}{follow === i && " 🎥"}
            </span>
            <span style={{ fontSize: 9, color: "#50505a", marginLeft: "auto", fontFamily: FONT.mono }}>
              {d.a ? `${d.a.toFixed(1)} AU` : d.isStar ? "star" : ""}
            </span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 20, padding: "10px 0", borderTop: "1px solid rgba(60,60,80,0.3)" }}>
        <div style={{ fontSize: 9, color: "#4a4a5a", fontFamily: FONT.mono, lineHeight: 1.6 }}>
          Velocity-Verlet N-body · dt = {DT} yr<br />
          Starts from real positions (JPL elements)<br />
          Time-reversible: rewind retraces exactly<br />
          G = 4π² AU³/(M☉·yr²)
        </div>
      </div>
    </div>
  );
}
