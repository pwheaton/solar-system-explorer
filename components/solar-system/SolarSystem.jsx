"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { centerOn, defaultCamera, makeView, zoomAt } from "@/lib/sim/camera.js";
import { DT, PHYSICS_BUDGET_MS } from "@/lib/sim/constants.js";
import {
  addBelt, advance, beltStats, clearTrails, createSystem, removeBelt, setMassMultipliers,
} from "@/lib/sim/physics.js";
import { createGravityLayer, drawFrame, hitTest, updateGravityLayer } from "@/lib/sim/render.js";
import { randomSeed } from "@/lib/sim/rng.js";
import { SCENARIOS, SCENARIO_DEFAULTS, getScenario, rampValue } from "@/lib/sim/scenarios.js";
import { readUrlState, writeUrlState } from "@/lib/url-state.js";
import ControlPanel from "./ControlPanel";
import PlanetInfo from "./PlanetInfo";
import TimeDock from "./TimeDock";
import { Icon, styles as s } from "./ui";

const NARROW_PX = 768;
const CLICK_SLOP_PX = 5;
const FOLLOW_ZOOM = 3;
const PANEL_INSET_PX = 320; // control panel width plus its margin
const EMPTY_HUD = { date: "", years: 0, rate: 0, limited: false, belts: {}, bodies: [] };

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

  const canvasRef = useRef(null);
  const sysRef = useRef(null);
  const cameraRef = useRef({ ...defaultCamera(), follow: null });
  const viewRef = useRef(null);
  const optsRef = useRef({});

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
    if (window.innerWidth >= NARROW_PX) setPanelOpen(true);
  }, [loadScenario]);

  // Keep the URL in sync so the address bar is always a shareable link.
  const urlState = () => {
    const sys = sysRef.current;
    return sys && writeUrlState({
      scenario: scenarioId, date: sys.startDate, seed: sys.seed, speed, sunMass, jupMass,
      ramping: !!sys.ramp, distExp, sizeMult, showTrails, showGrav, belts,
      follow: follow !== null ? sys.bodies[follow]?.name : null,
    });
  };
  const urlStateRef = useRef(urlState);
  urlStateRef.current = urlState;
  useEffect(() => {
    const id = setTimeout(() => {
      const qs = urlStateRef.current();
      if (qs && qs !== window.location.search) window.history.replaceState(null, "", qs);
    }, 400);
    return () => clearTimeout(id);
  }, [scenarioId, sysVersion, speed, sunMass, jupMass, distExp, sizeMult, showTrails, showGrav, belts, follow]);

  const copyLink = useCallback(async () => {
    const qs = urlStateRef.current();
    if (qs) window.history.replaceState(null, "", qs);
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch {
      return false;
    }
  }, []);

  const setBelt = useCallback((key, on) => setBelts((b) => ({ ...b, [key]: on })), []);

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
      setSunMass: (v) => { optsRef.current.sunMass = v; setSunMass(v); },
    };

    let raf;
    let last = performance.now();
    let carry = 0;       // simulated years owed but not yet stepped
    let rate = 0;        // smoothed actual sim speed, years per real second
    let limitedScore = 0;
    let frame = 0;
    let inset = 0;       // animated: screen width covered by the control panel

    function loop(now) {
      const o = optsRef.current;
      const sys = sysRef.current;
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!sys) { raf = requestAnimationFrame(loop); return; }

      // Scenario mass ramp (a function of sim time, so it rewinds too).
      const jupiterMult = sys.ramp ? rampValue(sys.ramp, sys.t) : o.jupMass;
      if (setMassMultipliers(sys, o.sunMass, jupiterMult)) clearTrails(sys);

      // Advance by real elapsed time, so speed doesn't depend on refresh rate.
      if (!o.paused) {
        carry += o.speed * realDt;
        const want = Math.floor(carry / DT);
        const done = advance(sys, want, PHYSICS_BUDGET_MS, o.reverse ? -1 : 1);
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
      if (o.showGrav && frame % 3 === 0) updateGravityLayer(gravity, sys.bodies, view);

      drawFrame(ctx, sys, view, {
        showGrav: o.showGrav, showTrails: o.showTrails, selected: o.selected,
        sizeMult: o.sizeMult, sunMult: o.sunMass, jupiterMult,
        gravityLayer: gravity, labelFont, monoFont,
      });

      if (frame % 6 === 0) {
        if (sys.ramp && jupiterMult !== o.jupMass) setJupMass(jupiterMult);
        const date = new Date(sys.startDate.getTime() + sys.t * 365.25 * 86400000);
        const stats = {};
        for (const [key, b] of Object.entries(sys.belts)) stats[key] = beltStats(b, sun);
        setHud({
          date: isNaN(date) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
          years: sys.t,
          rate,
          limited: limitedScore > 0.5,
          belts: stats,
          bodies: sys.bodies.map((b) => ({
            name: b.name, color: b.color, isDwarf: b.isDwarf, isStar: b.isStar, isSun: b.isSun,
            removed: b.removed, a: b.el?.[0],
          })),
        });
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
  const pointerActions = useRef(null);
  pointerActions.current = { selectBody, setFollow };
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
      const wasTap = e.type === "pointerup" && gesture?.type === "pan" && gesture.moved < CLICK_SLOP_PX;
      pointers.delete(e.pointerId);
      if (wasTap && sysRef.current && viewRef.current) {
        pointerActions.current.selectBody(hitTest(sysRef.current, viewRef.current, p.x, p.y, e.pointerType === "touch" ? 30 : 22));
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
  }, []);

  // ─── Keyboard shortcuts ────────────────────────────────────────
  const keyActions = useRef(null);
  keyActions.current = { reset, recenter, setBelt, belts, loadScenario, selected, follow, setFollow };
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "TEXTAREA" || (tag === "INPUT" && e.target.type !== "range")) return;
      const k = keyActions.current;
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
        case "Escape": setSelected(null); break;
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

      <TimeDock
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
          sunMass: setSunMass, jupMass: setJupMassByHand, belt: setBelt,
          distExp: setDistExp, sizeMult: setSizeMult, showGrav: setShowGrav, showTrails: setShowTrails,
        }}
        hud={hud}
        selected={selected}
        follow={follow}
        onSelect={selectBody}
        onRecenter={recenter}
        onCopyLink={copyLink}
      />

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
