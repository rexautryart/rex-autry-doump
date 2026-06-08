'use client'

import Image from 'next/image'
import type { DoumpSample } from '@/lib/types'

interface SamplePanelProps {
  sample: DoumpSample | null
  onClose: () => void
  darkMode?: boolean
}

const FIELD_LABEL = 'text-[10px] tracking-widest uppercase font-medium'

function MetaRow({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  if (!value) return null
  return (
    <div>
      <dt className={`${FIELD_LABEL} ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{label}</dt>
      <dd className={`text-sm mt-0.5 font-["Helvetica_Neue",Arial,sans-serif] ${dark ? 'text-gray-200' : 'text-gray-800'}`}>
        {value}
      </dd>
    </div>
  )
}

export default function SamplePanel({ sample, onClose, darkMode = false }: SamplePanelProps) {
  if (!sample) return null

  const dark = darkMode
  const bg = dark ? '#111111' : '#ffffff'
  const borderColor = dark ? '#ffffff' : '#000000'
  const textColor = dark ? '#e8e8e8' : '#111111'

  return (
    <>
      {/* Desktop: right-side panel */}
      <div
        className="hidden md:flex flex-col h-full w-80 shrink-0 overflow-y-auto"
        style={{
          background: bg,
          borderLeft: `3px solid ${borderColor}`,
          color: textColor,
          fontFamily: '"Helvetica Neue", Arial, sans-serif',
        }}
      >
        <PanelContent sample={sample} onClose={onClose} dark={dark} bg={bg} textColor={textColor} />
      </div>

      {/* Mobile: bottom sheet */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto"
        style={{
          background: bg,
          borderTop: `3px solid ${borderColor}`,
          color: textColor,
          fontFamily: '"Helvetica Neue", Arial, sans-serif',
        }}
      >
        <PanelContent sample={sample} onClose={onClose} dark={dark} bg={bg} textColor={textColor} />
      </div>
    </>
  )
}

function PanelContent({
  sample,
  onClose,
  dark,
  textColor,
}: {
  sample: DoumpSample
  onClose: () => void
  dark: boolean
  bg: string
  textColor: string
}) {
  const dividerColor = dark ? 'border-gray-800' : 'border-gray-100'
  const mutedColor = dark ? 'text-gray-500' : 'text-gray-400'

  return (
    <div className="p-8 flex flex-col gap-5">
      {/* Close */}
      <button
        onClick={onClose}
        className={`self-start text-[10px] tracking-widest uppercase hover:underline ${mutedColor}`}
        style={{ fontFamily: 'monospace' }}
      >
        ← CLOSE
      </button>

      {/* Photo */}
      {sample.photoUrl ? (
        <div className="relative w-full aspect-[4/3] overflow-hidden">
          <Image src={sample.photoUrl} alt={sample.name} fill className="object-cover" />
        </div>
      ) : (
        <div
          className={`w-full aspect-[4/3] flex items-center justify-center text-[10px] tracking-widest ${mutedColor}`}
          style={{
            fontFamily: 'monospace',
            border: `1px solid ${dark ? '#2a2a2a' : '#e5e5e5'}`,
          }}
        >
          NO PHOTO ON FILE
        </div>
      )}

      {/* ID + Name */}
      <div>
        <p
          className={`text-[10px] tracking-widest mb-1 ${mutedColor}`}
          style={{ fontFamily: 'monospace' }}
        >
          {sample.id}
        </p>
        <h2
          className="text-xl font-bold leading-tight"
          style={{ color: textColor, fontFamily: '"Helvetica Neue", Arial, sans-serif' }}
        >
          {sample.name}
        </h2>
      </div>

      <hr className={`border-t ${dividerColor}`} />

      {/* Metadata grid */}
      <dl className="flex flex-col gap-3">
        <MetaRow label="Location" value={[sample.city, sample.state, sample.country].filter(Boolean).join(', ')} dark={dark} />
        <MetaRow label="Continent" value={sample.continent} dark={dark} />
        <MetaRow label="Collected by" value={sample.collectedBy} dark={dark} />
        <MetaRow label="Date" value={sample.dateCollected} dark={dark} />
        <MetaRow label="Container" value={sample.containerType} dark={dark} />
        <MetaRow label="Condition" value={sample.condition} dark={dark} />
        {sample.notes && (
          <div>
            <dt className={`${FIELD_LABEL} ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Notes</dt>
            <dd className={`text-sm mt-0.5 leading-relaxed ${dark ? 'text-gray-200' : 'text-gray-800'}`}>
              {sample.notes}
            </dd>
          </div>
        )}
      </dl>

      {/* Verified badge */}
      {sample.verified && (
        <p className="text-[10px] tracking-widest text-green-600 dark:text-green-400" style={{ fontFamily: 'monospace' }}>
          ✓ VERIFIED
        </p>
      )}

      <hr className={`border-t ${dividerColor}`} />

      {/* Buy button */}
      <a
        href="https://www.rexautry.com/shop"
        target="_blank"
        rel="noopener noreferrer"
        className={`block text-center text-xs tracking-widest uppercase py-3 px-4 transition-opacity hover:opacity-70`}
        style={{
          fontFamily: 'monospace',
          background: dark ? '#ffffff' : '#000000',
          color: dark ? '#000000' : '#ffffff',
        }}
      >
        Bottle Kit Available
      </a>
    </div>
  )
}
