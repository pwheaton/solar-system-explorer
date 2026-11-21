// One-click scenarios. Each one starts from today's real solar system and
// then changes something: adds a body, schedules an event at a set sim time,
// or ramps a mass over time. Events and ramps are tied to sim time, so they
// undo themselves when you rewind past them.

import { G } from "./constants.js";
import { addBody, setSunRemoved, toBarycentricFrame } from "./physics.js";

/** Settings every scenario starts from unless it overrides them. */
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

export const SCENARIOS = [
  {
    id: "today",
    name: "Today's sky",
    icon: "🌍",
    blurb: "The solar system as it is right now, planets in their real positions.",
  },
  {
    id: "flyby",
    name: "Rogue star flyby",
    icon: "💫",
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
    name: "Binary star",
    icon: "✴️",
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
    name: "Jupiter ignites",
    icon: "🔥",
    blurb: "Starting in year 1, Jupiter gains mass until it's 1,000× heavier. Past ~80× it would start fusing hydrogen and become a star.",
    settings: { speed: 1 },
    ramp: { key: "jupMass", t0: 1, t1: 11, from: 1, to: 1000 },
  },
  {
    id: "halfsun",
    name: "Sun loses half its mass",
    icon: "🌗",
    blurb: "In year 1 the Sun suddenly loses half its mass. For a circular orbit, that's exactly the escape threshold, so every planet ends up barely bound or flying away.",
    settings: { speed: 0.5 },
    events: [{
      t: 1,
      label: "☀ The Sun just lost half its mass",
      undoLabel: "⏪ The Sun has its mass back",
      do: (ctl) => ctl.setSunMass(0.5),
      undo: (ctl) => ctl.setSunMass(1),
    }],
  },
  {
    id: "nosun",
    name: "Delete the Sun",
    icon: "🕳️",
    blurb: "In year 1 the Sun vanishes. Every planet flies off in a straight line at the speed it was orbiting.",
    settings: { speed: 0.3 },
    events: [{
      t: 1,
      label: "☀ The Sun is gone",
      undoLabel: "⏪ The Sun is back",
      do: (ctl) => setSunRemoved(ctl.sys, true),
      undo: (ctl) => setSunRemoved(ctl.sys, false),
    }],
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

/** Value of a mass ramp at sim time t (log-linear between t0 and t1). */
export function rampValue(ramp, t) {
  const f = Math.max(0, Math.min(1, (t - ramp.t0) / (ramp.t1 - ramp.t0)));
  return ramp.from * Math.pow(ramp.to / ramp.from, f);
}
