'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import SamplePanel from '@/components/SamplePanel'
import type { DoumpSample } from '@/lib/types'
import samplesData from '@/public/doump-samples.json'

const StandardMap = dynamic(() => import('@/components/StandardMap'), { ssr: false })

const samples = samplesData as DoumpSample[]

export default function StandardPage() {
  const [darkMode, setDarkMode] = useState(false)
  const [selectedSample, setSelectedSample] = useState<DoumpSample | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('doump_mode')
    if (stored === 'dark') setDarkMode(true)
  }, [])

  const toggleDark = () => {
    setDarkMode(d => {
      const next = !d
      localStorage.setItem('doump_mode', next ? 'dark' : 'light')
      return next
    })
  }

  const bg = darkMode ? '#0a0a0a' : '#ffffff'
  const fg = darkMode ? '#e8e8e8' : '#111111'
  const borderColor = darkMode ? '#222' : '#e5e5e5'
  const mutedColor = darkMode ? '#555' : '#aaa'

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: bg, color: fg, fontFamily: '"Helvetica Neue", Arial, sans-serif' }}
    >
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-6 shrink-0"
        style={{ height: 48, borderBottom: `1px solid ${borderColor}` }}
      >
        <Link
          href="/"
          className="text-sm font-semibold tracking-[0.2em] uppercase hover:opacity-60 transition-opacity"
          style={{ color: fg, fontVariant: 'small-caps' }}
        >
          D.O.U.M.P.
        </Link>

        <div className="flex items-center gap-5">
          <Link
            href="/adventure"
            className="text-[10px] tracking-widest uppercase hover:opacity-60 transition-opacity hidden sm:block"
            style={{ color: mutedColor }}
          >
            Adventure Mode
          </Link>
          <button
            onClick={toggleDark}
            aria-label="Toggle dark mode"
            className="text-base hover:opacity-60 transition-opacity"
            style={{ color: fg }}
          >
            {darkMode ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* Main: map + panel side by side on desktop */}
      <main className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex-1 overflow-hidden min-w-0 flex items-start">
          <StandardMap
            samples={samples}
            onSelectSample={setSelectedSample}
            darkMode={darkMode}
          />
        </div>

        {/* SamplePanel handles desktop (right column) + mobile (bottom sheet) internally */}
        <SamplePanel
          sample={selectedSample}
          onClose={() => setSelectedSample(null)}
          darkMode={darkMode}
        />
      </main>
    </div>
  )
}
