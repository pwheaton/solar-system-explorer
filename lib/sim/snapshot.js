// Render snapshots: what the physics worker sends the page each frame, and
// how the page rebuilds a lightweight "mirror" of the system from them. The
// mirror has the same shape the renderer, hit-testing and path prediction
// already read (bodies, beltList, t, flashes), so they work unchanged.

/** Body fields the page needs for drawing, panels, hit-testing and prediction. */
const BODY_FIELDS = [
  "name", "color", "x", "y", "vx", "vy", "mass", "displayRadius", "radiusKm", "period",
  "removed", "merged", "shattered", "unborn", "discarded",
  "isSun", "isStar", "starPalette", "isDwarf", "rings", "fragment", "launched", "type", "description",
];

/** Per-connection bookkeeping so unchanged trails aren't re-sent. */
export function createSnapshotState() {
  return { trailKeys: [] };
}

const trailKey = (b) => {
  const n = b.trailT.length;
  return n ? `${n}:${b.trailT[0]}:${b.trailT[n - 1]}` : "0";
};

/**
 * Package the system for the page. Returns the snapshot and the list of
 * buffers to transfer (not copy) to the main thread.
 */
export function makeSnapshot(sys, state, full = false) {
  const transfer = [];
  const bodies = sys.bodies.map((b, i) => {
    const o = {};
    for (const f of BODY_FIELDS) o[f] = b[f];
    o.a = b.el ? b.el[0] : undefined;
    const key = trailKey(b);
    if (full || state.trailKeys[i] !== key) {
      state.trailKeys[i] = key;
      o.trail = Float64Array.from(b.trail);
      o.trailT = Float64Array.from(b.trailT);
      transfer.push(o.trail.buffer, o.trailT.buffer);
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

/** Apply a snapshot to a mirror (or start a new one when `mirror` is null). */
export function applySnapshot(mirror, snap) {
  const m = mirror ?? { bodies: [], beltList: [], belts: {}, flashes: [] };
  m.t = snap.t;
  m.stepCount = snap.stepCount;
  m.seed = snap.seed;
  if (!m.startDate || m.startDate.getTime() !== snap.startDate) m.startDate = new Date(snap.startDate);

  const prev = m.bodies;
  m.bodies = snap.bodies.map((o, i) => {
    const b = prev[i] && prev[i].name === o.name ? prev[i] : { trail: [], trailT: [] };
    const { trail, trailT, ...rest } = o;
    Object.assign(b, rest);
    b.el = o.a != null ? [o.a] : undefined;
    if (trail) { b.trail = trail; b.trailT = trailT; }
    return b;
  });

  m.beltList = snap.belts;
  m.belts = Object.fromEntries(snap.belts.map((b) => [b.key, b]));
  const now = performance.now();
  for (const f of snap.flashes) m.flashes.push({ ...f, at: now });
  return m;
}
