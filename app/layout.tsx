import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'D.O.U.M.P. — Dirt Of Universal Mysterious Provenance',
  description: 'A multigenerational dirt sample collection. Museum archive view.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
