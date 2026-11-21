// @ts-check
// Turns orbital elements into positions and velocities.

/** @typedef {import("./types").Elements} Elements */
/** @typedef {import("./types").Orbit} Orbit */
/** @typedef {import("./types").State2D} State2D */

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/**
 * Julian centuries since J2000.0 (2000-01-01 12:00 TT) for a JS Date.
 * @param {Date} date
 */
export function julianCenturies(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - 2451545.0) / 36525;
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly E.
 * @param {number} M
 * @param {number} e
 */
export function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 50; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/**
 * Wrap an angle to [−π, π).
 * @param {number} a
 */
function wrap(a) {
  return ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

/**
 * Planar orbital elements for a body at time T (Julian centuries since J2000).
 * Returns { a, e, varpi, M } with angles in radians.
 * @param {{ el?: Elements, rate?: Elements }} body
 * @param {number} T
 * @returns {Orbit}
 */
export function elementsAt(body, T) {
  if (!body.el || !body.rate) throw new Error("elementsAt: body has no orbital elements");
  const [a0, e0, L0, w0] = body.el;
  const [da, de, dL, dw] = body.rate;
  const varpi = (w0 + dw * T) * DEG;
  const L = (L0 + dL * T) * DEG;
  return { a: a0 + da * T, e: e0 + de * T, varpi, M: wrap(L - varpi) };
}

/**
 * Position and velocity (relative to the central body) for a Keplerian orbit.
 * `mu` is G·(M_central + m_body). Angles in radians.
 * @param {Orbit} orbit
 * @param {number} mu
 * @returns {State2D}
 */
export function keplerState({ a, e, varpi, M }, mu) {
  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);

  // Position and velocity in the orbit's own frame (perihelion along +x).
  const xp = a * (cosE - e);
  const yp = b * sinE;
  const n = Math.sqrt(mu / (a * a * a));
  const Edot = n / (1 - e * cosE);
  const vxp = -a * sinE * Edot;
  const vyp = b * cosE * Edot;

  // Rotate so perihelion points along the longitude of perihelion.
  const c = Math.cos(varpi);
  const s = Math.sin(varpi);
  return {
    x: xp * c - yp * s,
    y: xp * s + yp * c,
    vx: vxp * c - vyp * s,
    vy: vxp * s + vyp * c,
  };
}
