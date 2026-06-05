'use client'

import type { DirtSample } from '@/lib/samples'

type Props = {
  samples: DirtSample[]
  onSelect: (sample: DirtSample) => void
}

export default function StandardMap({ samples, onSelect }: Props) {
  return (
    <div className="relative w-full aspect-[16/9] bg-[#f5f0e8] border border-gray-300">
      <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm font-sans">
        Standard Map — {samples.length} samples
      </div>
      {samples.map(sample => {
        const left = `${((sample.coordinates[0] + 180) / 360) * 100}%`
        const top = `${((90 - sample.coordinates[1]) / 180) * 100}%`
        return (
          <button
            key={sample.id}
            onClick={() => onSelect(sample)}
            style={{ left, top }}
            className="absolute w-3 h-3 rounded-full bg-[#df1b12] border-2 border-white -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform"
            title={sample.name}
          />
        )
      })}
    </div>
  )
}
