import type { Metadata, Viewport } from 'next'
import { Fira_Mono, Fira_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const firaSans = Fira_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-fira-sans',
})
const firaMono = Fira_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-fira-mono' })

// Absolute base for preview-image URLs: the production domain in production,
// the deployment's own URL elsewhere.
const siteUrl =
  process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Solar System Explorer',
  description:
    'An interactive N-body simulation of the solar system, starting from the real positions of the planets today. Crank up the Sun or Jupiter and watch the asteroid belt fall apart.',
}

export const viewport: Viewport = {
  themeColor: '#070a12',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaMono.variable}`}>
      <body>
        {children}
        {/* Vercel Analytics only exists on Vercel; elsewhere (CI, local builds) its script 404s. */}
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
