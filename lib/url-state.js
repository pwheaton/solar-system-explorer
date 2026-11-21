// Read and write the simulator setup in the page URL, so a link reproduces
// the same scenario, start date, belts (via the seed) and settings.
//
// Example: ?s=flyby&d=2026-11-21&seed=12345&jup=80&follow=Neptune
// The default view (today, nothing changed) is just the plain URL.

import { SCENARIO_DEFAULTS, getScenario } from "./sim/scenarios.js";

const NUM = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function readUrlState(search) {
  const p = new URLSearchParams(search);
  const date = p.get("d");
  const parsedDate = date && /^-?\d{4,6}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : undefined;
  const beltsParam = p.get("belts");
  return {
    scenario: p.get("s") || undefined,
    date: parsedDate && !isNaN(parsedDate) ? parsedDate : undefined,
    seed: NUM(p.get("seed")),
    overrides: clean({
      speed: NUM(p.get("speed")),
      sunMass: NUM(p.get("sun")),
      jupMass: NUM(p.get("jup")),
      distExp: NUM(p.get("warp")),
      sizeMult: NUM(p.get("scale")),
      zoom: NUM(p.get("zoom")),
      showTrails: p.has("trails") ? p.get("trails") !== "0" : undefined,
      showGrav: p.has("grav") ? p.get("grav") === "1" : undefined,
      belts: beltsParam != null ? { asteroids: beltsParam.includes("a"), kuiper: beltsParam.includes("k") } : undefined,
    }),
    follow: p.get("follow") || undefined,
  };
}

/**
 * Only what differs from the defaults goes in the URL, so the default view is
 * just the plain address. As soon as anything differs, the start date and belt
 * seed come along too, so a shared link reproduces exactly what you saw.
 * Returns "" for the default state, otherwise "?…".
 */
export function writeUrlState(state) {
  const defaults = { ...SCENARIO_DEFAULTS, ...getScenario(state.scenario).settings };
  const p = new URLSearchParams();
  if (state.scenario !== "today") p.set("s", state.scenario);
  if (Math.abs(state.speed - defaults.speed) > 1e-9) p.set("speed", round(state.speed));
  if (state.sunMass !== 1 && !state.sunByEvent) p.set("sun", round(state.sunMass));
  if (state.jupMass !== 1 && !state.ramping) p.set("jup", round(state.jupMass));
  if (state.distExp !== defaults.distExp) p.set("warp", round(state.distExp));
  if (state.sizeMult !== defaults.sizeMult) p.set("scale", round(state.sizeMult));
  if (state.showTrails !== defaults.showTrails) p.set("trails", state.showTrails ? "1" : "0");
  if (state.showGrav !== defaults.showGrav) p.set("grav", state.showGrav ? "1" : "0");
  if (state.belts.asteroids !== defaults.belts.asteroids || state.belts.kuiper !== defaults.belts.kuiper) {
    p.set("belts", (state.belts.asteroids ? "a" : "") + (state.belts.kuiper ? "k" : ""));
  }
  if (state.follow) p.set("follow", state.follow);
  if (p.size === 0) return "";
  // Something's non-default: pin the date and belts so the link reproduces it.
  const pinned = new URLSearchParams();
  if (p.has("s")) pinned.set("s", p.get("s"));
  pinned.set("d", state.date.toISOString().slice(0, 10));
  pinned.set("seed", String(state.seed));
  for (const [k, v] of p) if (k !== "s") pinned.set(k, v);
  return `?${pinned.toString()}`;
}

function round(v) {
  return String(Number(v.toPrecision(3)));
}

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
