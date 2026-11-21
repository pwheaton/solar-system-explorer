import { useEffect } from "react";
import { zoomAt } from "@/lib/sim/camera.js";
import { hitTest } from "@/lib/sim/render.js";
import { launchFromDrag } from "../launchFromDrag";
import { CLICK_SLOP_PX } from "../layout";
import { useLatest } from "./useLatest";

/**
 * Canvas input: drag to pan, pinch or scroll to zoom, tap to select, and in
 * launch mode press-drag-release to throw a body.
 */
export function usePointerControls({
  canvasRef, cameraRef, viewRef, hostRef, launchRef, launchModeRef, selectBody, setFollow, doLaunch,
}) {
  const pointerActions = useLatest({ selectBody, setFollow, doLaunch });
  useEffect(() => {
    const canvas = canvasRef.current;
    const pointers = new Map();
    let gesture = null;

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const startPan = (p, moved = 0) => {
      const cam = cameraRef.current;
      gesture = { type: "pan", start: p, panX: cam.panX, panY: cam.panY, moved };
    };
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const idleCursor = () => (launchModeRef.current ? "crosshair" : "grab");
    const cancelLaunch = () => { launchRef.current = null; };

    const onDown = (e) => {
      const rightDrag = e.pointerType === "mouse" && e.button === 2;
      if (e.pointerType === "mouse" && e.button !== 0 && !rightDrag) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer not tracked by the browser */ }
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1 && launchModeRef.current && !rightDrag) {
        // Launch mode: press where the body starts, drag the way it should go.
        const p = local(e);
        gesture = { type: "launch" };
        launchRef.current = { from: p, to: p, dirty: true, preview: null };
        return;
      }
      if (pointers.size === 1) startPan(local(e));
      else if (pointers.size === 2) { cancelLaunch(); gesture = { type: "pinch", ...pinchState() }; }
      canvas.style.cursor = "grabbing";
    };

    const onMove = (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const cam = cameraRef.current;
      if (gesture.type === "launch") {
        if (launchRef.current) { launchRef.current.to = p; launchRef.current.dirty = true; }
        return;
      }
      if (gesture.type === "pan") {
        const dx = p.x - gesture.start.x;
        const dy = p.y - gesture.start.y;
        gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
        if (gesture.moved < CLICK_SLOP_PX) return;
        // Dragging the view takes over from follow mode.
        if (cam.follow !== null) {
          pointerActions.current.setFollow(null);
          startPan(p, gesture.moved);
          return;
        }
        cam.panX = gesture.panX + dx;
        cam.panY = gesture.panY + dy;
      } else if (gesture.type === "pinch" && pointers.size >= 2 && viewRef.current) {
        const next = pinchState();
        zoomAt(cam, viewRef.current, next.mid.x, next.mid.y, next.dist / gesture.dist);
        cam.panX += next.mid.x - gesture.mid.x;
        cam.panY += next.mid.y - gesture.mid.y;
        gesture.dist = next.dist;
        gesture.mid = next.mid;
      }
    };

    const onUp = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      if (gesture?.type === "launch") {
        pointers.delete(e.pointerId);
        const L = launchRef.current;
        launchRef.current = null;
        gesture = null;
        if (L && e.type === "pointerup" && hostRef.current?.mirror && viewRef.current) {
          L.to = p;
          pointerActions.current.doLaunch(launchFromDrag(hostRef.current.mirror, viewRef.current, L.from, L.to));
        }
        return;
      }
      const wasTap = e.type === "pointerup" && gesture?.type === "pan" && gesture.moved < CLICK_SLOP_PX;
      pointers.delete(e.pointerId);
      if (wasTap && hostRef.current?.mirror && viewRef.current) {
        pointerActions.current.selectBody(hitTest(hostRef.current.mirror, viewRef.current, p.x, p.y, e.pointerType === "touch" ? 30 : 22));
      }
      // Lifting one finger of a pinch continues as a pan (never as a tap).
      if (pointers.size === 1) startPan([...pointers.values()][0], Infinity);
      else if (pointers.size === 0) { gesture = null; canvas.style.cursor = idleCursor(); }
    };
    const onContextMenu = (e) => { if (launchModeRef.current) e.preventDefault(); };

    const onWheel = (e) => {
      e.preventDefault();
      if (!viewRef.current) return;
      const p = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(cameraRef.current, viewRef.current, p.x, p.y, Math.exp(-dy * 0.0015));
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvasRef, cameraRef, viewRef, hostRef, launchRef, launchModeRef, pointerActions]);
}
