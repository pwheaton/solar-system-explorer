// N-body physics: massive bodies attract each other; belt particles are
// "test particles" that feel gravity from the bodies but exert none, so
// thousands of them stay cheap.
//
// Everything here is time-reversible: stepping with direction −1 retraces
// the path exactly (up to floating-point rounding), which is what makes
// the rewind button work.
//
// This file holds the integrator step; the pieces live in system.js,
// forces.js, belts.js, collisions.js, history.js and trails.js. Everything
// other code needs is re-exported from here.

import { beltAfterStep, beltBeforeStep } from "./belts.js";
import { detectCollisions } from "./collisions.js";
import { DT } from "./constants.js";
import { computeBodyAccel } from "./forces.js";
import { redoAt, undoHistoryAt } from "./history.js";
import { updateTrails } from "./trails.js";

function stepBodies(bodies, dt) {
  const h = dt / 2;
  for (const b of bodies) {
    if (b.removed) continue;
    b.vx += b.ax * h; b.vy += b.ay * h;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  computeBodyAccel(bodies);
  for (const b of bodies) {
    if (b.removed) continue;
    b.vx += b.ax * h; b.vy += b.ay * h;
  }
}

/** One step forward (dir = 1) or backward (dir = −1). Returns false at the rewind limit. */
function step(sys, dir) {
  if (dir < 0 && sys.stepCount <= sys.rewindFloor) return false;
  if (dir < 0) undoHistoryAt(sys, sys.stepCount);
  const belts = sys.beltList;
  for (const belt of belts) beltBeforeStep(belt, sys.stepCount, dir);
  stepBodies(sys.bodies, dir * DT);
  sys.stepCount += dir;
  sys.t = sys.stepCount * DT;
  for (const belt of belts) beltAfterStep(belt, sys.bodies, sys.stepCount);
  if (dir > 0) {
    // Same order as when it first happened: collisions are checked as the step
    // completes, and a launch at this step came after that (between frames).
    redoAt(sys, sys.stepCount, "impact");
    detectCollisions(sys);
    redoAt(sys, sys.stepCount, "launch");
  }
  updateTrails(sys, dir);
  return true;
}

/**
 * Advance up to `steps` steps in direction `dir`, stopping early if
 * `budgetMs` runs out. Returns how many steps actually ran.
 */
export function advance(sys, steps, budgetMs, dir = 1) {
  const start = performance.now();
  let done = 0;
  while (done < steps) {
    if (!step(sys, dir)) break; // reached the rewind limit
    done++;
    if ((done & 7) === 0 && performance.now() - start > budgetMs) break;
  }
  return done;
}

// ─── Public API ──────────────────────────────────────────────────
export { createSystem, addBody, toBarycentricFrame, setSunRemoved, setMassMultipliers } from "./system.js";
export { BELTS, addBelt, removeBelt, beltStats } from "./belts.js";
export { clearTrails } from "./trails.js";
export { launchBody, clearLaunched } from "./history.js";
export { collisionRadius } from "./impacts.js";
export { MAX_HISTORY } from "./constants.js";
