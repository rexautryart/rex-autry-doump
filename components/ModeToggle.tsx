'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function ModeToggle() {
  const path = usePathname()
  const isAdventure = path.startsWith('/adventure')

  return (
    <div className="flex gap-2 text-xs" style={{ fontFamily: '"Press Start 2P", monospace' }}>
      <Link
        href="/adventure"
        className={`px-3 py-2 border-2 transition-colors ${
          isAdventure
            ? 'bg-[#5a9a20] border-[#5a9a20] text-black'
            : 'bg-transparent border-[#5a9a20] text-[#5a9a20] hover:bg-[#5a9a20] hover:text-black'
        }`}
      >
        ADVENTURE
      </Link>
      <Link
        href="/standard"
        className={`px-3 py-2 border-2 transition-colors ${
          !isAdventure
            ? 'bg-white border-white text-black'
            : 'bg-transparent border-white text-white hover:bg-white hover:text-black'
        }`}
      >
        STANDARD
      </Link>
    </div>
  )
}
