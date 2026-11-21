// The shapes of the simulation's data. The simulation is plain JavaScript;
// these types are checked through JSDoc (`// @ts-check` + `@param` comments),
// so a typo like `b.fragmnt` or a field a body might not have is caught at
// build time instead of on screen.

export type StarPalette = 'sun' | 'red' | 'white'

/** [a (AU), e, L mean longitude (°), ϖ longitude of perihelion (°)] or their rates per century. */
export type Elements = [number, number, number, number]

/** What a body is: BODY_DATA entries, scenario extras, launched bodies, fragments. */
export interface BodySpec {
  name: string
  mass: number
  color: string
  displayRadius: number
  /** True radius, for impact physics. Defaults to Earth's density for the mass. */
  radiusKm?: number
  isSun?: boolean
  isStar?: boolean
  isDwarf?: boolean
  rings?: boolean
  starPalette?: StarPalette
  el?: Elements
  rate?: Elements
  /** Roughly how long one orbit takes (years); sets the trail length. */
  period?: number
  /** Shown on the info card for bodies without a fact sheet. */
  type?: string
  description?: string
  /** For launched bodies: which LAUNCH_TYPES entry. */
  launchType?: string
  /** For impact chunks: the original body they came from. */
  fragmentOf?: string
}

/** A body in a running simulation. */
export interface Body extends BodySpec {
  /** Mass before any chaos-slider multiplier. */
  baseMass: number
  period: number
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  /** Sun-relative trail points [x0, y0, x1, y1, …] and their sim times. */
  trail: number[]
  trailT: number[]
  /** Out of the physics: swallowed, shattered, not launched yet, or (the Sun) deleted. */
  removed: boolean
  merged: boolean
  unborn: boolean
  shattered?: boolean
  /** Launched in a timeline that was rewound and replaced. */
  discarded?: boolean
  launched?: boolean
  fragment?: boolean
  /** Pieces of the same impact can't re-collide until stepCount reaches graceUntil. */
  impactId?: number
  graceUntil?: number
}

/** The parts of a body that history snapshots save and restore. */
export type BodyState = Pick<
  Body,
  'x' | 'y' | 'vx' | 'vy' | 'mass' | 'baseMass' | 'removed' | 'merged' | 'unborn' |
  'shattered' | 'radiusKm' | 'displayRadius' | 'impactId' | 'graceUntil'
>

/** A belt or debris cloud: test particles that feel gravity but exert none. */
export interface Belt {
  key: string
  n: number
  /** One particle step per `every` body steps. */
  every: number
  color: string
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
  ax: Float64Array
  ay: Float64Array
  alive: Uint8Array
  /** Fell into the Sun. */
  swallowed: number
  /** Swept up by a body (debris only). */
  absorbed?: number
  /** Mid-way through a particle step (see belts.js). */
  pending: boolean
  pendingDir: number
  pendingDt: number
  pendingStart: number
  debris?: boolean
  /** Debris: the sim time it was made (its colour cools with age). */
  born?: number
  mass?: number
}

export interface DebrisInit {
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
}

export interface LaunchRecord {
  kind: 'launch'
  step: number
  t: number
  index: number
  state: BodyState
  text: string
}

export interface MergeRecord {
  kind: 'merge'
  step: number
  t: number
  keep: number
  gone: number
  before: [BodyState, BodyState]
  text: string
}

export interface ImpactRecord {
  kind: 'impact'
  step: number
  t: number
  /** Target (the remnant) and impactor. */
  a: number
  b: number
  before: [BodyState, BodyState]
  after: [BodyState, BodyState]
  created: { index: number; state: BodyState }[]
  debrisKey: string | null
  debrisInit: DebrisInit | null
  debrisMass: number
  text: string
}

export type HistoryRecord = LaunchRecord | MergeRecord | ImpactRecord

/** What scenario events may change. */
export interface EventControl {
  readonly sys: SimSystem
  setSunMass(value: number): void
}

export interface ScenarioEvent {
  t: number
  label: string
  undoLabel: string
  do(ctl: EventControl): void
  undo(ctl: EventControl): void
  done?: boolean
}

export interface MassRamp {
  key: 'jupMass'
  t0: number
  t1: number
  from: number
  to: number
}

export interface Flash {
  /** Sun-relative position of the impact. */
  hx: number
  hy: number
  /** performance.now() when it happened (on the thread that draws it). */
  at: number
  power?: number
  shatter?: boolean
}

export interface SimSystem {
  bodies: Body[]
  belts: Record<string, Belt>
  /** Same belts as `belts`, as an array. */
  beltList: Belt[]
  startDate: Date
  seed: number
  t: number
  stepCount: number
  events: ScenarioEvent[]
  ramp: MassRamp | null
  /** Launches and collisions in order; records before historyIndex have happened. */
  history: HistoryRecord[]
  historyIndex: number
  flashes: Flash[]
  nextImpactId: number
  maxHistory: number
  /** Rewinding can't go back past this step (older history was dropped). */
  rewindFloor: number
  forceMassUpdate?: boolean
}

/** Position and velocity (AU, AU/yr). */
export interface State2D {
  x: number
  y: number
  vx: number
  vy: number
}

/** Planar orbital elements at a moment (angles in radians). */
export interface Orbit {
  a: number
  e: number
  varpi: number
  M: number
}

/** What the impact model needs to know about a colliding body. */
export type MassPoint = Pick<Body, 'mass' | 'radiusKm' | 'x' | 'y' | 'vx' | 'vy'>

export interface ImpactSpeeds {
  /** Speed at contact, using real radii (AU/yr). */
  vImp: number
  vEsc: number
  vRel: number
}

export interface MergePlan {
  kind: 'merge'
  vImp: number
  vEsc: number
  fLR: number
}

export interface ShatterPlan {
  kind: 'shatter'
  vImp: number
  vEsc: number
  /** Mass fraction kept by the largest remnant. */
  fLR: number
  /** Relative to the colliding pair's centre of mass. */
  remnant: { mass: number; vx: number; vy: number }
  fragments: (State2D & { mass: number })[]
  debris: State2D[]
  debrisMass: number
}

export type ImpactPlan = MergePlan | ShatterPlan

export interface BeltDef {
  label: string
  count: number
  every: number
  color: string
  sample(rng: () => number): { a: number; e: number }
}

export interface Camera {
  zoom: number
  panX: number
  panY: number
  /** Index of the body the camera follows, if any. */
  follow?: number | null
}

/** Everything needed to map world ↔ screen for one frame. */
export interface View {
  w: number
  h: number
  cx: number
  cy: number
  scale: number
  exp: number
  zoom: number
  panX: number
  panY: number
}

// ─── What the page reads ─────────────────────────────────────────
// The renderer, panels, hit-testing and launch prediction work on either the
// live system (main-thread host) or the worker's mirror, so they're typed
// against just the fields both provide.

export type ViewBody = Omit<
  Pick<
    Body,
    'name' | 'color' | 'x' | 'y' | 'vx' | 'vy' | 'mass' | 'displayRadius' | 'radiusKm' | 'period' |
    'removed' | 'merged' | 'shattered' | 'unborn' | 'discarded' |
    'isSun' | 'isStar' | 'starPalette' | 'isDwarf' | 'rings' | 'fragment' | 'launched' | 'type' | 'description' |
    'trail' | 'trailT'
  >,
  'trail' | 'trailT'
> & {
  trail: ArrayLike<number>
  trailT: ArrayLike<number>
  el?: readonly number[]
}

export interface ViewBelt {
  key: string
  n: number
  color: string
  debris?: boolean
  born?: number
  x: ArrayLike<number>
  y: ArrayLike<number>
  alive: ArrayLike<number>
}

export interface ViewSystem {
  bodies: ViewBody[]
  beltList: ViewBelt[]
  belts: Record<string, ViewBelt>
  t: number
  flashes: Flash[]
  startDate: Date
  seed: number
}

// ─── Snapshots (worker → page) ───────────────────────────────────

export type BodySnapshot = Omit<ViewBody, 'trail' | 'trailT' | 'el'> & {
  a?: number
  trail?: Float64Array
  trailT?: Float64Array
}

export interface BeltSnapshot extends ViewBelt {
  x: Float32Array
  y: Float32Array
  alive: Uint8Array
}

export interface Snapshot {
  t: number
  stepCount: number
  startDate: number
  seed: number
  bodies: BodySnapshot[]
  belts: BeltSnapshot[]
  flashes: Omit<Flash, 'at'>[]
}

export interface Mirror extends ViewSystem {
  stepCount: number
}

// ─── Scenarios and launches ──────────────────────────────────────

export interface ScenarioSettings {
  speed: number
  sunMass: number
  jupMass: number
  distExp: number
  sizeMult: number
  showTrails: boolean
  showGrav: boolean
  belts: Record<string, boolean>
  zoom: number
  follow: string | null
}

export interface Scenario {
  id: string
  name: string
  blurb: string
  /** The sim time of its most dramatic moment, for link previews. */
  previewYears?: number
  settings?: Partial<ScenarioSettings>
  setup?(sys: SimSystem): void
  events?: ScenarioEvent[]
  ramp?: MassRamp
}

export interface LaunchTypeDef {
  label: string
  mass: number
  radiusKm: number
  displayRadius: number
  colors: string[]
  prefix: string
  type: string
  description: string
  isStar?: boolean
  starPalette?: StarPalette
}

// ─── Engine and host ─────────────────────────────────────────────

export interface EngineOptions {
  speed: number
  paused: boolean
  reverse: boolean
  sunMass: number
  jupMass: number
}

export type EngineMessage =
  | { kind: 'notice'; text: string; ms?: number }
  | { kind: 'sunMass'; value: number; byEvent: boolean }
  | { kind: 'jupMass'; value: number }
  | { kind: 'rewindFloor' }

export interface BeltCounts {
  alive: number
  ejected: number
  swallowed: number
  absorbed: number
}

export interface HudData {
  belts: Record<string, BeltCounts>
  debris: { clouds: number; pieces: number }
  log: { text: string; kind: HistoryRecord['kind']; t: number }[]
  escaped: string[]
  launched: number
}

export interface TickResult {
  t: number
  steps: number
  physicsMs: number
  rate: number
  limited: boolean
  jupiterMult: number
  ramping: boolean
  messages: EngineMessage[]
  hud: HudData | null
}

export interface LoadParams {
  scenario: string
  date: Date
  seed: number
  belts?: Record<string, boolean>
}

export interface SimHost {
  readonly kind: 'worker' | 'main'
  readonly mirror: ViewSystem | null
  load(params: LoadParams): void
  configure(opts: Partial<EngineOptions>): void
  setBelts(belts: Record<string, boolean>): void
  cancelRamp(): void
  launch(typeKey: string, hx: number, hy: number, vx: number, vy: number): void
  clearLaunched(): void
  frame(realDt: number, budgetMs: number, wantHud: boolean): void
  physicsBudget(displayFrame: number, otherMs: number): number
  dispose(): void
}

export interface HostCallbacks {
  onLoaded?(mirror: ViewSystem): void
  onResult?(result: TickResult): void
}

/** What createMainHost/createWorkerHost build: a SimHost whose mirror they update. */
export type HostImpl = { -readonly [K in keyof SimHost]: SimHost[K] }
