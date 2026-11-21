// Where the simulation runs. Two hosts with the same interface:
//   - worker host: physics in a Web Worker; the page draws from snapshots
//   - main host:   physics on the main thread (fallback, and ?worker=0)
//
//   host.load({ scenario, date, seed, belts })
//   host.configure({ speed, paused, reverse, sunMass, jupMass })
//   host.setBelts(belts) / host.cancelRamp() / host.launch(type, hx, hy, vx, vy) / host.clearLaunched()
//   host.frame(realDt, budgetMs, wantHud)   call once per animation frame
//   host.mirror                             the system as last seen, for drawing
//   host.physicsBudget(displayFrameMs, otherMs)  how long physics may run per tick
//
// Callbacks: onLoaded(mirror) after a load, onResult(result) after each tick.

import { createEngine } from "./engine.js";
import { applySnapshot } from "./snapshot.js";

export function createHost({ preferWorker = true, onLoaded, onResult }) {
  let inner = null;
  // Remember the current setup, so a fallback can pick up where the worker left off.
  let lastLoad = null;
  let lastConfig = {};
  let lastBelts = null;

  const fallBack = () => {
    if (inner?.kind !== "worker") return;
    inner.dispose();
    inner = createMainHost({ onLoaded, onResult });
    inner.configure(lastConfig);
    if (lastLoad) inner.load({ ...lastLoad, belts: lastBelts ?? lastLoad.belts });
  };

  if (preferWorker && typeof Worker !== "undefined") {
    try {
      inner = createWorkerHost({ onLoaded, onResult, onFail: fallBack });
    } catch {
      inner = null; // Worker exists but can't run module workers: use the main thread.
    }
  }
  inner ??= createMainHost({ onLoaded, onResult });

  return {
    get kind() { return inner.kind; },
    get mirror() { return inner.mirror; },
    load(params) { lastLoad = params; lastBelts = null; inner.load(params); },
    configure(opts) { Object.assign(lastConfig, opts); inner.configure(opts); },
    setBelts(belts) { lastBelts = belts; inner.setBelts(belts); },
    cancelRamp: () => inner.cancelRamp(),
    launch: (...args) => inner.launch(...args),
    clearLaunched: () => inner.clearLaunched(),
    frame: (realDt, budgetMs, wantHud) => inner.frame(realDt, budgetMs, wantHud),
    physicsBudget: (displayFrame, otherMs) => inner.physicsBudget(displayFrame, otherMs),
    dispose: () => inner.dispose(),
  };
}

function createMainHost({ onLoaded, onResult }) {
  const engine = createEngine();
  const host = {
    kind: "main",
    mirror: null,
    load(params) {
      host.mirror = engine.load(params);
      onLoaded?.(host.mirror);
    },
    configure: (o) => engine.configure(o),
    setBelts: (b) => engine.setBelts(b),
    cancelRamp: () => engine.cancelRamp(),
    launch: (type, hx, hy, vx, vy) => engine.launch(type, hx, hy, vx, vy),
    clearLaunched: () => engine.clearLaunched(),
    frame(realDt, budgetMs, wantHud) {
      const result = engine.tick(realDt, budgetMs, wantHud);
      if (result) onResult?.(result);
    },
    // Physics shares the frame with drawing here: it gets what's left.
    physicsBudget: (displayFrame, otherMs) => Math.max(2, Math.min(10, displayFrame * 0.8 - otherMs)),
    dispose() {},
  };
  return host;
}

// How long a load may take before we decide the worker isn't working.
const WORKER_LOAD_TIMEOUT_MS = 4000;

function createWorkerHost({ onLoaded, onResult, onFail }) {
  const worker = new Worker(new URL("./sim.worker.js", import.meta.url), { type: "module" });
  let failTimer = null;
  const fail = () => { clearTimeout(failTimer); onFail?.(); };
  // Some older browsers create module workers but can't load them; that shows
  // up as an error event (or silence), not an exception. Fall back either way.
  worker.onerror = fail;
  worker.onmessageerror = fail;
  let generation = 0;   // bumps on every load; stale frames from before a load are dropped
  let busy = false;     // a tick is in flight
  let owedDt = 0;       // real time that passed while the worker was busy
  let loaded = false;

  const host = {
    kind: "worker",
    mirror: null,
    load(params) {
      generation++;
      loaded = false;
      busy = false;
      owedDt = 0;
      worker.postMessage({ type: "load", generation, ...params, date: params.date.getTime() });
      clearTimeout(failTimer);
      failTimer = setTimeout(fail, WORKER_LOAD_TIMEOUT_MS);
    },
    configure: (opts) => worker.postMessage({ type: "configure", opts }),
    setBelts: (belts) => worker.postMessage({ type: "belts", belts }),
    cancelRamp: () => worker.postMessage({ type: "cancelRamp" }),
    launch: (typeKey, hx, hy, vx, vy) => worker.postMessage({ type: "launch", typeKey, hx, hy, vx, vy }),
    clearLaunched: () => worker.postMessage({ type: "clearLaunched" }),
    frame(realDt, budgetMs, wantHud) {
      owedDt += realDt;
      if (!loaded || busy) return;
      busy = true;
      worker.postMessage({ type: "tick", realDt: Math.min(0.1, owedDt), budget: budgetMs, wantHud });
      owedDt = 0;
    },
    // Physics runs in parallel with drawing, so it can use most of a frame.
    physicsBudget: (displayFrame) => Math.max(2, Math.min(14, displayFrame * 0.85)),
    dispose() { clearTimeout(failTimer); worker.terminate(); },
  };

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.generation !== generation) return; // from before the latest load
    if (m.type === "loaded") {
      clearTimeout(failTimer);
      host.mirror = applySnapshot(null, m.snap);
      loaded = true;
      onLoaded?.(host.mirror);
    } else if (m.type === "frame") {
      host.mirror = applySnapshot(host.mirror, m.snap);
      busy = false;
      onResult?.(m.result);
    } else if (m.type === "idle") {
      busy = false;
    }
  };
  return host;
}
