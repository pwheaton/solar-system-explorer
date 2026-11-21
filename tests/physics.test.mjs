// Physics checks: run with `npm test` (node --test). No dependencies.
// These guard the things that are easy to break silently: real starting
// positions, energy conservation, exact rewind, and reproducible belts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { G } from "../lib/sim/constants.js";
import { addBelt, advance, createSystem } from "../lib/sim/physics.js";

const DATE = new Date("2026-11-21T12:00:00Z");

function energy(bodies) {
  let E = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    E += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy);
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      E -= (G * a.mass * b.mass) / Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  return E;
}

const helioLongitude = (sys, name) => {
  const sun = sys.bodies[0];
  const b = sys.bodies.find((x) => x.name === name);
  return ((Math.atan2(b.y - sun.y, b.x - sun.x) * 180) / Math.PI + 360) % 360;
};

test("planets start at their real positions", () => {
  // On 21 Nov the Sun's apparent longitude is ~239°, so Earth's heliocentric
  // longitude is ~59°. Jupiter is near 135° in late 2026.
  const sys = createSystem(DATE, 1);
  assert.ok(Math.abs(helioLongitude(sys, "Earth") - 59) < 1.5, `Earth at ${helioLongitude(sys, "Earth")}°`);
  assert.ok(Math.abs(helioLongitude(sys, "Jupiter") - 135) < 3, `Jupiter at ${helioLongitude(sys, "Jupiter")}°`);
  const sun = sys.bodies[0];
  const earth = sys.bodies.find((b) => b.name === "Earth");
  const r = Math.hypot(earth.x - sun.x, earth.y - sun.y);
  assert.ok(r > 0.983 && r < 1.017, `Earth at ${r} AU`);
});

test("system starts with zero net momentum (no drift)", () => {
  const sys = createSystem(DATE, 1);
  let px = 0, py = 0;
  for (const b of sys.bodies) { px += b.mass * b.vx; py += b.mass * b.vy; }
  assert.ok(Math.hypot(px, py) < 1e-14);
});

test("energy is conserved over 10 years", () => {
  const sys = createSystem(DATE, 1);
  const E0 = energy(sys.bodies);
  advance(sys, 50000, Infinity, 1);
  const drift = Math.abs((energy(sys.bodies) - E0) / E0);
  assert.ok(drift < 1e-5, `relative energy drift ${drift}`);
});

test("planets complete their orbits on schedule", () => {
  // After exactly one Earth year, Earth should be back within ~1° of where it started.
  const sys = createSystem(DATE, 1);
  const start = helioLongitude(sys, "Earth");
  advance(sys, Math.round(1.00004 / 0.0002), Infinity, 1);
  let d = Math.abs(helioLongitude(sys, "Earth") - start);
  if (d > 180) d = 360 - d;
  assert.ok(d < 1, `Earth off by ${d}° after one year`);
});

test("rewind retraces exactly, belts included, even when flipped mid-step", () => {
  const sys = createSystem(DATE, 42);
  addBelt(sys, "asteroids", { count: 400 });
  addBelt(sys, "kuiper", { count: 400 });
  const before = sys.bodies.map((b) => [b.x, b.y, b.vx, b.vy]);
  const ast = Float64Array.from(sys.belts.asteroids.x);
  const kui = Float64Array.from(sys.belts.kuiper.y);

  advance(sys, 5003, Infinity, 1); // ends mid belt-step
  advance(sys, 5, Infinity, -1);
  advance(sys, 7, Infinity, 1);
  advance(sys, 5005, Infinity, -1);

  assert.equal(sys.stepCount, 0);
  let maxBody = 0;
  sys.bodies.forEach((b, i) => [b.x, b.y, b.vx, b.vy].forEach((v, j) => { maxBody = Math.max(maxBody, Math.abs(v - before[i][j])); }));
  const maxAst = Math.max(...sys.belts.asteroids.x.map((v, i) => Math.abs(v - ast[i])));
  const maxKui = Math.max(...sys.belts.kuiper.y.map((v, i) => Math.abs(v - kui[i])));
  assert.ok(maxBody < 1e-9, `bodies off by ${maxBody}`);
  assert.ok(maxAst < 1e-9, `asteroids off by ${maxAst}`);
  assert.ok(maxKui < 1e-9, `Kuiper belt off by ${maxKui}`);
});

test("belts are reproducible from the seed", () => {
  const a = createSystem(DATE, 1234);
  const b = createSystem(DATE, 1234);
  const c = createSystem(DATE, 99);
  addBelt(a, "asteroids");
  addBelt(b, "asteroids");
  addBelt(c, "asteroids");
  assert.deepEqual(Array.from(a.belts.asteroids.x.slice(0, 50)), Array.from(b.belts.asteroids.x.slice(0, 50)));
  assert.notDeepEqual(Array.from(a.belts.asteroids.x.slice(0, 50)), Array.from(c.belts.asteroids.x.slice(0, 50)));
});

test("thinned belts are a prefix of the full belt (link previews match the app)", () => {
  const full = createSystem(DATE, 7);
  const thin = createSystem(DATE, 7);
  addBelt(full, "kuiper");
  addBelt(thin, "kuiper", { count: 100 });
  assert.equal(thin.belts.kuiper.n, 100);
  assert.deepEqual(Array.from(thin.belts.kuiper.x), Array.from(full.belts.kuiper.x.slice(0, 100)));
});

test("asteroids stay in the belt over a decade", () => {
  const sys = createSystem(DATE, 5);
  addBelt(sys, "asteroids", { count: 500 });
  advance(sys, 50000, Infinity, 1);
  const { x, y, alive, n } = sys.belts.asteroids;
  const sun = sys.bodies[0];
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(x[i] - sun.x, y[i] - sun.y);
    if (alive[i] && r > 1.6 && r < 4.5) inside++;
  }
  assert.ok(inside / n > 0.97, `only ${inside}/${n} still in the belt`);
});
