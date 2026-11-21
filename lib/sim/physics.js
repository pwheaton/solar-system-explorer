// N-body physics: massive bodies attract each other; belt particles are
// "test particles" that feel gravity from the bodies but exert none, so
// thousands of them stay cheap.

import { BODY_DATA } from "./bodies.js";
import {
  DT, EJECT_AU, G, JUPITER_INDEX, SOFTENING, SUN_CAPTURE_AU, TRAIL_POINTS,
} from "./constants.js";
import { elementsAt, julianCenturies, keplerState } from "./ephemeris.js";

// ─── System setup ────────────────────────────────────────────────

/** Build the solar system at the real planet positions for `date`. */
export function createSystem(date = new Date()) {
  const T = julianCenturies(date);
  const bodies = BODY_DATA.map((d) => ({
    ...d,
    baseMass: d.mass,
    x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
    // Nominal period (years) sets how often the trail is sampled.
    period: d.el ? Math.pow(d.el[0], 1.5) : 0,
    trail: [],
    lastSample: -Infinity,
  }));

  const sunMass = bodies[0].mass;
  for (const b of bodies) {
    if (!b.el) continue;
    Object.assign(b, keplerState(elementsAt(b, T), G * (sunMass + b.mass)));
  }

  toBarycentricFrame(bodies);
  computeBodyAccel(bodies);
  return { bodies, belts: {}, startDate: date, t: 0, stepCount: 0 };
}

/**
 * Shift everything so the centre of mass sits at rest at the origin.
 * Without this the Sun starts at rest while the planets carry net momentum,
 * and the whole system slowly drifts away.
 */
function toBarycentricFrame(bodies) {
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

/** Apply the chaos-control mass multipliers. Returns true if anything changed. */
export function setMassMultipliers(sys, sunMult, jupiterMult) {
  const { bodies } = sys;
  const sun = bodies[0];
  const jup = bodies[JUPITER_INDEX];
  const newSun = sun.baseMass * sunMult;
  const newJup = jup.baseMass * jupiterMult;
  if (newSun === sun.mass && newJup === jup.mass) return false;
  sun.mass = newSun;
  jup.mass = newJup;
  computeBodyAccel(bodies);
  for (const belt of Object.values(sys.belts)) computeParticleAccel(belt, bodies);
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
 * Acceleration on every live particle from the massive bodies. Also retires
 * particles that were ejected from the system or fell into the Sun.
 */
function computeParticleAccel(belt, bodies) {
  const { x, y, ax, ay, alive, n } = belt;
  const nb = bodies.length;
  const sun = bodies[0];
  const ejectR2 = EJECT_AU * EJECT_AU;
  const captureR2 = SUN_CAPTURE_AU * SUN_CAPTURE_AU;

  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const px = x[i], py = y[i];
    const sdx = px - sun.x, sdy = py - sun.y;
    const sr2 = sdx * sdx + sdy * sdy;
    if (sr2 > ejectR2) { alive[i] = 0; belt.aliveCount--; belt.ejected++; continue; }
    if (sr2 < captureR2) { alive[i] = 0; belt.aliveCount--; belt.swallowed++; continue; }

    let fx = 0, fy = 0;
    for (let j = 0; j < nb; j++) {
      const b = bodies[j];
      const dx = b.x - px, dy = b.y - py;
      const r2 = dx * dx + dy * dy + SOFTENING;
      const k = (G * b.mass) / (r2 * Math.sqrt(r2));
      fx += dx * k; fy += dy * k;
    }
    ax[i] = fx; ay[i] = fy;
  }
}

// ─── Integration (velocity Verlet / kick-drift-kick) ─────────────

function stepBodies(bodies, dt) {
  const h = dt / 2;
  for (const b of bodies) {
    b.vx += b.ax * h; b.vy += b.ay * h;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  computeBodyAccel(bodies);
  for (const b of bodies) {
    b.vx += b.ax * h; b.vy += b.ay * h;
  }
}

function stepBelt(belt, bodies, dt) {
  const { x, y, vx, vy, ax, ay, alive, n } = belt;
  const h = dt / 2;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
    x[i] += vx[i] * dt; y[i] += vy[i] * dt;
  }
  computeParticleAccel(belt, bodies);
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
  }
}

/** Record trail points in Sun-relative coordinates, about one orbit long. */
function sampleTrails(sys) {
  const { bodies, t } = sys;
  const sun = bodies[0];
  for (let i = 1; i < bodies.length; i++) {
    const b = bodies[i];
    if (t - b.lastSample < b.period / TRAIL_POINTS) continue;
    b.lastSample = t;
    b.trail.push(b.x - sun.x, b.y - sun.y);
    if (b.trail.length > TRAIL_POINTS * 2) b.trail.splice(0, 2);
  }
}

export function clearTrails(sys) {
  for (const b of sys.bodies) { b.trail = []; b.lastSample = -Infinity; }
}

function step(sys) {
  stepBodies(sys.bodies, DT);
  sys.t += DT;
  sys.stepCount++;
  // Belt particles move slowly, so they take bigger steps (every Nth body step).
  for (const belt of Object.values(sys.belts)) {
    if (sys.stepCount % belt.every === 0) stepBelt(belt, sys.bodies, DT * belt.every);
  }
  sampleTrails(sys);
}

/**
 * Advance up to `steps` steps, stopping early if `budgetMs` runs out.
 * Returns how many steps actually ran.
 */
export function advance(sys, steps, budgetMs) {
  const start = performance.now();
  let done = 0;
  while (done < steps) {
    step(sys);
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
    sample: () => ({ a: 2.1 + Math.random() * 1.2, e: Math.random() * 0.15 }),
  },
  kuiper: {
    label: "Kuiper Belt",
    count: 1500,
    every: 16,
    color: "rgba(140,172,214,0.75)",
    // Classical belt 38–50 AU, plus "plutinos" near Neptune's 3:2 resonance.
    sample: () =>
      Math.random() < 0.2
        ? { a: 39.2 + Math.random() * 0.5, e: 0.1 + Math.random() * 0.15 }
        : { a: 38 + Math.random() * 12, e: Math.random() * 0.1 },
  },
};

/** Scatter a belt's particles on random Keplerian orbits around the Sun's current position. */
export function addBelt(sys, key) {
  const def = BELTS[key];
  const n = def.count;
  const belt = {
    key, n, every: def.every, color: def.color,
    x: new Float64Array(n), y: new Float64Array(n),
    vx: new Float64Array(n), vy: new Float64Array(n),
    ax: new Float64Array(n), ay: new Float64Array(n),
    alive: new Uint8Array(n).fill(1),
    aliveCount: n, ejected: 0, swallowed: 0,
  };
  const sun = sys.bodies[0];
  const mu = G * sun.mass;
  for (let i = 0; i < n; i++) {
    const { a, e } = def.sample();
    const s = keplerState(
      { a, e, varpi: Math.random() * Math.PI * 2, M: Math.random() * Math.PI * 2 - Math.PI },
      mu,
    );
    belt.x[i] = sun.x + s.x; belt.y[i] = sun.y + s.y;
    belt.vx[i] = sun.vx + s.vx; belt.vy[i] = sun.vy + s.vy;
  }
  computeParticleAccel(belt, sys.bodies);
  sys.belts[key] = belt;
}

export function removeBelt(sys, key) {
  delete sys.belts[key];
}
