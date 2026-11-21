// Planetary impacts: merge vs shatter, fragments and debris, and rewinding through it all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, createSystem } from "../lib/sim/physics.js";
import {
  disruptionThreshold, impactSpeeds, largestRemnantFraction, planImpact, starImpactEnergyYears, toKms,
} from "../lib/sim/impacts.js";
import { launch } from "../lib/sim/sandbox.js";

const DATE = new Date("2026-11-21T12:00:00Z");
const KMS = 4.74047; // km/s per AU/yr
const earth = { mass: 3.003e-6, radiusKm: 6371 };
const at = (A, B, kms, d = 0.02) => [
  { ...A, x: 0, y: 0, vx: 0, vy: 0 },
  { ...B, x: d, y: 0, vx: -kms / KMS, vy: 0 },
];

test("scaling laws give the published numbers", () => {
  // Leinhardt & Stewart (2012): Q*_RD for two Earth masses is a few times 10^7 J/kg.
  const q = disruptionThreshold(2 * earth.mass);
  assert.ok(q > 3e7 && q < 1.5e8, `Q*_RD = ${q}`);
  // Two Earths drifting together still hit at their mutual escape speed (~11.2 km/s).
  const s = impactSpeeds(...at(earth, earth, 0));
  assert.ok(Math.abs(toKms(s.vImp) - 11.2) < 0.2 && Math.abs(toKms(s.vEsc) - 11.2) < 0.2);
});

test("slow impacts merge, fast ones shatter, faster ones shatter more", () => {
  assert.equal(largestRemnantFraction(...at(earth, earth, 0)), 1);
  const f15 = largestRemnantFraction(...at(earth, earth, 15));
  const f30 = largestRemnantFraction(...at(earth, earth, 30));
  assert.ok(f15 < 0.9 && f15 > f30, `${f15} then ${f30}`);
});

test("a shatter plan conserves momentum among the massive pieces", () => {
  const [T, P] = at(earth, { mass: 3.213e-7, radiusKm: 3390 }, 30);
  const plan = planImpact(T, P, { seed: 7, reach: (m) => 0.012 * Math.cbrt(m / 3.003e-6) });
  assert.equal(plan.kind, "shatter");
  let px = plan.remnant.mass * plan.remnant.vx, py = plan.remnant.mass * plan.remnant.vy;
  for (const f of plan.fragments) { px += f.mass * f.vx; py += f.mass * f.vy; }
  assert.ok(Math.hypot(px, py) < 1e-18, `net momentum ${Math.hypot(px, py)}`);
  const total = plan.remnant.mass + plan.fragments.reduce((a, f) => a + f.mass, 0) + plan.debrisMass;
  assert.ok(Math.abs(total - (T.mass + P.mass)) < 1e-18, "mass adds up (remnant + fragments + debris)");
  assert.ok(plan.fragments.length > 0 && plan.debris.length > 0);
  for (const f of plan.fragments) assert.ok(f.mass < plan.remnant.mass, "the largest remnant stays the largest piece");
});

test("falling into the Sun: Earth releases ~94 years of sunlight, Jupiter ~30,000", () => {
  const sun = { mass: 1, radiusKm: 696340 };
  assert.ok(Math.abs(starImpactEnergyYears(sun, earth) - 94) < 3);
  assert.ok(Math.abs(starImpactEnergyYears(sun, { mass: 9.543e-4, radiusKm: 69911 }) - 30000) < 1000);
});

/** Throw a planet head-on into Earth, fast. */
function smashIntoEarth() {
  const sys = createSystem(DATE, 11);
  advance(sys, 100, Infinity, 1);
  const S = sys.bodies[0], E = sys.bodies[3];
  const ex = E.x - S.x, ey = E.y - S.y, evx = E.vx - S.vx, evy = E.vy - S.vy;
  // Start 0.08 AU ahead of Earth on its orbit, moving backwards at Earth's speed (~60 km/s relative).
  const v = Math.hypot(evx, evy), ux = evx / v, uy = evy / v;
  launch(sys, "planet", ex + ux * 0.08, ey + uy * 0.08, -evx, -evy);
  const startStep = sys.stepCount;
  for (let k = 0; k < 400 && !sys.history.some((r) => r.kind === "impact"); k++) advance(sys, 5, Infinity, 1);
  return { sys, startStep };
}

test("a fast impact shatters Earth into fragments and a debris cloud", () => {
  const { sys } = smashIntoEarth();
  const rec = sys.history.find((r) => r.kind === "impact");
  assert.ok(rec, "expected a shattering impact");
  assert.match(rec.text, /hit Earth at \d+ km\/s\. Earth kept \d+% of the mass/);
  assert.ok(rec.created.length > 0, "big fragments");
  assert.ok(sys.belts[rec.debrisKey].n > 0, "debris cloud");
  const earthNow = sys.bodies[3];
  assert.ok(earthNow.mass < 2 * 3.003e-6 && !earthNow.removed, "Earth survives as the largest remnant");
  advance(sys, 2000, Infinity, 1); // fragments keep orbiting under gravity
  assert.ok(sys.bodies.every((b) => [b.x, b.y, b.vx, b.vy].every(Number.isFinite)));
});

test("rewinding un-shatters exactly, and replay rebuilds the same pieces in the same slots", () => {
  const { sys, startStep } = smashIntoEarth();
  const rec = sys.history.find((r) => r.kind === "impact");
  advance(sys, 300, Infinity, 1);
  const laterStep = sys.stepCount;
  const nBodies = sys.bodies.length;
  const later = sys.bodies.map((b) => [b.x, b.y, b.mass]);
  const debrisLater = Float64Array.from(sys.belts[rec.debrisKey].x);

  advance(sys, laterStep - startStep, Infinity, -1); // back to just after the launch
  assert.equal(sys.stepCount, startStep);
  assert.equal(sys.belts[rec.debrisKey], undefined, "debris gone before the impact");
  assert.equal(sys.bodies[3].mass, 3.003e-6, "Earth whole again");
  for (const c of rec.created) assert.equal(sys.bodies[c.index].unborn, true);

  advance(sys, laterStep - startStep, Infinity, 1); // and forward again
  assert.equal(sys.bodies.length, nBodies, "no duplicate fragments");
  let err = 0;
  sys.bodies.forEach((b, i) => { err = Math.max(err, Math.abs(b.x - later[i][0]), Math.abs(b.y - later[i][1]), Math.abs(b.mass - later[i][2])); });
  const errD = Math.max(...sys.belts[rec.debrisKey].x.map((v, i) => Math.abs(v - debrisLater[i])));
  assert.ok(err < 1e-9 && errD < 1e-9, `bodies ${err}, debris ${errD}`);
});

test("a planet falling into the Sun is swallowed, with the energy in the log", () => {
  const sys = createSystem(DATE, 2);
  launch(sys, "planet", 0.5, 0, 0, 0.3); // almost no sideways speed: it falls straight in
  advance(sys, 3000, Infinity, 1);
  const rec = sys.history.find((r) => r.kind === "merge");
  assert.ok(rec, "expected it to hit the Sun");
  assert.match(rec.text, /^Planet 1 fell into the Sun at \d+ km\/s, releasing as much energy as the Sun puts out in \d+ years$/);
});
