// One mapping between Sun-relative world coordinates (AU) and screen pixels,
// shared by drawing, click hit-testing and the gravity overlay so they always agree.
//
// The distance warp compresses the outer system: screen radius ∝ (r / MAX_AU)^exp.

import { MAX_AU } from "./constants.js";

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 60;

export function defaultCamera() {
  return { zoom: 1, panX: 0, panY: 0 };
}

/**
 * Snapshot of everything needed to map coordinates for one frame.
 * `insetRight` is screen space covered by a panel; the view centres in what's left.
 */
export function makeView(width, height, camera, distExp, insetRight = 0) {
  const visibleW = width - insetRight;
  return {
    w: width, h: height,
    cx: visibleW / 2, cy: height / 2,
    scale: Math.min(visibleW, height) * 0.45,
    exp: distExp,
    zoom: camera.zoom, panX: camera.panX, panY: camera.panY,
  };
}

/** Sun-relative world position (AU) → screen pixels. */
export function worldToScreen(v, hx, hy) {
  const dx = hx / MAX_AU;
  const dy = hy / MAX_AU;
  const r = Math.sqrt(dx * dx + dy * dy);
  const k = r < 1e-12 ? 0 : (Math.pow(r, v.exp) / r) * v.scale * v.zoom;
  return [v.cx + v.panX + dx * k, v.cy + v.panY + dy * k];
}

/** Screen pixels → Sun-relative world position (AU). */
export function screenToWorld(v, sx, sy) {
  const dx = (sx - v.cx - v.panX) / (v.scale * v.zoom);
  const dy = (sy - v.cy - v.panY) / (v.scale * v.zoom);
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r < 1e-12) return [0, 0];
  const k = (Math.pow(r, 1 / v.exp) / r) * MAX_AU;
  return [dx * k, dy * k];
}

/** Screen radius (px) of a circle at `au` from the Sun. */
export function auToScreenRadius(v, au) {
  return Math.pow(au / MAX_AU, v.exp) * v.scale * v.zoom;
}

/** Pan so the Sun-relative point (hx, hy) sits in the middle of the screen. */
export function centerOn(camera, width, height, distExp, hx, hy, insetRight = 0) {
  const v = makeView(width, height, { ...camera, panX: 0, panY: 0 }, distExp, insetRight);
  const [bx, by] = worldToScreen(v, hx, hy);
  camera.panX = v.cx - bx;
  camera.panY = v.cy - by;
}

/** Zoom by `factor`, keeping the point under (sx, sy) fixed on screen. */
export function zoomAt(camera, view, sx, sy, factor) {
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
  const f = z / camera.zoom;
  camera.panX = sx - view.cx - (sx - view.cx - camera.panX) * f;
  camera.panY = sy - view.cy - (sy - view.cy - camera.panY) * f;
  camera.zoom = z;
}
