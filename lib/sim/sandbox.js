// @ts-check
// Slingshot sandbox: throw your own bodies into the system.

import { DT, EARTH_MASS, G, SOFTENING } from "./constants.js";
import { collisionRadius, launchBody } from "./physics.js";

/** @typedef {import("./types").LaunchTypeDef} LaunchTypeDef */
/** @typedef {import("./types").SimSystem} SimSystem */
/** @typedef {import("./types").ViewSystem} ViewSystem */

/**
 * @type {Record<string, LaunchTypeDef>}
 */
export const LAUNCH_TYPES = {
  asteroid: {
    radiusKm: 50,
    label: "Asteroid",
    mass: 1e-12,
    displayRadius: 2.2,
    colors: ["#B8AE9F", "#9C948A", "#C9B79C"],
    prefix: "Asteroid",
    type: "Launched asteroid",
    description: "A rock you threw in. It's so light it doesn't pull on anything, so it just goes wherever gravity sends it.",
  },
  planet: {
    radiusKm: 6371,
    label: "Planet",
    mass: EARTH_MASS,
    displayRadius: 4.8,
    colors: ["#7FE0B0", "#E07FB8", "#7FB8E0", "#E0C87F", "#B89CF0"],
    prefix: "Planet",
    type: "Launched planet (1 Earth mass)",
    description: "An Earth-sized planet you threw in. Try getting it into a stable orbit — it's harder than it looks.",
  },
  giant: {
    radiusKm: 69911,
    label: "Gas giant",
    mass: 9.543e-4,
    displayRadius: 8,
    colors: ["#D9A066", "#9FC0D9", "#D98C8C"],
    prefix: "Giant",
    type: "Launched gas giant (1 Jupiter mass)",
    description: "A second Jupiter. Two giants close together tend to fling each other — and everything nearby — around.",
  },
  star: {
    radiusKm: 210000,
    label: "Red dwarf",
    mass: 0.3,
    displayRadius: 7,
    colors: ["#FF9A6A"],
    prefix: "Star",
    type: "Launched red dwarf (0.3 M☉)",
    description: "A small star you threw in. Even a lightweight star wrecks planetary orbits it passes near.",
    isStar: true,
    starPalette: "red",
  },
};

export const MAX_LAUNCHED = 30;

/** Pixels of drag that equal the speed of a circular orbit at the launch point. */
export const DRAG_PX_PER_ORBIT_SPEED = 80;

/**
 * Speed (AU/yr) of a circular orbit at distance r from the Sun.
 * @param {ViewSystem} sys
 * @param {number} r
 */
export function circularSpeed(sys, r) {
  const sun = sys.bodies[0];
  const M = sun.removed ? 1 : sun.mass;
  return Math.sqrt((G * M) / Math.max(r, 0.05));
}

/**
 * Rough orbital period (years) for trail length; long for unbound paths.
 * @param {ViewSystem} sys
 * @param {number} x
 * @param {number} y
 * @param {number} vx
 * @param {number} vy
 */
function periodEstimate(sys, x, y, vx, vy) {
  const sun = sys.bodies[0];
  const M = sun.removed ? 1 : sun.mass;
  const r = Math.hypot(x, y);
  const energy = 0.5 * (vx * vx + vy * vy) - (G * M) / r;
  if (energy >= 0) return 40;
  const a = (-G * M) / (2 * energy);
  return Math.min(300, Math.max(0.15, Math.pow(a, 1.5) / Math.sqrt(M)));
}

/**
 * Launch a body of `typeKey` at Sun-relative position (x, y) with velocity (vx, vy).
 * @param {SimSystem} sys
 * @param {string} typeKey
 * @param {number} x
 * @param {number} y
 * @param {number} vx
 * @param {number} vy
 */
export function launch(sys, typeKey, x, y, vx, vy) {
  const def = LAUNCH_TYPES[typeKey];
  const sameType = sys.bodies.filter((b) => b.launchType === typeKey && !b.discarded).length;
  const color = def.colors[sameType % def.colors.length];
  return launchBody(sys, {
    name: `${def.prefix} ${sameType + 1}`,
    mass: def.mass,
    color,
    displayRadius: def.displayRadius,
    radiusKm: def.radiusKm,
    isStar: def.isStar,
    starPalette: def.starPalette,
    type: def.type,
    description: def.description,
    launchType: typeKey,
    period: periodEstimate(sys, x, y, vx, vy),
    x, y, vx, vy,
  });
}

/**
 * @param {SimSystem} sys
 */
export function launchedCount(sys) {
  return sys.bodies.filter((b) => b.launched && !b.removed).length;
}

/**
 * Predict where a body launched now would go, by simulating a lightweight
 * copy of the system (bodies only, no belts) ahead of time. Returns points
 * relative to the Sun's predicted position, plus what stopped the path.
 * @param {ViewSystem} sys
 * @param {string} typeKey
 * @param {number} x
 * @param {number} y
 * @param {number} vx
 * @param {number} vy
 * @param {number} [maxSteps]
 * @returns {{ points: [number, number][], hit: string | null, years: number }}
 */
export function predictPath(sys, typeKey, x, y, vx, vy, maxSteps = 1400) {
  const src = sys.bodies.filter((b) => !b.removed || b.isSun);
  const n = src.length + 1;
  const px = new Float64Array(n), py = new Float64Array(n), pvx = new Float64Array(n), pvy = new Float64Array(n);
  const m = new Float64Array(n), fixed = new Uint8Array(n), ax = new Float64Array(n), ay = new Float64Array(n);
  src.forEach((b, i) => {
    px[i] = b.x; py[i] = b.y; pvx[i] = b.vx; pvy[i] = b.vy; m[i] = b.removed ? 0 : b.mass; fixed[i] = b.removed ? 1 : 0;
  });
  const p = n - 1;
  const sun = sys.bodies[0];
  px[p] = sun.x + x; py[p] = sun.y + y; pvx[p] = sun.vx + vx; pvy[p] = sun.vy + vy; m[p] = LAUNCH_TYPES[typeKey].mass;
  const reach = src.map((b) => collisionRadius(b) + collisionRadius({ mass: m[p], isStar: LAUNCH_TYPES[typeKey].isStar }));

  // Look ahead about one orbit (or a while, if it's escaping), in at most maxSteps steps.
  const horizon = Math.min(120, Math.max(0.4, periodEstimate(sys, x, y, vx, vy) * 1.02));
  const dt = Math.max(DT, horizon / maxSteps);
  const steps = Math.ceil(horizon / dt);

  const accel = () => {
    ax.fill(0); ay.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i], dy = py[j] - py[i];
        const r2 = dx * dx + dy * dy + SOFTENING;
        const k = G / (r2 * Math.sqrt(r2));
        ax[i] += m[j] * dx * k; ay[i] += m[j] * dy * k;
        ax[j] -= m[i] * dx * k; ay[j] -= m[i] * dy * k;
      }
    }
  };

  /** @type {[number, number][]} */
  const points = [[x, y]];
  let hit = null;
  accel();
  const every = Math.max(1, Math.floor(steps / 300));
  for (let s = 1; s <= steps; s++) {
    const h = dt / 2;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      pvx[i] += ax[i] * h; pvy[i] += ay[i] * h;
      px[i] += pvx[i] * dt; py[i] += pvy[i] * dt;
    }
    accel();
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      pvx[i] += ax[i] * h; pvy[i] += ay[i] * h;
    }
    if (s % every === 0) points.push([px[p] - px[0], py[p] - py[0]]);
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) continue;
      if (Math.hypot(px[p] - px[i], py[p] - py[i]) < reach[i]) { hit = src[i].name; break; }
    }
    if (hit) { points.push([px[p] - px[0], py[p] - py[0]]); break; }
    if (Math.hypot(px[p] - px[0], py[p] - py[0]) > 400) break;
  }
  return { points, hit, years: horizon };
}
