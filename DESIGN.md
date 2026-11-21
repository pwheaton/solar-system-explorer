# Design

Why the simulator is built the way it is, and how it should look. `README.md` covers what each file does; this covers the decisions behind them and the limits worth knowing before changing things.

## Visual language: "modern orrery"

The look is a brass-and-glass instrument at night: a dark sky, thin hairline frames, warm amber for what matters, and numbers set like an instrument readout. The simulation is the hero; the UI sits around the edges and gets out of the way.

**Colour tokens** (defined at the top of `components/solar-system/styles.module.css`, scoped to `.root`; use these rather than new hex values):

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#070a12` | The sky behind everything |
| `--panel` / `--panel-solid` | translucent / `#0b1020` | Panels, dock, cards |
| `--line` / `--line-strong` | blue-grey hairlines | Borders, section dividers, hover |
| `--text` / `--text-dim` / `--text-faint` | warm off-white to grey | Body text, labels, metadata |
| `--amber` (+ `-soft`, `-line`) | `#f2b441` | The accent: selected scenario, section numbers, brand, notices |
| `--cyan` | `#8fd0ea` | Live values: slider readouts, confirmations |
| `--rewind` | `#9fb5ff` | Anything about running time backwards |
| `--chaos` | `#ff8a5c` | Settings pushed away from reality, warnings, lost particles |

The colours carry meaning: amber means "selected / important", cyan "a live number", blue "rewinding", orange "you've broken physics". Keep new UI to the same mapping.

**Type:** two families, loaded with `next/font` in `app/layout.tsx`.
- **Fira Sans** for everything people read: headings, labels, descriptions, the brand.
- **Fira Mono** for instrument-style details: slider values, section numbers (`01`, `02`), belt counts, the dock's meta line. Numbers that change use `font-variant-numeric: tabular-nums` so they don't jitter.

**Shape:** 10px radius (`--radius`), 1px hairlines, panel frames with corner brackets (`.frame::before/::after`), one easing curve (`--ease`). Motion is short and functional, and everything animated is switched off under `prefers-reduced-motion`.

**Layout:**
- Desktop: the brand top-left, the control panel on the right, the time dock centred at the bottom, the shortcuts drawer as a tab on the left edge, the planet card floating near the selection.
- At 768px and below (`NARROW_PX` in `layout.js`): the panel becomes a full-height sheet behind a toggle, the dock spans the bottom and wraps (speed slider on its own row), the planet card sits above the dock, and the dock and notices hide while the panel is open.
- Canvas labels and the scale of things are tuned for both; check both widths for any UI change.

**Honesty notes in the UI:** where the picture isn't to scale (belt density, body sizes, distance warp), the panel says so plainly. Keep doing that when adding exaggerations.

## Physics

**Units:** AU, solar masses and years, so G = 4π² (`constants.js`). Numbers stay near 1, which keeps floating-point error small.

**Integrator:** velocity Verlet with a fixed step, `DT = 0.0002` years (about 1.75 hours).
- It's symplectic, so energy doesn't drift over long runs (a test checks 10 years).
- It's time-reversible: running it with `-DT` retraces the path exactly. That's what makes rewind a real rewind rather than a replay of saved frames.
- The step is fixed because adaptive steps break both properties. A small softening (`SOFTENING = 1e-4`) keeps close passes finite.

**Belts are test particles:** asteroids, Kuiper objects and impact debris feel gravity but exert none.
- That makes thousands of them cheap: the cost is particles × bodies, not particles².
- They step less often than bodies (every 8 body steps for the asteroid belt, 32 for the Kuiper belt, 2 for debris).
- Each particle step is split into kick and drift halves around the body steps, so rewinding through a partial step lands exactly where it started.
- The belts are seeded (`rng.js`), so a link reproduces the same belt.

**Collisions** (`impacts.js` decides, `collisions.js` applies), following Leinhardt & Stewart (2012):
1. Work out the real impact speed from the bodies' true radii (`radiusKm`, or Earth density from mass). Two bodies drifting together still hit at least at mutual escape speed.
2. Below 1.4 × escape speed (`MERGE_SPEED_RATIO`), they merge.
3. Faster than that, the energy of the impact sets how much mass the largest remnant keeps. If it keeps more than 97%, that still counts as a merge. Otherwise the target shatters into the remnant, up to 7 large fragments that are real bodies with gravity, and a debris cloud of test particles.
4. Fragments fly out at around the remnant's escape speed, mostly downrange. Pieces of one impact can't hit each other for 250 steps (`GRACE_STEPS`, about 18 days), so the explosion is visible before chunks start re-merging.

Bodies that get too close to the Sun are swallowed (`SUN_CAPTURE_AU`). Bodies beyond `EJECT_AU` are dropped as escaped.

**History and rewind:** every launch, merge and impact is a record holding the state before (and after) it (`history.js`). Running backwards past a record undoes it; running forwards again redoes it, so a rewound timeline replays identically.

**Limits** keep the cost bounded on slow machines:

| Limit | Value | Where |
|---|---|---|
| History records kept | 200 (older ones drop; rewind stops at `rewindFloor`) | `MAX_HISTORY` in `constants.js` |
| Debris particles in total | 3,000 (at most 500 per impact) | `MAX_DEBRIS` in `collisions.js` |
| Live impact chunks | 45 (past this, impacts make debris only) | `MAX_CHUNKS` in `collisions.js` |
| Launched bodies | 30 | `MAX_LAUNCHED` in `sandbox.js` |
| Physics time per frame | 10 ms default; the host adjusts it to the display | `PHYSICS_BUDGET_MS`, `host.physicsBudget` |

When physics can't keep up with the chosen speed it runs slower than asked rather than building a backlog. The dock shows this as "limited".

## Threads: worker, snapshots, mirror

Physics runs in a Web Worker (`sim.worker.js`) so a heavy frame never blocks drawing or input.

1. Each animation frame, the page asks the worker to advance by the real time that passed (`host.frame`). It never queues more than one tick: if the worker is still busy, the time is owed to the next tick.
2. The worker runs the engine (`engine.js`) and replies with a **snapshot** (`snapshot.js`):
   - body fields the page needs
   - belts as `Float32Array`s, transferred rather than copied
   - trails only when they changed
   - new collision flashes
3. The page applies it to a **mirror**: a lightweight copy of the system with the same shape the renderer, hit-testing and launch prediction read. So those don't care which thread the physics runs on.

**The main thread is kept as a fallback**, behind the same `SimHost` interface (`host.js`). Some browsers create module workers but can't run them, so if the worker errors or doesn't answer the first load within 4 seconds, the host replays the last setup on the main thread. `?worker=0` forces this path, which is useful for debugging and for comparing. Both paths must keep working, and the smoke tests cover both.

Every load bumps a generation number, and replies from an older generation are dropped. This stops a frame from the previous scenario flashing up after a switch.

## Server-side previews

Link previews (`app/api/og/route.tsx`) run the shared scenario forward to its most dramatic moment (`previewYears`). `scene.js` then turns the result into plain shapes (rings, orbits, trails, dots, bodies) and draws them as an image. This reuses the same simulation code, which is the main reason `lib/sim/` stays free of DOM and React.
