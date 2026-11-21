import { useEffect } from "react";
import { centerOn, makeView } from "@/lib/sim/camera.js";
import { createGravityLayer, drawFrame, updateGravityLayer } from "@/lib/sim/render.js";
import { LAUNCH_TYPES, predictPath } from "@/lib/sim/sandbox.js";
import { launchFromDrag } from "../launchFromDrag";
import { NARROW_PX, PANEL_INSET_PX } from "../layout";

/**
 * The animation loop: asks the simulation host to advance, then draws the
 * latest snapshot (camera follow, panel inset, launch preview, the ?perf=1
 * overlay). Everything it needs arrives as refs so it never restarts.
 */
export function useRenderLoop({
  canvasRef, hostRef, latestRef, cameraRef, viewRef, optsRef, perfRef, launchRef, launchTypeRef, hudDirtyRef,
}) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const gravity = createGravityLayer();
    const rootStyle = getComputedStyle(document.documentElement);
    const labelFont = rootStyle.getPropertyValue("--font-fira-sans").trim() || "sans-serif";
    const monoFont = rootStyle.getPropertyValue("--font-fira-mono").trim() || "monospace";

    let raf;
    let last = performance.now();
    let frame = 0;
    let inset = 0;       // animated: screen width covered by the control panel

    // Optional timing breakdown (?perf=1): exponential moving averages in ms.
    const perfOn = new URLSearchParams(window.location.search).has("perf");
    const perf = { interval: 16.7, physics: 0, steps: 0, predict: 0, gravity: 0, draw: 0, hud: 0, loop: 0 };
    const ema = (key, v) => { perf[key] = perf[key] * 0.92 + v * 0.08; };
    let tPrev = performance.now();
    let displayFrame = 16.7; // shortest recent frame interval: the display's refresh period
    let lastHud = 0;
    if (perfOn) window.__perf = perf;

    function loop(now) {
      const tLoop = performance.now();
      ema("interval", tLoop - tPrev);
      tPrev = tLoop;
      const o = optsRef.current;
      const host = hostRef.current;
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;

      // Ask the host to advance. With the worker host this returns at once and
      // the result arrives a moment later; drawing uses the latest snapshot.
      if (host) {
        displayFrame = Math.min(displayFrame * 1.002, Math.max(6, Math.min(17, perf.interval)));
        const budget = host.physicsBudget(displayFrame, perf.draw + perf.hud + perf.predict + perf.gravity);
        const wantHud = tLoop - lastHud > 140 || hudDirtyRef.current;
        if (wantHud) { lastHud = tLoop; hudDirtyRef.current = false; }
        const tPhys = performance.now();
        host.frame(realDt, budget, wantHud);
        if (host.kind === "main") ema("physics", performance.now() - tPhys);
      }
      const r = latestRef.current;
      if (r) {
        if (host?.kind === "worker") ema("physics", r.physicsMs);
        ema("steps", r.steps);
      }
      const sys = host?.mirror;
      if (!sys) { raf = requestAnimationFrame(loop); return; }
      if (process.env.NODE_ENV !== "production") window.__sys = sys; // handy for debugging in the console
      const jupiterMult = r?.ramping ? r.jupiterMult : o.jupMass;

      // Resize backing store to match the element and device pixel ratio.
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // On wide screens the open panel covers the right edge; centre the view in what's left.
      const targetInset = o.panelOpen && w >= NARROW_PX ? PANEL_INSET_PX : 0;
      inset += (targetInset - inset) * Math.min(1, realDt * 8);
      if (Math.abs(targetInset - inset) < 0.5) inset = targetInset;

      const cam = cameraRef.current;
      const sun = sys.bodies[0];
      const target = cam.follow !== null ? sys.bodies[cam.follow] : null;
      if (target && !target.removed) centerOn(cam, w, h, o.distExp, target.x - sun.x, target.y - sun.y, inset);

      const view = makeView(w, h, cam, o.distExp, inset);
      viewRef.current = view;
      if (process.env.NODE_ENV !== "production") window.__view = view;
      const tGrav = performance.now();
      if (o.showGrav && frame % 3 === 0) updateGravityLayer(gravity, sys.bodies, view);
      ema("gravity", performance.now() - tGrav);
      const tPred = performance.now();

      // Launch preview: recompute the predicted path at most once per frame.
      const L = launchRef.current;
      let launchPreview = null;
      if (L) {
        if (L.dirty) {
          const shot = launchFromDrag(sys, view, L.from, L.to);
          const path = predictPath(sys, launchTypeRef.current, shot.hx, shot.hy, shot.vx, shot.vy);
          L.preview = { shot, path };
          L.dirty = false;
        }
        const def = LAUNCH_TYPES[launchTypeRef.current];
        launchPreview = L.preview && {
          from: [L.from.x, L.from.y], to: [L.to.x, L.to.y],
          points: L.preview.path.points, hit: L.preview.path.hit,
          factor: L.preview.shot.factor, color: def.colors[0], radius: Math.max(2.5, def.displayRadius * 0.8),
        };
      }

      ema("predict", performance.now() - tPred);
      const tDraw = performance.now();
      drawFrame(ctx, sys, view, {
        showGrav: o.showGrav, showTrails: o.showTrails, selected: o.selected,
        sizeMult: o.sizeMult, sunMult: o.sunMass, jupiterMult, zoom: cam.zoom,
        gravityLayer: gravity, labelFont, monoFont, launch: launchPreview,
      });
      ema("draw", performance.now() - tDraw);

      ema("loop", performance.now() - tLoop);
      if (perfOn && frame % 15 === 0 && perfRef.current) {
        const p = perf;
        const nParticles = sys.beltList.reduce((a, b) => a + b.n, 0);
        const nBodies = sys.bodies.filter((b) => !b.removed).length;
        perfRef.current.textContent =
          `fps ${(1000 / p.interval).toFixed(0)}  frame ${p.interval.toFixed(1)}ms  physics on ${host?.kind === "worker" ? "worker" : "main thread"}\n` +
          `loop ${p.loop.toFixed(1)}  physics ${p.physics.toFixed(1)} (${p.steps.toFixed(0)} steps)\n` +
          `draw ${p.draw.toFixed(1)}  predict ${p.predict.toFixed(1)}  grav ${p.gravity.toFixed(1)}\n` +
          `bodies ${nBodies}  particles ${nParticles}`;
      }
      frame++;
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, hostRef, latestRef, cameraRef, viewRef, optsRef, perfRef, launchRef, launchTypeRef, hudDirtyRef]);
}
