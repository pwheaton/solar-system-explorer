"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultCamera, makeView, zoomAt } from "@/lib/sim/camera.js";
import { DT, PHYSICS_BUDGET_MS } from "@/lib/sim/constants.js";
import {
  addBelt, advance, clearTrails, createSystem, removeBelt, setMassMultipliers,
} from "@/lib/sim/physics.js";
import { createGravityLayer, drawFrame, hitTest, updateGravityLayer } from "@/lib/sim/render.js";
import ControlPanel, { PANEL_WIDTH, formatRate } from "./ControlPanel";
import PlanetInfo from "./PlanetInfo";
import { FONT, GlobalStyles } from "./ui";

const DEFAULTS = { speed: 0.1, sunMass: 1, jupMass: 1, distExp: 0.42, sizeMult: 1 };
const NARROW_PX = 768;
const CLICK_SLOP_PX = 5;
const EMPTY_HUD = { date: "", years: 0, rate: 0, limited: false, belts: {} };

export default function SolarSystem() {
  const [speed, setSpeed] = useState(DEFAULTS.speed);
  const [sunMass, setSunMass] = useState(DEFAULTS.sunMass);
  const [jupMass, setJupMass] = useState(DEFAULTS.jupMass);
  const [distExp, setDistExp] = useState(DEFAULTS.distExp);
  const [sizeMult, setSizeMult] = useState(DEFAULTS.sizeMult);
  const [showGrav, setShowGrav] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [paused, setPaused] = useState(false);
  const [belts, setBelts] = useState({ asteroids: true, kuiper: true });
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [yourWeight, setYourWeight] = useState(70);
  const [hud, setHud] = useState(EMPTY_HUD);
  const [sysVersion, setSysVersion] = useState(0);

  const canvasRef = useRef(null);
  const sysRef = useRef(null);
  const cameraRef = useRef(defaultCamera());
  const viewRef = useRef(null);
  const optsRef = useRef({});

  useEffect(() => {
    optsRef.current = { speed, sunMass, jupMass, distExp, sizeMult, showGrav, showTrails, paused, selected };
  });

  // The control panel starts closed and opens on wide screens, so phones don't flash it.
  useEffect(() => {
    if (window.innerWidth >= NARROW_PX) setPanelOpen(true);
  }, []);

  const selectBody = useCallback((index) => {
    setSelected(index);
    if (index !== null && window.innerWidth < NARROW_PX) setPanelOpen(false);
  }, []);

  const recenter = useCallback(() => {
    cameraRef.current = defaultCamera();
  }, []);

  const reset = useCallback(() => {
    sysRef.current = createSystem(new Date());
    setSysVersion((v) => v + 1);
    cameraRef.current = defaultCamera();
    setSpeed(DEFAULTS.speed);
    setSunMass(DEFAULTS.sunMass);
    setJupMass(DEFAULTS.jupMass);
    setDistExp(DEFAULTS.distExp);
    setSizeMult(DEFAULTS.sizeMult);
    setSelected(null);
    setPaused(false);
  }, []);

  const setBelt = useCallback((key, on) => setBelts((b) => ({ ...b, [key]: on })), []);

  // ─── Simulation + render loop ──────────────────────────────────
  useEffect(() => {
    if (!sysRef.current) sysRef.current = createSystem(new Date());
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const gravity = createGravityLayer();
    const labelFont = getComputedStyle(document.documentElement).getPropertyValue("--font-dm-sans").trim() || "sans-serif";

    let raf;
    let last = performance.now();
    let carry = 0;       // simulated years owed but not yet stepped
    let rate = 0;        // smoothed actual sim speed, years per real second
    let limitedScore = 0;
    let frame = 0;

    function loop(now) {
      const o = optsRef.current;
      const sys = sysRef.current;
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (setMassMultipliers(sys, o.sunMass, o.jupMass)) clearTrails(sys);

      // Advance by real elapsed time, so speed doesn't depend on refresh rate.
      if (!o.paused) {
        carry += o.speed * realDt;
        const want = Math.floor(carry / DT);
        const done = advance(sys, want, PHYSICS_BUDGET_MS);
        carry -= done * DT;
        const limited = done < want;
        if (limited) carry = 0; // don't build up a backlog we can never catch up on
        limitedScore = limitedScore * 0.9 + (limited ? 0.1 : 0);
        if (realDt > 0) rate = rate * 0.9 + ((done * DT) / realDt) * 0.1;
      } else {
        carry = 0;
        rate = 0;
        limitedScore = 0;
      }

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

      const view = makeView(w, h, cameraRef.current, o.distExp);
      viewRef.current = view;
      if (o.showGrav && frame % 3 === 0) updateGravityLayer(gravity, sys.bodies, view);

      drawFrame(ctx, sys, view, {
        showGrav: o.showGrav, showTrails: o.showTrails, selected: o.selected,
        sizeMult: o.sizeMult, sunMult: o.sunMass, jupiterMult: o.jupMass,
        gravityLayer: gravity, labelFont,
      });

      if (frame % 6 === 0) {
        const date = new Date(sys.startDate.getTime() + sys.t * 365.25 * 86400000);
        const beltStats = {};
        for (const [key, b] of Object.entries(sys.belts)) {
          beltStats[key] = { alive: b.aliveCount, ejected: b.ejected, swallowed: b.swallowed };
        }
        setHud({
          date: isNaN(date) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
          years: sys.t,
          rate,
          limited: limitedScore > 0.5,
          belts: beltStats,
        });
      }

      frame++;
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── Belts follow their toggles (and come back after a reset) ──
  useEffect(() => {
    const sys = sysRef.current;
    if (!sys) return;
    for (const [key, on] of Object.entries(belts)) {
      if (on && !sys.belts[key]) addBelt(sys, key);
      if (!on && sys.belts[key]) removeBelt(sys, key);
    }
  }, [belts, sysVersion]);

  // ─── Pointer input: drag to pan, pinch/scroll to zoom, tap to select ──
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

    const onDown = (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) startPan(local(e));
      else if (pointers.size === 2) gesture = { type: "pinch", ...pinchState() };
      canvas.style.cursor = "grabbing";
    };

    const onMove = (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const cam = cameraRef.current;
      if (gesture.type === "pan") {
        const dx = p.x - gesture.start.x;
        const dy = p.y - gesture.start.y;
        gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
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
      const wasTap = e.type === "pointerup" && gesture?.type === "pan" && gesture.moved < CLICK_SLOP_PX;
      pointers.delete(e.pointerId);
      if (wasTap && sysRef.current && viewRef.current) {
        selectBody(hitTest(sysRef.current, viewRef.current, p.x, p.y, e.pointerType === "touch" ? 30 : 22));
      }
      // Lifting one finger of a pinch continues as a pan (never as a tap).
      if (pointers.size === 1) startPan([...pointers.values()][0], Infinity);
      else if (pointers.size === 0) { gesture = null; canvas.style.cursor = "grab"; }
    };

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
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [selectBody]);

  // ─── Keyboard shortcuts ────────────────────────────────────────
  const keyActions = useRef(null);
  keyActions.current = { reset, recenter, setBelt, belts };
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "TEXTAREA" || (tag === "INPUT" && e.target.type !== "range")) return;
      const k = keyActions.current;
      switch (e.code) {
        case "Space": e.preventDefault(); setPaused((p) => !p); break;
        case "KeyR": k.reset(); break;
        case "KeyG": setShowGrav((g) => !g); break;
        case "KeyT": setShowTrails((t) => !t); break;
        case "KeyA": k.setBelt("asteroids", !k.belts.asteroids); break;
        case "KeyK": k.setBelt("kuiper", !k.belts.kuiper); break;
        case "KeyC": k.recenter(); break;
        case "Escape": setSelected(null); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sys = sysRef.current;
  const selBody = sys && selected !== null ? sys.bodies[selected] : null;
  const panelW = `min(${PANEL_WIDTH}px, 85vw)`;

  return (
    <div style={{ width: "100vw", height: "100dvh", overflow: "hidden", position: "relative", background: "#06060d", fontFamily: FONT.sans }}>
      <canvas
        ref={canvasRef}
        aria-label="Solar system simulation. Drag to pan, scroll or pinch to zoom, click a planet for details."
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", cursor: "grab", touchAction: "none" }}
      />

      {/* Title */}
      <div style={{
        position: "absolute", top: 16, zIndex: 10, pointerEvents: "none", textAlign: "center",
        // Centre in the space left of the control panel, clear of the toggle button.
        left: 0, right: panelOpen ? `calc(${panelW} + 90px)` : 0, paddingLeft: panelOpen ? 90 : 110, paddingRight: panelOpen ? 0 : 110,
        transition: "right 0.3s ease",
      }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: "clamp(11px, 3.2vw, 16px)", color: "#888898", letterSpacing: "0.15em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          N-Body Solar System
        </div>
        <div className="hint" style={{ fontSize: 10, color: "#4a4a5a", marginTop: 2, fontFamily: FONT.mono }}>
          SPACE pause · R reset · G gravity · drag to pan · scroll to zoom · click a planet
        </div>
      </div>

      {/* HUD */}
      <div style={{ position: "absolute", left: 16, bottom: 16, pointerEvents: "none", zIndex: 10, fontFamily: FONT.mono, lineHeight: 1.5 }}>
        <div style={{ fontSize: 10, color: paused ? "#8a6a3a" : "#3a6a3a" }}>{paused ? "⏸ PAUSED" : "▶ RUNNING"}</div>
        <div style={{ fontSize: 15, color: "#a8a8b8", fontFamily: FONT.display, fontWeight: 600, letterSpacing: "0.04em" }}>{hud.date}</div>
        <div style={{ fontSize: 10, color: "#5a5a70" }}>
          +{hud.years.toFixed(2)} yr{!paused && <> · {formatRate(hud.rate)}</>}
        </div>
        {hud.limited && !paused && (
          <div style={{ fontSize: 10, color: "#a07a40" }}>Top speed for this device — slower than requested</div>
        )}
      </div>

      <button
        onClick={() => setPanelOpen((p) => !p)}
        aria-expanded={panelOpen}
        style={{
          position: "absolute", top: 12, right: panelOpen ? `calc(${panelW} + 6px)` : 12, zIndex: 20,
          background: "rgba(20,20,30,0.7)", border: "1px solid rgba(80,80,100,0.3)",
          color: "#8a8a9a", borderRadius: 6, padding: "6px 10px", cursor: "pointer",
          fontSize: 12, fontFamily: FONT.sans, backdropFilter: "blur(8px)", transition: "right 0.3s ease",
        }}
      >
        {panelOpen ? "▸ Hide" : "◂ Controls"}
      </button>

      <ControlPanel
        open={panelOpen}
        settings={{ speed, paused, sunMass, jupMass, belts, distExp, sizeMult, showGrav, showTrails }}
        set={{
          speed: setSpeed, paused: setPaused, sunMass: setSunMass, jupMass: setJupMass, belt: setBelt,
          distExp: setDistExp, sizeMult: setSizeMult, showGrav: setShowGrav, showTrails: setShowTrails,
        }}
        hud={hud}
        selected={selected}
        onSelect={selectBody}
        onReset={reset}
        onRecenter={recenter}
      />

      {selBody && (
        <PlanetInfo
          body={selBody}
          sun={sys.bodies[0]}
          yourWeight={yourWeight}
          setYourWeight={setYourWeight}
          onClose={() => setSelected(null)}
        />
      )}

      <GlobalStyles />
      <style>{`@media (max-width: ${NARROW_PX}px) { .hint { display: none; } }`}</style>
    </div>
  );
}
