// @ts-check
// Belts and debris clouds: thousands of test particles that feel gravity but
// exert none. They take one big step per several body steps; that step is
// split around the body steps it spans so it stays exactly reversible.

import { DT, EJECT_AU, G } from "./constants.js";
import { keplerState } from "./ephemeris.js";
import { computeParticleAccel } from "./forces.js";
import { hashString, mulberry32 } from "./rng.js";

/** @typedef {import("./types").Body} Body */
/** @typedef {import("./types").Belt} Belt */
/** @typedef {import("./types").BeltDef} BeltDef */
/** @typedef {import("./types").DebrisInit} DebrisInit */
/** @typedef {import("./types").SimSystem} SimSystem */

// Belt particles take one big step per `every` body steps. To keep that
// reversible, each big step is split around the body steps it spans:
//   start of interval: half-kick with the stored acceleration, then drift
//   end of interval:   recompute acceleration from the bodies, half-kick
// Running backwards mirrors this exactly. If the direction flips mid-interval,
// the half-finished drift is undone first.
/**
 * @param {Belt} belt
 * @param {number} dt
 */
function beltKickDrift(belt, dt) {
  const { x, y, vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
    x[i] += vx[i] * dt; y[i] += vy[i] * dt;
  }
}

/**
 * @param {Belt} belt
 * @param {number} dt
 */
function beltUndoKickDrift(belt, dt) {
  const { x, y, vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    x[i] -= vx[i] * dt; y[i] -= vy[i] * dt;
    vx[i] -= ax[i] * h; vy[i] -= ay[i] * h;
  }
}

/**
 * @param {Belt} belt
 * @param {Body[]} bodies
 * @param {number} dt
 */
function beltFinishKick(belt, bodies, dt) {
  computeParticleAccel(belt, bodies);
  const { vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
  }
}

/**
 * @param {Belt} belt
 * @param {number} count
 * @param {number} dir
 */
export function beltBeforeStep(belt, count, dir) {
  if (belt.pending && belt.pendingDir !== dir) {
    beltUndoKickDrift(belt, belt.pendingDt);
    belt.pending = false;
  }
  if (!belt.pending && count % belt.every === 0) {
    belt.pendingDt = dir * DT * belt.every;
    belt.pendingDir = dir;
    belt.pendingStart = count;
    beltKickDrift(belt, belt.pendingDt);
    belt.pending = true;
  }
}

/**
 * @param {Belt} belt
 * @param {Body[]} bodies
 * @param {number} count
 */
export function beltAfterStep(belt, bodies, count) {
  if (belt.pending && count !== belt.pendingStart && count % belt.every === 0) {
    beltFinishKick(belt, bodies, belt.pendingDt);
    belt.pending = false;
  }
}

/**
 * @param {SimSystem} sys
 */
export function debrisCount(sys) {
  let n = 0;
  for (const b of sys.beltList) if (b.debris) n += aliveCount(b);
  return n;
}

/**
 * @param {Belt} belt
 */
function aliveCount(belt) {
  let n = 0;
  for (let i = 0; i < belt.n; i++) n += belt.alive[i];
  return n;
}

/**
 * A debris cloud is a belt of test particles that steps every 2 body steps.
 * @param {SimSystem} sys
 * @param {string} key
 * @param {DebrisInit} init
 * @param {number} born
 * @param {number} mass
 */
export function addDebris(sys, key, init, born, mass) {
  const n = init.x.length;
  const belt = {
    key, n, every: 2, debris: true, born, mass, color: "rgba(255,200,140,0.9)",
    x: Float64Array.from(init.x), y: Float64Array.from(init.y),
    vx: Float64Array.from(init.vx), vy: Float64Array.from(init.vy),
    ax: new Float64Array(n), ay: new Float64Array(n),
    alive: new Uint8Array(n).fill(1),
    swallowed: 0, absorbed: 0,
    pending: false, pendingDir: 1, pendingDt: 0, pendingStart: 0,
  };
  computeParticleAccel(belt, sys.bodies);
  sys.belts[key] = belt;
  sys.beltList = Object.values(sys.belts);
}

/**
 * @param {SimSystem} sys
 * @param {string | null} key
 */
export function removeDebris(sys, key) {
  if (!key || !sys.belts[key]) return;
  delete sys.belts[key];
  sys.beltList = Object.values(sys.belts);
}

/**
 * @type {Record<string, BeltDef>}
 */
export const BELTS = {
  asteroids: {
    label: "Asteroid Belt",
    count: 2500,
    every: 8, // 0.0016 yr steps: still ~1,900 per orbit at the belt's inner edge
    color: "rgba(214,192,150,0.6)",
    // Main belt: 2.1–3.3 AU, mildly eccentric.
    sample: (rng) => ({ a: 2.1 + rng() * 1.2, e: rng() * 0.15 }),
  },
  kuiper: {
    label: "Kuiper Belt",
    count: 1500,
    every: 32, // orbits take ~250 years out here
    color: "rgba(150,190,230,0.55)",
    // Classical belt 38–50 AU, plus "plutinos" near Neptune's 3:2 resonance.
    sample: (rng) =>
      rng() < 0.2
        ? { a: 39.2 + rng() * 0.5, e: 0.1 + rng() * 0.15 }
        : { a: 38 + rng() * 12, e: rng() * 0.1 },
  },
};

/**
 * Scatter a belt's particles on random Keplerian orbits around the Sun's current
 * position. `count` can thin the belt (the first N particles of the full belt).
 * @param {SimSystem} sys
 * @param {string} key
 * @param {{ count?: number }} [options]
 */
export function addBelt(sys, key, { count } = {}) {
  const def = BELTS[key];
  const n = Math.min(count ?? def.count, def.count);
  const rng = mulberry32(sys.seed ^ hashString(key));
  const belt = {
    key, n, every: def.every, color: def.color,
    x: new Float64Array(n), y: new Float64Array(n),
    vx: new Float64Array(n), vy: new Float64Array(n),
    ax: new Float64Array(n), ay: new Float64Array(n),
    alive: new Uint8Array(n).fill(1),
    swallowed: 0,
    pending: false, pendingDir: 1, pendingDt: 0, pendingStart: 0,
  };
  const sun = sys.bodies[0];
  const mu = G * sun.baseMass;
  for (let i = 0; i < n; i++) {
    const { a, e } = def.sample(rng);
    const s = keplerState({ a, e, varpi: rng() * Math.PI * 2, M: rng() * Math.PI * 2 - Math.PI }, mu);
    belt.x[i] = sun.x + s.x; belt.y[i] = sun.y + s.y;
    belt.vx[i] = sun.vx + s.vx; belt.vy[i] = sun.vy + s.vy;
  }
  computeParticleAccel(belt, sys.bodies);
  sys.belts[key] = belt;
  sys.beltList = Object.values(sys.belts);
}

/**
 * @param {SimSystem} sys
 * @param {string} key
 */
export function removeBelt(sys, key) {
  delete sys.belts[key];
  sys.beltList = Object.values(sys.belts);
}

/**
 * Live counts for the HUD: still in the system, flung out, fell into the Sun.
 * @param {Belt} belt
 * @param {Body} sun
 */
export function beltStats(belt, sun) {
  const { x, y, alive, n } = belt;
  const eject2 = EJECT_AU * EJECT_AU;
  let inside = 0, ejected = 0;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const dx = x[i] - sun.x, dy = y[i] - sun.y;
    if (dx * dx + dy * dy > eject2) ejected++; else inside++;
  }
  return { alive: inside, ejected, swallowed: belt.swallowed, absorbed: belt.absorbed || 0 };
}
