import { AU_KM, EARTH_MASS, YEAR_S } from "@/lib/sim/constants.js";
import { PLANET_FACTS } from "@/lib/sim/planet-facts.js";
import { Icon, styles as s } from "./ui";

/** "Field guide" card for the selected body: live readouts plus facts. */
export default function PlanetInfo({ body, sun, following, onFollow, yourWeight, setYourWeight, onClose }) {
  // Scenario extras (rogue star, companion) have a description instead of a fact sheet.
  const facts = PLANET_FACTS[body.name] || { type: body.type, funFact: body.description };

  const distAU = Math.hypot(body.x - sun.x, body.y - sun.y);
  const velKmS = (Math.hypot(body.vx - sun.vx, body.vy - sun.vy) * AU_KM) / YEAR_S;
  const earthMasses = body.mass / EARTH_MASS;
  const glow = body.isSun || body.isStar;

  const rows = [
    ["Temperature", facts.temperature],
    ["Year", facts.orbitalPeriod],
    ["Day", facts.dayLength],
    ["Made of", facts.composition],
    ["Moons", facts.moons == null ? null : facts.moons === 0 ? "None" : `${facts.moons} — ${facts.moonNames}`],
    ["Rings", facts.rings ? facts.ringDesc || "Yes" : null],
    ["Could you stand on it?", facts.canStand],
    ["Wind", facts.windSpeed],
    ["Distance from Earth", facts.distFromEarthKm],
    ["Getting there", facts.travelTime],
  ].filter(([, v]) => v);

  return (
    <article className={`${s.frame} ${s.card}`} aria-label={`${body.name} details`}>
      <header className={s.cardHead}>
        <span
          className={s.orb}
          style={{
            background: `radial-gradient(circle at 35% 30%, #fff8, ${body.color} 45%, #0008 120%)`,
            boxShadow: glow ? `0 0 22px ${body.color}` : `0 0 0 1px ${body.color}33`,
          }}
        />
        <div>
          <h2 className={s.cardName} style={{ margin: 0 }}>{body.name}</h2>
          <div className={`${s.eyebrow} ${s.cardType}`}>{facts.type}</div>
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="Close (Esc)"><Icon.close /></button>
      </header>

      {!body.isSun && (
        <button type="button" className={s.followBtn} aria-pressed={following} onClick={onFollow}>
          <Icon.target /> {following ? "Following — click to stop" : `Follow ${body.name}`}
        </button>
      )}

      {!body.isSun && (
        <div className={s.stats}>
          <div className={s.stat}>
            <div className={s.eyebrow}>From Sun</div>
            <div className={s.statValue}>{distAU.toFixed(2)}<small>AU</small></div>
          </div>
          <div className={s.stat}>
            <div className={s.eyebrow}>Speed</div>
            <div className={s.statValue}>{velKmS.toFixed(1)}<small>km/s</small></div>
          </div>
          <div className={s.stat}>
            <div className={s.eyebrow}>Mass</div>
            <div className={s.statValue}>
              {earthMasses < 0.01 ? earthMasses.toExponential(1) : earthMasses < 1000 ? earthMasses.toFixed(2) : Math.round(earthMasses).toLocaleString()}
              <small>M⊕</small>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <dl className={s.facts}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className={s.eyebrow}>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {facts.surfaceGravity && (
        <div className={s.weigh}>
          <div className={s.eyebrow} style={{ color: "var(--amber)" }}>What would you weigh here?</div>
          <div className={s.weighRow}>
            <input
              type="number"
              min={1}
              value={yourWeight}
              aria-label="Your weight on Earth in kilograms"
              onChange={(e) => setYourWeight(Math.max(1, parseInt(e.target.value) || 1))}
            />
            kg on Earth
            <span className={s.weighResult}>{(yourWeight * facts.surfaceGravity).toFixed(1)}<small>kg</small></span>
          </div>
        </div>
      )}

      {facts.funFact && <blockquote className={s.quote}>{facts.funFact}</blockquote>}
    </article>
  );
}
