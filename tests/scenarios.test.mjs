// Scenario and link checks: each scenario should do what its description says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, runScenario } from "../lib/sim/scenarios.js";
import { readUrlState, writeUrlState } from "../lib/url-state.js";

const DATE = new Date("2026-11-21T12:00:00Z");
const dist = (sys, name) => {
  const sun = sys.bodies[0];
  const b = sys.bodies.find((x) => x.name === name);
  return Math.hypot(b.x - sun.x, b.y - sun.y);
};
const allFinite = (sys) => sys.bodies.every((b) => [b.x, b.y, b.vx, b.vy].every(Number.isFinite));

test("every scenario runs to its preview time without blowing up", () => {
  for (const sc of SCENARIOS) {
    const { sys } = runScenario(sc.id, { date: DATE, seed: 42, belts: { asteroids: true, kuiper: true }, beltCount: 100 });
    assert.ok(allFinite(sys), `${sc.id}: non-finite positions`);
    assert.ok(Math.abs(sys.t - (sc.previewYears ?? 0)) < 1e-6, `${sc.id}: stopped at ${sys.t}`);
  }
});

test("rogue star flyby disturbs the outer planets but leaves the inner ones alone", () => {
  const { sys } = runScenario("flyby", { date: DATE, seed: 42, years: 45 });
  assert.ok(sys.bodies.some((b) => b.name === "Rogue Star"));
  assert.ok(Math.abs(dist(sys, "Earth") - 1) < 0.05, "Earth should be unaffected");
  assert.ok(Math.abs(dist(sys, "Uranus") - 19.2) > 3, "Uranus should be knocked off its orbit");
});

test("deleting the Sun sends planets off in straight lines", () => {
  const { sys } = runScenario("nosun", { date: DATE, years: 6 });
  assert.equal(sys.bodies[0].removed, true);
  assert.ok(dist(sys, "Mercury") > 20, `Mercury only at ${dist(sys, "Mercury")} AU`);
  assert.ok(dist(sys, "Earth") > 10, `Earth only at ${dist(sys, "Earth")} AU`);
});

test("halving the Sun's mass unbinds the planets", () => {
  const { sys, sunMass } = runScenario("halfsun", { date: DATE, years: 15 });
  assert.equal(sunMass, 0.5);
  assert.ok(dist(sys, "Earth") > 3, `Earth only at ${dist(sys, "Earth")} AU`);
});

test("Jupiter ignites to 1000x by year 11", () => {
  assert.equal(Math.round(runScenario("ignite", { date: DATE, years: 0.5 }).jupMass), 1);
  assert.equal(Math.round(runScenario("ignite", { date: DATE, years: 12 }).jupMass), 1000);
});

test("binary companion keeps the inner planets", () => {
  const { sys } = runScenario("binary", { date: DATE, years: 30 });
  for (const name of ["Mercury", "Venus", "Earth"]) {
    const r = dist(sys, name);
    assert.ok(r < 1.6, `${name} at ${r} AU`);
  }
});

test("mass changes made by scenario events stay out of links", () => {
  const base = {
    scenario: "halfsun", date: DATE, seed: 1, speed: 0.5, jupMass: 1, distExp: 0.42, sizeMult: 1,
    showTrails: true, showGrav: false, belts: { asteroids: true, kuiper: true }, follow: null,
  };
  assert.ok(!writeUrlState({ ...base, sunMass: 0.5, sunByEvent: true }).includes("sun="));
  assert.ok(writeUrlState({ ...base, sunMass: 0.5, sunByEvent: false }).includes("sun=0.5"));
});

test("the default view is a plain URL; anything changed pins date and seed", () => {
  const base = {
    scenario: "today", date: DATE, seed: 42, speed: 0.1, sunMass: 1, jupMass: 1, distExp: 0.42, sizeMult: 1,
    showTrails: true, showGrav: false, belts: { asteroids: true, kuiper: true }, follow: null,
  };
  assert.equal(writeUrlState(base), "");
  assert.equal(writeUrlState({ ...base, sunMass: 3 }), "?d=2026-11-21&seed=42&sun=3");
  // A scenario at its own default speed doesn't repeat the speed.
  assert.equal(writeUrlState({ ...base, scenario: "flyby", speed: 2 }), "?s=flyby&d=2026-11-21&seed=42");
  assert.equal(writeUrlState({ ...base, belts: { asteroids: true, kuiper: false } }), "?d=2026-11-21&seed=42&belts=a");
});

test("URL state round-trips", () => {
  const state = {
    scenario: "flyby", date: DATE, seed: 42, speed: 2, sunMass: 1, jupMass: 80, ramping: false,
    distExp: 0.6, sizeMult: 1.5, showTrails: false, showGrav: true,
    belts: { asteroids: true, kuiper: false }, follow: "Jupiter",
  };
  const back = readUrlState(writeUrlState(state));
  assert.equal(back.scenario, "flyby");
  assert.equal(back.date.toISOString().slice(0, 10), "2026-11-21");
  assert.equal(back.seed, 42);
  assert.equal(back.follow, "Jupiter");
  // speed 2 is the flyby's default, so it isn't written (or read back).
  assert.deepEqual(back.overrides, {
    jupMass: 80, distExp: 0.6, sizeMult: 1.5, showTrails: false, showGrav: true,
    belts: { asteroids: true, kuiper: false },
  });
});
