// @ts-check
// What happens when two bodies collide.
//
// The outcome follows the scaling laws used in planet-formation research
// (Leinhardt & Stewart 2012, "Collisions between gravity-dominated bodies"):
//
//   1. Work out the real impact speed, using the bodies' true radii. Even two
//      bodies drifting together hit at least at their mutual escape speed,
//      because gravity accelerates them on the way in.
//   2. Slower than ~1.4x escape speed: they merge (gravity wins).
//   3. Faster: compare the impact energy per unit mass, Q_R, with the energy
//      needed to blow away half the combined mass, Q*_RD. The "universal law"
//      gives the mass fraction kept by the largest remnant:
//          M_lr / M_total = 1 - Q_R / (2 Q*_RD)
//      The rest becomes a few large fragments (real bodies, with gravity) and
//      a cloud of small debris (test particles that feel gravity).
//
// Fragments are thrown out at speeds around the remnant's escape speed, mostly
// "downrange" in the direction the impactor was travelling: some escape,
// some fall back and re-merge.

import { AU_KM, EARTH_MASS, G, YEAR_S } from "./constants.js";
import { mulberry32 } from "./rng.js";

/** @typedef {import("./types").MassPoint} MassPoint */
/** @typedef {import("./types").ImpactSpeeds} ImpactSpeeds */
/** @typedef {import("./types").ImpactPlan} ImpactPlan */

const SOLAR_MASS_KG = 1.98892e30;
const G_SI = 6.674e-11;
const KMS_PER_AU_YR = AU_KM / YEAR_S; // 1 AU/yr ≈ 4.74 km/s
const SUN_LUMINOSITY_W = 3.828e26;
const SECONDS_PER_YEAR = YEAR_S;

/** Below this many times escape speed, colliding bodies simply merge. */
export const MERGE_SPEED_RATIO = 1.4;
export const MAX_FRAGMENTS = 7;
/** Fragments lighter than this (~half of Vesta) become debris instead of bodies. */
export const MIN_FRAGMENT_MASS = 6e-11;
/**
 * Steps after an impact during which its pieces can't re-collide with each
 * other (250 steps = 0.05 yr, about 18 days): long enough to watch the
 * explosion fly apart before chunks start re-accreting.
 */
export const GRACE_STEPS = 250;

/**
 * True physical radius in AU (from radiusKm, or from mass at Earth's density).
 * @param {{ mass: number, radiusKm?: number }} b
 */
export function physicalRadius(b) {
  const km = b.radiusKm ?? 6371 * Math.cbrt(b.mass / EARTH_MASS);
  return km / AU_KM;
}

/**
 * @param {number} auPerYear
 */
export const toKms = (auPerYear) => auPerYear * KMS_PER_AU_YR;

/**
 * How fast two bodies actually hit, and their mutual escape speed (both AU/yr).
 * @param {MassPoint} A
 * @param {MassPoint} B
 * @returns {ImpactSpeeds}
 */
export function impactSpeeds(A, B) {
  const M = A.mass + B.mass;
  const R = physicalRadius(A) + physicalRadius(B);
  const d = Math.max(R, Math.hypot(B.x - A.x, B.y - A.y));
  const vRel = Math.hypot(B.vx - A.vx, B.vy - A.vy);
  const vEsc = Math.sqrt((2 * G * M) / R);
  // Energy conservation from the detection distance down to actual contact.
  const vImp = Math.sqrt(vRel * vRel + 2 * G * M * (1 / R - 1 / d));
  return { vImp, vEsc, vRel };
}

/**
 * Catastrophic disruption threshold Q*_RD in J/kg for a combined mass in
 * solar masses (Leinhardt & Stewart 2012, eq. 28 with c* = 1.9, ρ1 = 1 g/cm³).
 * @param {number} totalMass
 */
export function disruptionThreshold(totalMass) {
  const Mkg = totalMass * SOLAR_MASS_KG;
  const rho1 = 1000;
  const Rc1 = Math.cbrt((3 * Mkg) / (4 * Math.PI * rho1));
  return 1.9 * 0.8 * Math.PI * rho1 * G_SI * Rc1 * Rc1;
}

/**
 * Fraction of the total mass kept by the largest remnant.
 * @param {MassPoint} A
 * @param {MassPoint} B
 * @param {ImpactSpeeds} [speeds]
 */
export function largestRemnantFraction(A, B, speeds = impactSpeeds(A, B)) {
  const M = A.mass + B.mass;
  if (speeds.vImp < MERGE_SPEED_RATIO * speeds.vEsc) return 1;
  const v = toKms(speeds.vImp) * 1000; // m/s
  const QR = (0.5 * ((A.mass * B.mass) / M) * v * v) / M; // J/kg
  const f = 1 - QR / (2 * disruptionThreshold(M));
  return Math.min(1, Math.max(0.04, f));
}

/**
 * Energy released when a body falls into a star, in "years of the Sun's output".
 * @param {{ mass: number, radiusKm?: number }} star
 * @param {{ mass: number, radiusKm?: number }} body
 */
export function starImpactEnergyYears(star, body) {
  const E = (G_SI * star.mass * SOLAR_MASS_KG * body.mass * SOLAR_MASS_KG) / (physicalRadius(star) * AU_KM * 1000);
  return E / (SUN_LUMINOSITY_W * SECONDS_PER_YEAR);
}

/**
 * @param {number} years
 */
export function formatDuration(years) {
  const s = years * SECONDS_PER_YEAR;
  if (s < 1) return "less than a second";
  if (s < 90) return `${Math.round(s)} seconds`;
  if (s < 5400) return `${Math.round(s / 60)} minutes`;
  if (s < 172800) return `${Math.round(s / 3600)} hours`;
  if (years < 0.5) return `${Math.round(s / 86400)} days`;
  if (years < 1000) return `${Math.round(years)} years`;
  return `${Math.round(years).toLocaleString("en-US")} years`;
}

/**
 * @param {number} ux
 * @param {number} uy
 * @param {number} angle
 * @returns {[number, number]}
 */
function rotate(ux, uy, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [ux * c - uy * s, ux * s + uy * c];
}

/**
 * Mostly downrange (within ~75° of the impactor's direction), some in any direction.
 * @param {() => number} rng
 * @param {number} ux
 * @param {number} uy
 */
function ejectaDirection(rng, ux, uy) {
  const angle = rng() < 0.7 ? (rng() * 2 - 1) * 1.3 : rng() * Math.PI * 2;
  return rotate(ux, uy, angle);
}

/**
 * Plan a collision between `target` (the heavier body) and `impactor`.
 * Positions and velocities in the plan are relative to the pair's centre of
 * mass. `reach(mass)` is the (enlarged) collision distance for a body of that
 * mass, used to place pieces just clear of each other.
 * @param {MassPoint} target
 * @param {MassPoint} impactor
 * @param {{ seed: number, reach: (mass: number) => number, maxDebris?: number, allowFragments?: boolean }} options
 * @returns {ImpactPlan}
 */
export function planImpact(target, impactor, { seed, reach, maxDebris = 500, allowFragments = true }) {
  const speeds = impactSpeeds(target, impactor);
  const M = target.mass + impactor.mass;
  const fLR = largestRemnantFraction(target, impactor, speeds);
  if (fLR > 0.97) return { kind: "merge", vImp: speeds.vImp, vEsc: speeds.vEsc, fLR };

  const rng = mulberry32(seed);
  let Mlr = fLR * M;
  const Mrest = M - Mlr;

  // Ejecta speeds are drawn relative to the remnant's real escape speed
  // (escape speed scales as M^1/3 at fixed density). Anything slower than
  // escape falls back within hours, so it rejoins the remnant. Anything faster
  // leaves with its "hyperbolic excess" speed, sqrt(v² − v_esc²): what it has
  // left after climbing out of the remnant's gravity well.
  const vEscLR = speeds.vEsc * Math.cbrt(fLR);
  /** @param {number} f  speed in units of escape speed */
  const excess = (f) => vEscLR * Math.sqrt(f * f - 1);

  // Big fragments: a geometric series. The biggest is ~32% of the ejected mass,
  // but never more than half the largest remnant (so it stays the largest);
  // in very violent impacts most of the mass ends up as debris.
  // Chunks hit again don't spawn more big chunks (their losses become debris),
  // which keeps a pile-up from snowballing into hundreds of bodies.
  const fragMasses = [];
  const first = Math.min(Mrest * 0.32, Mlr * 0.5);
  for (let i = 0; allowFragments && i < MAX_FRAGMENTS; i++) {
    const m = first * Math.pow(0.55, i);
    if (m < MIN_FRAGMENT_MASS) break;
    fragMasses.push(m);
  }
  let debrisMass = Mrest - fragMasses.reduce((a, b) => a + b, 0);

  // Downrange = the impactor's direction of travel relative to the target.
  let ux = impactor.vx - target.vx, uy = impactor.vy - target.vy;
  let un = Math.hypot(ux, uy);
  if (un < 1e-12) { ux = impactor.x - target.x; uy = impactor.y - target.y; un = Math.hypot(ux, uy) || 1; }
  ux /= un; uy /= un;

  const escaping = [];
  for (const m of fragMasses) {
    const f = 0.85 + rng() * 1.35; // speed in units of escape speed
    const [dx, dy] = ejectaDirection(rng, ux, uy);
    if (f < 1) { Mlr += m; continue; } // falls back
    escaping.push({ m, dx, dy, vInf: excess(f) });
  }

  // Debris: more particles for more mass (a puff for a small impact, a few
  // hundred for a planet-scale one), capped for speed.
  const planned = debrisMass > 1e-12
    ? Math.round(Math.min(maxDebris, Math.max(0, 70 * Math.log10(debrisMass / 1e-12))))
    : 0;
  const perParticle = planned ? debrisMass / planned : 0;
  const debrisDirs = [];
  for (let k = 0; k < planned; k++) {
    const f = 0.7 + rng() * 2.3;
    const [dx, dy] = ejectaDirection(rng, ux, uy);
    if (f < 1) { Mlr += perParticle; debrisMass -= perParticle; continue; } // falls back
    debrisDirs.push({ dx, dy, vInf: excess(f), jitter: rng() });
  }

  // Place escaping pieces just outside the (enlarged) collision zone, with
  // enough extra speed to climb out of the remnant's pull from there.
  const rLR = reach(Mlr);
  const fragments = escaping.map(({ m, dx, dy, vInf }) => {
    const dist = (rLR + reach(m)) * 1.15;
    const speed = Math.sqrt(vInf * vInf + (2 * G * (Mlr + m)) / dist);
    return { mass: m, x: dx * dist, y: dy * dist, vx: dx * speed, vy: dy * speed };
  });

  // Recoil on the remnant so the massive pieces keep the pair's total momentum.
  let px = 0, py = 0;
  for (const f of fragments) { px += f.mass * f.vx; py += f.mass * f.vy; }
  const remnant = { mass: Mlr, vx: -px / Mlr, vy: -py / Mlr };

  const debris = debrisDirs.map(({ dx, dy, vInf, jitter }) => {
    const dist = rLR * (1.05 + jitter * 0.35);
    const speed = Math.sqrt(vInf * vInf + (2 * G * Mlr) / dist);
    return { x: dx * dist, y: dy * dist, vx: dx * speed, vy: dy * speed };
  });

  return {
    kind: "shatter", vImp: speeds.vImp, vEsc: speeds.vEsc, fLR: Mlr / M,
    remnant, fragments, debris, debrisMass: Math.max(0, debrisMass),
  };
}

/**
 * How close two bodies have to get to collide, in AU. Far bigger than real
 * radii (Earth is 0.00004 AU across), which would make collisions vanishingly
 * rare at this time step. Scales with the cube root of mass, like a radius.
 * @param {{ mass: number, isSun?: boolean, isStar?: boolean }} b
 */
export function collisionRadius(b) {
  if (b.isSun || b.isStar || b.mass > 0.01) return Math.max(0.02, 0.03 * Math.cbrt(b.mass));
  return Math.min(0.1, Math.max(0.004, 0.012 * Math.cbrt(b.mass / 3.003e-6)));
}
