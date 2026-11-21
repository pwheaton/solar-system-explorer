// @ts-check
// The rewind history: launches, merges and impacts in order, with what's
// needed to undo each one exactly and redo it on replay. Records before
// sys.historyIndex have happened; rewinding undoes them (newest first).

import { addDebris, removeDebris } from "./belts.js";
import { computeBodyAccel, computeParticleAccel } from "./forces.js";
import { makeBody } from "./system.js";

/** @typedef {import("./types").Body} Body */
/** @typedef {import("./types").BodySpec} BodySpec */
/** @typedef {import("./types").BodyState} BodyState */
/** @typedef {import("./types").HistoryRecord} HistoryRecord */
/** @typedef {import("./types").SimSystem} SimSystem */
/** @typedef {import("./types").State2D} State2D */

/** @type {(keyof BodyState)[]} */
const STATE_KEYS = [
  "x", "y", "vx", "vy", "mass", "baseMass", "removed", "merged", "unborn",
  "shattered", "radiusKm", "displayRadius", "impactId", "graceUntil",
];

/**
 * @param {Body} b
 * @returns {BodyState}
 */
export const snapshot = (b) => /** @type {BodyState} */ (Object.fromEntries(STATE_KEYS.map((k) => [k, b[k]])));

/**
 * @param {SimSystem} sys
 * @param {HistoryRecord} record
 */
export function insertRecord(sys, record) {
  sys.history.splice(sys.historyIndex, 0, record);
  sys.historyIndex++;
  // Keep memory bounded in long sandbox sessions: forget the oldest events.
  // Rewinding can't go back past them any more.
  while (sys.historyIndex > sys.maxHistory) {
    const dropped = sys.history.shift();
    if (!dropped) break;
    sys.historyIndex--;
    sys.rewindFloor = Math.max(sys.rewindFloor, dropped.step);
  }
}

/**
 * Before stepping back from `count`, undo whatever happened at `count` (newest first).
 * @param {SimSystem} sys
 * @param {number} count
 */
export function undoHistoryAt(sys, count) {
  let changed = false;
  while (sys.historyIndex > 0 && sys.history[sys.historyIndex - 1].step === count) {
    const rec = sys.history[sys.historyIndex - 1];
    if (rec.kind === "merge") {
      Object.assign(sys.bodies[rec.keep], rec.before[0]);
      Object.assign(sys.bodies[rec.gone], rec.before[1]);
      sys.history.splice(sys.historyIndex - 1, 1); // it will happen again on replay
    } else if (rec.kind === "impact") {
      // Kept (not deleted) so replay reuses the same fragment slots.
      Object.assign(sys.bodies[rec.a], rec.before[0]);
      Object.assign(sys.bodies[rec.b], rec.before[1]);
      for (const c of rec.created) {
        Object.assign(sys.bodies[c.index], { removed: true, unborn: true, mass: 0, trail: [], trailT: [] });
      }
      removeDebris(sys, rec.debrisKey);
    } else {
      const b = sys.bodies[rec.index];
      b.removed = true; b.unborn = true; b.mass = 0;
      b.trail = []; b.trailT = [];
    }
    sys.historyIndex--;
    changed = true;
  }
  if (changed) computeBodyAccel(sys.bodies);
}

/**
 * After stepping forward to `count`, replay recorded events of `kind` there:
 * impacts (before new collisions are checked) or launches (after).
 * @param {SimSystem} sys
 * @param {number} count
 * @param {"impact" | "launch"} kind
 */
export function redoAt(sys, count, kind) {
  let changed = false;
  while (sys.historyIndex < sys.history.length) {
    const rec = sys.history[sys.historyIndex];
    if (rec.step !== count || rec.kind !== kind) break;
    if (rec.kind === "launch") {
      Object.assign(sys.bodies[rec.index], rec.state);
    } else if (rec.kind === "impact") {
      Object.assign(sys.bodies[rec.a], rec.after[0]);
      Object.assign(sys.bodies[rec.b], rec.after[1]);
      for (const c of rec.created) Object.assign(sys.bodies[c.index], c.state);
      if (rec.debrisKey && rec.debrisInit) addDebris(sys, rec.debrisKey, rec.debrisInit, rec.t, rec.debrisMass);
      const T = sys.bodies[rec.a];
      sys.flashes.push({ hx: T.x - sys.bodies[0].x, hy: T.y - sys.bodies[0].y, at: performance.now(), power: 1, shatter: true });
    }
    sys.historyIndex++;
    changed = true;
  }
  if (changed) computeBodyAccel(sys.bodies);
}

/**
 * Throw a new body into the system right now. Position and velocity are
 * relative to the Sun. Launching after a rewind starts a new timeline: any
 * launches that were still in the future are discarded.
 * @param {SimSystem} sys
 * @param {BodySpec & State2D} spec  position and velocity relative to the Sun
 * @returns {number} the new body's index
 */
export function launchBody(sys, spec) {
  for (const rec of sys.history.splice(sys.historyIndex)) {
    if (rec.kind === "launch") Object.assign(sys.bodies[rec.index], { removed: true, unborn: true, discarded: true, mass: 0 });
    if (rec.kind === "impact") {
      for (const c of rec.created) Object.assign(sys.bodies[c.index], { removed: true, unborn: true, discarded: true, mass: 0 });
    }
  }
  const sun = sys.bodies[0];
  const b = makeBody(spec);
  b.x = sun.x + spec.x; b.y = sun.y + spec.y;
  b.vx = sun.vx + spec.vx; b.vy = sun.vy + spec.vy;
  b.launched = true;
  b.unborn = false;
  sys.bodies.push(b);
  const index = sys.bodies.length - 1;
  insertRecord(sys, { kind: "launch", step: sys.stepCount, t: sys.t, index, state: snapshot(b), text: `${b.name} launched` });
  computeBodyAccel(sys.bodies);
  for (const belt of Object.values(sys.belts)) if (!belt.pending) computeParticleAccel(belt, sys.bodies);
  return index;
}

/**
 * Remove every launched body for good. Whatever they already did stays done
 * (if your planet knocked Mars out, Mars stays knocked out), and their part
 * of the history is dropped, so rewinding no longer brings them back.
 * @param {SimSystem} sys
 */
export function clearLaunched(sys) {
  /** @param {HistoryRecord} r */
  const involvesLaunched = (r) => r.kind === "launch"
    || (r.kind === "merge" ? [r.keep, r.gone] : [r.a, r.b]).some((i) => sys.bodies[i].launched);
  const applied = sys.history.slice(0, sys.historyIndex).filter((r) => !involvesLaunched(r));
  const pending = sys.history.slice(sys.historyIndex).filter((r) => !involvesLaunched(r));
  sys.history = [...applied, ...pending];
  sys.historyIndex = applied.length;
  for (const b of sys.bodies) {
    if (b.launched) Object.assign(b, { removed: true, unborn: true, discarded: true, mass: 0, trail: [], trailT: [] });
  }
  computeBodyAccel(sys.bodies);
}
