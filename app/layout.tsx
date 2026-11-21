import type { Metadata, Viewport } from 'next'
import { Fraunces, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const fraunces = Fraunces({ subsets: ['latin'], axes: ['SOFT', 'opsz'], style: ['normal', 'italic'], variable: '--font-fraunces' })
const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' })

export const metadata: Metadata = {
  title: 'Solar System Explorer',
  description:
    'An interactive N-body simulation of the solar system, starting from the real positions of the planets today. Crank up the Sun or Jupiter and watch the asteroid belt fall apart.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#070a12',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body className="antialiased" style={{ margin: 0, background: '#070a12' }}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
