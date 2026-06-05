import Link from 'next/link'

export default function Home() {
  return (
    <main className="relative min-h-screen bg-black flex flex-col items-center justify-center overflow-hidden px-4">
      {/* CRT scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-10"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
        }}
      />

      <div className="relative z-20 flex flex-col items-center gap-8 text-center">
        {/* Title */}
        <h1
          className="text-4xl md:text-6xl tracking-widest"
          style={{
            fontFamily: '"Press Start 2P", monospace',
            color: '#df1b12',
            textShadow: '0 0 20px rgba(223,27,18,0.6)',
          }}
        >
          D.O.U.M.P.
        </h1>

        <p
          className="text-xs md:text-sm text-white tracking-wider max-w-sm leading-6"
          style={{ fontFamily: '"Press Start 2P", monospace' }}
        >
          DIRT OF UNIVERSAL MYSTERIOUS PROVENANCE
        </p>

        {/* Mode buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
          <Link
            href="/adventure"
            className="px-6 py-4 text-xs text-black border-4 transition-all hover:brightness-110 active:scale-95"
            style={{
              fontFamily: '"Press Start 2P", monospace',
              backgroundColor: '#5a9a20',
              borderColor: '#3d6b15',
              boxShadow: '4px 4px 0 #3d6b15',
            }}
          >
            ▶ ADVENTURE MODE
          </Link>

          <Link
            href="/standard"
            className="px-6 py-4 text-xs text-white border-4 border-white transition-all hover:bg-white hover:text-black active:scale-95"
            style={{
              fontFamily: '"Press Start 2P", monospace',
              boxShadow: '4px 4px 0 rgba(255,255,255,0.3)',
            }}
          >
            ◈ STANDARD MODE
          </Link>
        </div>

        {/* Subtitle */}
        <p
          className="text-[10px] text-gray-400 mt-4"
          style={{ fontFamily: '"Press Start 2P", monospace' }}
        >
          A multigenerational dirt sample collection
        </p>
      </div>
    </main>
  )
}
