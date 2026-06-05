'use client'

import { useRef, useEffect } from 'react'
import type { DirtSample } from '@/lib/samples'

type Props = {
  samples: DirtSample[]
  onSelect: (sample: DirtSample) => void
}

export default function AdventureMap({ samples, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#0a0a1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#5a9a20'
    ctx.font = '8px "Press Start 2P", monospace'
    ctx.fillText('MAP LOADING...', 20, 40)

    samples.forEach(sample => {
      const x = ((sample.coordinates[0] + 180) / 360) * canvas.width
      const y = ((90 - sample.coordinates[1]) / 180) * canvas.height
      ctx.fillStyle = '#df1b12'
      ctx.fillRect(x - 4, y - 4, 8, 8)
    })
  }, [samples])

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={450}
      className="w-full border-2 border-[#5a9a20] cursor-crosshair"
      onClick={e => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const cx = (e.clientX - rect.left) * scaleX
        const cy = (e.clientY - rect.top) * scaleY
        const hit = samples.find(s => {
          const sx = ((s.coordinates[0] + 180) / 360) * canvas.width
          const sy = ((90 - s.coordinates[1]) / 180) * canvas.height
          return Math.abs(cx - sx) < 12 && Math.abs(cy - sy) < 12
        })
        if (hit) onSelect(hit)
      }}
    />
  )
}
