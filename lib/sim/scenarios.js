// @ts-check
// One-click scenarios. Each one starts from today's real solar system and
// then changes something: adds a body, schedules an event at a set sim time,
// or ramps a mass over time. Events and ramps are tied to sim time, so they
// undo themselves when you rewind past them.

import { G } from "./constants.js";
import { addBelt, addBody, advance, createSystem, setMassMultipliers, setSunRemoved, toBarycentricFrame } from "./physics.js";

/** @typedef {import("./types").MassRamp} MassRamp */
/** @typedef {import("./types").Scenario} Scenario */
/** @typedef {import("./types").ScenarioSettings} ScenarioSettings */

/**
 * Settings every scenario starts from unless it overrides them.
 * @type {ScenarioSettings}
 */
export const SCENARIO_DEFAULTS = {
  speed: 0.1,
  sunMass: 1,
  jupMass: 1,
  distExp: 0.42,
  sizeMult: 1,
  showTrails: true,
  showGrav: false,
  belts: { asteroids: true, kuiper: true },
  zoom: 1,
  follow: null,
};

/**
 * @type {Scenario[]}
 */
export const SCENARIOS = [
  {
    id: "today",
    previewYears: 0,
    name: "Today's sky",
    blurb: "The solar system as it is right now, planets in their real positions.",
  },
  {
    id: "flyby",
    previewYears: 29,
    name: "Rogue star flyby",
    blurb: "A star 80% as massive as the Sun plunges through the outer solar system, passing inside Uranus's orbit. Watch the ice giants and the Kuiper belt.",
    settings: { speed: 2, zoom: 0.7 },
    setup(sys) {
      addBody(sys, {
        name: "Rogue Star", mass: 0.8, color: "#C8D8FF", displayRadius: 7,
        isStar: true, starPalette: "white", period: 40,
        type: "Passing star (0.8 M☉)",
        description: "A wandering star on a one-way trip past the Sun. Close stellar flybys like this happen to most stars over billions of years. One may have shaped our own Kuiper belt.",
        x: -95, y: 14, vx: 4.5, vy: 0,
      });
    },
  },
  {
    id: "binary",
    previewYears: 25,
    name: "Binary star",
    blurb: "The Sun gets a red dwarf companion 14 AU out, just beyond Saturn. The inner planets hang on. The giants have a rough time.",
    settings: { speed: 1, zoom: 0.85 },
    setup(sys) {
      const m = 0.4;
      const r = 14;
      const angle = (200 * Math.PI) / 180;
      const v = Math.sqrt((G * (1 + m)) / r);
      addBody(sys, {
        name: "Companion", mass: m, color: "#FF9A6A", displayRadius: 7,
        isStar: true, starPalette: "red", period: Math.sqrt((r * r * r) / (1 + m)),
        type: "Red dwarf (0.4 M☉)",
        description: "About half of Sun-like stars have a companion star. Planets can survive in a binary, but only on orbits well inside or far outside the companion's path.",
        x: r * Math.cos(angle), y: r * Math.sin(angle),
        vx: -v * Math.sin(angle), vy: v * Math.cos(angle),
      });
      toBarycentricFrame(sys.bodies);
    },
  },
  {
    id: "ignite",
    previewYears: 12,
    name: "Jupiter ignites",
    blurb: "Starting in year 1, Jupiter gains mass until it's 1,000× heavier. Past ~80× it would start fusing hydrogen and become a star.",
    settings: { speed: 1 },
    ramp: { key: "jupMass", t0: 1, t1: 11, from: 1, to: 1000 },
  },
  {
    id: "halfsun",
    previewYears: 8,
    name: "Sun loses half its mass",
    blurb: "In year 1 the Sun suddenly loses half its mass. For a circular orbit, that's exactly the escape threshold, so every planet ends up barely bound or flying away.",
    settings: { speed: 0.5 },
    events: [{
      t: 1,
      label: "Year 1: the Sun just lost half its mass.",
      undoLabel: "Rewound past year 1: the Sun has its mass back.",
      do: (ctl) => ctl.setSunMass(0.5),
      undo: (ctl) => ctl.setSunMass(1),
    }],
  },
  {
    id: "nosun",
    previewYears: 4,
    name: "Delete the Sun",
    blurb: "In year 1 the Sun vanishes. Every planet flies off in a straight line at the speed it was orbiting.",
    settings: { speed: 0.3 },
    events: [{
      t: 1,
      label: "Year 1: the Sun is gone.",
      undoLabel: "Rewound past year 1: the Sun is back.",
      do: (ctl) => setSunRemoved(ctl.sys, true),
      undo: (ctl) => setSunRemoved(ctl.sys, false),
    }],
  },
];

/**
 * @param {string} id
 * @returns {Scenario}
 */
export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

/**
 * Value of a mass ramp at sim time t (log-linear between t0 and t1).
 * @param {MassRamp} ramp
 * @param {number} t
 */
export function rampValue(ramp, t) {
  const f = Math.max(0, Math.min(1, (t - ramp.t0) / (ramp.t1 - ramp.t0)));
  return ramp.from * Math.pow(ramp.to / ramp.from, f);
}

/**
 * Build a scenario's system and play it forward `years` without a browser:
 * same physics, events and mass ramps as the app. Used by tests and by the
 * link-preview image. Returns the system plus the mass multipliers in effect.
 *
 * @param {string} id  scenario id
 * @param {{
 *   date?: Date, seed?: number, years?: number,
 *   belts?: Record<string, boolean>, beltCount?: number,
 *   sunMass?: number, jupMass?: number,
 * }} [options]
 */
export function runScenario(id, { date = new Date(), seed = 1, years, belts = {}, beltCount, sunMass = 1, jupMass = 1 } = {}) {
  const sc = getScenario(id);
  const sys = createSystem(date, seed);
  sc.setup?.(sys);
  for (const [key, on] of Object.entries(belts)) if (on) addBelt(sys, key, { count: beltCount });
  const events = (sc.events || []).map((e) => ({ ...e, done: false }));
  const state = { sunMass, jupMass };
  const ctl = { sys, setSunMass: (/** @type {number} */ v) => { state.sunMass = v; } };
  const target = years ?? sc.previewYears ?? 0;
  const CHUNK = 250; // apply events and ramps every 0.05 sim-years, like the app's per-frame checks

  while (sys.t < target - 1e-9) {
    for (const e of events) if (!e.done && sys.t >= e.t) { e.done = true; e.do(ctl); }
    const jup = sc.ramp ? rampValue(sc.ramp, sys.t) : state.jupMass;
    setMassMultipliers(sys, state.sunMass, jup);
    const steps = Math.min(CHUNK, Math.round((target - sys.t) / 0.0002));
    if (steps <= 0) break;
    advance(sys, steps, Infinity, 1);
  }
  for (const e of events) if (!e.done && sys.t >= e.t) { e.done = true; e.do(ctl); }
  const finalJup = sc.ramp ? rampValue(sc.ramp, sys.t) : state.jupMass;
  setMassMultipliers(sys, state.sunMass, finalJup);
  return { sys, scenario: sc, sunMass: state.sunMass, jupMass: finalJup };
}
