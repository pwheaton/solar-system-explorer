// @ts-check
// Render snapshots: what the physics worker sends the page each frame, and
// how the page rebuilds a lightweight "mirror" of the system from them. The
// mirror has the same shape the renderer, hit-testing and path prediction
// already read (bodies, beltList, t, flashes), so they work unchanged.

/** @typedef {import("./types").Body} Body */
/** @typedef {import("./types").Mirror} Mirror */
/** @typedef {import("./types").SimSystem} SimSystem */
/** @typedef {import("./types").Snapshot} Snapshot */
/** @typedef {import("./types").BodySnapshot} BodySnapshot */
/** @typedef {import("./types").ViewBody} ViewBody */

/** Body fields the page needs for drawing, panels, hit-testing and prediction. */
/** @type {(keyof ViewBody)[]} */
const BODY_FIELDS = [
  "name", "color", "x", "y", "vx", "vy", "mass", "displayRadius", "radiusKm", "period",
  "removed", "merged", "shattered", "unborn", "discarded",
  "isSun", "isStar", "starPalette", "isDwarf", "rings", "fragment", "launched", "type", "description",
];

/**
 * Per-connection bookkeeping so unchanged trails aren't re-sent.
 * @returns {{ trailKeys: string[] }}
 */
export function createSnapshotState() {
  return { trailKeys: [] };
}

/**
 * @param {Body} b
 */
const trailKey = (b) => {
  const n = b.trailT.length;
  return n ? `${n}:${b.trailT[0]}:${b.trailT[n - 1]}` : "0";
};

/**
 * Package the system for the page. Returns the snapshot and the list of
 * buffers to transfer (not copy) to the main thread.
 * @param {SimSystem} sys
 * @param {{ trailKeys: string[] }} state
 * @param {boolean} [full]
 * @returns {{ snap: Snapshot, transfer: Transferable[] }}
 */
export function makeSnapshot(sys, state, full = false) {
  /** @type {Transferable[]} */
  const transfer = [];
  const bodies = sys.bodies.map((b, i) => {
    /** @type {Record<string, unknown>} */
    const fields = {};
    for (const f of BODY_FIELDS) fields[f] = b[f];
    const o = /** @type {BodySnapshot} */ (fields);
    o.a = b.el ? b.el[0] : undefined;
    const key = trailKey(b);
    if (full || state.trailKeys[i] !== key) {
      state.trailKeys[i] = key;
      const trail = Float64Array.from(b.trail), trailT = Float64Array.from(b.trailT);
      o.trail = trail;
      o.trailT = trailT;
      transfer.push(trail.buffer, trailT.buffer);
    }
    return o;
  });

  const belts = sys.beltList.map((b) => {
    const x = new Float32Array(b.n), y = new Float32Array(b.n);
    for (let i = 0; i < b.n; i++) { x[i] = b.x[i]; y[i] = b.y[i]; }
    const alive = Uint8Array.from(b.alive);
    transfer.push(x.buffer, y.buffer, alive.buffer);
    return { key: b.key, n: b.n, color: b.color, debris: !!b.debris, born: b.born, x, y, alive };
  });

  // New collision flashes; the page stamps them with its own clock.
  const flashes = sys.flashes.splice(0).map(({ hx, hy, power, shatter }) => ({ hx, hy, power, shatter }));

  return {
    snap: {
      t: sys.t, stepCount: sys.stepCount, startDate: sys.startDate.getTime(), seed: sys.seed,
      bodies, belts, flashes,
    },
    transfer,
  };
}

/**
 * Apply a snapshot to a mirror (or start a new one when `mirror` is null).
 * @param {Mirror | null} mirror
 * @param {Snapshot} snap
 * @returns {Mirror}
 */
export function applySnapshot(mirror, snap) {
  /** @type {Mirror} */
  const m = mirror ?? { bodies: [], beltList: [], belts: {}, flashes: [], t: 0, stepCount: 0, seed: 0, startDate: new Date(snap.startDate) };
  m.t = snap.t;
  m.stepCount = snap.stepCount;
  m.seed = snap.seed;
  if (!m.startDate || m.startDate.getTime() !== snap.startDate) m.startDate = new Date(snap.startDate);

  const prev = m.bodies;
  m.bodies = snap.bodies.map((o, i) => {
    /** @type {ViewBody} */
    const b = prev[i] && prev[i].name === o.name ? prev[i] : /** @type {ViewBody} */ (/** @type {unknown} */ ({ trail: [], trailT: [] }));
    const { trail, trailT, ...rest } = o;
    Object.assign(b, rest);
    b.el = o.a != null ? [o.a] : undefined;
    if (trail && trailT) { b.trail = trail; b.trailT = trailT; }
    return b;
  });

  m.beltList = snap.belts;
  m.belts = Object.fromEntries(snap.belts.map((b) => [b.key, b]));
  const now = performance.now();
  for (const f of snap.flashes) m.flashes.push({ ...f, at: now });
  return m;
}
