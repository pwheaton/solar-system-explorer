// N-body physics: massive bodies attract each other; belt particles are
// "test particles" that feel gravity from the bodies but exert none, so
// thousands of them stay cheap.
//
// Everything here is time-reversible: stepping with direction −1 retraces
// the path exactly (up to floating-point rounding), which is what makes
// the rewind button work.

import { BODY_DATA } from "./bodies.js";
import {
  DT, EJECT_AU, G, JUPITER_INDEX, SOFTENING, SUN_CAPTURE_AU, TRAIL_POINTS,
} from "./constants.js";
import { elementsAt, julianCenturies, keplerState } from "./ephemeris.js";
import { hashString, mulberry32 } from "./rng.js";

// ─── System setup ────────────────────────────────────────────────

function makeBody(spec) {
  return {
    ...spec,
    baseMass: spec.mass,
    x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
    removed: false,
    trail: [],   // flat [x0, y0, x1, y1, ...], Sun-relative
    trailT: [],  // sim time of each trail point
  };
}

/** Build the solar system at the real planet positions for `date`. */
export function createSystem(date = new Date(), seed = 1) {
  const T = julianCenturies(date);
  const bodies = BODY_DATA.map((d) => makeBody({
    ...d,
    // Nominal period (years) sets the trail length: about one orbit.
    period: d.el ? Math.pow(d.el[0], 1.5) : 0,
  }));

  const sunMass = bodies[0].mass;
  for (const b of bodies) {
    if (!b.el) continue;
    Object.assign(b, keplerState(elementsAt(b, T), G * (sunMass + b.mass)));
  }

  toBarycentricFrame(bodies);
  computeBodyAccel(bodies);
  return { bodies, belts: {}, startDate: date, seed, t: 0, stepCount: 0, events: [], ramp: null };
}

/**
 * Add an extra body (a rogue star, a companion…). Position and velocity
 * are given relative to the Sun.
 */
export function addBody(sys, spec) {
  const sun = sys.bodies[0];
  const b = makeBody(spec);
  b.x = sun.x + spec.x; b.y = sun.y + spec.y;
  b.vx = sun.vx + spec.vx; b.vy = sun.vy + spec.vy;
  sys.bodies.push(b);
  computeBodyAccel(sys.bodies);
  return b;
}

/**
 * Shift everything so the centre of mass sits at rest at the origin.
 * Without this the Sun starts at rest while the planets carry net momentum,
 * and the whole system slowly drifts away.
 */
export function toBarycentricFrame(bodies) {
  let M = 0, cx = 0, cy = 0, cvx = 0, cvy = 0;
  for (const b of bodies) {
    M += b.mass;
    cx += b.mass * b.x; cy += b.mass * b.y;
    cvx += b.mass * b.vx; cvy += b.mass * b.vy;
  }
  cx /= M; cy /= M; cvx /= M; cvy /= M;
  for (const b of bodies) {
    b.x -= cx; b.y -= cy; b.vx -= cvx; b.vy -= cvy;
  }
}

/** Remove the Sun from the physics (it stays put as the view's origin) or bring it back. */
export function setSunRemoved(sys, removed) {
  sys.bodies[0].removed = removed;
  sys.forceMassUpdate = true;
}

/** Apply the chaos-control mass multipliers. Returns true if anything changed. */
export function setMassMultipliers(sys, sunMult, jupiterMult) {
  const { bodies } = sys;
  const sun = bodies[0];
  const jup = bodies[JUPITER_INDEX];
  const newSun = sun.removed ? 0 : sun.baseMass * sunMult;
  const newJup = jup.baseMass * jupiterMult;
  if (newSun === sun.mass && newJup === jup.mass && !sys.forceMassUpdate) return false;
  sys.forceMassUpdate = false;
  sun.mass = newSun;
  jup.mass = newJup;
  computeBodyAccel(bodies);
  for (const belt of Object.values(sys.belts)) {
    if (!belt.pending) computeParticleAccel(belt, bodies);
  }
  return true;
}

// ─── Forces ──────────────────────────────────────────────────────

function computeBodyAccel(bodies) {
  const n = bodies.length;
  for (const b of bodies) { b.ax = 0; b.ay = 0; }
  for (let i = 0; i < n; i++) {
    const bi = bodies[i];
    for (let j = i + 1; j < n; j++) {
      const bj = bodies[j];
      const dx = bj.x - bi.x;
      const dy = bj.y - bi.y;
      const r2 = dx * dx + dy * dy + SOFTENING;
      const inv = G / (r2 * Math.sqrt(r2));
      bi.ax += bj.mass * dx * inv; bi.ay += bj.mass * dy * inv;
      bj.ax -= bi.mass * dx * inv; bj.ay -= bi.mass * dy * inv;
    }
  }
}

/**
 * Acceleration on every live particle from the massive bodies. Particles
 * that fall into the Sun are retired for good (their orbits can't be
 * integrated accurately that close in).
 */
// Scratch arrays for the hot loop below. Body objects differ in shape
// (planets, stars, the Sun), and reading their fields thousands of times per
// step knocks the JS engine off its fast path, so copy them into plain arrays.
let packX = new Float64Array(16), packY = new Float64Array(16), packGM = new Float64Array(16);

function computeParticleAccel(belt, bodies) {
  const { x, y, ax, ay, alive, n } = belt;
  const sun = bodies[0];
  const sunX = sun.x, sunY = sun.y;
  const captureR2 = sun.removed ? -1 : SUN_CAPTURE_AU * SUN_CAPTURE_AU;

  if (packX.length < bodies.length) {
    packX = new Float64Array(bodies.length * 2);
    packY = new Float64Array(bodies.length * 2);
    packGM = new Float64Array(bodies.length * 2);
  }
  let nb = 0;
  for (const b of bodies) {
    if (b.mass === 0) continue;
    packX[nb] = b.x; packY[nb] = b.y; packGM[nb] = G * b.mass;
    nb++;
  }
  const bx = packX, by = packY, gm = packGM;

  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const px = x[i], py = y[i];
    const sdx = px - sunX, sdy = py - sunY;
    if (sdx * sdx + sdy * sdy < captureR2) { alive[i] = 0; belt.swallowed++; continue; }

    let fx = 0, fy = 0;
    for (let j = 0; j < nb; j++) {
      const dx = bx[j] - px, dy = by[j] - py;
      const r2 = dx * dx + dy * dy + SOFTENING;
      const k = gm[j] / (r2 * Math.sqrt(r2));
      fx += dx * k; fy += dy * k;
    }
    ax[i] = fx; ay[i] = fy;
  }
}

// ─── Integration (velocity Verlet / kick-drift-kick) ─────────────

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

// Belt particles take one big step per `every` body steps. To keep that
// reversible, each big step is split around the body steps it spans:
//   start of interval: half-kick with the stored acceleration, then drift
//   end of interval:   recompute acceleration from the bodies, half-kick
// Running backwards mirrors this exactly. If the direction flips mid-interval,
// the half-finished drift is undone first.

function beltKickDrift(belt, dt) {
  const { x, y, vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
    x[i] += vx[i] * dt; y[i] += vy[i] * dt;
  }
}

function beltUndoKickDrift(belt, dt) {
  const { x, y, vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    x[i] -= vx[i] * dt; y[i] -= vy[i] * dt;
    vx[i] -= ax[i] * h; vy[i] -= ay[i] * h;
  }
}

function beltFinishKick(belt, bodies, dt) {
  computeParticleAccel(belt, bodies);
  const { vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
  }
}

function beltBeforeStep(belt, count, dir) {
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

function beltAfterStep(belt, bodies, count) {
  if (belt.pending && count !== belt.pendingStart && count % belt.every === 0) {
    beltFinishKick(belt, bodies, belt.pendingDt);
    belt.pending = false;
  }
}

/**
 * Trails keep about one orbit of Sun-relative positions on either side of
 * "now", so they still make sense when time runs backwards.
 */
function updateTrails(sys, dir) {
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
    while (trailT.length && trailT[0] < t - b.period) { trailT.shift(); trail.splice(0, 2); }
    while (trailT.length && trailT[trailT.length - 1] > t + b.period) { trailT.pop(); trail.length -= 2; }
  }
}

export function clearTrails(sys) {
  for (const b of sys.bodies) { b.trail = []; b.trailT = []; }
}

/** One step forward (dir = 1) or backward (dir = −1). */
function step(sys, dir) {
  const belts = Object.values(sys.belts);
  for (const belt of belts) beltBeforeStep(belt, sys.stepCount, dir);
  stepBodies(sys.bodies, dir * DT);
  sys.stepCount += dir;
  sys.t = sys.stepCount * DT;
  for (const belt of belts) beltAfterStep(belt, sys.bodies, sys.stepCount);
  updateTrails(sys, dir);
}

/**
 * Advance up to `steps` steps in direction `dir`, stopping early if
 * `budgetMs` runs out. Returns how many steps actually ran.
 */
export function advance(sys, steps, budgetMs, dir = 1) {
  const start = performance.now();
  let done = 0;
  while (done < steps) {
    step(sys, dir);
    done++;
    if ((done & 7) === 0 && performance.now() - start > budgetMs) break;
  }
  return done;
}

// ─── Belts ───────────────────────────────────────────────────────

export const BELTS = {
  asteroids: {
    label: "Asteroid Belt",
    count: 2500,
    every: 4,
    color: "rgba(196,176,140,0.8)",
    // Main belt: 2.1–3.3 AU, mildly eccentric.
    sample: (rng) => ({ a: 2.1 + rng() * 1.2, e: rng() * 0.15 }),
  },
  kuiper: {
    label: "Kuiper Belt",
    count: 1500,
    every: 16,
    color: "rgba(140,172,214,0.75)",
    // Classical belt 38–50 AU, plus "plutinos" near Neptune's 3:2 resonance.
    sample: (rng) =>
      rng() < 0.2
        ? { a: 39.2 + rng() * 0.5, e: 0.1 + rng() * 0.15 }
        : { a: 38 + rng() * 12, e: rng() * 0.1 },
  },
};

/** Scatter a belt's particles on random Keplerian orbits around the Sun's current position. */
export function addBelt(sys, key) {
  const def = BELTS[key];
  const n = def.count;
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
  // Start the first big step on the next multiple of `every`.
  sys.belts[key] = belt;
}

export function removeBelt(sys, key) {
  delete sys.belts[key];
}

/** Live counts for the HUD: still in the system, flung out, fell into the Sun. */
export function beltStats(belt, sun) {
  const { x, y, alive, n } = belt;
  const eject2 = EJECT_AU * EJECT_AU;
  let inside = 0, ejected = 0;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const dx = x[i] - sun.x, dy = y[i] - sun.y;
    if (dx * dx + dy * dy > eject2) ejected++; else inside++;
  }
  return { alive: inside, ejected, swallowed: belt.swallowed };
}
