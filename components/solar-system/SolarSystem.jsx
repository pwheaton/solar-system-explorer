"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { centerOn, defaultCamera, makeView, screenToWorld, zoomAt } from "@/lib/sim/camera.js";
import { DT, PHYSICS_BUDGET_MS } from "@/lib/sim/constants.js";
import {
  addBelt, advance, beltStats, clearLaunched, clearTrails, createSystem, removeBelt, setMassMultipliers,
} from "@/lib/sim/physics.js";
import { createGravityLayer, drawFrame, hitTest, updateGravityLayer } from "@/lib/sim/render.js";
import { randomSeed } from "@/lib/sim/rng.js";
import {
  DRAG_PX_PER_ORBIT_SPEED, LAUNCH_TYPES, MAX_LAUNCHED, circularSpeed, launch, launchedCount, predictPath,
} from "@/lib/sim/sandbox.js";
import { SCENARIOS, SCENARIO_DEFAULTS, getScenario, rampValue } from "@/lib/sim/scenarios.js";
import { readUrlState, writeUrlState } from "@/lib/url-state.js";
import ControlPanel from "./ControlPanel";
import PlanetInfo from "./PlanetInfo";
import LaunchBar from "./LaunchBar";
import ShortcutsDrawer from "./ShortcutsDrawer";
import TimeDock from "./TimeDock";
import { Icon, styles as s } from "./ui";

const NARROW_PX = 768;
const CLICK_SLOP_PX = 5;
const FOLLOW_ZOOM = 3;
const PANEL_INSET_PX = 320; // control panel width plus its margin
const EMPTY_HUD = {
  date: "", years: 0, rate: 0, limited: false, belts: {}, bodies: [], log: [], escaped: [], launched: 0,
  debris: { clouds: 0, pieces: 0 },
};
const ESCAPE_AU = 100;

/** Turn a press-and-drag on screen into a launch: position and velocity relative to the Sun. */
function launchFromDrag(sys, view, from, to) {
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

export default function SolarSystem() {
  const [scenarioId, setScenarioId] = useState("today");
  const [speed, setSpeed] = useState(SCENARIO_DEFAULTS.speed);
  const [sunMass, setSunMass] = useState(1);
  const [jupMass, setJupMass] = useState(1);
  const [distExp, setDistExp] = useState(SCENARIO_DEFAULTS.distExp);
  const [sizeMult, setSizeMult] = useState(SCENARIO_DEFAULTS.sizeMult);
  const [showGrav, setShowGrav] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [belts, setBelts] = useState(SCENARIO_DEFAULTS.belts);
  const [selected, setSelected] = useState(null);
  const [follow, setFollowState] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [yourWeight, setYourWeight] = useState(70);
  const [hud, setHud] = useState(EMPTY_HUD);
  const [sysVersion, setSysVersion] = useState(0);
  const [notice, setNotice] = useState(null);
  const [launchMode, setLaunchMode] = useState(false);
  const [launchType, setLaunchType] = useState("planet");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const canvasRef = useRef(null);
  const sysRef = useRef(null);
  const cameraRef = useRef({ ...defaultCamera(), follow: null });
  const viewRef = useRef(null);
  const optsRef = useRef({});
  const perfRef = useRef(null);
  // True while the Sun's mass was last set by a scenario event rather than by hand.
  // Event-driven values stay out of shared links (the event replays on its own).
  const sunByEventRef = useRef(false);
  // Launch drag in progress: { from, to, dirty, preview } in screen pixels.
  const launchRef = useRef(null);
  const launchModeRef = useRef(false);
  launchModeRef.current = launchMode;
  const launchTypeRef = useRef(launchType);
  launchTypeRef.current = launchType;

  useEffect(() => {
    optsRef.current = { speed, sunMass, jupMass, distExp, sizeMult, showGrav, showTrails, paused, reverse, selected, panelOpen };
  });

  // ─── Notices (scenario intros, events) ─────────────────────────
  const notify = useCallback((text, ms = 4000, title) => setNotice({ text, title, id: Math.random(), ms }), []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), notice.ms);
    return () => clearTimeout(id);
  }, [notice]);

  // ─── Camera ────────────────────────────────────────────────────
  const setFollow = useCallback((index) => {
    const cam = cameraRef.current;
    cam.follow = index;
    if (index !== null && cam.zoom < FOLLOW_ZOOM) cam.zoom = FOLLOW_ZOOM;
    setFollowState(index);
  }, []);

  const recenter = useCallback(() => {
    cameraRef.current = { ...defaultCamera(), follow: null };
    setFollowState(null);
  }, []);

  const selectBody = useCallback((index) => {
    setSelected(index);
    if (index !== null && window.innerWidth < NARROW_PX) setPanelOpen(false);
  }, []);

  // ─── Scenarios ─────────────────────────────────────────────────
  const loadScenario = useCallback((id, opts = {}) => {
    const sc = getScenario(id);
    const seed = opts.seed ?? sysRef.current?.seed ?? randomSeed();
    const sys = createSystem(opts.date ?? new Date(), seed);
    sc.setup?.(sys);
    sys.events = (sc.events || []).map((e) => ({ ...e, done: false }));
    sys.ramp = sc.ramp ? { ...sc.ramp } : null;
    sysRef.current = sys;

    const s = { ...SCENARIO_DEFAULTS, ...sc.settings, ...opts.overrides };
    setScenarioId(sc.id);
    setSysVersion((v) => v + 1);
    setSpeed(s.speed);
    setSunMass(s.sunMass);
    sunByEventRef.current = false;
    setJupMass(s.jupMass);
    setDistExp(s.distExp);
    setSizeMult(s.sizeMult);
    setShowTrails(s.showTrails);
    setShowGrav(s.showGrav);
    setBelts(s.belts);
    setPaused(false);
    setReverse(false);
    setSelected(null);

    const followName = opts.follow ?? s.follow;
    const followIndex = followName ? sys.bodies.findIndex((b) => b.name === followName) : -1;
    cameraRef.current = { ...defaultCamera(), zoom: s.zoom, follow: null };
    setFollowState(null);
    if (followIndex >= 0) setFollow(followIndex);

    if (!opts.quiet) notify(sc.blurb, 9000, sc.name);
  }, [notify, setFollow]);

  const reset = useCallback(() => loadScenario(scenarioId, { quiet: true }), [loadScenario, scenarioId]);

  // First load: restore from the URL if there's a shared link.
  useEffect(() => {
    const url = readUrlState(window.location.search);
    loadScenario(url.scenario || "today", {
      date: url.date, seed: url.seed ?? randomSeed(), overrides: url.overrides, follow: url.follow,
      quiet: !url.scenario || url.scenario === "today",
    });
    // A link (or a refresh) can bring back changed masses, which change what
    // happens a lot. Say so, rather than let it look like a normal start.
    const changed = [];
    if (url.overrides.sunMass != null && url.overrides.sunMass !== 1) changed.push(`the Sun at ${+url.overrides.sunMass.toFixed(2)}× mass`);
    if (url.overrides.jupMass != null && url.overrides.jupMass !== 1) changed.push(`Jupiter at ${+url.overrides.jupMass.toFixed(1)}× mass`);
    if (changed.length) {
      notify(`This link starts with ${changed.join(" and ")}. Press R (or ↺) to restart with normal settings.`, 9000, "Heads up");
    }
    if (window.innerWidth >= NARROW_PX) setPanelOpen(true);
  }, [loadScenario]);

  // Keep the URL in sync so the address bar is always a shareable link.
  const urlState = () => {
    const sys = sysRef.current;
    return sys && writeUrlState({
      scenario: scenarioId, date: sys.startDate, seed: sys.seed, speed, sunMass, jupMass,
      ramping: !!sys.ramp, sunByEvent: sunByEventRef.current, distExp, sizeMult, showTrails, showGrav, belts,
      follow: follow !== null ? sys.bodies[follow]?.name : null,
    });
  };
  const urlStateRef = useRef(urlState);
  urlStateRef.current = urlState;
  useEffect(() => {
    const id = setTimeout(() => {
      const qs = urlStateRef.current();
      if (qs != null && qs !== window.location.search) window.history.replaceState(null, "", window.location.pathname + qs);
    }, 400);
    return () => clearTimeout(id);
  }, [scenarioId, sysVersion, speed, sunMass, jupMass, distExp, sizeMult, showTrails, showGrav, belts, follow]);

  const copyLink = useCallback(async () => {
    const qs = urlStateRef.current();
    if (qs != null) window.history.replaceState(null, "", window.location.pathname + qs);
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch {
      return false;
    }
  }, []);

  const setBelt = useCallback((key, on) => setBelts((b) => ({ ...b, [key]: on })), []);

  const setSunMassByHand = useCallback((v) => {
    sunByEventRef.current = false;
    setSunMass(v);
  }, []);

  // Moving the Jupiter slider by hand takes over from a scenario's mass ramp.
  const setJupMassByHand = useCallback((v) => {
    if (sysRef.current) sysRef.current.ramp = null;
    setJupMass(v);
  }, []);

  // ─── Simulation + render loop ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const gravity = createGravityLayer();
    const rootStyle = getComputedStyle(document.documentElement);
    const labelFont = rootStyle.getPropertyValue("--font-fira-sans").trim() || "sans-serif";
    const monoFont = rootStyle.getPropertyValue("--font-fira-mono").trim() || "monospace";

    // What scenario events are allowed to change.
    const ctl = {
      get sys() { return sysRef.current; },
      setSunMass: (v) => { optsRef.current.sunMass = v; sunByEventRef.current = true; setSunMass(v); },
    };

    let raf;
    let last = performance.now();
    let carry = 0;       // simulated years owed but not yet stepped
    let rate = 0;        // smoothed actual sim speed, years per real second
    let limitedScore = 0;
    let frame = 0;
    let inset = 0;       // animated: screen width covered by the control panel
    const announced = new WeakSet(); // collision records already shown as a toast

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
      const sys = sysRef.current;
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!sys) { raf = requestAnimationFrame(loop); return; }
      if (process.env.NODE_ENV !== "production") window.__sys = sys; // handy for debugging in the console

      // Scenario mass ramp (a function of sim time, so it rewinds too).
      const jupiterMult = sys.ramp ? rampValue(sys.ramp, sys.t) : o.jupMass;
      if (setMassMultipliers(sys, o.sunMass, jupiterMult)) clearTrails(sys);

      // Advance by real elapsed time, so speed doesn't depend on refresh rate.
      if (!o.paused) {
        carry += o.speed * realDt;
        const want = Math.floor(carry / DT);
        // Physics gets whatever's left of a frame after drawing, so slower
        // devices run the simulation a little slower instead of dropping frames.
        // The frame length comes from the display (8.3 ms at 120 Hz, 16.7 at 60).
        displayFrame = Math.min(displayFrame * 1.002, Math.max(6, Math.min(17, perf.interval)));
        const budget = Math.max(2, Math.min(PHYSICS_BUDGET_MS, displayFrame * 0.8 - perf.draw - perf.hud - perf.predict - perf.gravity));
        const tPhys = performance.now();
        const done = advance(sys, want, budget, o.reverse ? -1 : 1);
        ema("physics", performance.now() - tPhys);
        ema("steps", done);
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

      // Scenario events fire when sim time passes them, and undo when rewound past.
      for (const e of sys.events) {
        if (!e.done && sys.t >= e.t) { e.done = true; e.do(ctl); notify(e.label); }
        else if (e.done && sys.t < e.t) { e.done = false; e.undo(ctl); notify(e.undoLabel); }
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

      // Toast each new collision once, as it happens.
      for (let k = 0; k < sys.historyIndex; k++) {
        const rec = sys.history[k];
        if ((rec.kind === "merge" || rec.kind === "impact") && !announced.has(rec)) {
          announced.add(rec);
          if (!o.reverse) notify(`${rec.text}.`, 3500);
        }
      }

      ema("draw", performance.now() - tDraw);
      const tHud = performance.now();
      // Panels update ~7 times a second; more often just costs React work.
      if (tLoop - lastHud > 140) {
        lastHud = tLoop;
        if (sys.ramp && jupiterMult !== o.jupMass) setJupMass(jupiterMult);
        const date = new Date(sys.startDate.getTime() + sys.t * 365.25 * 86400000);
        const stats = {};
        let debrisClouds = 0, debrisPieces = 0;
        for (const [key, b] of Object.entries(sys.belts)) {
          if (b.debris) {
            debrisClouds++;
            debrisPieces += beltStats(b, sun).alive;
          } else {
            stats[key] = beltStats(b, sun);
          }
        }
        setHud({
          date: isNaN(date) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
          years: sys.t,
          rate,
          limited: limitedScore > 0.5,
          belts: stats,
          bodies: sys.bodies.map((b) => ({
            name: b.name, color: b.color, isDwarf: b.isDwarf, isStar: b.isStar, isSun: b.isSun,
            removed: b.removed, a: b.el?.[0], launched: b.launched, merged: b.merged,
            shattered: b.shattered, fragment: b.fragment,
            hidden: b.unborn || b.discarded,
          })),
          log: sys.history.slice(0, sys.historyIndex).slice(-12).reverse().map((r) => ({
            text: r.text, kind: r.kind,
            date: new Date(sys.startDate.getTime() + r.t * 365.25 * 86400000)
              .toLocaleDateString(undefined, { year: "numeric", month: "short" }),
          })),
          escaped: sys.bodies.filter((b) => !b.isSun && !b.removed && Math.hypot(b.x - sun.x, b.y - sun.y) > ESCAPE_AU).map((b) => b.name),
          launched: launchedCount(sys),
          debris: { clouds: debrisClouds, pieces: debrisPieces },
        });
      }

      ema("hud", performance.now() - tHud);
      ema("loop", performance.now() - tLoop);
      if (perfOn && frame % 15 === 0 && perfRef.current) {
        const p = perf;
        const nParticles = sys.beltList.reduce((a, b) => a + b.n, 0);
        const nBodies = sys.bodies.filter((b) => !b.removed).length;
        perfRef.current.textContent =
          `fps ${(1000 / p.interval).toFixed(0)}  frame ${p.interval.toFixed(1)}ms\n` +
          `loop ${p.loop.toFixed(1)}  physics ${p.physics.toFixed(1)} (${p.steps.toFixed(0)} steps)\n` +
          `draw ${p.draw.toFixed(1)}  predict ${p.predict.toFixed(1)}  grav ${p.gravity.toFixed(1)}  hud ${p.hud.toFixed(1)}\n` +
          `bodies ${nBodies}  particles ${nParticles}`;
      }
      frame++;
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [notify]);

  // ─── Belts follow their toggles (and come back after a reload) ─
  useEffect(() => {
    const sys = sysRef.current;
    if (!sys) return;
    for (const [key, on] of Object.entries(belts)) {
      if (on && !sys.belts[key]) addBelt(sys, key);
      if (!on && sys.belts[key]) removeBelt(sys, key);
    }
  }, [belts, sysVersion]);

  // ─── Pointer input: drag to pan, pinch/scroll to zoom, tap to select ──
  const doLaunch = useCallback((shot) => {
    const sys = sysRef.current;
    if (!sys) return;
    if (launchedCount(sys) >= MAX_LAUNCHED) {
      notify(`That's ${MAX_LAUNCHED} launched bodies — clear some first.`, 3500);
      return;
    }
    launch(sys, launchTypeRef.current, shot.hx, shot.hy, shot.vx, shot.vy);
  }, [notify]);

  const clearAllLaunched = useCallback(() => {
    if (sysRef.current) clearLaunched(sysRef.current);
    setSelected(null);
  }, []);

  const toggleLaunchMode = useCallback(() => {
    setLaunchMode((on) => {
      if (!on) notify("Launch mode: press where you want a body, drag the way it should go, and let go. A tap makes a circular orbit. Right-drag pans.", 6000);
      return !on;
    });
  }, [notify]);

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.cursor = launchMode ? "crosshair" : "grab";
    if (!launchMode) launchRef.current = null;
  }, [launchMode]);

  const pointerActions = useRef(null);
  pointerActions.current = { selectBody, setFollow, doLaunch };
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
        if (L && e.type === "pointerup" && sysRef.current && viewRef.current) {
          L.to = p;
          pointerActions.current.doLaunch(launchFromDrag(sysRef.current, viewRef.current, L.from, L.to));
        }
        return;
      }
      const wasTap = e.type === "pointerup" && gesture?.type === "pan" && gesture.moved < CLICK_SLOP_PX;
      pointers.delete(e.pointerId);
      if (wasTap && sysRef.current && viewRef.current) {
        pointerActions.current.selectBody(hitTest(sysRef.current, viewRef.current, p.x, p.y, e.pointerType === "touch" ? 30 : 22));
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
  }, []);

  // ─── Keyboard shortcuts ────────────────────────────────────────
  const keyActions = useRef(null);
  keyActions.current = { reset, recenter, setBelt, belts, loadScenario, selected, follow, setFollow, toggleLaunchMode, launchMode, shortcutsOpen };
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "TEXTAREA" || (tag === "INPUT" && e.target.type !== "range")) return;
      const k = keyActions.current;
      if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { e.preventDefault(); setShortcutsOpen((o) => !o); return; }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && SCENARIOS[digit[1] - 1]) { k.loadScenario(SCENARIOS[digit[1] - 1].id); return; }
      switch (e.code) {
        case "Space": e.preventDefault(); setPaused((p) => !p); break;
        case "KeyB": setReverse((r) => !r); break;
        case "KeyR": k.reset(); break;
        case "KeyG": setShowGrav((g) => !g); break;
        case "KeyT": setShowTrails((t) => !t); break;
        case "KeyA": k.setBelt("asteroids", !k.belts.asteroids); break;
        case "KeyK": k.setBelt("kuiper", !k.belts.kuiper); break;
        case "KeyC": k.recenter(); break;
        case "KeyF":
          if (k.follow !== null) k.setFollow(null);
          else if (k.selected !== null) k.setFollow(k.selected);
          break;
        case "KeyL": k.toggleLaunchMode(); break;
        case "Escape":
          if (k.shortcutsOpen) setShortcutsOpen(false);
          else if (k.launchMode) setLaunchMode(false);
          else setSelected(null);
          break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sys = sysRef.current;
  const selBody = sys && selected !== null ? sys.bodies[selected] : null;
  const scenario = getScenario(scenarioId);

  return (
    <div className={s.root} data-panel={panelOpen ? "open" : "closed"}>
      <canvas
        ref={canvasRef}
        className={s.canvas}
        aria-label="Solar system simulation. Drag to pan, scroll or pinch to zoom, click a planet for details."
      />

      <div className={s.brand}>
        <div className={s.brandName}>Solar System <em>Explorer</em></div>
        <div className={`${s.eyebrow} ${s.brandSub}`}>
          N-body gravity simulator{scenarioId !== "today" && <> · <span style={{ color: "var(--amber)" }}>{scenario.name}</span></>}
          {follow !== null && hud.bodies[follow] && <> · following {hud.bodies[follow].name}</>}
        </div>
      </div>

      {notice && (
        <div key={notice.id} role="status" className={`${s.frame} ${s.notice}`}>
          {notice.title && <strong>{notice.title}. </strong>}{notice.text}
        </div>
      )}

      <ShortcutsDrawer
        open={shortcutsOpen}
        onToggle={() => setShortcutsOpen((o) => !o)}
        onClose={() => setShortcutsOpen(false)}
      />

      {launchMode && (
        <LaunchBar
          type={launchType}
          onType={setLaunchType}
          count={hud.launched}
          max={MAX_LAUNCHED}
          onClear={clearAllLaunched}
          onClose={() => setLaunchMode(false)}
        />
      )}

      <TimeDock
        launchMode={launchMode}
        onToggleLaunch={toggleLaunchMode}
        paused={paused}
        reverse={reverse}
        speed={speed}
        hud={hud}
        onTogglePause={() => setPaused((p) => !p)}
        onToggleReverse={() => setReverse((r) => !r)}
        onSpeed={setSpeed}
        onReset={reset}
      />

      <button
        type="button"
        className={s.panelToggle}
        onClick={() => setPanelOpen((p) => !p)}
        aria-expanded={panelOpen}
      >
        {panelOpen ? <Icon.close /> : <Icon.sliders />} {panelOpen ? "Close" : "Controls"}
      </button>

      <ControlPanel
        open={panelOpen}
        scenarioId={scenarioId}
        onScenario={(id) => loadScenario(id)}
        settings={{ sunMass, jupMass, belts, distExp, sizeMult, showGrav, showTrails }}
        set={{
          sunMass: setSunMassByHand, jupMass: setJupMassByHand, belt: setBelt,
          distExp: setDistExp, sizeMult: setSizeMult, showGrav: setShowGrav, showTrails: setShowTrails,
        }}
        hud={hud}
        selected={selected}
        follow={follow}
        onSelect={selectBody}
        onRecenter={recenter}
        onCopyLink={copyLink}
      />

      <pre ref={perfRef} className={s.perf} aria-hidden />

      {selBody && (
        <PlanetInfo
          body={selBody}
          sun={sys.bodies[0]}
          following={follow === selected}
          onFollow={() => setFollow(follow === selected ? null : selected)}
          yourWeight={yourWeight}
          setYourWeight={setYourWeight}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
