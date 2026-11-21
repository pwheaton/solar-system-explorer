// The simulation engine and render snapshots (what the physics worker uses).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../lib/sim/engine.js";
import { applySnapshot, createSnapshotState, makeSnapshot } from "../lib/sim/snapshot.js";

const DATE = new Date("2026-11-21T12:00:00Z");

test("ticks advance by real time at the configured speed", () => {
  const e = createEngine();
  e.load({ scenario: "today", date: DATE, seed: 1, belts: { asteroids: true } });
  e.configure({ speed: 1 });
  let r;
  for (let i = 0; i < 60; i++) r = e.tick(1 / 60, Infinity);
  assert.ok(Math.abs(r.t - 1) < 0.001, `t = ${r.t}`);
  assert.ok(Math.abs(r.rate - 1) < 0.05, `rate = ${r.rate}`);
});

test("paused engines don't move; reverse runs time backwards", () => {
  const e = createEngine();
  e.load({ scenario: "today", date: DATE, seed: 1 });
  e.configure({ speed: 1, paused: true });
  assert.equal(e.tick(0.5, Infinity).t, 0);
  e.configure({ paused: false, reverse: true });
  assert.ok(e.tick(0.1, Infinity).t < 0);
});

test("scenario events report the Sun's mass change to the page", () => {
  const e = createEngine();
  e.load({ scenario: "halfsun", date: DATE, seed: 1 });
  e.configure({ speed: 1 });
  const messages = [];
  for (let i = 0; i < 80; i++) messages.push(...e.tick(1 / 60, Infinity).messages);
  assert.ok(messages.some((m) => m.kind === "sunMass" && m.value === 0.5 && m.byEvent));
  assert.ok(messages.some((m) => m.kind === "notice" && /lost half its mass/.test(m.text)));
});

test("hitting the rewind limit pauses and says so", () => {
  const e = createEngine();
  e.load({ scenario: "today", date: DATE, seed: 1 });
  e.sys.rewindFloor = 10;
  e.configure({ speed: 0.1, reverse: true });
  advanceSteps(e, 20);
  const r = e.tick(1, Infinity);
  assert.ok(r.messages.some((m) => m.kind === "rewindFloor"));
  assert.equal(e.sys.stepCount, 10);
});

function advanceSteps(e, n) {
  e.configure({ reverse: false });
  e.tick(n * 0.0002 / 0.1 + 1e-9, Infinity);
  e.configure({ reverse: true });
}

test("snapshots rebuild a mirror the renderer can use", () => {
  const e = createEngine();
  e.load({ scenario: "flyby", date: DATE, seed: 3, belts: { asteroids: true, kuiper: true } });
  e.configure({ speed: 1 });
  for (let i = 0; i < 30; i++) e.tick(1 / 60, Infinity);
  const state = createSnapshotState();
  const { snap, transfer } = makeSnapshot(e.sys, state, true);
  assert.ok(transfer.length > 0, "big arrays are transferred, not copied");
  const m = applySnapshot(null, snap);
  assert.equal(m.bodies.length, e.sys.bodies.length);
  assert.equal(m.bodies[3].name, "Earth");
  assert.ok(Math.abs(m.bodies[3].x - e.sys.bodies[3].x) < 1e-12);
  assert.ok(m.bodies.find((b) => b.name === "Rogue Star").isStar);
  assert.equal(m.beltList.length, 2);
  assert.ok(Math.abs(m.beltList[0].x[5] - e.sys.beltList[0].x[5]) < 1e-5, "float32 positions are close enough to draw");
  assert.equal(m.startDate.getTime(), DATE.getTime());
  // Unchanged trails aren't re-sent, but the mirror keeps the old ones.
  const trail = m.bodies[3].trail;
  const again = makeSnapshot(e.sys, state).snap;
  assert.equal(again.bodies[3].trail, undefined);
  applySnapshot(m, again);
  assert.equal(m.bodies[3].trail, trail);
});

test("if the physics worker fails to start, the host falls back to the main thread", async () => {
  const { createHost } = await import("../lib/sim/host.js");
  // A fake Worker that fails the way older browsers do: no exception, just an error event.
  class BrokenWorker {
    constructor() { setTimeout(() => this.onerror?.(new Event("error")), 5); }
    postMessage() {}
    terminate() {}
  }
  globalThis.Worker = BrokenWorker;
  try {
    let loadedMirror = null;
    const host = createHost({ onLoaded: (m) => { loadedMirror = m; }, onResult: () => {} });
    assert.equal(host.kind, "worker");
    host.configure({ speed: 1 });
    host.load({ scenario: "flyby", date: DATE, seed: 2, belts: { asteroids: true } });
    host.setBelts({ asteroids: true, kuiper: true });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(host.kind, "main", "switched to the main-thread host");
    assert.ok(loadedMirror, "and replayed the load");
    assert.ok(loadedMirror.bodies.some((b) => b.name === "Rogue Star"), "with the same scenario");
    assert.equal(loadedMirror.beltList.length, 2, "and the latest belt settings");
    host.frame(0.1, Infinity, true);
    assert.ok(host.mirror.t > 0, "and it runs");
  } finally {
    delete globalThis.Worker;
  }
});

test("a worker that never answers also falls back (after a timeout)", async () => {
  const { createHost } = await import("../lib/sim/host.js");
  class SilentWorker { postMessage() {} terminate() {} }
  globalThis.Worker = SilentWorker;
  const realSetTimeout = globalThis.setTimeout;
  // Run the 4-second timeout instantly.
  globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, ms > 1000 ? 1 : ms);
  try {
    const host = createHost({ onLoaded: () => {}, onResult: () => {} });
    host.load({ scenario: "today", date: DATE, seed: 1, belts: {} });
    await new Promise((r) => realSetTimeout(r, 20));
    assert.equal(host.kind, "main");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    delete globalThis.Worker;
  }
});
