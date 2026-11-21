import type { Metadata } from 'next'
import SolarSystem from '@/components/solar-system/SolarSystem'
import { getScenario } from '@/lib/sim/scenarios.js'

const SITE_NAME = 'Solar System Explorer'
const DEFAULT_DESCRIPTION =
  'An interactive N-body simulation of the solar system, starting from the real positions of the planets today. Crank up the Sun or Jupiter, send a star through, or delete the Sun, then rewind it.'

// Query params that change what the preview image shows.
const PREVIEW_PARAMS = ['s', 'd', 'seed', 'belts', 'sun', 'jup', 'warp']

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Per-link title, description and preview image, so shared links describe what they show. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const pick = new URLSearchParams()
  for (const key of PREVIEW_PARAMS) {
    const v = params[key]
    if (typeof v === 'string') pick.set(key, v)
  }
  const scenario = typeof params.s === 'string' && params.s !== 'today' ? getScenario(params.s) : null
  const title = scenario ? `${scenario.name} · ${SITE_NAME}` : SITE_NAME
  const description = scenario ? scenario.blurb : DEFAULT_DESCRIPTION
  const image = { url: `/api/og${pick.size ? `?${pick}` : ''}`, width: 1200, height: 630, alt: scenario ? scenario.name : SITE_NAME }

  return {
    title,
    description,
    openGraph: { title, description, siteName: SITE_NAME, type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  }
}

export default function Home() {
  return (
    <main>
      <SolarSystem />
    </main>
  )
}
