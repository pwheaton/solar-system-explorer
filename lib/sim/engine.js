// @ts-check
// The simulation engine: everything that happens to the simulated system each
// frame, with no DOM or React. It runs either inside a Web Worker (so physics
// never blocks drawing) or on the main thread, behind the same interface.
//
// The UI talks to it with commands (load, configure, launch, …) and gets back
// a result per tick plus messages for things it should show: notices, the
// Sun's mass changing because of a scenario event, hitting the rewind limit.

import { DT, PHYSICS_BUDGET_MS } from "./constants.js";
import {
  addBelt, advance, beltStats, clearLaunched, clearTrails, createSystem, removeBelt, setMassMultipliers,
} from "./physics.js";
import { MAX_LAUNCHED, launch, launchedCount } from "./sandbox.js";
import { getScenario, rampValue } from "./scenarios.js";

/** @typedef {import("./types").BeltCounts} BeltCounts */
/** @typedef {import("./types").EngineMessage} EngineMessage */
/** @typedef {import("./types").EngineOptions} EngineOptions */
/** @typedef {import("./types").EventControl} EventControl */
/** @typedef {import("./types").HudData} HudData */
/** @typedef {import("./types").LoadParams} LoadParams */
/** @typedef {import("./types").SimSystem} SimSystem */
/** @typedef {import("./types").TickResult} TickResult */

const ESCAPE_AU = 100;

export function createEngine() {
  /** @type {SimSystem | null} */
  let sys = null;
  /** @type {EngineOptions} */
  const opts = { speed: 0.1, paused: false, reverse: false, sunMass: 1, jupMass: 1 };
  let carry = 0;        // simulated years owed but not yet stepped
  let rate = 0;         // smoothed actual sim speed, years per real second
  let limitedScore = 0;
  let announced = new WeakSet(); // collision records already announced
  let jupiterMult = 1;
  /** @type {EngineMessage[]} */
  let messages = [];
  /** @param {EngineMessage} msg */
  const say = (msg) => messages.push(msg);

  // What scenario events are allowed to change.
  /** @type {EventControl} */
  const ctl = {
    get sys() { return /** @type {SimSystem} */ (sys); }, // events only run while a system is loaded
    setSunMass: (v) => { opts.sunMass = v; say({ kind: "sunMass", value: v, byEvent: true }); },
  };

  return {
    get sys() { return sys; },

    /**
     * Build a scenario's system. `belts` says which belts to add.
     * @param {LoadParams} params
     */
    load({ scenario, date, seed, belts = {} }) {
      const sc = getScenario(scenario);
      sys = createSystem(date, seed);
      sc.setup?.(sys);
      sys.events = (sc.events || []).map((e) => ({ ...e, done: false }));
      sys.ramp = sc.ramp ? { ...sc.ramp } : null;
      for (const [key, on] of Object.entries(belts)) if (on) addBelt(sys, key);
      carry = 0; rate = 0; limitedScore = 0;
      announced = new WeakSet();
      return sys;
    },

    /**
     * @param {Partial<EngineOptions>} partial
     */
    configure(partial) { Object.assign(opts, partial); },

    /**
     * @param {Record<string, boolean>} belts
     */
    setBelts(belts) {
      if (!sys) return;
      for (const [key, on] of Object.entries(belts)) {
        if (on && !sys.belts[key]) addBelt(sys, key);
        if (!on && sys.belts[key]) removeBelt(sys, key);
      }
    },

    /** Moving the Jupiter slider by hand takes over from a scenario's mass ramp. */
    cancelRamp() { if (sys) sys.ramp = null; },

    /**
     * @param {string} typeKey
     * @param {number} hx
     * @param {number} hy
     * @param {number} vx
     * @param {number} vy
     */
    launch(typeKey, hx, hy, vx, vy) {
      if (!sys) return false;
      if (launchedCount(sys) >= MAX_LAUNCHED) {
        say({ kind: "notice", text: `That's ${MAX_LAUNCHED} launched bodies — clear some first.`, ms: 3500 });
        return false;
      }
      launch(sys, typeKey, hx, hy, vx, vy);
      return true;
    },

    clearLaunched() { if (sys) clearLaunched(sys); },

    /**
     * Advance by `realDt` seconds of real time, spending at most `budgetMs` on
     * physics. Returns what happened, plus HUD data when `wantHud` is set.
     * @param {number} realDt
     * @param {number} [budgetMs]
     * @param {boolean} [wantHud]
     * @returns {TickResult | null}
     */
    tick(realDt, budgetMs = PHYSICS_BUDGET_MS, wantHud = false) {
      if (!sys) return null;
      const t0 = performance.now();

      // Scenario mass ramp (a function of sim time, so it rewinds too).
      jupiterMult = sys.ramp ? rampValue(sys.ramp, sys.t) : opts.jupMass;
      if (setMassMultipliers(sys, opts.sunMass, jupiterMult)) clearTrails(sys);

      // Advance by real elapsed time, so speed doesn't depend on refresh rate.
      let done = 0;
      if (!opts.paused) {
        carry += opts.speed * realDt;
        const want = Math.floor(carry / DT);
        done = advance(sys, want, budgetMs, opts.reverse ? -1 : 1);
        if (opts.reverse && sys.stepCount <= sys.rewindFloor) {
          // Rewind can only undo the most recent events; stop here.
          opts.paused = true;
          opts.reverse = false;
          say({ kind: "rewindFloor" });
          say({ kind: "notice", text: `That's as far back as rewind goes: it remembers the last ${sys.maxHistory} launches and collisions.`, ms: 6000 });
        }
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
        if (!e.done && sys.t >= e.t) { e.done = true; e.do(ctl); say({ kind: "notice", text: e.label }); }
        else if (e.done && sys.t < e.t) { e.done = false; e.undo(ctl); say({ kind: "notice", text: e.undoLabel }); }
      }

      // Announce each new collision once, as it happens.
      for (let k = 0; k < sys.historyIndex; k++) {
        const rec = sys.history[k];
        if ((rec.kind === "merge" || rec.kind === "impact") && !announced.has(rec)) {
          announced.add(rec);
          if (!opts.reverse) say({ kind: "notice", text: `${rec.text}.`, ms: 3500 });
        }
      }
      if (sys.ramp) say({ kind: "jupMass", value: jupiterMult });

      const out = {
        t: sys.t,
        steps: done,
        physicsMs: performance.now() - t0,
        rate,
        limited: limitedScore > 0.5,
        jupiterMult,
        ramping: !!sys.ramp,
        messages,
        hud: wantHud ? hudData(sys) : null,
      };
      messages = [];
      return out;
    },
  };
}

/**
 * Panel data that's expensive or awkward to compute from a render snapshot.
 * @param {SimSystem} sys
 * @returns {HudData}
 */
export function hudData(sys) {
  const sun = sys.bodies[0];
  /** @type {Record<string, BeltCounts>} */
  const belts = {};
  let debrisClouds = 0, debrisPieces = 0;
  for (const [key, b] of Object.entries(sys.belts)) {
    if (b.debris) {
      debrisClouds++;
      debrisPieces += beltStats(b, sun).alive;
    } else {
      belts[key] = beltStats(b, sun);
    }
  }
  return {
    belts,
    debris: { clouds: debrisClouds, pieces: debrisPieces },
    log: sys.history.slice(0, sys.historyIndex).slice(-12).reverse().map((r) => ({ text: r.text, kind: r.kind, t: r.t })),
    escaped: sys.bodies
      .filter((b) => !b.isSun && !b.removed && Math.hypot(b.x - sun.x, b.y - sun.y) > ESCAPE_AU)
      .map((b) => b.name),
    launched: launchedCount(sys),
  };
}
