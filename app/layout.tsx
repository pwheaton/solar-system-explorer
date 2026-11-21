import type { Metadata, Viewport } from 'next'
import { DM_Sans, Oxanium, Source_Code_Pro } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' })
const sourceCode = Source_Code_Pro({ subsets: ['latin'], variable: '--font-code' })
const oxanium = Oxanium({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-display' })

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
  themeColor: '#06060d',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${sourceCode.variable} ${oxanium.variable}`}>
      <body className="antialiased" style={{ margin: 0, background: '#06060d' }}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
