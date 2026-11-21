// Creating systems and bodies, and the few whole-system operations: the
// centre-of-mass frame, removing the Sun, and the chaos-slider masses.

import { BODY_DATA } from "./bodies.js";
import { G, JUPITER_INDEX, MAX_HISTORY } from "./constants.js";
import { elementsAt, julianCenturies, keplerState } from "./ephemeris.js";
import { computeBodyAccel, computeParticleAccel } from "./forces.js";

export function makeBody(spec) {
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
