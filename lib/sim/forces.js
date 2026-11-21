// Gravity. The two hot loops of the simulation: body-to-body forces, and the
// force on every belt/debris particle from the bodies. Both read plain typed
// arrays because body objects come in many shapes, which is slow in hot loops.

import { EJECT_AU, G, SOFTENING, SUN_CAPTURE_AU } from "./constants.js";
import { collisionRadius } from "./impacts.js";

// Scratch arrays for body-body forces (see the note on computeParticleAccel:
// mixed object shapes are slow in hot loops, plain arrays are fast).
let bx = new Float64Array(16), by = new Float64Array(16), bm = new Float64Array(16);

let bax = new Float64Array(16), bay = new Float64Array(16);

export function computeBodyAccel(bodies) {
  const n = bodies.length;
  if (bx.length < n) {
    bx = new Float64Array(n * 2); by = new Float64Array(n * 2); bm = new Float64Array(n * 2);
    bax = new Float64Array(n * 2); bay = new Float64Array(n * 2);
  }
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    bx[i] = b.x; by[i] = b.y; bm[i] = b.mass; bax[i] = 0; bay[i] = 0;
  }
  for (let i = 0; i < n; i++) {
    const xi = bx[i], yi = by[i], mi = bm[i];
    for (let j = i + 1; j < n; j++) {
      const mj = bm[j];
      if (mi === 0 && mj === 0) continue;
      const dx = bx[j] - xi;
      const dy = by[j] - yi;
      const r2 = dx * dx + dy * dy + SOFTENING;
      const inv = G / (r2 * Math.sqrt(r2));
      bax[i] += mj * dx * inv; bay[i] += mj * dy * inv;
      bax[j] -= mi * dx * inv; bay[j] -= mi * dy * inv;
    }
  }
  for (let i = 0; i < n; i++) { bodies[i].ax = bax[i]; bodies[i].ay = bay[i]; }
}

/**
 * Acceleration on every live particle from the massive bodies. Particles
 * that fall into the Sun are retired for good (their orbits can't be
 * integrated accurately that close in).
 */
// Scratch arrays for the hot loop below. Body objects differ in shape
// (planets, stars, the Sun), and reading their fields thousands of times per
// step knocks the JS engine off its fast path, so copy them into plain arrays.
let packX = new Float64Array(16), packY = new Float64Array(16), packGM = new Float64Array(16), packR2 = new Float64Array(16);

export function computeParticleAccel(belt, bodies) {
  const { x, y, ax, ay, alive, n } = belt;
  const sun = bodies[0];
  const sunX = sun.x, sunY = sun.y;
  const captureR2 = sun.removed ? -1 : SUN_CAPTURE_AU * SUN_CAPTURE_AU;
  const farR2 = EJECT_AU * EJECT_AU;

  if (packX.length < bodies.length) {
    packX = new Float64Array(bodies.length * 2);
    packY = new Float64Array(bodies.length * 2);
    packGM = new Float64Array(bodies.length * 2);
    packR2 = new Float64Array(bodies.length * 2);
  }
  const sweep = !!belt.debris; // impact debris gets swept up by whatever it hits
  let nb = 0;
  for (const b of bodies) {
    if (b.mass < 1e-10) continue; // removed, or too light to matter (launched asteroids)
    // Launched planets and impact chunks barely move asteroids; skipping them keeps a busy sandbox fast.
    // (The real planets always count, so the belt's own physics is unchanged.)
    if ((b.launched || b.fragment) && b.mass < 1e-5) continue;
    packX[nb] = b.x; packY[nb] = b.y; packGM[nb] = G * b.mass;
    if (sweep) { const r = collisionRadius(b) * 0.6; packR2[nb] = r * r; }
    nb++;
  }
  const bx = packX, by = packY, gm = packGM;

  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const px = x[i], py = y[i];
    const sdx = px - sunX, sdy = py - sunY;
    const sd2 = sdx * sdx + sdy * sdy;
    if (sd2 < captureR2) { alive[i] = 0; belt.swallowed++; continue; }
    // Past EJECT_AU a particle has left the system: the Sun's pull out there is
    // ~1/60,000 of what Earth feels, so let it drift in a straight line and skip
    // the force sum. This depends only on position, so rewind stays exact.
    if (sd2 > farR2) { ax[i] = 0; ay[i] = 0; continue; }

    let fx = 0, fy = 0;
    let hit = false;
    for (let j = 0; j < nb; j++) {
      const dx = bx[j] - px, dy = by[j] - py;
      const d2 = dx * dx + dy * dy;
      if (sweep && d2 < packR2[j]) { hit = true; break; }
      const r2 = d2 + SOFTENING;
      const k = gm[j] / (r2 * Math.sqrt(r2));
      fx += dx * k; fy += dy * k;
    }
    if (hit) { alive[i] = 0; belt.absorbed = (belt.absorbed || 0) + 1; continue; }
    ax[i] = fx; ay[i] = fy;
  }
}
