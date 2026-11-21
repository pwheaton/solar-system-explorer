// @ts-check
// Turns a simulated system into plain shapes (circles, paths, dots) for a
// static picture, using the same camera mapping as the live canvas. No DOM,
// so it runs on the server for link-preview images.

import { auToScreenRadius, makeView, worldToScreen } from "./camera.js";
import { JUPITER_INDEX, STAR_THRESHOLD_JUPITERS } from "./constants.js";
import { elementsAt, julianCenturies, keplerState } from "./ephemeris.js";
import { G } from "./constants.js";

const GRID_AU = [1, 5, 10, 30, 50];

/**
 * @param {[number, number][]} points
 */
function pathFrom(points) {
  if (points.length < 2) return null;
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

/**
 * @typedef {{
 *   name: string, x: number, y: number, r: number, color: string,
 *   removed: boolean, star: string | null, rings?: boolean, dwarf?: boolean, onScreen: boolean,
 * }} SceneBody
 * @typedef {{
 *   width: number, height: number,
 *   rings: { cx: number, cy: number, r: number, au: number }[],
 *   orbits: { d: string | null, color: string }[],
 *   trails: { d: string | null, color: string }[],
 *   dots: { x: number, y: number, color: string }[],
 *   bodies: SceneBody[],
 * }} Scene
 */

/**
 * @param {import("./types").SimSystem} sys  system from createSystem/runScenario
 * @param {{
 *   width: number, height: number, centerX?: number, zoom?: number, distExp?: number,
 *   sunMass?: number, jupMass?: number, maxDots?: number,
 * }} opts
 * @returns {Scene}
 */
export function buildScene(sys, opts) {
  const { width, height, centerX = width / 2, zoom = 1, distExp = 0.42, sunMass = 1, jupMass = 1, maxDots = 900 } = opts;
  const view = makeView(width, height, { zoom, panX: 0, panY: 0 }, distExp);
  view.cx = centerX;
  view.scale = height * 0.45;
  const sun = sys.bodies[0];
  const [ox, oy] = worldToScreen(view, 0, 0);

  const rings = GRID_AU.map((au) => ({ cx: ox, cy: oy, r: auToScreenRadius(view, au), au }));

  // Full orbit ellipses at the start, so the "today" picture shows where each planet goes.
  const T = julianCenturies(sys.startDate);
  const orbits = sys.t === 0
    ? sys.bodies.filter((b) => b.el).map((b) => {
        const el = elementsAt(b, T);
        /** @type {[number, number][]} */
        const pts = [];
        for (let k = 0; k <= 96; k++) {
          const s = keplerState({ ...el, M: (k / 96) * 2 * Math.PI - Math.PI }, G);
          pts.push(worldToScreen(view, s.x, s.y));
        }
        return { d: pathFrom(pts), color: b.color };
      })
    : [];

  const trails = sys.bodies.slice(1).filter((b) => !b.removed && b.trail.length >= 4).map((b) => {
    /** @type {[number, number][]} */
    const pts = [];
    for (let i = 0; i < b.trail.length; i += 2) pts.push(worldToScreen(view, b.trail[i], b.trail[i + 1]));
    return { d: pathFrom(pts), color: b.color };
  });

  const dots = [];
  for (const belt of Object.values(sys.belts)) {
    const stride = Math.max(1, Math.ceil(belt.n / maxDots));
    for (let i = 0; i < belt.n; i += stride) {
      if (!belt.alive[i]) continue;
      const [x, y] = worldToScreen(view, belt.x[i] - sun.x, belt.y[i] - sun.y);
      if (x < 0 || y < 0 || x > width || y > height) continue;
      dots.push({ x, y, color: belt.key === "asteroids" ? "rgba(214,192,150,0.65)" : "rgba(150,190,230,0.6)" });
    }
  }

  const bodies = sys.bodies.map((b, i) => {
    const [x, y] = worldToScreen(view, b.x - sun.x, b.y - sun.y);
    const ignited = i === JUPITER_INDEX && jupMass >= STAR_THRESHOLD_JUPITERS;
    let r = b.displayRadius;
    if (b.isSun) r *= 1.5 * Math.sqrt(sunMass);
    if (i === JUPITER_INDEX && jupMass !== 1) r *= Math.min(2.5, Math.pow(jupMass, 1 / 6));
    return {
      name: b.name, x, y, r, color: b.color,
      removed: b.removed,
      star: b.isSun ? "sun" : b.isStar ? (b.starPalette ?? "sun") : ignited ? "red" : null,
      rings: b.rings,
      dwarf: b.isDwarf,
      onScreen: x > -20 && y > -20 && x < width + 20 && y < height + 20,
    };
  });

  return { width, height, rings, orbits, trails, dots, bodies };
}
