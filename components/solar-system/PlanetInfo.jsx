import { AU_KM, EARTH_MASS, YEAR_S } from "@/lib/sim/constants.js";
import { PLANET_FACTS } from "@/lib/sim/planet-facts.js";
import { FONT, InfoRow, panelStyle } from "./ui";

/** Left-hand panel with live simulation data and facts for the selected body. */
export default function PlanetInfo({ body, sun, following, onFollow, yourWeight, setYourWeight, onClose }) {
  // Scenario extras (rogue star, companion) have a description instead of a fact sheet.
  const facts = PLANET_FACTS[body.name] || { type: body.type, funFact: body.description, moons: null };

  const distAU = Math.hypot(body.x - sun.x, body.y - sun.y);
  const velKmS = (Math.hypot(body.vx - sun.vx, body.vy - sun.vy) * AU_KM) / YEAR_S;
  const earthMasses = body.mass / EARTH_MASS;

  return (
    <div style={{
      ...panelStyle,
      position: "absolute", top: 16, left: 16,
      width: "min(280px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 32px)",
      border: "1px solid rgba(60,60,80,0.3)", borderRadius: 8, padding: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: body.color, boxShadow: `0 0 8px ${body.color}60` }} />
        <span style={{ fontFamily: FONT.display, fontWeight: 700, color: "#d0d0e0", fontSize: 15 }}>{body.name}</span>
        <span style={{ fontSize: 9, color: "#6a6a7a", marginLeft: "auto", fontFamily: FONT.mono, textAlign: "right" }}>{facts.type}</span>
        <button onClick={onClose} aria-label="Close" style={{
          background: "none", border: "none", color: "#6a6a7a", cursor: "pointer", fontSize: 14, padding: "0 0 0 4px",
        }}>✕</button>
      </div>

      {!body.isSun && (
        <button onClick={onFollow} aria-pressed={following} style={{
          width: "100%", marginBottom: 10, padding: "6px 8px", borderRadius: 6, cursor: "pointer",
          fontSize: 11, fontFamily: FONT.sans, fontWeight: 500,
          background: following ? "rgba(200,168,78,0.15)" : "rgba(40,40,55,0.5)",
          border: following ? "1px solid rgba(200,168,78,0.35)" : "1px solid rgba(60,60,80,0.4)",
          color: following ? "#d8c070" : "#9a9aaa",
        }}>
          {following ? "🎥 Following — click to stop (F)" : `🎥 Follow ${body.name} (F)`}
        </button>
      )}

      {!body.isSun && (
        <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "#7a7a8a", lineHeight: 1.7, marginBottom: 10, padding: "6px 8px", background: "rgba(20,20,35,0.5)", borderRadius: 5 }}>
          <Live label="Distance from Sun" value={`${distAU.toFixed(3)} AU`} />
          <Live label="Speed" value={`${velKmS.toFixed(1)} km/s`} />
          <Live label="Mass" value={`${earthMasses < 0.01 ? earthMasses.toExponential(2) : earthMasses.toFixed(2)} M⊕`} />
        </div>
      )}

      <InfoRow label="🌡 Temperature" value={facts.temperature} />
      <InfoRow label="📏 Distance from Earth" value={facts.distFromEarthKm} />
      <InfoRow label="🚀 Travel time" value={facts.travelTime} />
      <InfoRow label="🔄 Year length" value={facts.orbitalPeriod} />
      <InfoRow label="🌅 Day length" value={facts.dayLength} />
      {facts.earthMasses != null && (
        <InfoRow label="⚖️ Mass" value={facts.earthMasses !== 1 ? `${facts.earthMasses.toLocaleString()} × Earth` : "1 Earth (that's us)"} />
      )}
      <InfoRow label="🧪 Made of" value={facts.composition} />
      {facts.moons != null && (
        <InfoRow label="🌙 Moons" value={facts.moons === 0 ? "None" : `${facts.moons} — ${facts.moonNames}`} />
      )}
      {facts.rings && <InfoRow label="💍 Rings" value={facts.ringDesc || "Yes"} />}
      <InfoRow label="🧍 Stand on it?" value={facts.canStand} />
      <InfoRow label="💨 Wind" value={facts.windSpeed} />

      {facts.surfaceGravity && (
        <div style={{ marginTop: 10, padding: 8, background: "rgba(200,168,78,0.06)", borderRadius: 5, border: "1px solid rgba(200,168,78,0.15)" }}>
          <div style={{ fontSize: 10, color: "#9a9070", fontFamily: FONT.sans, fontWeight: 600, marginBottom: 5 }}>⚖️ What would you weigh here?</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="number"
              min={1}
              value={yourWeight}
              onChange={(e) => setYourWeight(Math.max(1, parseInt(e.target.value) || 1))}
              style={{
                width: 52, background: "rgba(20,20,35,0.8)", border: "1px solid rgba(80,80,100,0.3)",
                borderRadius: 4, color: "#d0d0e0", padding: "3px 6px", fontSize: 11,
                fontFamily: FONT.mono, outline: "none", textAlign: "right",
              }}
            />
            <span style={{ fontSize: 10, color: "#6a6a7a" }}>kg on Earth →</span>
            <span style={{ fontSize: 12, color: "#C8A84E", fontFamily: FONT.mono, fontWeight: 600 }}>
              {(yourWeight * facts.surfaceGravity).toFixed(1)} kg
            </span>
          </div>
          <div style={{ fontSize: 9, color: "#5a5a6a", marginTop: 3 }}>Gravity: {facts.surfaceGravity}× Earth</div>
        </div>
      )}

      <div style={{ marginTop: 10, padding: 8, background: "rgba(75,95,232,0.06)", borderRadius: 5, border: "1px solid rgba(75,95,232,0.12)" }}>
        <div style={{ fontSize: 10, color: "#7080b0", fontFamily: FONT.sans, fontWeight: 600, marginBottom: 3 }}>{body.description ? "💡 About this scenario" : "💡 Did you know?"}</div>
        <div style={{ fontSize: 11, color: "#9098b8", fontFamily: FONT.sans, lineHeight: 1.5 }}>{facts.funFact}</div>
      </div>
    </div>
  );
}

function Live({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span>{label}</span>
      <span style={{ color: "#b0b0c0" }}>{value}</span>
    </div>
  );
}
