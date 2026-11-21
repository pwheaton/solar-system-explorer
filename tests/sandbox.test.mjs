// Slingshot sandbox: launches, collisions, and rewinding through both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, addBelt, clearLaunched, createSystem } from "../lib/sim/physics.js";
import { launch, launchedCount, predictPath } from "../lib/sim/sandbox.js";

const DATE = new Date("2026-11-21T12:00:00Z");

/** A system with a gas giant dropped right next to Jupiter, on Jupiter's own orbit. */
function giantBesideJupiter() {
  const sys = createSystem(DATE, 42);
  advance(sys, 3000, Infinity, 1);
  const S = sys.bodies[0], J = sys.bodies[5];
  const index = launch(sys, "giant", J.x - S.x + 0.03, J.y - S.y, J.vx - S.vx, J.vy - S.vy);
  return { sys, index };
}

const totals = (sys) => {
  let m = 0, px = 0, py = 0;
  for (const b of sys.bodies) { m += b.mass; px += b.mass * b.vx; py += b.mass * b.vy; }
  return { m, px, py };
};

test("a collision merges bodies, conserving mass and momentum", () => {
  const { sys, index } = giantBesideJupiter();
  const before = totals(sys);
  advance(sys, 500, Infinity, 1);
  const merge = sys.history.find((r) => r.kind === "merge");
  assert.ok(merge, "expected a collision");
  assert.match(merge.text, /^Giant 1 merged into Jupiter at \d+ km\/s$/);
  assert.equal(sys.bodies[index].removed, true);
  const after = totals(sys);
  assert.ok(Math.abs(after.m - before.m) < 1e-15);
  assert.ok(Math.hypot(after.px - before.px, after.py - before.py) < 1e-15);
});

test("rewinding undoes a collision and a launch; replaying redoes both at the same step", () => {
  const { sys, index } = giantBesideJupiter();
  const launchStep = sys.stepCount;
  const jupiterBefore = { ...sys.bodies[5] };
  advance(sys, 500, Infinity, 1);
  const mergeStep = sys.history.find((r) => r.kind === "merge").step;

  advance(sys, sys.stepCount - (mergeStep - 1), Infinity, -1);
  assert.equal(sys.bodies[5].mass, jupiterBefore.mass, "Jupiter gets its own mass back");
  assert.equal(sys.bodies[index].removed, false, "the giant is back");

  advance(sys, sys.stepCount - (launchStep - 1), Infinity, -1);
  assert.equal(sys.bodies[index].unborn, true, "before its launch, the giant doesn't exist");
  assert.equal(launchedCount(sys), 0);
  const j = sys.bodies[5];
  assert.ok(Math.hypot(j.x - jupiterBefore.x, j.y - jupiterBefore.y) < 1e-3);

  advance(sys, 600, Infinity, 1);
  const replayed = sys.history.slice(0, sys.historyIndex).filter((r) => r.kind === "merge");
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].step, mergeStep, "same collision, same step");
});

test("launching after a rewind starts a new timeline", () => {
  const sys = createSystem(DATE, 1);
  advance(sys, 1000, Infinity, 1);
  const first = launch(sys, "planet", 3, 0, 0, 3.6);
  advance(sys, 500, Infinity, 1);
  advance(sys, 800, Infinity, -1); // back before the first launch
  const second = launch(sys, "planet", -3, 0, 0, -3.6);
  advance(sys, 1000, Infinity, 1);
  assert.equal(sys.bodies[first].discarded, true, "the old future's launch is gone");
  assert.equal(sys.bodies[second].removed, false);
  assert.equal(launchedCount(sys), 1);
});

test("clearing launched bodies removes them and their history", () => {
  const { sys } = giantBesideJupiter();
  launch(sys, "asteroid", 2.5, 0, 0, 4);
  advance(sys, 500, Infinity, 1);
  clearLaunched(sys);
  assert.equal(launchedCount(sys), 0);
  assert.equal(sys.history.length, 0);
  advance(sys, 100, Infinity, 1); // keeps running fine
  assert.ok(sys.bodies.every((b) => [b.x, b.y].every(Number.isFinite)));
});

test("predicted path matches what actually happens", () => {
  const sys = createSystem(DATE, 3);
  const shot = [2.2, 0, 0, 5.2]; // an eccentric orbit inside Jupiter's
  const { points, years } = predictPath(sys, "asteroid", ...shot);
  const index = launch(sys, "asteroid", ...shot);
  advance(sys, Math.round((years * 0.5) / 0.0002), Infinity, 1);
  const S = sys.bodies[0], b = sys.bodies[index];
  const at = points[Math.round((points.length - 1) * 0.5)];
  const err = Math.hypot(b.x - S.x - at[0], b.y - S.y - at[1]);
  assert.ok(err < 0.15, `prediction off by ${err.toFixed(3)} AU halfway along`);
});

test("rewind stays exact with launched bodies and belts", () => {
  const sys = createSystem(DATE, 9);
  addBelt(sys, "asteroids", { count: 300 });
  advance(sys, 200, Infinity, 1);
  launch(sys, "planet", 3, 0.5, -0.5, 3.4);
  const snap = sys.bodies.map((b) => [b.x, b.y]);
  const ast = Float64Array.from(sys.belts.asteroids.x);
  advance(sys, 3001, Infinity, 1);
  advance(sys, 3001, Infinity, -1);
  let err = 0;
  sys.bodies.forEach((b, i) => { err = Math.max(err, Math.abs(b.x - snap[i][0]), Math.abs(b.y - snap[i][1])); });
  const errA = Math.max(...sys.belts.asteroids.x.map((v, i) => Math.abs(v - ast[i])));
  assert.ok(err < 1e-9 && errA < 1e-9, `bodies ${err}, asteroids ${errA}`);
});

test("rewind history is capped, and rewinding stops at the oldest event it still remembers", () => {
  const sys = createSystem(DATE, 4);
  sys.maxHistory = 20;
  for (let k = 0; k < 30; k++) {
    advance(sys, 10, Infinity, 1);
    launch(sys, "asteroid", 2 + k * 0.05, 0, 0, 4); // one event every 10 steps
  }
  assert.equal(sys.history.length, 20, "only the newest 20 events are kept");
  assert.equal(sys.rewindFloor, 100, "the 10th launch (at step 100) is the newest one dropped");
  const before = sys.stepCount;
  const done = advance(sys, 10000, Infinity, -1);
  assert.equal(sys.stepCount, 100, "rewind stops at the floor");
  assert.equal(done, before - 100);
  assert.equal(advance(sys, 5, Infinity, -1), 0, "and won't go further");
  assert.equal(advance(sys, 5, Infinity, 1), 5, "forward still works");
});
