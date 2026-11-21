"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultCamera } from "@/lib/sim/camera.js";
import { randomSeed } from "@/lib/sim/rng.js";
import { MAX_LAUNCHED } from "@/lib/sim/sandbox.js";
import { SCENARIO_DEFAULTS, getScenario } from "@/lib/sim/scenarios.js";
import { readUrlState, writeUrlState } from "@/lib/url-state.js";
import ControlPanel from "./ControlPanel";
import LaunchBar from "./LaunchBar";
import PlanetInfo from "./PlanetInfo";
import ShortcutsDrawer from "./ShortcutsDrawer";
import TimeDock from "./TimeDock";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNotices } from "./hooks/useNotices";
import { usePointerControls } from "./hooks/usePointerControls";
import { useRenderLoop } from "./hooks/useRenderLoop";
import { useSimulationHost } from "./hooks/useSimulationHost";
import { useUrlSync } from "./hooks/useUrlSync";
import { FOLLOW_ZOOM, NARROW_PX } from "./layout";
import { Icon, styles as s } from "./ui";

const EMPTY_HUD = {
  date: "", years: 0, rate: 0, limited: false, belts: {}, bodies: [], log: [], escaped: [], launched: 0,
  debris: { clouds: 0, pieces: 0 },
};
const formatDate = (start, t, opts) => {
  const d = new Date(start.getTime() + t * 365.25 * 86400000);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, opts);
};

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
  const [launchMode, setLaunchMode] = useState(false);
  const [launchType, setLaunchType] = useState("planet");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const canvasRef = useRef(null);
  // Where the simulation runs (a Web Worker, or the main thread as a fallback).
  // host.mirror is the system as last reported, for drawing and hit-testing.
  const latestRef = useRef(null);        // last tick result from the host
  const pendingFollowRef = useRef(null); // body to follow once a load finishes
  const handlersRef = useRef({}); // host callbacks, filled in below
  const hostRef = useSimulationHost(handlersRef);
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
  const launchTypeRef = useRef(launchType);
  // Set when something the panels show changes outside the loop's own timing.
  const hudDirtyRef = useRef(false);

  // The animation loop and event handlers read the latest settings via refs,
  // updated after each render (never during it).
  useEffect(() => {
    launchModeRef.current = launchMode;
    launchTypeRef.current = launchType;
    optsRef.current = { speed, sunMass, jupMass, distExp, sizeMult, showGrav, showTrails, paused, reverse, selected, panelOpen };
  });

  const { notice, notify } = useNotices();

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
    hudDirtyRef.current = true; // show the card on the next frame, not the next HUD tick
    if (index !== null && window.innerWidth < NARROW_PX) setPanelOpen(false);
  }, []);

  // ─── Scenarios ─────────────────────────────────────────────────
  const loadScenario = useCallback((id, opts = {}) => {
    const host = hostRef.current;
    if (!host) return;
    const sc = getScenario(id);
    const seed = opts.seed ?? host.mirror?.seed ?? randomSeed();
    const s = { ...SCENARIO_DEFAULTS, ...sc.settings, ...opts.overrides };
    // Settings first, so the very first tick of the new system uses them.
    host.configure({ speed: s.speed, paused: false, reverse: false, sunMass: s.sunMass, jupMass: s.jupMass });
    host.load({ scenario: sc.id, date: opts.date ?? new Date(), seed, belts: s.belts });
    latestRef.current = null;
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

    // Bodies are only known once the load finishes (see onLoaded).
    pendingFollowRef.current = opts.follow ?? s.follow ?? null;
    cameraRef.current = { ...defaultCamera(), zoom: s.zoom, follow: null };
    setFollowState(null);

    if (!opts.quiet) notify(sc.blurb, 9000, sc.name);
  }, [notify, hostRef]);

  const reset = useCallback(() => loadScenario(scenarioId, { quiet: true }), [loadScenario, scenarioId]);

  // First load: restore from the URL if there's a shared link. This has to
  // happen after hydration (the URL and window size don't exist on the server),
  // so setting state from an effect is the right tool here.
  /* eslint-disable react-hooks/set-state-in-effect */
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
      notify(`This link starts with ${changed.join(" and ")}. Press R (or ↺) to restart with normal settings.`, 9000, "Heads up", 2);
    }
    if (window.innerWidth >= NARROW_PX) setPanelOpen(true);
  }, [loadScenario, notify]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep the address bar a shareable link.
  const copyLink = useUrlSync(() => {
    const m = hostRef.current?.mirror;
    return m && writeUrlState({
      scenario: scenarioId, date: m.startDate, seed: m.seed, speed, sunMass, jupMass,
      ramping: !!latestRef.current?.ramping, sunByEvent: sunByEventRef.current,
      distExp, sizeMult, showTrails, showGrav, belts,
      follow: follow !== null ? m.bodies[follow]?.name : null,
    });
  }, JSON.stringify([scenarioId, sysVersion, speed, sunMass, jupMass, distExp, sizeMult, showTrails, showGrav, belts, follow]));

  const setBelt = useCallback((key, on) => setBelts((b) => ({ ...b, [key]: on })), []);

  const setSunMassByHand = useCallback((v) => {
    sunByEventRef.current = false;
    setSunMass(v);
  }, []);

  // Moving the Jupiter slider by hand takes over from a scenario's mass ramp.
  const setJupMassByHand = useCallback((v) => {
    hostRef.current?.cancelRamp();
    setJupMass(v);
  }, [hostRef]);

  // Turn a tick result plus the mirror into what the panels show.
  const buildHud = (r) => {
    const m = hostRef.current?.mirror;
    if (!m) return;
    const o = optsRef.current;
    if (r.ramping && r.jupiterMult !== o.jupMass) setJupMass(r.jupiterMult);
    const sun = m.bodies[0];
    const sel = o.selected !== null ? m.bodies[o.selected] : null;
    setHud({
      date: formatDate(m.startDate, r.t, { year: "numeric", month: "short", day: "numeric" }),
      years: r.t,
      rate: r.rate,
      limited: r.limited,
      belts: r.hud.belts,
      debris: r.hud.debris,
      bodies: m.bodies.map((b) => ({
        name: b.name, color: b.color, isDwarf: b.isDwarf, isStar: b.isStar, isSun: b.isSun,
        removed: b.removed, a: b.el?.[0], launched: b.launched, merged: b.merged,
        shattered: b.shattered, fragment: b.fragment,
        hidden: b.unborn || b.discarded,
      })),
      log: r.hud.log.map((l) => ({ ...l, date: formatDate(m.startDate, l.t, { year: "numeric", month: "short" }) })),
      escaped: r.hud.escaped,
      launched: r.hud.launched,
      // Snapshot of the selected body for the info card (render never reads the live sim).
      selected: sel ? {
        index: o.selected,
        body: (({ name, color, x, y, vx, vy, mass, isSun, isStar, type, description }) =>
          ({ name, color, x, y, vx, vy, mass, isSun, isStar, type, description }))(sel),
        sun: { x: sun.x, y: sun.y, vx: sun.vx, vy: sun.vy },
      } : null,
    });
  };

  // The host reports back through these (kept current with the latest state setters).
  useEffect(() => {
    handlersRef.current = {
      onLoaded(m) {
        const name = pendingFollowRef.current;
        pendingFollowRef.current = null;
        const index = name ? m.bodies.findIndex((b) => b.name === name) : -1;
        if (index >= 0) setFollow(index);
        hudDirtyRef.current = true;
        setSysVersion((v) => v + 1); // the URL can now record the new start date and seed
      },
      onResult(r) {
        latestRef.current = r;
        for (const msg of r.messages) {
          if (msg.kind === "notice") notify(msg.text, msg.ms ?? 4000);
          else if (msg.kind === "sunMass") { sunByEventRef.current = !!msg.byEvent; setSunMass(msg.value); }
          else if (msg.kind === "rewindFloor") { setPaused(true); setReverse(false); }
        }
        if (r.hud) buildHud(r);
      },
    };
  });

  // Settings the simulation needs, sent whenever they change.
  useEffect(() => {
    hostRef.current?.configure({ speed, paused, reverse, sunMass, jupMass });
  }, [speed, paused, reverse, sunMass, jupMass, hostRef]);

  // Belts follow their toggles.
  useEffect(() => {
    hostRef.current?.setBelts(belts);
  }, [belts, hostRef]);

  // ─── Render loop ───────────────────────────────────────────────
  useRenderLoop({
    canvasRef, hostRef, latestRef, cameraRef, viewRef, optsRef, perfRef, launchRef, launchTypeRef, hudDirtyRef,
  });

  // ─── Pointer input: drag to pan, pinch/scroll to zoom, tap to select ──
  const doLaunch = useCallback((shot) => {
    hostRef.current?.launch(launchTypeRef.current, shot.hx, shot.hy, shot.vx, shot.vy);
  }, [hostRef]);

  const clearAllLaunched = useCallback(() => {
    hostRef.current?.clearLaunched();
    setSelected(null);
  }, [hostRef]);
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

  usePointerControls({
    canvasRef, cameraRef, viewRef, hostRef, launchRef, launchModeRef, selectBody, setFollow, doLaunch,
  });

  // ─── Keyboard shortcuts ────────────────────────────────────────
  useKeyboardShortcuts({
    loadScenario,
    reset,
    recenter,
    toggleLaunchMode,
    togglePause: () => setPaused((p) => !p),
    toggleReverse: () => setReverse((r) => !r),
    toggleGravity: () => setShowGrav((g) => !g),
    toggleTrails: () => setShowTrails((t) => !t),
    toggleBelt: (key) => setBelt(key, !belts[key]),
    toggleShortcuts: () => setShortcutsOpen((o) => !o),
    toggleFollow: () => {
      if (follow !== null) setFollow(null);
      else if (selected !== null) setFollow(selected);
    },
    escape: () => {
      if (shortcutsOpen) setShortcutsOpen(false);
      else if (launchMode) setLaunchMode(false);
      else setSelected(null);
    },
  });

  // The card shows the HUD's snapshot once it has caught up with the selection.
  const selInfo = selected !== null && hud.selected?.index === selected ? hud.selected : null;
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

      {selInfo && (
        <PlanetInfo
          body={selInfo.body}
          sun={selInfo.sun}
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
