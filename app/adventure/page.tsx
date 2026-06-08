'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'

const AdventureMap = dynamic(() => import('@/components/AdventureMap'), { ssr: false })

export default function AdventurePage() {
  return (
    <div
      className="min-h-screen bg-black flex flex-col overflow-hidden"
      style={{ fontFamily: '"Press Start 2P", monospace' }}
    >
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 24, borderBottom: '1px solid #222' }}
      >
        <Link
          href="/"
          className="text-[8px] hover:opacity-70 transition-opacity"
          style={{ color: '#5a9a20' }}
        >
          D.O.U.M.P.
        </Link>
        <Link
          href="/standard"
          className="text-[8px] hover:opacity-70 transition-opacity"
          style={{ color: '#888888' }}
        >
          STANDARD MODE
        </Link>
      </header>

      {/* Canvas area */}
      <main className="flex-1 flex items-center justify-center p-2">
        <div className="w-full" style={{ maxWidth: 768 }}>
          <AdventureMap />
        </div>
      </main>

      {/* Controls hint */}
      <footer className="shrink-0 pb-1 text-center" style={{ color: '#444', fontSize: 6 }}>
        WASD / ARROWS to move &nbsp;·&nbsp; SPACE to interact
      </footer>
    </div>
  )
}
