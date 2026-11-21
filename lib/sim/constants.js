// Units: distance in AU, mass in solar masses, time in years.
// In these units G = 4π² (Earth's orbit: 1 AU, 1 year, 1 solar mass).
export const G = 4 * Math.PI * Math.PI;

// Base integration step. ~1,200 steps per Mercury orbit.
export const DT = 0.0002;

// Gravitational softening (AU²) — keeps close encounters from blowing up.
export const SOFTENING = 1e-4;

// Outer edge of the view, used by the distance warp.
export const MAX_AU = 50;

// Particles farther than this from the Sun count as ejected;
// closer than SUN_CAPTURE_AU count as swallowed by the Sun.
export const EJECT_AU = 250;
export const SUN_CAPTURE_AU = 0.02;

// Each trail holds about one orbit, sampled this many times.
export const TRAIL_POINTS = 240;

// Time budget per animation frame for physics, in milliseconds.
// If a frame can't hit the requested speed within this budget, the sim
// runs slower than requested and the HUD says so.
export const PHYSICS_BUDGET_MS = 10;

export const AU_KM = 149597870.7;
export const YEAR_S = 365.25 * 24 * 3600;
export const EARTH_MASS = 3.003e-6;
export const JUPITER_INDEX = 5;

// Roughly the mass at which a body starts fusing hydrogen (~80 Jupiters).
export const STAR_THRESHOLD_JUPITERS = 80;

/** How many events (launches, merges, impacts) rewind can undo. */
export const MAX_HISTORY = 200;
