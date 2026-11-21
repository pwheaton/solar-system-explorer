// @ts-check
// Collisions: detection, and what happens next. Stars swallow things; for
// everything else the impact model (impacts.js) decides merge vs shatter.

import { addDebris, debrisCount } from "./belts.js";
import { G } from "./constants.js";
import { computeBodyAccel } from "./forces.js";
import { insertRecord, snapshot } from "./history.js";
import {
  GRACE_STEPS, collisionRadius, formatDuration, impactSpeeds, physicalRadius, planImpact, starImpactEnergyYears, toKms,
} from "./impacts.js";
import { hashString } from "./rng.js";
import { makeBody } from "./system.js";

/** @typedef {import("./types").Body} Body */
/** @typedef {import("./types").SimSystem} SimSystem */
/** @typedef {import("./types").ShatterPlan} ShatterPlan */
/** @typedef {import("./types").BodyState} BodyState */
/** @typedef {import("./types").DebrisInit} DebrisInit */

let radii = new Float64Array(16);

/**
 * @param {SimSystem} sys
 */
export function detectCollisions(sys) {
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
        if (a.impactId && a.impactId === b.impactId && sys.stepCount < Math.max(a.graceUntil ?? 0, b.graceUntil ?? 0)) continue;
        resolveCollision(sys, i, j);
        radii[i] = bodies[i].removed ? -1 : collisionRadius(bodies[i]);
        radii[j] = bodies[j].removed ? -1 : collisionRadius(bodies[j]);
        if (radii[i] < 0) break;
      }
    }
  }
}

/**
 * @param {Body} b
 */
const isStarLike = (b) => b.isSun || b.isStar;

/**
 * Collision: stars swallow things; otherwise the impact model decides merge vs shatter.
 * @param {SimSystem} sys
 * @param {number} i
 * @param {number} j
 */
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
    maxDebris: Math.max(0, Math.min(500, MAX_DEBRIS - debrisCount(sys))),
    allowFragments: !A.fragment && !B.fragment && liveChunks < MAX_CHUNKS,
  });
  if (plan.kind === "merge") return merge(sys, i, j, plan);
  return shatter(sys, ti, pj, plan);
}

/** Limits that keep a pile-up from overwhelming slower devices. */
const MAX_CHUNKS = 45;

const MAX_DEBRIS = 3000;

/**
 * Merge two bodies, conserving mass and momentum. The heavier one (or the Sun) survives.
 * @param {SimSystem} sys
 * @param {number} i
 * @param {number} j
 * @param {{ vImp: number }} [plan]
 */
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

/**
 * Blend two #rrggbb colours.
 * @param {string} a
 * @param {string} b
 * @param {number} t
 */
function mixColor(a, b, t) {
  /** @param {string} h @param {number} k */
  const p = (h, k) => parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16);
  const c = [0, 1, 2].map((k) => Math.round(p(a, k) * (1 - t) + p(b, k) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Orbital period estimate (years) around the Sun, for trail length.
 * @param {Body} sun
 * @param {number} x
 * @param {number} y
 * @param {number} vx
 * @param {number} vy
 */
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
 * @param {SimSystem} sys
 * @param {number} ti  the target (heavier body)
 * @param {number} pj  the impactor
 * @param {ShatterPlan} plan
 */
function shatter(sys, ti, pj, plan) {
  const { bodies } = sys;
  const T = bodies[ti], P = bodies[pj];
  const sun = bodies[0];
  const before = /** @type {[BodyState, BodyState]} */ ([snapshot(T), snapshot(P)]);
  const M = T.mass + P.mass;
  const X = (T.mass * T.x + P.mass * P.x) / M, Y = (T.mass * T.y + P.mass * P.y) / M;
  const VX = (T.mass * T.vx + P.mass * P.vx) / M, VY = (T.mass * T.vy + P.mass * P.vy) / M;
  const impactId = sys.nextImpactId++;
  const graceUntil = sys.stepCount + GRACE_STEPS;
  // Density stays the parent's: radius scales with the cube root of mass.
  /** @param {number} m */
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
  /** @type {{ index: number, state: BodyState }[]} */
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
  /** @type {string | null} */
  let debrisKey = null;
  /** @type {DebrisInit | null} */
  let debrisInit = null;
  if (plan.debris.length) {
    debrisKey = `debris-${impactId}`;
    const n = plan.debris.length;
    const init = { x: new Float64Array(n), y: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n) };
    plan.debris.forEach((d, k) => {
      init.x[k] = X + d.x; init.y[k] = Y + d.y;
      init.vx[k] = VX + d.vx; init.vy[k] = VY + d.vy;
    });
    debrisInit = init;
    addDebris(sys, debrisKey, init, sys.t, plan.debrisMass);
  }

  const kept = Math.round(plan.fLR * 100);
  const pieces = plan.fragments.length;
  const text = `${P.name} hit ${T.name} at ${Math.round(toKms(plan.vImp))} km/s. ${T.name} kept ${kept}% of the mass`
    + (pieces ? `; ${pieces} big chunk${pieces > 1 ? "s" : ""} and a debris cloud flew off` : "; the rest became a debris cloud");
  insertRecord(sys, {
    kind: "impact", step: sys.stepCount, t: sys.t, a: ti, b: pj, before, after: /** @type {[BodyState, BodyState]} */ ([snapshot(T), snapshot(P)]),
    created, debrisKey, debrisInit, debrisMass: plan.debrisMass, text,
  });
  sys.flashes.push({ hx: X - sun.x, hy: Y - sun.y, at: performance.now(), power: 1, shatter: true });
  computeBodyAccel(bodies);
}
