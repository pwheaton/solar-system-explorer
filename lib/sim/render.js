// Canvas drawing for one frame. Everything is drawn in screen space through
// the shared camera mapping; no canvas transforms, so nothing drifts out of line.

import { auToScreenRadius, screenToWorld, worldToScreen } from "./camera.js";
import { JUPITER_INDEX, MAX_AU, STAR_THRESHOLD_JUPITERS } from "./constants.js";

const GRID_AU = [1, 2, 3, 4, 5, 10, 20, 30, 40, 50];
const LABELLED_AU = new Set([1, 5, 10, 30, 50]);
const BG = "#070a12";

// Background starfield, rendered once per canvas size into an offscreen canvas.
let starfield = null;
function getStarfield(w, h, dpr) {
  if (starfield && starfield.w === w && starfield.h === h && starfield.dpr === dpr) return starfield.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const c = canvas.getContext("2d");
  c.scale(dpr, dpr);
  // Deterministic pseudo-random so the sky doesn't reshuffle on resize.
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const count = Math.round((w * h) / 2600);
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const m = rnd();
    const r = m > 0.985 ? 1.1 : m > 0.9 ? 0.75 : 0.5;
    const warm = rnd() > 0.7;
    c.fillStyle = warm ? `rgba(255,228,190,${0.15 + rnd() * 0.35})` : `rgba(200,215,255,${0.12 + rnd() * 0.3})`;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  starfield = { w, h, dpr, canvas };
  return canvas;
}
const GRAV_RES = 72;
const TRAIL_CHUNKS = 5; // fade steps per trail: each is a separate stroke

const STAR_PALETTES = {
  sun: {
    glow: ["rgba(253,184,19,0.4)", "rgba(253,150,19,0.15)", "rgba(253,184,19,0)"],
    body: ["#FFF8E0", "#FDB813", "#E8960A"],
  },
  red: {
    glow: ["rgba(255,140,60,0.45)", "rgba(255,90,40,0.15)", "rgba(255,90,40,0)"],
    body: ["#FFE6C8", "#FF8A3C", "#C8501E"],
  },
  white: {
    glow: ["rgba(190,210,255,0.45)", "rgba(150,180,255,0.15)", "rgba(150,180,255,0)"],
    body: ["#FFFFFF", "#D8E4FF", "#8FB0FF"],
  },
};

export function createGravityLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = GRAV_RES;
  canvas.height = GRAV_RES;
  return { canvas, ctx: canvas.getContext("2d"), image: null, field: new Float64Array(GRAV_RES * GRAV_RES) };
}

/** Recompute the gravity-strength heatmap for the current view. */
export function updateGravityLayer(layer, bodies, view) {
  const { ctx, field } = layer;
  if (!layer.image) layer.image = ctx.createImageData(GRAV_RES, GRAV_RES);
  const data = layer.image.data;
  const sun = bodies[0];
  let maxF = 0;

  for (let py = 0; py < GRAV_RES; py++) {
    for (let px = 0; px < GRAV_RES; px++) {
      const [hx, hy] = screenToWorld(view, ((px + 0.5) / GRAV_RES) * view.w, ((py + 0.5) / GRAV_RES) * view.h);
      const wx = hx + sun.x, wy = hy + sun.y;
      let f = 0;
      for (const b of bodies) {
        const dx = wx - b.x, dy = wy - b.y;
        f += b.mass / (dx * dx + dy * dy + 0.01);
      }
      field[py * GRAV_RES + px] = f;
      if (f > maxF) maxF = f;
    }
  }

  const logMax = Math.log(maxF + 1);
  for (let i = 0; i < field.length; i++) {
    const t = Math.log(field[i] + 1) / logMax;
    const t2 = t * t;
    data[i * 4] = Math.min(255, t2 * t * 180 + t2 * 30);
    data[i * 4 + 1] = Math.min(255, t2 * 100 + t * 40);
    data[i * 4 + 2] = Math.min(255, Math.pow(t, 0.45) * 200);
    data[i * 4 + 3] = Math.min(255, Math.pow(t, 0.35) * 180);
  }
  ctx.putImageData(layer.image, 0, 0);
}

export function drawFrame(ctx, sys, view, opts) {
  const { bodies } = sys;
  const sun = bodies[0];
  const { w, h } = view;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const dpr = window.devicePixelRatio || 1;
  ctx.drawImage(getStarfield(w, h, dpr), 0, 0, w, h);

  // Distance rings, with a few labelled like the scale on an instrument.
  const [ox, oy] = worldToScreen(view, 0, 0);
  ctx.lineWidth = 0.6;
  ctx.font = `9px ${opts.monoFont || "monospace"}`;
  ctx.textAlign = "left";
  for (const au of GRID_AU) {
    const r = auToScreenRadius(view, au);
    ctx.strokeStyle = LABELLED_AU.has(au) ? "rgba(148,163,196,0.13)" : "rgba(148,163,196,0.06)";
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (LABELLED_AU.has(au) && r > 18) {
      ctx.fillStyle = "rgba(148,163,196,0.32)";
      ctx.fillText(`${au} AU`, ox + r * 0.707 + 4, oy - r * 0.707 - 4);
    }
  }

  if (opts.showGrav && opts.gravityLayer) {
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(opts.gravityLayer.canvas, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  drawBelts(ctx, sys, view);
  if (opts.showTrails) drawTrails(ctx, bodies, view, sys.t);

  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b.removed && !b.isSun) continue; // swallowed in a collision, or not launched yet
    const [bx, by] = worldToScreen(view, b.x - sun.x, b.y - sun.y);
    if (b.isSun) {
      if (b.removed) drawGhost(ctx, bx, by);
      else drawStar(ctx, bx, by, b.displayRadius * (1 + opts.sizeMult * 0.5) * Math.sqrt(opts.sunMult), "sun");
    } else if (b.isStar) {
      drawSelection(ctx, b, i, bx, by, b.displayRadius * 1.2, opts);
      drawStar(ctx, bx, by, b.displayRadius * (0.7 + opts.sizeMult * 0.3), b.starPalette);
      drawLabel(ctx, b, bx, by, b.displayRadius, opts.labelFont);
    } else {
      drawPlanet(ctx, b, i, bx, by, opts);
    }
  }

  drawFlashes(ctx, sys, view);
  if (opts.launch) drawLaunchPreview(ctx, view, opts.launch, opts.monoFont);
}

const FLASH_MS = 1400;
const SHATTER_MS = 2600;

/**
 * Impact flashes. Merges get a glow scaled by the impactor's mass; shattering
 * impacts get a white-hot core, an expanding shockwave ring and a longer fade.
 */
function drawFlashes(ctx, sys, view) {
  const now = performance.now();
  sys.flashes = sys.flashes.filter((f) => now - f.at < (f.shatter ? SHATTER_MS : FLASH_MS));
  for (const f of sys.flashes) {
    const life = f.shatter ? SHATTER_MS : FLASH_MS;
    const k = (now - f.at) / life;
    const fade = 1 - k;
    const p = f.power ?? 0.5;
    const [x, y] = worldToScreen(view, f.hx, f.hy);

    const r = 6 + k * (20 + 70 * p);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,248,230,${0.95 * fade})`);
    g.addColorStop(0.35, `rgba(255,180,90,${0.5 * fade})`);
    g.addColorStop(1, "rgba(255,110,50,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Shockwave: a thin ring racing outward, faster than the glow.
    ctx.strokeStyle = `rgba(255,225,190,${0.75 * fade * fade})`;
    ctx.lineWidth = f.shatter ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 8 + k * (f.shatter ? 140 : 50 + 40 * p), 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Debris colour by age in sim-years: white-hot, then orange, then dull rock. */
function debrisColor(age) {
  const stops = [
    [0, [255, 250, 235], 1],
    [0.04, [255, 205, 120], 0.95],
    [0.25, [240, 130, 70], 0.85],
    [1.2, [160, 120, 100], 0.65],
    [4, [130, 120, 112], 0.5],
  ];
  if (age >= stops[stops.length - 1][0]) {
    const [, c, a] = stops[stops.length - 1];
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  for (let i = 1; i < stops.length; i++) {
    if (age < stops[i][0]) {
      const [t0, c0, a0] = stops[i - 1];
      const [t1, c1, a1] = stops[i];
      const u = (age - t0) / (t1 - t0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * u));
      return `rgba(${c[0]},${c[1]},${c[2]},${(a0 + (a1 - a0) * u).toFixed(2)})`;
    }
  }
  return "rgba(255,255,255,1)";
}

/** While dragging in launch mode: throw arrow, predicted path, speed readout. */
function drawLaunchPreview(ctx, view, L, monoFont) {
  const [fx, fy] = L.from;
  const [tx, ty] = L.to;

  if (L.points && L.points.length > 1) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = L.hit ? "rgba(255,138,92,0.85)" : "rgba(143,208,234,0.8)";
    ctx.beginPath();
    L.points.forEach(([hx, hy], i) => {
      const [x, y] = worldToScreen(view, hx, hy);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
    if (L.hit) {
      const [ex, ey] = worldToScreen(view, ...L.points[L.points.length - 1]);
      ctx.strokeStyle = "rgba(255,138,92,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey + 5);
      ctx.moveTo(ex + 5, ey - 5); ctx.lineTo(ex - 5, ey + 5);
      ctx.stroke();
    }
  }

  // Arrow from the launch point in the throw direction.
  const len = Math.hypot(tx - fx, ty - fy);
  if (len > 3) {
    const ux = (tx - fx) / len, uy = (ty - fy) / len;
    ctx.strokeStyle = "#f2b441";
    ctx.fillStyle = "#f2b441";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx - ux * 8, ty - uy * 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * 11 - uy * 5, ty - uy * 11 + ux * 5);
    ctx.lineTo(tx - ux * 11 + uy * 5, ty - uy * 11 - ux * 5);
    ctx.closePath();
    ctx.fill();
  }

  // The body-to-be.
  ctx.fillStyle = L.color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(fx, fy, L.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(242,180,65,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(fx, fy, L.radius + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Speed readout next to the arrow tip.
  const label = len > 3
    ? `${L.factor.toFixed(1)}× orbital speed${L.hit ? ` · hits ${L.hit}` : ""}`
    : "let go for a circular orbit · drag to throw";
  ctx.font = `11px ${monoFont || "monospace"}`;
  ctx.textAlign = "left";
  const lx = (len > 3 ? tx : fx) + 12, ly = (len > 3 ? ty : fy) - 10;
  const w = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(9,13,24,0.85)";
  ctx.fillRect(lx - 5, ly - 12, w + 10, 17);
  ctx.fillStyle = L.hit ? "#ff8a5c" : Math.abs(L.factor - 1) < 0.08 ? "#7cc79a" : "#ebe6d8";
  ctx.fillText(label, lx, ly);
}

/** Dashed outline marking where the Sun used to be. */
function drawGhost(ctx, x, y) {
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgba(253,184,19,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBelts(ctx, sys, view) {
  const sun = sys.bodies[0];
  const { cx, cy, panX, panY, scale, zoom, exp } = view;
  const k0 = scale * zoom;
  for (const belt of sys.beltList) {
    const { x, y, alive, n } = belt;
    const age = belt.debris ? Math.abs(sys.t - belt.born) : 0;
    ctx.fillStyle = belt.debris ? debrisColor(age) : belt.color;
    const size = belt.debris ? (age < 0.25 ? 1.7 : 1.3) : 1.1;
    const half = size / 2;
    // One path per belt and a single fill: much cheaper than thousands of fillRect calls.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      // Inlined worldToScreen — this runs thousands of times per frame.
      const dx = (x[i] - sun.x) / MAX_AU, dy = (y[i] - sun.y) / MAX_AU;
      const r = Math.sqrt(dx * dx + dy * dy);
      const k = (Math.pow(r, exp) / r) * k0;
      const sx = cx + panX + dx * k, sy = cy + panY + dy * k;
      if (sx < -2 || sy < -2 || sx > view.w + 2 || sy > view.h + 2) continue;
      ctx.rect(sx - half, sy - half, size, size);
    }
    ctx.fill();
  }
}

function drawTrails(ctx, bodies, view, now) {
  ctx.lineWidth = 1.2;
  ctx.lineCap = "butt"; // round caps/joins on hundreds of short segments are costly
  ctx.lineJoin = "miter";
  // Inlined worldToScreen (no array per point), and points closer than ~0.8 px
  // to the last one drawn are skipped: thousands of trail points per frame.
  const { cx, cy, panX, panY, scale, zoom, exp } = view;
  const ox = cx + panX, oy = cy + panY, k0 = scale * zoom, inv = 1 / MAX_AU;
  for (let bi = 1; bi < bodies.length; bi++) {
    const b = bodies[bi];
    if (b.removed) continue;
    const pts = b.trail;
    const times = b.trailT;
    const count = pts.length / 2;
    if (count < 2) continue;
    // Draw in chunks that fade with distance in time from "now", so the wake
    // is bright behind the body whichever way time is running.
    const chunk = Math.ceil(count / TRAIL_CHUNKS);
    for (let c = 0; c < TRAIL_CHUNKS; c++) {
      const start = c * chunk;
      const end = Math.min(count - 1, start + chunk);
      if (start >= end) break;
      ctx.beginPath();
      let lx = 0, ly = 0;
      for (let t = start; t <= end; t++) {
        const dx = pts[t * 2] * inv, dy = pts[t * 2 + 1] * inv;
        const r = Math.sqrt(dx * dx + dy * dy);
        const k = r < 1e-12 ? 0 : (Math.pow(r, exp) / r) * k0;
        const sx = ox + dx * k, sy = oy + dy * k;
        if (t === start) { ctx.moveTo(sx, sy); lx = sx; ly = sy; continue; }
        if (t !== end && Math.abs(sx - lx) + Math.abs(sy - ly) < 0.8) continue;
        ctx.lineTo(sx, sy);
        lx = sx; ly = sy;
      }
      const age = Math.abs((times[start] + times[end]) / 2 - now) / b.period;
      const alpha = 0.06 + 0.7 * Math.max(0, 1 - age) ** 1.6;
      ctx.strokeStyle = b.color + ALPHA_HEX[Math.round(alpha * 255)];
      ctx.stroke();
    }
  }
}

// "00".."ff", so trail colours don't build hex strings every frame.
const ALPHA_HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

// Planets and stars are pre-rendered once per colour and size into small
// offscreen canvases, then stamped with drawImage. Building radial gradients
// for every body on every frame is slow on older browsers.
const sprites = new Map();
const quant = (r) => Math.max(0.5, Math.round(r * 2) / 2);

function sprite(key, radius, paint) {
  const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const k = `${key}|${radius}|${dpr}`;
  let entry = sprites.get(k);
  if (!entry) {
    if (sprites.size > 400) sprites.clear();
    const size = Math.ceil(radius * 2 + 2);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.ceil(size * dpr);
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    paint(c, size / 2, size / 2);
    entry = { canvas, size };
    sprites.set(k, entry);
  }
  return entry;
}

function stamp(ctx, entry, x, y) {
  ctx.drawImage(entry.canvas, x - entry.size / 2, y - entry.size / 2, entry.size, entry.size);
}

function drawStar(ctx, x, y, r, palette) {
  const rq = quant(r);
  const { glow, body } = STAR_PALETTES[palette] || STAR_PALETTES.sun;
  stamp(ctx, sprite(`star:${palette}`, rq * 4, (c, cx, cy) => {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, rq * 4);
    g.addColorStop(0, glow[0]);
    g.addColorStop(0.3, glow[1]);
    g.addColorStop(1, glow[2]);
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, rq * 4, 0, Math.PI * 2);
    c.fill();
    const s = c.createRadialGradient(cx - rq * 0.2, cy - rq * 0.2, 0, cx, cy, rq);
    s.addColorStop(0, body[0]);
    s.addColorStop(0.5, body[1]);
    s.addColorStop(1, body[2]);
    c.fillStyle = s;
    c.beginPath();
    c.arc(cx, cy, rq, 0, Math.PI * 2);
    c.fill();
  }), x, y);
}

function drawPlanet(ctx, b, index, bx, by, opts) {
  let r = Math.max(2, b.displayRadius * (0.5 + opts.sizeMult * 0.5));

  // A super-massive Jupiter swells, and past ~80 Jupiter masses it ignites.
  if (index === JUPITER_INDEX && opts.jupiterMult !== 1) {
    r *= Math.min(2.5, Math.pow(opts.jupiterMult, 1 / 6));
    if (opts.jupiterMult >= STAR_THRESHOLD_JUPITERS) {
      drawStar(ctx, bx, by, r * 0.9, "red");
      drawLabel(ctx, b, bx, by, r, opts.labelFont);
      return;
    }
  }

  drawSelection(ctx, b, index, bx, by, r, opts);

  const rq = quant(r);
  stamp(ctx, sprite(`planet:${b.color}`, rq, (c, cx, cy) => {
    const g = c.createRadialGradient(cx - rq * 0.3, cy - rq * 0.3, 0, cx, cy, rq);
    g.addColorStop(0, lighten(b.color, 40));
    g.addColorStop(1, b.color);
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, rq, 0, Math.PI * 2);
    c.fill();
  }), bx, by);

  if (b.rings) {
    ctx.strokeStyle = b.color + "60";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(bx, by, r * 1.8, r * 0.5, -0.3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Impact chunks crowd together; only label them up close or when selected.
  if (!b.fragment || opts.selected === index || opts.zoom >= 6) drawLabel(ctx, b, bx, by, r, opts.labelFont);
}

function drawSelection(ctx, b, index, bx, by, r, opts) {
  if (opts.selected !== index) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = b.color + "80";
  ctx.beginPath();
  ctx.arc(bx, by, r + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = b.color + "30";
  ctx.beginPath();
  ctx.arc(bx, by, r + 12, 0, Math.PI * 2);
  ctx.stroke();
}

function drawLabel(ctx, b, bx, by, r, font) {
  ctx.fillStyle = b.isStar ? "rgba(255,226,180,0.8)" : b.isDwarf ? "rgba(235,230,216,0.35)" : "rgba(235,230,216,0.6)";
  ctx.font = `500 11px ${font || "sans-serif"}`;
  ctx.textAlign = "center";
  ctx.fillText(b.name, bx, by + r + 14);
}

/** Index of the body nearest to (sx, sy) within `radius` px, or null. */
export function hitTest(sys, view, sx, sy, radius = 22) {
  const sun = sys.bodies[0];
  let best = null;
  let bestD = radius;
  sys.bodies.forEach((b, i) => {
    if (b.removed) return;
    const [bx, by] = worldToScreen(view, b.x - sun.x, b.y - sun.y);
    const d = Math.hypot(sx - bx, sy - by);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function lighten(hex, amount) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}
