"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Physics Constants (AU, Solar Masses, Years) ─────────────────
const G = 4 * Math.PI * Math.PI;
const BASE_DT = 0.00015;
const MAX_STEPS = 4000;
const MAX_TRAIL = 800;
const GRAV_RES = 70;
const MAX_AU = 38;
const SOFTENING = 1e-4;

// ─── Planet Data ─────────────────────────────────────────────────
const INIT_DATA = [
  { name: "Sun", mass: 1.0, x: 0, y: 0, vx: 0, vy: 0, color: "#FDB813", glowColor: "#FDB81340", displayRadius: 12, isSun: true },
  { name: "Mercury", mass: 1.652e-7, dist: 0.387, color: "#9E9590", displayRadius: 3 },
  { name: "Venus", mass: 2.447e-6, dist: 0.723, color: "#E8CDA0", displayRadius: 4.5 },
  { name: "Earth", mass: 3.003e-6, dist: 1.0, color: "#4B8FE5", displayRadius: 4.8 },
  { name: "Mars", mass: 3.213e-7, dist: 1.524, color: "#C1440E", displayRadius: 3.5 },
  { name: "Jupiter", mass: 9.543e-4, dist: 5.203, color: "#C88B3A", displayRadius: 9 },
  { name: "Saturn", mass: 2.857e-4, dist: 9.537, color: "#E3D5A0", displayRadius: 8 },
  { name: "Uranus", mass: 4.365e-5, dist: 19.19, color: "#7EC8E3", displayRadius: 6 },
  { name: "Neptune", mass: 5.149e-5, dist: 30.07, color: "#4B5FE8", displayRadius: 5.8 },
];

const PLANET_FACTS = {
  Sun: {
    type: "Star (G-type main-sequence)",
    composition: "Hydrogen (73%), Helium (25%), heavier elements (2%)",
    temperature: "5,500°C surface / 15 million °C core",
    moons: null,
    rings: false,
    orbitalPeriod: null,
    dayLength: "25 Earth days (equator)",
    earthMasses: 333000,
    surfaceGravity: 27.9,
    canStand: "No — plasma surface at 5,500°C",
    windSpeed: null,
    funFact: "The Sun contains 99.86% of all mass in the solar system. Everything else — every planet, moon, asteroid, and comet — is the remaining 0.14%.",
    travelTime: "8 min 20 sec (at the speed of light)",
    distFromEarthKm: "~150 million km",
  },
  Mercury: {
    type: "Terrestrial (rocky)",
    composition: "Iron core (75% of radius), silicate mantle and crust",
    temperature: "−180°C night / 430°C day",
    moons: 0,
    rings: false,
    orbitalPeriod: "88 Earth days",
    dayLength: "59 Earth days (sunrise to sunrise: 176 days)",
    earthMasses: 0.055,
    surfaceGravity: 0.38,
    canStand: "Technically yes — solid surface, but no atmosphere and extreme temperatures",
    windSpeed: "None — virtually no atmosphere",
    funFact: "A day on Mercury (sunrise to sunrise) is 2 Mercury years long. You'd celebrate two birthdays before lunch.",
    travelTime: "~6.5 years (Messenger probe)",
    distFromEarthKm: "77–222 million km",
  },
  Venus: {
    type: "Terrestrial (rocky)",
    composition: "Iron core, silicate mantle, CO₂ atmosphere (96.5%)",
    temperature: "465°C average — hotter than Mercury despite being further from the Sun",
    moons: 0,
    rings: false,
    orbitalPeriod: "225 Earth days",
    dayLength: "243 Earth days — longer than its year, and it spins backwards",
    earthMasses: 0.815,
    surfaceGravity: 0.9,
    canStand: "No — you'd be simultaneously crushed (90× Earth pressure), melted, and dissolved by sulfuric acid clouds",
    windSpeed: "360 km/h (upper atmosphere), ~3 km/h at surface",
    funFact: "Venus rotates backwards compared to most planets. If you could see through its clouds, the Sun would rise in the west.",
    travelTime: "~4 months (shortest route)",
    distFromEarthKm: "38–261 million km",
  },
  Earth: {
    type: "Terrestrial (rocky)",
    composition: "Iron core, silicate mantle, nitrogen/oxygen atmosphere",
    temperature: "−89°C to 57°C (average 15°C)",
    moons: 1,
    moonNames: "The Moon",
    rings: false,
    orbitalPeriod: "365.25 days",
    dayLength: "24 hours",
    earthMasses: 1,
    surfaceGravity: 1.0,
    canStand: "Yes — you're doing it right now",
    windSpeed: "Up to 400 km/h (strongest recorded tornado)",
    funFact: "Earth is the only known place in the universe where fire can exist. Fire requires oxygen, which no other planet in our solar system has in its atmosphere.",
    travelTime: "You're already here",
    distFromEarthKm: "0",
  },
  Mars: {
    type: "Terrestrial (rocky)",
    composition: "Iron core, silicate mantle, thin CO₂ atmosphere",
    temperature: "−140°C to 20°C (average −63°C)",
    moons: 2,
    moonNames: "Phobos, Deimos",
    rings: false,
    orbitalPeriod: "687 Earth days (1.88 years)",
    dayLength: "24 hours 37 minutes — almost identical to Earth",
    earthMasses: 0.107,
    surfaceGravity: 0.38,
    canStand: "Yes, with a suit — solid surface, but thin atmosphere (1% of Earth's pressure)",
    windSpeed: "Up to 100 km/h (but feels like a gentle breeze due to thin air)",
    funFact: "Mars has the tallest mountain in the solar system: Olympus Mons, 2.5× the height of Everest. It's so wide that standing on top, you couldn't see the edges — they'd be beyond the horizon.",
    travelTime: "~7 months (current rockets)",
    distFromEarthKm: "55–400 million km",
  },
  Jupiter: {
    type: "Gas giant",
    composition: "Hydrogen (90%), Helium (10%), no solid surface",
    temperature: "−110°C (cloud tops), ~24,000°C (core)",
    moons: 95,
    moonNames: "Io, Europa, Ganymede, Callisto + 91 others",
    rings: true,
    ringDesc: "Faint dust rings (discovered 1979)",
    orbitalPeriod: "11.86 Earth years",
    dayLength: "9 hours 56 minutes — fastest spinning planet despite being the largest",
    earthMasses: 318,
    surfaceGravity: 2.53,
    canStand: "No — no solid surface. You'd sink into ever-denser gas until pressure crushed you",
    windSpeed: "Up to 620 km/h",
    funFact: "Jupiter's Great Red Spot is a storm that's been raging for at least 350 years. It's so large that Earth could fit inside it. Twice.",
    travelTime: "~5–6 years (Juno probe)",
    distFromEarthKm: "588–968 million km",
  },
  Saturn: {
    type: "Gas giant",
    composition: "Hydrogen (96%), Helium (3%), no solid surface",
    temperature: "−178°C (cloud tops)",
    moons: 146,
    moonNames: "Titan, Enceladus, Mimas, Rhea + 142 others",
    rings: true,
    ringDesc: "Massive ring system — 280,000 km wide but only ~10 meters thick. Made of ice and rock.",
    orbitalPeriod: "29.46 Earth years",
    dayLength: "10 hours 42 minutes",
    earthMasses: 95.2,
    surfaceGravity: 1.07,
    canStand: "No — gas giant, no surface. But you could theoretically float on it — Saturn is less dense than water",
    windSpeed: "Up to 1,800 km/h (equatorial)",
    funFact: "Saturn is the only planet that would float if you could find a bathtub big enough. Its density is less than water.",
    travelTime: "~6–7 years (Cassini probe)",
    distFromEarthKm: "1.2–1.67 billion km",
  },
  Uranus: {
    type: "Ice giant",
    composition: "Water, methane, and ammonia ices over a small rocky core. Methane gives it the blue-green color",
    temperature: "−224°C (coldest atmosphere in the solar system)",
    moons: 28,
    moonNames: "Titania, Oberon, Miranda, Ariel, Umbriel + 23 others",
    rings: true,
    ringDesc: "13 faint rings, discovered in 1977",
    orbitalPeriod: "84 Earth years",
    dayLength: "17 hours 14 minutes",
    earthMasses: 14.5,
    surfaceGravity: 0.89,
    canStand: "No — no solid surface, icy gas layers compress into exotic high-pressure ices",
    windSpeed: "Up to 900 km/h",
    funFact: "Uranus is tipped completely on its side (98° axial tilt), likely from a collision with an Earth-sized object billions of years ago. It essentially rolls around the Sun.",
    travelTime: "~9 years (Voyager 2, the only spacecraft to visit)",
    distFromEarthKm: "2.6–3.15 billion km",
  },
  Neptune: {
    type: "Ice giant",
    composition: "Water, methane, and ammonia ices over rocky core. Methane makes it vivid blue",
    temperature: "−218°C (cloud tops)",
    moons: 16,
    moonNames: "Triton (orbits backwards), Nereid + 14 others",
    rings: true,
    ringDesc: "5 faint rings, some with unusual clumps called arcs",
    orbitalPeriod: "164.8 Earth years",
    dayLength: "16 hours 6 minutes",
    earthMasses: 17.1,
    surfaceGravity: 1.14,
    canStand: "No — ice giant with no solid surface",
    windSpeed: "Up to 2,100 km/h — fastest winds in the solar system",
    funFact: "Neptune has the most violent weather in the solar system. Its wind speeds reach 2,100 km/h — nearly 2× the speed of sound. Scientists still don't fully understand where the energy comes from, since it receives very little heat from the Sun.",
    travelTime: "~12 years (Voyager 2)",
    distFromEarthKm: "4.3–4.7 billion km",
  },
};

function createBodies() {
  return INIT_DATA.map((d, i) => {
    const b = { ...d, baseMass: d.mass, trail: [] };
    if (i > 0) {
      b.x = d.dist;
      b.y = 0;
      b.vx = 0;
      b.vy = Math.sqrt(G * INIT_DATA[0].mass / d.dist);
    }
    return b;
  });
}

// ─── Physics Engine ──────────────────────────────────────────────
function computeAccel(bodies) {
  const n = bodies.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + SOFTENING;
      const inv = 1 / (r2 * Math.sqrt(r2));
      ax[i] += G * bodies[j].mass * dx * inv;
      ay[i] += G * bodies[j].mass * dy * inv;
      ax[j] -= G * bodies[i].mass * dx * inv;
      ay[j] -= G * bodies[i].mass * dy * inv;
    }
  }
  return [ax, ay];
}

function step(bodies, dt) {
  const n = bodies.length;
  const [ax1, ay1] = computeAccel(bodies);
  for (let i = 0; i < n; i++) {
    bodies[i].vx += 0.5 * ax1[i] * dt;
    bodies[i].vy += 0.5 * ay1[i] * dt;
    bodies[i].x += bodies[i].vx * dt;
    bodies[i].y += bodies[i].vy * dt;
  }
  const [ax2, ay2] = computeAccel(bodies);
  for (let i = 0; i < n; i++) {
    bodies[i].vx += 0.5 * ax2[i] * dt;
    bodies[i].vy += 0.5 * ay2[i] * dt;
  }
}

// ─── Coordinate Mapping ──────────────────────────────────────────
function w2s(wx, wy, exp, cx, cy, scale, sunX, sunY) {
  const dx = (wx - sunX) / MAX_AU;
  const dy = (wy - sunY) / MAX_AU;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r < 1e-12) return [cx, cy];
  const warped = Math.pow(r, exp);
  const ratio = warped / r;
  return [cx + dx * ratio * scale, cy + dy * ratio * scale];
}

function s2w(sx, sy, exp, cx, cy, scale, sunX, sunY) {
  const dx = (sx - cx) / scale;
  const dy = (sy - cy) / scale;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r < 1e-12) return [sunX, sunY];
  const unwarped = Math.pow(r, 1 / exp);
  const ratio = unwarped / r;
  return [dx * ratio * MAX_AU + sunX, dy * ratio * MAX_AU + sunY];
}

// ─── Gravity Field Rendering ─────────────────────────────────────
function renderGravField(gravCtx, bodies, exp, mainW, mainH, sunX, sunY) {
  const cx = mainW / 2, cy = mainH / 2;
  const scale = Math.min(mainW, mainH) * 0.45;
  const imgData = gravCtx.createImageData(GRAV_RES, GRAV_RES);
  const data = imgData.data;
  const fields = new Float64Array(GRAV_RES * GRAV_RES);
  let maxF = 0;

  for (let py = 0; py < GRAV_RES; py++) {
    for (let px = 0; px < GRAV_RES; px++) {
      const screenX = (px + 0.5) / GRAV_RES * mainW;
      const screenY = (py + 0.5) / GRAV_RES * mainH;
      const [wx, wy] = s2w(screenX, screenY, exp, cx, cy, scale, sunX, sunY);
      let f = 0;
      for (const b of bodies) {
        const dx = wx - b.x, dy = wy - b.y;
        f += b.mass / (dx * dx + dy * dy + 0.01);
      }
      fields[py * GRAV_RES + px] = f;
      if (f > maxF) maxF = f;
    }
  }

  const logMax = Math.log(maxF + 1);
  for (let i = 0; i < GRAV_RES * GRAV_RES; i++) {
    const t = Math.log(fields[i] + 1) / logMax;
    const t2 = t * t, t3 = t * t * t;
    data[i * 4] = Math.min(255, t3 * 180 + t2 * 30);
    data[i * 4 + 1] = Math.min(255, t2 * 100 + t * 40);
    data[i * 4 + 2] = Math.min(255, Math.pow(t, 0.45) * 200);
    data[i * 4 + 3] = Math.min(255, Math.pow(t, 0.35) * 180);
  }
  gravCtx.putImageData(imgData, 0, 0);
}

// ─── Slider Component ────────────────────────────────────────────
function Slider({ label, value, min, max, step: s, onChange, format, log }) {
  const displayVal = format ? format(value) : value.toFixed(1);
  const sliderVal = log ? Math.log10(value) : value;
  const sliderMin = log ? Math.log10(min) : min;
  const sliderMax = log ? Math.log10(max) : max;
  const sliderStep = log ? 0.01 : (s || 0.01);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, letterSpacing: "0.04em" }}>
        <span style={{ color: "#8a8a9a", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{label}</span>
        <span style={{ color: "#d0c8a8", fontFamily: "'Source Code Pro', monospace", fontWeight: 500 }}>{displayVal}</span>
      </div>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={sliderVal}
        onChange={e => {
          const v = parseFloat(e.target.value);
          onChange(log ? Math.pow(10, v) : v);
        }}
        style={{ width: "100%" }}
      />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
export default function SolarSystem() {
  const [speed, setSpeed] = useState(0.05);
  const [sunMass, setSunMass] = useState(1);
  const [jupMass, setJupMass] = useState(1);
  const [distExp, setDistExp] = useState(0.42);
  const [sizeMult, setSizeMult] = useState(1);
  const [showGrav, setShowGrav] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(null);
  const [simYears, setSimYears] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [yourWeight, setYourWeight] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const canvasRef = useRef(null);
  const bodiesRef = useRef(createBodies());
  const sRef = useRef({});
  const simTimeRef = useRef(0);
  const selRef = useRef(null);
  const frameRef = useRef(0);
  const gravCanvasRef = useRef(null);
  const gravCtxRef = useRef(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    sRef.current = { speed, sunMass, jupMass, distExp, sizeMult, showGrav, showTrails, paused, zoom, panX, panY };
    selRef.current = selected;
  });

  // Load fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Source+Code+Pro:wght@400;500&family=Oxanium:wght@400;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  // Clear trails when chaos controls change
  useEffect(() => {
    for (const b of bodiesRef.current) {
      b.trail = [];
    }
  }, [sunMass, jupMass]);

  const handleReset = useCallback(() => {
    bodiesRef.current = createBodies();
    simTimeRef.current = 0;
    setSimYears(0);
    setSelected(null);
    setSpeed(0.05);
    setSunMass(1);
    setJupMass(1);
    setDistExp(0.42);
    setSizeMult(1);
    setPaused(false);
  }, []);

  const handleResetRef = useRef(null);
  handleResetRef.current = handleReset;

  // Keyboard
  useEffect(() => {
    const handler = (e) => {
      if (e.code === "Space") { e.preventDefault(); setPaused(p => !p); }
      if (e.code === "KeyR") { handleResetRef.current(); }
      if (e.code === "KeyG") setShowGrav(g => !g);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ─── Main Render Loop ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const gravCanvas = document.createElement("canvas");
    gravCanvas.width = GRAV_RES;
    gravCanvas.height = GRAV_RES;
    const gravCtx = gravCanvas.getContext("2d");
    gravCanvasRef.current = gravCanvas;
    gravCtxRef.current = gravCtx;

    let animId;

    function loop() {
      const s = sRef.current;
      const bodies = bodiesRef.current;

      // Sync masses
      bodies[0].mass = bodies[0].baseMass * s.sunMass;
      if (bodies[5]) bodies[5].mass = bodies[5].baseMass * s.jupMass;

      // Physics
      if (!s.paused) {
        const steps = Math.max(1, Math.min(Math.round(s.speed * 25), MAX_STEPS));
        for (let i = 0; i < steps; i++) {
          step(bodies, BASE_DT);
          simTimeRef.current += BASE_DT;
        }
        // Trails (sample every few steps)
        for (const b of bodies) {
          if (!b.isSun) {
            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > MAX_TRAIL) b.trail.shift();
          }
        }
        if (frameRef.current % 6 === 0) setSimYears(simTimeRef.current);
      }

      // Canvas sizing
      const par = canvas.parentElement;
      const rect = par.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) * 0.45;
      const exp = s.distExp;
      const sunX = bodies[0].x, sunY = bodies[0].y;
      const zoom = s.zoom || 1;
      const panX = s.panX || 0;
      const panY = s.panY || 0;

      // ─── Background ───
      ctx.fillStyle = "#06060d";
      ctx.fillRect(0, 0, w, h);

      // Apply zoom and pan transformations
      ctx.save();
      ctx.translate(cx + panX, cy + panY);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);

      // Subtle grid
      ctx.strokeStyle = "rgba(40,40,60,0.3)";
      ctx.lineWidth = 0.5;
      for (let au = 1; au <= 35; au += (au < 5 ? 1 : 5)) {
        const r = Math.pow(au / MAX_AU, exp) * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ─── Gravity Wells ───
      if (s.showGrav && frameRef.current % 3 === 0) {
        renderGravField(gravCtx, bodies, exp, w, h, sunX, sunY);
      }
      if (s.showGrav) {
        ctx.globalAlpha = 0.55;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(gravCanvas, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      // ─── Trails ───
      if (s.showTrails) {
        for (let bi = 1; bi < bodies.length; bi++) {
          const b = bodies[bi];
          if (b.trail.length < 2) continue;
          ctx.beginPath();
          for (let t = 0; t < b.trail.length; t++) {
            const [tx, ty] = w2s(b.trail[t].x, b.trail[t].y, exp, cx, cy, scale, sunX, sunY);
            if (t === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
          }
          const alpha = 0.5;
          ctx.strokeStyle = b.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
          ctx.lineWidth = 1;
          ctx.stroke();

          // Fading portion
          if (b.trail.length > 10) {
            ctx.beginPath();
            const startIdx = Math.max(0, b.trail.length - 80);
            for (let t = startIdx; t < b.trail.length; t++) {
              const [tx, ty] = w2s(b.trail[t].x, b.trail[t].y, exp, cx, cy, scale, sunX, sunY);
              if (t === startIdx) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
            }
            ctx.strokeStyle = b.color + "cc";
            ctx.lineWidth = 1.8;
            ctx.stroke();
          }
        }
      }

      // ─── Planets ───
      const sel = selRef.current;
      const sizeBase = s.sizeMult;

      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        const [bx, by] = w2s(b.x, b.y, exp, cx, cy, scale, sunX, sunY);

        if (b.isSun) {
          // Sun glow
          const sunR = b.displayRadius * (1 + sizeBase * 0.5) * Math.sqrt(s.sunMass);
          const grad = ctx.createRadialGradient(bx, by, 0, bx, by, sunR * 4);
          grad.addColorStop(0, "rgba(253,184,19,0.4)");
          grad.addColorStop(0.3, "rgba(253,150,19,0.15)");
          grad.addColorStop(1, "rgba(253,184,19,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(bx, by, sunR * 4, 0, Math.PI * 2);
          ctx.fill();

          // Sun body
          const sunGrad = ctx.createRadialGradient(bx - sunR * 0.2, by - sunR * 0.2, 0, bx, by, sunR);
          sunGrad.addColorStop(0, "#FFF8E0");
          sunGrad.addColorStop(0.5, "#FDB813");
          sunGrad.addColorStop(1, "#E8960A");
          ctx.fillStyle = sunGrad;
          ctx.beginPath();
          ctx.arc(bx, by, sunR, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const r = Math.max(2, b.displayRadius * (0.5 + sizeBase * 0.5));

          // Planet glow if selected
          if (sel === i) {
            ctx.strokeStyle = b.color + "80";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(bx, by, r + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = b.color + "30";
            ctx.beginPath();
            ctx.arc(bx, by, r + 12, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Planet body
          const pGrad = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.3, 0, bx, by, r);
          pGrad.addColorStop(0, lightenColor(b.color, 40));
          pGrad.addColorStop(1, b.color);
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();

          // Saturn rings
          if (b.name === "Saturn") {
            ctx.strokeStyle = b.color + "60";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(bx, by, r * 1.8, r * 0.5, -0.3, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Label
          ctx.fillStyle = "#8888a0";
          ctx.font = "10px 'DM Sans', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(b.name, bx, by + r + 14);
        }
      }

      // ─── HUD ───
      ctx.fillStyle = "#5a5a70";
      ctx.font = "11px 'Source Code Pro', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${simTimeRef.current.toFixed(1)} yr`, 16, h - 16);

      if (!s.paused) {
        ctx.fillStyle = "#3a6a3a";
        ctx.fillText("▶ RUNNING", 16, 24);
      } else {
        ctx.fillStyle = "#8a6a3a";
        ctx.fillText("⏸ PAUSED", 16, 24);
      }

      ctx.restore();
      frameRef.current++;
      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ─── Click to Select ────────────────────────────────────────────
  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width, h = rect.height;
    const cx = w / 2, cy = h / 2;
    const scale = Math.min(w, h) * 0.45;
    const s = sRef.current;
    const bodies = bodiesRef.current;
    const sunX = bodies[0].x, sunY = bodies[0].y;
    let closest = null, closestD = 25;
    for (let i = 0; i < bodies.length; i++) {
      const [bx, by] = w2s(bodies[i].x, bodies[i].y, s.distExp, cx, cy, scale, sunX, sunY);
      const d = Math.sqrt((mx - bx) ** 2 + (my - by) ** 2);
      if (d < closestD) { closestD = d; closest = i; }
    }
    setSelected(closest);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(5, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 2 || e.buttons === 2) return;
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panX,
      panY: panY
    };
  }, [panX, panY]);

  // ─── Setup event listeners ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelNative = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.5, Math.min(5, z * delta)));
    };

    const handleMouseDownNative = (e) => {
      if (e.button === 2) return;
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panX,
        panY: panY
      };
    };

    const handleMouseMoveNative = (e) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanX(panStartRef.current.panX + dx);
      setPanY(panStartRef.current.panY + dy);
    };

    const handleMouseUpNative = () => {
      isPanningRef.current = false;
    };

    canvas.addEventListener('wheel', handleWheelNative, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDownNative);
    window.addEventListener('mousemove', handleMouseMoveNative);
    window.addEventListener('mouseup', handleMouseUpNative);

    return () => {
      canvas.removeEventListener('wheel', handleWheelNative);
      canvas.removeEventListener('mousedown', handleMouseDownNative);
      window.removeEventListener('mousemove', handleMouseMoveNative);
      window.removeEventListener('mouseup', handleMouseUpNative);
    };
  }, [panX, panY]);

  // ─── Selected Planet Info ───────────────────────────────────────
  const selBody = selected !== null ? bodiesRef.current[selected] : null;
  const selInfo = selBody ? (() => {
    const dx = selBody.x - bodiesRef.current[0].x;
    const dy = selBody.y - bodiesRef.current[0].y;
    const distAU = Math.sqrt(dx * dx + dy * dy);
    const vel = Math.sqrt(selBody.vx ** 2 + selBody.vy ** 2);
    const velKmS = vel * 149597870.7 / (365.25 * 24 * 3600);
    const earthMasses = selBody.mass / 3.003e-6;
    const facts = PLANET_FACTS[selBody.name];
    return { name: selBody.name, distAU, velKmS, earthMasses, color: selBody.color, facts };
  })() : null;

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "#06060d", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Canvas */}
      <div style={{ position: "absolute", inset: 0 }}>
        <canvas ref={canvasRef} onClick={handleClick} style={{ display: "block", width: "100%", height: "100%", cursor: panelOpen ? "crosshair" : "grab" }} />
      </div>

      {/* Title */}
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none", zIndex: 10 }}>
        <div style={{ fontFamily: "'Oxanium', sans-serif", fontWeight: 700, fontSize: 16, color: "#888898", letterSpacing: "0.15em", textTransform: "uppercase" }}>
          N-Body Solar System
        </div>
        <div style={{ fontSize: 10, color: "#4a4a5a", marginTop: 2, fontFamily: "'Source Code Pro', monospace" }}>
          SPACE pause · R reset · G gravity · click to inspect
        </div>
      </div>

      {/* Toggle Panel Button */}
      <button
        onClick={() => setPanelOpen(p => !p)}
        style={{
          position: "absolute", top: 12, right: panelOpen ? 274 : 12, zIndex: 20,
          background: "rgba(20,20,30,0.7)", border: "1px solid rgba(80,80,100,0.3)",
          color: "#8a8a9a", borderRadius: 6, padding: "6px 10px", cursor: "pointer",
          fontSize: 12, fontFamily: "'DM Sans', sans-serif", backdropFilter: "blur(8px)",
          transition: "right 0.3s ease"
        }}
      >
        {panelOpen ? "▸ Hide" : "◂ Controls"}
      </button>

      {/* Control Panel */}
      <div style={{
        position: "absolute", top: 0, right: panelOpen ? 0 : -280, width: 268, height: "100%",
        background: "rgba(10,10,18,0.88)", backdropFilter: "blur(16px)",
        borderLeft: "1px solid rgba(60,60,80,0.3)", padding: "48px 16px 16px",
        overflowY: "auto", zIndex: 15, transition: "right 0.3s ease",
        boxSizing: "border-box"
      }}>
        {/* Section: Simulation */}
        <SectionLabel>Simulation</SectionLabel>
        <Slider label="Speed" value={speed} min={0.05} max={2000} log onChange={setSpeed}
          format={v => v < 1 ? v.toFixed(2) + "×" : v < 100 ? Math.round(v) + "×" : Math.round(v) + "×"} />

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <SmallBtn active={paused} onClick={() => setPaused(p => !p)}>{paused ? "▶ Play" : "⏸ Pause"}</SmallBtn>
          <SmallBtn onClick={handleReset}>↺ Reset</SmallBtn>
        </div>

        {/* Section: Chaos Controls */}
        <SectionLabel>Chaos Controls</SectionLabel>
        <Slider label="☀ Sun Mass" value={sunMass} min={0.1} max={10} log onChange={setSunMass}
          format={v => v.toFixed(2) + "×"} />
        <Slider label="♃ Jupiter Mass" value={jupMass} min={0.1} max={200} log onChange={setJupMass}
          format={v => v < 10 ? v.toFixed(1) + "×" : Math.round(v) + "×"} />

        {/* Section: View */}
        <SectionLabel>View</SectionLabel>
        <Slider label="Distance Warp" value={distExp} min={0.2} max={1} step={0.01} onChange={setDistExp}
          format={v => v >= 0.95 ? "Linear" : v <= 0.25 ? "Max Log" : (v * 100).toFixed(0) + "%"} />
        <Slider label="Planet Scale" value={sizeMult} min={0.3} max={4} step={0.1} onChange={setSizeMult}
          format={v => v.toFixed(1) + "×"} />

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <SmallBtn active={showGrav} onClick={() => setShowGrav(g => !g)}>◎ Gravity</SmallBtn>
          <SmallBtn active={showTrails} onClick={() => setShowTrails(t => !t)}>〰 Trails</SmallBtn>
        </div>

        {/* Legend */}
        <SectionLabel>Planets</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {INIT_DATA.filter(d => !d.isSun).map((d, i) => (
            <div key={d.name}
              onClick={() => setSelected(i + 1)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4,
                cursor: "pointer", background: selected === i + 1 ? "rgba(60,60,80,0.3)" : "transparent",
                transition: "background 0.15s"
              }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#8a8a9a", fontFamily: "'DM Sans', sans-serif" }}>{d.name}</span>
              <span style={{ fontSize: 9, color: "#50505a", marginLeft: "auto", fontFamily: "'Source Code Pro', monospace" }}>{d.dist?.toFixed(1) ?? "0"} AU</span>
            </div>
          ))}
        </div>

        {/* Physics info */}
        <div style={{ marginTop: 20, padding: "10px 0", borderTop: "1px solid rgba(60,60,80,0.3)" }}>
          <div style={{ fontSize: 9, color: "#3a3a4a", fontFamily: "'Source Code Pro', monospace", lineHeight: 1.6 }}>
            Velocity-Verlet N-body<br />
            dt = {BASE_DT} yr/step<br />
            Elapsed: {simYears.toFixed(1)} years<br />
            G = 4π² AU³/(M☉·yr²)
          </div>
        </div>
      </div>

      {/* Left Panel: Planet Details */}
      {selInfo && selInfo.facts && (
        <div style={{
          position: "absolute", top: 16, left: 16, width: 280, maxHeight: "calc(100vh - 32px)",
          background: "rgba(10,10,18,0.88)", backdropFilter: "blur(16px)",
          borderRight: "1px solid rgba(60,60,80,0.3)", borderRadius: 8, padding: 16,
          overflowY: "auto", zIndex: 15, boxSizing: "border-box"
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: selInfo.color, boxShadow: `0 0 8px ${selInfo.color}60` }} />
            <span style={{ fontFamily: "'Oxanium', sans-serif", fontWeight: 700, color: "#d0d0e0", fontSize: 15 }}>{selInfo.name}</span>
            <span style={{ fontSize: 9, color: "#6a6a7a", marginLeft: "auto", fontFamily: "'Source Code Pro', monospace" }}>{selInfo.facts.type}</span>
          </div>

          {/* Live sim data */}
          <div style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: "#7a7a8a", lineHeight: 1.7, marginBottom: 10, padding: "6px 8px", background: "rgba(20,20,35,0.5)", borderRadius: 5 }}>
            <div>Sim Distance <span style={{ color: "#b0b0c0", float: "right" }}>{selInfo.distAU.toFixed(3)} AU</span></div>
            <div>Sim Velocity <span style={{ color: "#b0b0c0", float: "right" }}>{selInfo.velKmS.toFixed(1)} km/s</span></div>
            <div>Sim Mass <span style={{ color: "#b0b0c0", float: "right" }}>{selInfo.earthMasses < 0.01 ? selInfo.earthMasses.toExponential(2) : selInfo.earthMasses.toFixed(2)} M⊕</span></div>
          </div>

          {/* Fact rows */}
          <InfoRow label="🌡 Temperature" value={selInfo.facts.temperature} color={selInfo.color} />
          <InfoRow label="📏 Distance from Earth" value={selInfo.facts.distFromEarthKm} color={selInfo.color} />
          <InfoRow label="🚀 Travel time" value={selInfo.facts.travelTime} color={selInfo.color} />
          <InfoRow label="🔄 Year length" value={selInfo.facts.orbitalPeriod} color={selInfo.color} />
          <InfoRow label="🌅 Day length" value={selInfo.facts.dayLength} color={selInfo.color} />
          <InfoRow label="⚖️ Mass" value={selInfo.facts.earthMasses !== 1 ? `${selInfo.facts.earthMasses} × Earth` : "1 Earth (that's us)"} color={selInfo.color} />
          <InfoRow label="🧪 Made of" value={selInfo.facts.composition} color={selInfo.color} />
          {selInfo.facts.moons !== null && (
            <InfoRow label="🌙 Moons" value={selInfo.facts.moons === 0 ? "None" : `${selInfo.facts.moons} — ${selInfo.facts.moonNames}`} color={selInfo.color} />
          )}
          {selInfo.facts.rings && (
            <InfoRow label="💍 Rings" value={selInfo.facts.ringDesc || "Yes"} color={selInfo.color} />
          )}
          <InfoRow label="🧍 Stand on it?" value={selInfo.facts.canStand} color={selInfo.color} />
          {selInfo.facts.windSpeed && (
            <InfoRow label="💨 Wind" value={selInfo.facts.windSpeed} color={selInfo.color} />
          )}

          {/* Your weight calculator */}
          {selInfo.facts.surfaceGravity && (
            <div style={{ marginTop: 10, padding: "8px", background: "rgba(200,168,78,0.06)", borderRadius: 5, border: "1px solid rgba(200,168,78,0.15)" }}>
              <div style={{ fontSize: 10, color: "#9a9070", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, marginBottom: 5 }}>⚖️ What would you weigh here?</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  value={yourWeight}
                  onChange={e => setYourWeight(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{
                    width: 48, background: "rgba(20,20,35,0.8)", border: "1px solid rgba(80,80,100,0.3)",
                    borderRadius: 4, color: "#d0d0e0", padding: "3px 6px", fontSize: 11,
                    fontFamily: "'Source Code Pro', monospace", outline: "none", textAlign: "right"
                  }}
                />
                <span style={{ fontSize: 10, color: "#6a6a7a" }}>kg on Earth →</span>
                <span style={{ fontSize: 12, color: "#C8A84E", fontFamily: "'Source Code Pro', monospace", fontWeight: 600 }}>
                  {(yourWeight * selInfo.facts.surfaceGravity).toFixed(1)} kg
                </span>
              </div>
              <div style={{ fontSize: 9, color: "#5a5a6a", marginTop: 3 }}>
                Gravity: {selInfo.facts.surfaceGravity}× Earth
              </div>
            </div>
          )}

          {/* Fun fact */}
          <div style={{ marginTop: 10, padding: "8px", background: "rgba(75,95,232,0.06)", borderRadius: 5, border: "1px solid rgba(75,95,232,0.12)" }}>
            <div style={{ fontSize: 10, color: "#7080b0", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, marginBottom: 3 }}>💡 Did you know?</div>
            <div style={{ fontSize: 11, color: "#9098b8", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}>
              {selInfo.facts.funFact}
            </div>
          </div>
        </div>
      )}

      {/* Global slider styles */}
      <style>{`
        input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: rgba(60,60,80,0.5);
          border-radius: 2px;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #C8A84E;
          cursor: pointer;
          border: 2px solid #1a1a2a;
          box-shadow: 0 0 6px rgba(200,168,78,0.3);
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #C8A84E;
          cursor: pointer;
          border: 2px solid #1a1a2a;
        }
        input[type="range"]::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 2px;
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(80,80,100,0.3); border-radius: 2px; }
      `}</style>
    </div>
  );
}

// ─── Small UI Components ──────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, color: "#5a5a6a", fontFamily: "'Oxanium', sans-serif", fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10, marginTop: 8
    }}>
      {children}
    </div>
  );
}

function SmallBtn({ children, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "rgba(200,168,78,0.15)" : "rgba(40,40,55,0.5)",
      border: active ? "1px solid rgba(200,168,78,0.3)" : "1px solid rgba(60,60,80,0.4)",
      color: active ? "#C8A84E" : "#7a7a8a", borderRadius: 6, padding: "5px 10px",
      fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
      transition: "all 0.15s"
    }}>
      {children}
    </button>
  );
}

function InfoRow({ label, value, color }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ fontSize: 9, color: "#5a5a6a", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, marginBottom: 1, letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#a0a0b8", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}

// ─── Utility ──────────────────────────────────────────────────────
function lightenColor(hex, amount) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}
