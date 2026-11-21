import { useState } from "react";
import { DT, STAR_THRESHOLD_JUPITERS } from "@/lib/sim/constants.js";
import { BELTS } from "@/lib/sim/physics.js";
import { SCENARIOS } from "@/lib/sim/scenarios.js";
import { Chip, Icon, ScenarioGlyph, Section, Slider, styles as s } from "./ui";


export default function ControlPanel({
  open, scenarioId, onScenario, settings, set, hud, selected, follow, onSelect, onRecenter, onCopyLink,
}) {
  const st = settings;
  const [copied, setCopied] = useState(null);
  const copy = async () => {
    setCopied((await onCopyLink()) ? "Link copied" : "Copy failed — use the address bar");
    setTimeout(() => setCopied(null), 2000);
  };
  const jupiterIsStar = st.jupMass >= STAR_THRESHOLD_JUPITERS;

  return (
    <aside className={`${s.frame} ${s.panel}`} data-open={open} aria-label="Simulation controls" aria-hidden={!open} inert={!open}>
      <Section index="01" title="Scenarios">
        <ul className={s.scenarios}>
          {SCENARIOS.map((sc, i) => {
            const active = scenarioId === sc.id;
            return (
              <li key={sc.id}>
                <button type="button" className={s.scenario} aria-pressed={active} onClick={() => onScenario(sc.id)} title={`Key ${i + 1}`}>
                  <span className={s.scenarioNum}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={s.scenarioGlyph}><ScenarioGlyph id={sc.id} /></span>
                  <span>{sc.name}</span>
                  {active && <span className={s.scenarioBlurb}>{sc.blurb}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className={s.shareRow}>
          <Chip onClick={copy} title="Copy a link to exactly this setup"><Icon.link /> Copy link</Chip>
          {copied && <span className={s.shareMsg}>{copied}</span>}
        </div>
      </Section>

      <Section index="02" title="Chaos lab">
        <Slider label="Sun mass" value={st.sunMass} min={0.1} max={10} log onChange={set.sunMass}
          hot={st.sunMass !== 1} format={(v) => v.toFixed(2) + "×"} />
        <Slider
          label={jupiterIsStar ? "Jupiter mass — it's a star!" : "Jupiter mass"}
          value={st.jupMass} min={0.1} max={1000} log onChange={set.jupMass} hot={st.jupMass !== 1}
          format={(v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + "×"}
        />
      </Section>

      <Section index="03" title="Belts">
        <div className={s.chips}>
          {Object.entries(BELTS).map(([key, def]) => (
            <Chip key={key} active={st.belts[key]} onClick={() => set.belt(key, !st.belts[key])} title={`Key ${key === "asteroids" ? "A" : "K"}`}>
              {def.label}
            </Chip>
          ))}
        </div>
        {Object.keys(hud.belts).length > 0 && (
          <div className={s.beltStats}>
            {Object.entries(hud.belts).map(([key, b]) => (
              <div key={key}>
                {BELTS[key].label}: <b>{b.alive.toLocaleString()}</b>
                {b.ejected > 0 && <span className={s.lost}> · {b.ejected} flung out</span>}
                {b.swallowed > 0 && <span className={s.lost}> · {b.swallowed} into the Sun</span>}
              </div>
            ))}
          </div>
        )}
        <p className={s.note}>
          <strong>Not to scale.</strong> The real asteroid belt has over a million asteroids bigger than 1&nbsp;km,
          but neighbours are typically about a million km apart. Spacecraft fly straight through. Each dot here is drawn
          millions of times bigger than a real asteroid.
        </p>
      </Section>

      <Section index="04" title="View">
        <Slider label="Distance warp" value={st.distExp} min={0.2} max={1} step={0.01} onChange={set.distExp}
          format={(v) => (v >= 0.95 ? "true scale" : v <= 0.25 ? "max squash" : (v * 100).toFixed(0) + "%")} />
        <Slider label="Planet size" value={st.sizeMult} min={0.3} max={4} step={0.1} onChange={set.sizeMult}
          format={(v) => v.toFixed(1) + "×"} />
        <div className={s.chips}>
          <Chip active={st.showTrails} onClick={() => set.showTrails((t) => !t)} title="Key T">Trails</Chip>
          <Chip active={st.showGrav} onClick={() => set.showGrav((g) => !g)} title="Key G">Gravity map</Chip>
          <Chip onClick={onRecenter} title="Reset zoom and pan (C)"><Icon.target /> Recenter</Chip>
        </div>
      </Section>

      <Section index="05" title="Bodies">
        <ul className={s.bodies}>
          {hud.bodies.map((d, i) => !d.isSun && !d.hidden && (
            <li key={d.name}>
              <button type="button" className={s.body} onClick={() => onSelect(i)} aria-pressed={selected === i} data-gone={d.removed || undefined}>
                <span className={s.bodyDot} style={{ background: d.color, boxShadow: d.isStar ? `0 0 8px ${d.color}` : undefined }} />
                {d.name}
                {follow === i && <span className={s.eyebrow} style={{ color: "var(--amber)" }}>following</span>}
                <span className={s.bodyMeta}>
                  {d.shattered ? "shattered" : d.merged ? "merged" : d.a ? `${d.a.toFixed(1)} AU`
                    : d.fragment ? "chunk" : d.launched ? "yours" : d.isStar ? "star" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section index="06" title="Event log">
        {hud.debris.pieces > 0 && (
          <div className={s.beltStats}>
            Debris: <b>{hud.debris.pieces.toLocaleString()}</b> pieces in {hud.debris.clouds} cloud{hud.debris.clouds > 1 ? "s" : ""}
          </div>
        )}
        {hud.log.length === 0 && hud.escaped.length === 0 ? (
          <p className={s.logEmpty}>Nothing dramatic yet. Try launching something (press <kbd>L</kbd>) or a chaos scenario.</p>
        ) : (
          <ul className={s.log}>
            {hud.escaped.length > 0 && (
              <li className={s.logItem} data-kind="escape">
                <span className={s.logDate}>now</span>
                <span>Left the solar system: {hud.escaped.join(", ")}</span>
              </li>
            )}
            {hud.log.map((e, i) => (
              <li key={i} className={s.logItem} data-kind={e.kind}>
                <span className={s.logDate}>{e.date}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className={s.footer}>
        <div className={s.physics}>
          Velocity-Verlet N-body · dt = {DT} yr<br />
          Real starting positions from JPL orbital elements<br />
          Time-reversible: rewind retraces exactly
        </div>
      </footer>
    </aside>
  );
}
