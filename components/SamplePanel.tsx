'use client'

import Image from 'next/image'
import type { DirtSample } from '@/lib/samples'

type Props = {
  sample: DirtSample | null
  onClose: () => void
  mode: 'adventure' | 'standard'
}

export default function SamplePanel({ sample, onClose, mode }: Props) {
  if (!sample) return null

  const isAdventure = mode === 'adventure'

  return (
    <div
      className={`fixed inset-y-0 right-0 w-80 p-4 overflow-y-auto z-50 ${
        isAdventure
          ? 'bg-[#0a0a1a] border-l-2 border-[#5a9a20] text-white'
          : 'bg-white border-l border-gray-200 text-gray-900'
      }`}
      style={isAdventure ? { fontFamily: '"Press Start 2P", monospace' } : {}}
    >
      <button
        onClick={onClose}
        className={`mb-4 text-xs ${isAdventure ? 'text-[#df1b12]' : 'text-gray-500'}`}
      >
        {isAdventure ? '◄ CLOSE' : '← Close'}
      </button>

      {sample.photoUrl && (
        <div className="relative w-full aspect-square mb-4">
          <Image src={sample.photoUrl} alt={sample.name} fill className="object-cover" />
        </div>
      )}

      <div className={`space-y-2 text-xs ${isAdventure ? 'leading-6' : 'leading-5 font-sans text-sm'}`}>
        <p className={isAdventure ? 'text-[#5a9a20]' : 'font-semibold text-lg'}>{sample.name}</p>
        <p>{sample.location}</p>
        <p>{sample.city}{sample.state ? `, ${sample.state}` : ''} — {sample.country}</p>
        <p className={isAdventure ? 'text-[#df1b12]' : 'text-gray-500'}>{sample.continent}</p>
        <hr className={isAdventure ? 'border-[#5a9a20]' : 'border-gray-200'} />
        <p>Collected: {sample.dateCollected}</p>
        <p>By: {sample.collectedBy}</p>
        <p>Container: {sample.containerType}</p>
        <p>Condition: {sample.condition}</p>
        <hr className={isAdventure ? 'border-[#5a9a20]' : 'border-gray-200'} />
        <p>{sample.notes}</p>
        {sample.verified && (
          <p className={isAdventure ? 'text-[#5a9a20]' : 'text-green-600'}>
            {isAdventure ? '★ VERIFIED' : '✓ Verified'}
          </p>
        )}
      </div>
    </div>
  )
}
