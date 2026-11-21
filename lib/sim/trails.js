// @ts-check
// Trails: about one orbit of Sun-relative positions either side of "now", so
// they still make sense when time runs backwards.

import { TRAIL_POINTS } from "./constants.js";

/** @typedef {import("./types").SimSystem} SimSystem */

/**
 * Trails keep about one orbit of Sun-relative positions on either side of
 * "now", so they still make sense when time runs backwards.
 * @param {SimSystem} sys
 * @param {number} dir
 */
export function updateTrails(sys, dir) {
  const { bodies, t } = sys;
  const sun = bodies[0];
  for (let i = 1; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.removed || !b.period) continue;
    const { trail, trailT } = b;
    const interval = b.period / TRAIL_POINTS;
    const n = trailT.length;
    if (dir > 0) {
      if (n === 0 || t >= trailT[n - 1] + interval) { trail.push(b.x - sun.x, b.y - sun.y); trailT.push(t); }
    } else if (n === 0 || t <= trailT[0] - interval) {
      trail.unshift(b.x - sun.x, b.y - sun.y); trailT.unshift(t);
    }
    // Trim anything more than one orbit away from now, in either direction.
    // Done in batches (once 10% over) so arrays aren't reshuffled every step.
    const m = trailT.length;
    if (m && trailT[0] < t - b.period * 1.1) {
      let k = 0;
      while (k < m && trailT[k] < t - b.period) k++;
      trailT.splice(0, k); trail.splice(0, 2 * k);
    }
    if (trailT.length && trailT[trailT.length - 1] > t + b.period * 1.1) {
      let k = trailT.length;
      while (k > 0 && trailT[k - 1] > t + b.period) k--;
      trailT.length = k; trail.length = 2 * k;
    }
  }
}

/**
 * @param {SimSystem} sys
 */
export function clearTrails(sys) {
  for (const b of sys.bodies) { b.trail = []; b.trailT = []; }
}
