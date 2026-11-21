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
import {
  GRACE_STEPS, formatDuration, impactSpeeds, physicalRadius, planImpact, starImpactEnergyYears, toKms,
} from "./impacts.js";

// ─── System setup ────────────────────────────────────────────────

function makeBody(spec) {
  return {
    ...spec,
    baseMass: spec.mass,
    x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
    removed: false,
    merged: false,
    unborn: false,
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
  return {
    bodies, belts: {}, startDate: date, seed, t: 0, stepCount: 0, events: [], ramp: null,
    // Launches and collisions, in order. Records before `historyIndex` have
    // happened; rewinding undoes them, and replaying forward redoes launches
    // (collisions simply happen again, since the physics is deterministic).
    history: [], historyIndex: 0,
    beltList: [], // same belts as `belts`, as an array (avoids allocating one every step)
    flashes: [], // recent collisions, for the renderer
    nextImpactId: 1, // per system, so separate simulations never share ids
    // Rewind keeps the most recent MAX_HISTORY events; older ones are dropped
    // and rewinding stops at the step of the newest dropped one.
    maxHistory: MAX_HISTORY,
    rewindFloor: -Infinity,
  };
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
  const newJup = jup.removed ? 0 : jup.baseMass * jupiterMult;
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

// Scratch arrays for body-body forces (see the note on computeParticleAccel:
// mixed object shapes are slow in hot loops, plain arrays are fast).
let bx = new Float64Array(16), by = new Float64Array(16), bm = new Float64Array(16);
let bax = new Float64Array(16), bay = new Float64Array(16);

function computeBodyAccel(bodies) {
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

function computeParticleAccel(belt, bodies) {
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

export function clearTrails(sys) {
  for (const b of sys.bodies) { b.trail = []; b.trailT = []; }
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

// ─── Collisions, launches and their history ──────────────────────

const STATE_KEYS = [
  "x", "y", "vx", "vy", "mass", "baseMass", "removed", "merged", "unborn",
  "shattered", "radiusKm", "displayRadius", "impactId", "graceUntil",
];
const snapshot = (b) => Object.fromEntries(STATE_KEYS.map((k) => [k, b[k]]));

/**
 * How close two bodies have to get to collide, in AU. Far bigger than real
 * radii (Earth is 0.00004 AU across), which would make collisions vanishingly
 * rare at this time step. Scales with the cube root of mass, like a radius.
 */
export function collisionRadius(b) {
  if (b.isSun || b.isStar || b.mass > 0.01) return Math.max(0.02, 0.03 * Math.cbrt(b.mass));
  return Math.min(0.1, Math.max(0.004, 0.012 * Math.cbrt(b.mass / 3.003e-6)));
}

/** How many events (launches, merges, impacts) rewind can undo. */
export const MAX_HISTORY = 200;

function insertRecord(sys, record) {
  sys.history.splice(sys.historyIndex, 0, record);
  sys.historyIndex++;
  // Keep memory bounded in long sandbox sessions: forget the oldest events.
  // Rewinding can't go back past them any more.
  while (sys.historyIndex > sys.maxHistory) {
    const dropped = sys.history.shift();
    sys.historyIndex--;
    sys.rewindFloor = Math.max(sys.rewindFloor, dropped.step);
  }
}

let radii = new Float64Array(16);

function detectCollisions(sys) {
  const { bodies } = sys;
  const n = bodies.length;
  if (radii.length < n) radii = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) radii[i] = bodies[i].removed ? -1 : collisionRadius(bodies[i]);
  for (let i = 0; i < n; i++) {
    if (radii[i] < 0) continue;
    const a = bodies[i];
    for (let j = i + 1; j < n; j++) {
      if (radii[j] < 0) continue;
      const b = bodies[j];
      const reach = radii[i] + radii[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy < reach * reach) {
        // Pieces of the same impact get a moment to fly apart before they can re-collide.
        if (a.impactId && a.impactId === b.impactId && sys.stepCount < Math.max(a.graceUntil, b.graceUntil)) continue;
        resolveCollision(sys, i, j);
        radii[i] = bodies[i].removed ? -1 : collisionRadius(bodies[i]);
        radii[j] = bodies[j].removed ? -1 : collisionRadius(bodies[j]);
        if (radii[i] < 0) break;
      }
    }
  }
}

const isStarLike = (b) => b.isSun || b.isStar;

/** Collision: stars swallow things; otherwise the impact model decides merge vs shatter. */
function resolveCollision(sys, i, j) {
  const { bodies } = sys;
  const A = bodies[i], B = bodies[j];
  if (isStarLike(A) || isStarLike(B)) return merge(sys, i, j);
  // Pieces of the same original body drifting back together re-accrete:
  // that's how real planets reassemble after a giant impact.
  const rootA = A.fragmentOf || A.name, rootB = B.fragmentOf || B.name;
  if ((A.fragment || B.fragment) && rootA === rootB) return merge(sys, i, j);
  const ti = A.mass >= B.mass ? i : j;
  const pj = ti === i ? j : i;
  const liveChunks = bodies.reduce((n, b) => n + (b.fragment && !b.removed ? 1 : 0), 0);
  const plan = planImpact(bodies[ti], bodies[pj], {
    seed: (sys.seed ^ hashString(`${sys.stepCount}:${ti}:${pj}`)) >>> 0,
    reach: (m) => collisionRadius({ mass: m }),
    maxDebris: Math.max(0, Math.min(300, MAX_DEBRIS - debrisCount(sys))),
    allowFragments: !A.fragment && !B.fragment && liveChunks < MAX_CHUNKS,
  });
  if (plan.kind === "merge") return merge(sys, i, j, plan);
  return shatter(sys, ti, pj, plan);
}

/** Limits that keep a pile-up from overwhelming slower devices. */
const MAX_CHUNKS = 30;
const MAX_DEBRIS = 1800;

function debrisCount(sys) {
  let n = 0;
  for (const b of sys.beltList) if (b.debris) n += aliveCount(b);
  return n;
}

function aliveCount(belt) {
  let n = 0;
  for (let i = 0; i < belt.n; i++) n += belt.alive[i];
  return n;
}

/** Merge two bodies, conserving mass and momentum. The heavier one (or the Sun) survives. */
function merge(sys, i, j, plan) {
  const { bodies } = sys;
  const keep = i === 0 ? 0 : bodies[i].mass >= bodies[j].mass ? i : j;
  const gone = keep === i ? j : i;
  const A = bodies[keep], B = bodies[gone];
  const speeds = plan || impactSpeeds(A, B);
  let text;
  if (isStarLike(A)) {
    const where = A.isSun ? "the Sun" : A.name;
    text = `${B.name} fell into ${where} at ${Math.round(toKms(speeds.vImp))} km/s, releasing as much energy as the Sun puts out in ${formatDuration(starImpactEnergyYears(A, B))}`;
  } else {
    text = `${B.name} merged into ${A.name} at ${Math.round(toKms(speeds.vImp))} km/s`;
  }
  insertRecord(sys, { kind: "merge", step: sys.stepCount, t: sys.t, keep, gone, before: [snapshot(A), snapshot(B)], text });

  const M = A.mass + B.mass;
  const mult = A.baseMass ? A.mass / A.baseMass : 1; // keep any chaos-slider multiplier
  const flashPower = Math.min(1, Math.log10(1 + B.mass / 1e-9) / 6);
  A.x = (A.mass * A.x + B.mass * B.x) / M; A.y = (A.mass * A.y + B.mass * B.y) / M;
  A.vx = (A.mass * A.vx + B.mass * B.vx) / M; A.vy = (A.mass * A.vy + B.mass * B.vy) / M;
  if (!isStarLike(A) && A.radiusKm) A.radiusKm *= Math.cbrt(M / A.mass); // same density, more volume
  A.mass = M;
  A.baseMass = mult ? M / mult : M;
  B.removed = true; B.merged = true; B.mass = 0;
  sys.flashes.push({ hx: A.x - bodies[0].x, hy: A.y - bodies[0].y, at: performance.now(), power: flashPower });
  computeBodyAccel(bodies);
}

/** Blend two #rrggbb colours. */
function mixColor(a, b, t) {
  const p = (h, k) => parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16);
  const c = [0, 1, 2].map((k) => Math.round(p(a, k) * (1 - t) + p(b, k) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Orbital period estimate (years) around the Sun, for trail length. */
function periodAround(sun, x, y, vx, vy) {
  const M = sun.removed ? 1 : sun.mass;
  const r = Math.hypot(x, y);
  const energy = 0.5 * (vx * vx + vy * vy) - (G * M) / r;
  if (energy >= 0) return 40;
  const a = (-G * M) / (2 * energy);
  return Math.min(300, Math.max(0.15, Math.pow(a, 1.5) / Math.sqrt(M)));
}

/**
 * A disruptive impact: the target becomes the largest remnant, the impactor
 * is destroyed, and the lost mass becomes fragments (bodies) and debris
 * (test particles), all moving away from the pair's centre of mass.
 */
function shatter(sys, ti, pj, plan) {
  const { bodies } = sys;
  const T = bodies[ti], P = bodies[pj];
  const sun = bodies[0];
  const before = [snapshot(T), snapshot(P)];
  const M = T.mass + P.mass;
  const X = (T.mass * T.x + P.mass * P.x) / M, Y = (T.mass * T.y + P.mass * P.y) / M;
  const VX = (T.mass * T.vx + P.mass * P.vx) / M, VY = (T.mass * T.vy + P.mass * P.vy) / M;
  const impactId = sys.nextImpactId++;
  const graceUntil = sys.stepCount + GRACE_STEPS;
  // Density stays the parent's: radius scales with the cube root of mass.
  const radiusFor = (m) => (T.radiusKm ?? physicalRadius(T) * 149597870.7) * Math.cbrt(m / T.mass);

  // The target becomes the largest remnant.
  const mult = T.baseMass ? T.mass / T.baseMass : 1;
  const Mlr = plan.remnant.mass;
  T.radiusKm = radiusFor(Mlr);
  T.displayRadius = Math.max(1.6, T.displayRadius * Math.cbrt(Mlr / T.mass));
  T.x = X; T.y = Y;
  T.vx = VX + plan.remnant.vx; T.vy = VY + plan.remnant.vy;
  T.mass = Mlr;
  T.baseMass = mult ? Mlr / mult : Mlr;
  T.impactId = impactId; T.graceUntil = graceUntil;
  P.removed = true; P.shattered = true; P.mass = 0;
  P.impactId = impactId; P.graceUntil = graceUntil;

  // Fragments: real bodies that keep orbiting and can collide again.
  const created = [];
  // Chunks of chunks are still named after the original planet.
  const root = T.fragmentOf || T.name;
  const chunkNo = bodies.filter((b) => b.fragmentOf === root).length;
  plan.fragments.forEach((f, k) => {
    const x = X + f.x, y = Y + f.y, vx = VX + f.vx, vy = VY + f.vy;
    const b = makeBody({
      name: `${root} chunk ${chunkNo + k + 1}`,
      mass: f.mass,
      color: mixColor(k % 2 ? P.color : T.color, "#8a7f74", 0.25),
      displayRadius: Math.min(7, Math.max(1.6, 4.8 * Math.cbrt(f.mass / 3.003e-6))),
      radiusKm: radiusFor(f.mass),
      type: `Fragment of the ${T.name}–${P.name} collision`,
      description: `A chunk blasted off when ${P.name} hit ${T.name}. It still feels the gravity of everything around it, and if it meets something slowly enough it will merge back.`,
      period: periodAround(sun, x - sun.x, y - sun.y, vx - sun.vx, vy - sun.vy),
      fragmentOf: root,
    });
    Object.assign(b, { x, y, vx, vy, impactId, graceUntil, fragment: true });
    bodies.push(b);
    created.push({ index: bodies.length - 1, state: snapshot(b) });
  });

  // Debris: a cloud of test particles, hot at first.
  let debrisKey = null, debrisInit = null;
  if (plan.debris.length) {
    debrisKey = `debris-${impactId}`;
    const n = plan.debris.length;
    debrisInit = { x: new Float64Array(n), y: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n) };
    plan.debris.forEach((d, k) => {
      debrisInit.x[k] = X + d.x; debrisInit.y[k] = Y + d.y;
      debrisInit.vx[k] = VX + d.vx; debrisInit.vy[k] = VY + d.vy;
    });
    addDebris(sys, debrisKey, debrisInit, sys.t, plan.debrisMass);
  }

  const kept = Math.round(plan.fLR * 100);
  const pieces = plan.fragments.length;
  const text = `${P.name} hit ${T.name} at ${Math.round(toKms(plan.vImp))} km/s. ${T.name} kept ${kept}% of the mass`
    + (pieces ? `; ${pieces} big chunk${pieces > 1 ? "s" : ""} and a debris cloud flew off` : "; the rest became a debris cloud");
  insertRecord(sys, {
    kind: "impact", step: sys.stepCount, t: sys.t, a: ti, b: pj, before, after: [snapshot(T), snapshot(P)],
    created, debrisKey, debrisInit, debrisMass: plan.debrisMass, text,
  });
  sys.flashes.push({ hx: X - sun.x, hy: Y - sun.y, at: performance.now(), power: 1, shatter: true });
  computeBodyAccel(bodies);
}

/** A debris cloud is a belt of test particles that steps every 2 body steps. */
function addDebris(sys, key, init, born, mass) {
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

function removeDebris(sys, key) {
  if (!key || !sys.belts[key]) return;
  delete sys.belts[key];
  sys.beltList = Object.values(sys.belts);
}

/** Before stepping back from `count`, undo whatever happened at `count` (newest first). */
function undoHistoryAt(sys, count) {
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
 */
function redoAt(sys, count, kind) {
  let changed = false;
  while (sys.historyIndex < sys.history.length) {
    const rec = sys.history[sys.historyIndex];
    if (rec.step !== count || rec.kind !== kind) break;
    if (kind === "launch") {
      Object.assign(sys.bodies[rec.index], rec.state);
    } else {
      Object.assign(sys.bodies[rec.a], rec.after[0]);
      Object.assign(sys.bodies[rec.b], rec.after[1]);
      for (const c of rec.created) Object.assign(sys.bodies[c.index], c.state);
      if (rec.debrisKey) addDebris(sys, rec.debrisKey, rec.debrisInit, rec.t, rec.debrisMass);
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
 */
export function clearLaunched(sys) {
  const involvesLaunched = (r) => r.kind === "launch"
    || [r.keep, r.gone, r.a, r.b].some((i) => i != null && sys.bodies[i].launched);
  const applied = sys.history.slice(0, sys.historyIndex).filter((r) => !involvesLaunched(r));
  const pending = sys.history.slice(sys.historyIndex).filter((r) => !involvesLaunched(r));
  sys.history = [...applied, ...pending];
  sys.historyIndex = applied.length;
  for (const b of sys.bodies) {
    if (b.launched) Object.assign(b, { removed: true, unborn: true, discarded: true, mass: 0, trail: [], trailT: [] });
  }
  computeBodyAccel(sys.bodies);
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

// ─── Belts ───────────────────────────────────────────────────────

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

export function removeBelt(sys, key) {
  delete sys.belts[key];
  sys.beltList = Object.values(sys.belts);
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
  return { alive: inside, ejected, swallowed: belt.swallowed, absorbed: belt.absorbed || 0 };
}
