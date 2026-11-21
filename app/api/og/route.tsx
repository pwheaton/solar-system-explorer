// Link-preview image: runs the shared scenario forward on the server with the
// real physics and draws the result, so a shared link previews what it shows.
// GET /api/og?s=flyby&d=2026-11-21&seed=42&belts=ak

import { ImageResponse } from 'next/og'
import { getScenario, runScenario } from '@/lib/sim/scenarios.js'
import { buildScene } from '@/lib/sim/scene.js'
import { readUrlState } from '@/lib/url-state.js'

const W = 1200
const H = 630

const STAR_FILL: Record<string, [string, string, string]> = {
  sun: ['#FFF8E0', '#FDB813', 'rgba(253,184,19,0.35)'],
  red: ['#FFE6C8', '#FF8A3C', 'rgba(255,120,60,0.4)'],
  white: ['#FFFFFF', '#CFE0FF', 'rgba(170,200,255,0.4)'],
}

// Google Fonts serves a TrueType subset when asked for just the glyphs we use.
async function loadFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}&text=${encodeURIComponent(text)}`
    const css = await (await fetch(url)).text()
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)
    if (!src) return null
    const res = await fetch(src[1])
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

// Deterministic starfield.
function stars(count: number) {
  let seed = 98765
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  return Array.from({ length: count }, () => ({ x: rnd() * W, y: rnd() * H, r: rnd() > 0.95 ? 1.2 : 0.7, o: 0.15 + rnd() * 0.4 }))
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const state = readUrlState(url.search)
  const scenario = getScenario(state.scenario || 'today')
  const date = state.date ?? new Date()
  const belts = state.overrides.belts ?? { asteroids: true, kuiper: true }

  const { sys, sunMass, jupMass } = runScenario(scenario.id, {
    date,
    seed: state.seed ?? 1,
    belts,
    beltCount: 600,
    sunMass: state.overrides.sunMass ?? 1,
    jupMass: state.overrides.jupMass ?? 1,
  })
  const scene = buildScene(sys, {
    width: W, height: H, centerX: 800,
    zoom: (scenario.settings?.zoom ?? 1) * 1.1,
    distExp: state.overrides.distExp ?? 0.42,
    sunMass, jupMass,
  })

  const shownDate = new Date(date.getTime() + sys.t * 365.25 * 86400000)
  const dateText = shownDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const title = scenario.id === 'today' ? "Today's solar system" : scenario.name
  const blurb = scenario.blurb
  const meta = scenario.id === 'today' ? `${dateText} · real planet positions` : `${dateText} · year ${sys.t.toFixed(0)} of the simulation`

  const sans = `Solar System Explorer${title}${blurb}${scene.bodies.map((b) => b.name).join('')}`
  const [regular, semibold, mono] = await Promise.all([
    loadFont('Fira Sans', 400, sans),
    loadFont('Fira Sans', 600, sans),
    loadFont('Fira Mono', 400, `SOLAR SYSTEM EXPLORER N-BODY GRAVITY SIMULATOR${meta}`),
  ])
  const fonts = [
    regular && { name: 'Fira Sans', data: regular, weight: 400 as const, style: 'normal' as const },
    semibold && { name: 'Fira Sans', data: semibold, weight: 600 as const, style: 'normal' as const },
    mono && { name: 'Fira Mono', data: mono, weight: 400 as const, style: 'normal' as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 600; style: 'normal' }[]

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: 'flex', position: 'relative', background: '#070a12', fontFamily: 'Fira Sans' }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          <defs>
            {Object.entries(STAR_FILL).map(([k, [c0, c1, glow]]) => (
              <radialGradient key={k} id={`star-${k}`}>
                <stop offset="0%" stopColor={c0} />
                <stop offset="22%" stopColor={c1} />
                <stop offset="30%" stopColor={glow} />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            ))}
          </defs>
          {stars(260).map((s, i) => <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill={`rgba(210,220,255,${s.o})`} />)}
          {scene.rings.map((r) => <circle key={`g${r.au}`} cx={r.cx} cy={r.cy} r={r.r} fill="none" stroke="rgba(148,163,196,0.12)" strokeWidth={1} />)}
          {scene.orbits.map((o, i) => o.d && <path key={`o${i}`} d={o.d} fill="none" stroke={o.color} strokeOpacity={0.45} strokeWidth={1.4} />)}
          {scene.dots.map((d, i) => <circle key={`d${i}`} cx={d.x} cy={d.y} r={1.1} fill={d.color} />)}
          {scene.trails.map((t, i) => t.d && <path key={`t${i}`} d={t.d} fill="none" stroke={t.color} strokeOpacity={0.7} strokeWidth={1.6} />)}
          {scene.bodies.map((b) => {
            if (!b.onScreen) return null
            if (b.removed) return <circle key={b.name} cx={b.x} cy={b.y} r={12} fill="none" stroke="rgba(253,184,19,0.4)" strokeDasharray="3 4" />
            if (b.star) return <circle key={b.name} cx={b.x} cy={b.y} r={b.r * 4.5} fill={`url(#star-${b.star})`} />
            return (
              <g key={b.name}>
                {b.rings && <ellipse cx={b.x} cy={b.y} rx={b.r * 1.9} ry={b.r * 0.55} fill="none" stroke={b.color} strokeOpacity={0.6} strokeWidth={1.6} transform={`rotate(-17 ${b.x} ${b.y})`} />}
                <circle cx={b.x} cy={b.y} r={b.r} fill={b.color} />
              </g>
            )
          })}
        </svg>

        {/* Fade the left side so the text reads over the starfield. */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 760, height: H, display: 'flex', background: 'linear-gradient(90deg, rgba(7,10,18,0.97) 45%, rgba(7,10,18,0))' }} />

        {/* Labels for planets that are on screen */}
        {scene.bodies.filter((b) => {
          // Only label bodies with room around them (the inner planets crowd together).
          const sun = scene.bodies[0]
          return b.onScreen && !b.removed && !b.dwarf && !b.star && b.x > 560 && Math.hypot(b.x - sun.x, b.y - sun.y) > 95
        }).map((b) => (
          <div key={`l${b.name}`} style={{ position: 'absolute', left: b.x - 60, top: b.y + b.r + 4, width: 120, display: 'flex', justifyContent: 'center', fontSize: 15, color: 'rgba(235,230,216,0.7)' }}>
            {b.name}
          </div>
        ))}

        <div style={{ position: 'absolute', left: 64, top: 64, bottom: 64, width: 520, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 30, color: '#ebe6d8', fontWeight: 600 }}>
              Solar System <span style={{ color: '#f2b441', marginLeft: 10 }}>Explorer</span>
            </div>
            <div style={{ display: 'flex', marginTop: 8, fontFamily: 'Fira Mono', fontSize: 15, letterSpacing: 2, color: '#5d6479' }}>
              N-BODY GRAVITY SIMULATOR
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 58, lineHeight: 1.05, fontWeight: 600, color: '#ebe6d8' }}>{title}</div>
            <div style={{ display: 'flex', marginTop: 18, fontSize: 24, lineHeight: 1.4, color: '#9097ab' }}>{blurb}</div>
            <div style={{ display: 'flex', marginTop: 22, fontFamily: 'Fira Mono', fontSize: 17, color: '#8fd0ea' }}>{meta}</div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: fonts.length ? fonts : undefined,
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
    },
  )
}
