import { screenToWorld } from "@/lib/sim/camera.js";
import { DRAG_PX_PER_ORBIT_SPEED, circularSpeed } from "@/lib/sim/sandbox.js";

/** Turn a press-and-drag on screen into a launch: position and velocity relative to the Sun. */
export function launchFromDrag(sys, view, from, to) {
  const [hx, hy] = screenToWorld(view, from.x, from.y);
  const r = Math.max(1e-6, Math.hypot(hx, hy));
  const vc = circularSpeed(sys, r);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 4) {
    // A tap: circular orbit, going the same way round as the planets.
    return { hx, hy, vx: (-hy / r) * vc, vy: (hx / r) * vc, factor: 1, tap: true };
  }
  // Direction in world space (the distance warp bends screen directions slightly).
  const [hx2, hy2] = screenToWorld(view, from.x + (to.x - from.x) / len, from.y + (to.y - from.y) / len);
  const d = Math.hypot(hx2 - hx, hy2 - hy) || 1;
  const factor = Math.min(5, len / DRAG_PX_PER_ORBIT_SPEED);
  return { hx, hy, vx: ((hx2 - hx) / d) * vc * factor, vy: ((hy2 - hy) / d) * vc * factor, factor, tap: false };
}
