// Physics worker: runs the simulation engine off the main thread and sends
// the page a render snapshot after each tick.

import { createEngine } from "./engine.js";
import { createSnapshotState, makeSnapshot } from "./snapshot.js";

const engine = createEngine();
let snapState = createSnapshotState();
let generation = 0;

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case "load": {
      generation = m.generation;
      engine.load({ scenario: m.scenario, date: new Date(m.date), seed: m.seed, belts: m.belts });
      snapState = createSnapshotState();
      const { snap, transfer } = makeSnapshot(engine.sys, snapState, true);
      self.postMessage({ type: "loaded", generation, snap }, transfer);
      break;
    }
    case "configure": engine.configure(m.opts); break;
    case "belts": engine.setBelts(m.belts); break;
    case "cancelRamp": engine.cancelRamp(); break;
    case "launch": engine.launch(m.typeKey, m.hx, m.hy, m.vx, m.vy); break;
    case "clearLaunched": engine.clearLaunched(); break;
    case "tick": {
      const result = engine.tick(m.realDt, m.budget, m.wantHud);
      if (!result) { self.postMessage({ type: "idle", generation }); break; }
      const { snap, transfer } = makeSnapshot(engine.sys, snapState);
      self.postMessage({ type: "frame", generation, result, snap }, transfer);
      break;
    }
    default: break;
  }
};
