// Read and write the simulator setup in the page URL, so a link reproduces
// the same scenario, start date, belts (via the seed) and settings.
//
// Example: ?s=flyby&d=2026-11-21&seed=12345&speed=2&jup=1&belts=ak&follow=Neptune

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

export function writeUrlState(state) {
  const p = new URLSearchParams();
  p.set("s", state.scenario);
  p.set("d", state.date.toISOString().slice(0, 10));
  p.set("seed", String(state.seed));
  p.set("speed", round(state.speed));
  if (state.sunMass !== 1) p.set("sun", round(state.sunMass));
  if (state.jupMass !== 1 && !state.ramping) p.set("jup", round(state.jupMass));
  if (state.distExp !== 0.42) p.set("warp", round(state.distExp));
  if (state.sizeMult !== 1) p.set("scale", round(state.sizeMult));
  if (!state.showTrails) p.set("trails", "0");
  if (state.showGrav) p.set("grav", "1");
  p.set("belts", (state.belts.asteroids ? "a" : "") + (state.belts.kuiper ? "k" : ""));
  if (state.follow) p.set("follow", state.follow);
  return `?${p.toString()}`;
}

function round(v) {
  return String(Number(v.toPrecision(3)));
}

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
