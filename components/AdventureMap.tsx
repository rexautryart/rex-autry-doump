'use client'

import { useRef, useEffect, useState } from 'react'
import * as topojson from 'topojson-client'
import { geoContains } from 'd3-geo'
import biomesData from '@/public/doump-biomes.json'

const WORLD_W   = 1024
const WORLD_H   = 512
const TILE_SIZE = 8
const TILE_COLS = 128
const TILE_ROWS = 64
const SCREEN_W  = 256
const SCREEN_H  = 224
export const worldScale = 1024 / 13.2

export let tileMap: Uint8Array | null = null
export let collisionMap: Uint8Array | null = null
export let worldOffscreen: OffscreenCanvas | null = null

export function wt(lon: number, lat: number): [number, number] {
  const lam = (lon * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const phi1 = Math.acos(2 / Math.PI)
  const alpha = Math.acos(Math.cos(phi) * Math.cos(lam / 2))
  const sincAlpha = alpha === 0 ? 1 : Math.sin(alpha) / alpha
  const x = 0.5 * (lam * Math.cos(phi1) + (2 * Math.cos(phi) * Math.sin(lam / 2)) / sincAlpha)
  const y = 0.5 * (phi + Math.sin(phi) / sincAlpha)
  return [x, y]
}

export function projectToWorld(lon: number, lat: number): [number, number] {
  const [wx, wy] = wt(lon, lat)
  return [wx * worldScale + 512, -wy * worldScale + 256]
}

function worldPixelToApproxLonLat(wx: number, wy: number): [number, number] {
  const x = (wx - 512) / worldScale
  const y = -(wy - 256) / worldScale
  return [
    Math.max(-180, Math.min(180, (x / 0.818) * (180 / Math.PI))),
    Math.max(-90,  Math.min(90,  y * (180 / Math.PI))),
  ]
}

function getRegionName(lon: number, lat: number): string {
  if (lat > 70 || lat < -60)                                               return 'ARCTIC / ANTARCTICA'
  if (lon >= -168 && lon <= -52  && lat >= 15  && lat <= 72)               return 'NORTH AMERICA'
  if (lon >= -92  && lon <= -77  && lat >= 7   && lat <= 18)               return 'CENTRAL AMERICA'
  if (lon >= -85  && lon <= -59  && lat >= 10  && lat <= 25)               return 'CARIBBEAN'
  if (lon >= -82  && lon <= -34  && lat >= -56 && lat <= 12)               return 'SOUTH AMERICA'
  if (lon >= -10  && lon <= 20   && lat >= 35  && lat <= 71)               return 'WEST EUROPE'
  if (lon >= 20   && lon <= 60   && lat >= 35  && lat <= 70)               return 'EAST EUROPE'
  if (lon >= -18  && lon <= 60   && lat >= 10  && lat <= 40)               return 'MIDDLE EAST & N.AFRICA'
  if (lon >= -18  && lon <= 52   && lat >= -35 && lat <= 10)               return 'SUB-SAHARAN AFRICA'
  if (lon >= 60   && lon <= 95   && lat >= 5   && lat <= 38)               return 'SOUTH ASIA'
  if (lon >= 95   && lon <= 145  && lat >= 18  && lat <= 55)               return 'EAST ASIA'
  if (lon >= 95   && lon <= 145  && lat >= -10 && lat <= 25)               return 'SOUTH EAST ASIA'
  if (lon >= 110  && lon <= 180  && lat >= -50 && lat <= -10)              return 'OCEANIA'
  return 'OPEN OCEAN'
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233
  return x - Math.floor(x)
}

function biomeToTileType(biome: string | undefined): number {
  switch (biome) {
    case 'temperate':     return 1
    case 'forest':
    case 'boreal':        return 2
    case 'desert':        return 3
    case 'tundra':
    case 'arctic':        return 4
    case 'mountain':      return 5
    case 'savanna':       return 6
    case 'tropical':      return 7
    case 'mediterranean': return 8
    default:              return 1
  }
}

function spriteRect(col: number, row: number) {
  return { sx: col * 8, sy: row * 8 }
}

function baseSpriteForType(t: number): { sx: number; sy: number } {
  switch (t) {
    case 1: return spriteRect(0, 0)
    case 2: return spriteRect(0, 1)
    case 3: return spriteRect(0, 2)
    case 4: return spriteRect(0, 3)
    case 0: return spriteRect(0, 4)
    case 5: return spriteRect(0, 6)
    case 6: return spriteRect(0, 7)
    case 7: return spriteRect(0, 8)
    case 8: return spriteRect(0, 9)
    default: return spriteRect(0, 0)
  }
}

function charSprite(
  facing: 'down' | 'up' | 'left' | 'right',
  walkFrame: number,
  onWater: boolean,
): { sx: number; sy: number } {
  if (onWater) {
    if (facing === 'left') return spriteRect(2, 12)
    return spriteRect(walkFrame, 12)
  }
  switch (facing) {
    case 'down':  return spriteRect(walkFrame,     11)
    case 'right': return spriteRect(2 + walkFrame, 11)
    case 'up':    return spriteRect(4 + walkFrame, 11)
    case 'left':  return spriteRect(6 + walkFrame, 11)
  }
}

async function buildWorld(sprites: HTMLImageElement): Promise<void> {
  const topoRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
  const topo = await topoRes.json()
  const biomes = new Map(Object.entries(biomesData as Record<string, string>))
  const countries = topojson.feature(topo, topo.objects.countries as any) as any

  const tm = new Uint8Array(TILE_COLS * TILE_ROWS)
  for (const feature of countries.features) {
    if (!feature.geometry) continue
    const tileType = biomeToTileType(biomes.get(String(feature.id)))
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const lon = (col + 0.5) / TILE_COLS * 360 - 180
        const lat = 90 - (row + 0.5) / TILE_ROWS * 180
        if (geoContains(feature, [lon, lat])) tm[row * TILE_COLS + col] = tileType
      }
    }
  }

  const cm = new Uint8Array(WORLD_W * WORLD_H)
  for (let py = 0; py < WORLD_H; py++) {
    for (let px = 0; px < WORLD_W; px++) {
      cm[py * WORLD_W + px] =
        tm[Math.floor(py / TILE_SIZE) * TILE_COLS + Math.floor(px / TILE_SIZE)] === 0 ? 0 : 1
    }
  }

  const wc = new OffscreenCanvas(WORLD_W, WORLD_H)
  const ctx = wc.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const idx = row * TILE_COLS + col
      const t = tm[idx]
      const b = baseSpriteForType(t)
      ctx.drawImage(sprites, b.sx, b.sy, 8, 8, col * 8, row * 8, 8, 8)
      if (t === 2 || t === 3 || t === 5) {
        const rand = seededRand(idx)
        if (rand < 0.3) {
          const dcol = rand < 0.15 ? 1 : 2
          const drow = t === 2 ? 1 : t === 3 ? 2 : 6
          const d = spriteRect(dcol, drow)
          ctx.drawImage(sprites, d.sx, d.sy, 8, 8, col * 8, row * 8, 8, 8)
        }
      }
    }
  }

  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      if (tm[row * TILE_COLS + col] !== 0) continue
      const N = row > 0             ? tm[(row - 1) * TILE_COLS + col] : 0
      const S = row < TILE_ROWS - 1 ? tm[(row + 1) * TILE_COLS + col] : 0
      const W = col > 0             ? tm[row * TILE_COLS + (col - 1)] : 0
      const E = col < TILE_COLS - 1 ? tm[row * TILE_COLS + (col + 1)] : 0
      const dx = col * 8, dy = row * 8
      if (N > 0) { const s = spriteRect(0, 5); ctx.drawImage(sprites, s.sx, s.sy, 8, 8, dx, dy, 8, 8) }
      if (S > 0) { const s = spriteRect(1, 5); ctx.drawImage(sprites, s.sx, s.sy, 8, 8, dx, dy, 8, 8) }
      if (W > 0) { const s = spriteRect(2, 5); ctx.drawImage(sprites, s.sx, s.sy, 8, 8, dx, dy, 8, 8) }
      if (E > 0) { const s = spriteRect(3, 5); ctx.drawImage(sprites, s.sx, s.sy, 8, 8, dx, dy, 8, 8) }
    }
  }

  tileMap = tm
  collisionMap = cm
  worldOffscreen = wc
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AdventureMap() {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const spritesRef    = useRef<HTMLImageElement | null>(null)
  const worldReadyRef = useRef(false)
  const rafRef        = useRef(0)

  const [zoom, setZoom]               = useState(2)
  const [worldReady, setWorldReady]   = useState(false)
  const [visitedCount, setVisitedCount] = useState(0)
  const [regionName, setRegionName]   = useState('NORTH AMERICA')
  const [dlgOpen, setDlgOpen]         = useState(false)
  const [dlgDisplayed, setDlgDisplayed] = useState('')
  const [dlgDone, setDlgDone]         = useState(false)
  const [dlgContent, setDlgContent]   = useState({ title: '', sub: '', note: '' })

  const dlgStateRef   = useRef({ open: false, done: false, fullText: '', sampleId: '' })
  const dlgIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [startX, startY] = projectToWorld(-95.37, 29.76)
  const charRef = useRef({
    x: startX, y: startY,
    facing: 'down' as 'down' | 'up' | 'left' | 'right',
    walkFrame: 0, frameCount: 0,
  })

  const keysRef       = useRef(new Set<string>())
  const samplesRef    = useRef<{ id: string; wx: number; wy: number }[]>([])
  const sampleDataRef = useRef<Map<string, any>>(new Map())
  const visitedRef    = useRef(new Set<string>())
  const nearSampleRef = useRef<string | null>(null)

  // Handler refs — reassigned each render so they close over latest state
  const handleSpaceRef  = useRef<() => void>(() => {})
  const handleEscapeRef = useRef<() => void>(() => {})

  const openDialogue = (sampleId: string) => {
    const sample = sampleDataRef.current.get(sampleId)
    if (!sample) return
    const title = (sample.title ?? sample.name ?? '').toString().toUpperCase()
    const sub   = [sample.country, sample.year].filter(Boolean).join(', ')
    const note  = (sample.notes ?? sample.description ?? '').toString().slice(0, 80)
    const fullText = [title, sub, note].filter(Boolean).join('\n')

    if (dlgIntervalRef.current) clearInterval(dlgIntervalRef.current)
    dlgStateRef.current = { open: true, done: false, fullText, sampleId }
    setDlgContent({ title, sub, note })
    setDlgDisplayed('')
    setDlgDone(false)
    setDlgOpen(true)

    let i = 0
    dlgIntervalRef.current = setInterval(() => {
      i++
      setDlgDisplayed(fullText.slice(0, i))
      if (i >= fullText.length) {
        clearInterval(dlgIntervalRef.current!)
        dlgIntervalRef.current = null
        dlgStateRef.current.done = true
        setDlgDone(true)
      }
    }, 30)
  }

  const closeDialogue = (markVisited: boolean) => {
    if (dlgIntervalRef.current) { clearInterval(dlgIntervalRef.current); dlgIntervalRef.current = null }
    if (markVisited && dlgStateRef.current.sampleId) {
      const id = dlgStateRef.current.sampleId
      visitedRef.current.add(id)
      setVisitedCount(visitedRef.current.size)
      try { localStorage.setItem('doump_visited', JSON.stringify([...visitedRef.current])) } catch {}
    }
    dlgStateRef.current = { open: false, done: false, fullText: '', sampleId: '' }
    setDlgOpen(false)
    setDlgDisplayed('')
    setDlgDone(false)
  }

  handleSpaceRef.current = () => {
    const { open, done, fullText } = dlgStateRef.current
    if (!open && nearSampleRef.current) {
      openDialogue(nearSampleRef.current)
    } else if (open && !done) {
      if (dlgIntervalRef.current) { clearInterval(dlgIntervalRef.current); dlgIntervalRef.current = null }
      setDlgDisplayed(fullText)
      dlgStateRef.current.done = true
      setDlgDone(true)
    } else if (open && done) {
      closeDialogue(true)
    }
  }

  handleEscapeRef.current = () => {
    if (dlgStateRef.current.open) closeDialogue(false)
  }

  // Load visited from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('doump_visited')
      if (saved) {
        const ids: string[] = JSON.parse(saved)
        visitedRef.current = new Set(ids)
        setVisitedCount(ids.length)
      }
    } catch {}
  }, [])

  // Main game effect
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
    ctx.fillStyle = '#ffffff'
    ctx.font = '8px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('BUILDING MAP...', SCREEN_W / 2, SCREEN_H / 2)
    ctx.textAlign = 'left'

    let cancelled = false

    const loop = () => {
      if (!worldReadyRef.current || !worldOffscreen || !spritesRef.current) return
      const sprites = spritesRef.current
      const tm = tileMap!
      const cm = collisionMap!
      const char = charRef.current
      char.frameCount++

      if (char.frameCount % 30 === 0) {
        const [lon, lat] = worldPixelToApproxLonLat(char.x, char.y)
        setRegionName(getRegionName(lon, lat))
      }

      const tileCol = Math.max(0, Math.min(TILE_COLS - 1, Math.floor(char.x / TILE_SIZE)))
      const tileRow = Math.max(0, Math.min(TILE_ROWS - 1, Math.floor(char.y / TILE_SIZE)))
      const onWater = tm[tileRow * TILE_COLS + tileCol] === 0

      if (!dlgStateRef.current.open) {
        const keys  = keysRef.current
        const up    = keys.has('w') || keys.has('arrowup')
        const down  = keys.has('s') || keys.has('arrowdown')
        const left  = keys.has('a') || keys.has('arrowleft')
        const right = keys.has('d') || keys.has('arrowright')

        let dx = (right ? 1 : 0) - (left ? 1 : 0)
        let dy = (down  ? 1 : 0) - (up   ? 1 : 0)
        if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707 }

        if (dx > 0) char.facing = 'right'
        else if (dx < 0) char.facing = 'left'
        else if (dy > 0) char.facing = 'down'
        else if (dy < 0) char.facing = 'up'

        char.walkFrame = Math.floor(char.frameCount / 8) % 2

        if (dx !== 0 || dy !== 0) {
          const speed = onWater ? 1.0 : 1.5
          const nx = Math.max(0, Math.min(WORLD_W - TILE_SIZE, char.x + dx * speed))
          const ny = Math.max(0, Math.min(WORLD_H - TILE_SIZE, char.y + dy * speed))
          const feetLand = (x: number, y: number) => {
            const fx = Math.max(0, Math.min(WORLD_W - 1, Math.round(x + 4)))
            const fy = Math.max(0, Math.min(WORLD_H - 1, Math.round(y + 6)))
            return cm[fy * WORLD_W + fx] === 1
          }
          if (onWater) {
            char.x = nx; char.y = ny
          } else {
            if (feetLand(nx, ny))        { char.x = nx; char.y = ny }
            else if (feetLand(nx, char.y)) { char.x = nx }
            else if (feetLand(char.x, ny)) { char.y = ny }
          }
        }
      }

      const camX = Math.max(0, Math.min(WORLD_W - SCREEN_W, Math.round(char.x - 128 + 4)))
      const camY = Math.max(0, Math.min(WORLD_H - SCREEN_H, Math.round(char.y - 112 + 4)))

      ctx.imageSmoothingEnabled = false
      ctx.drawImage(worldOffscreen!, camX, camY, SCREEN_W, SCREEN_H, 0, 0, SCREEN_W, SCREEN_H)

      const oceanFrame = Math.floor(Date.now() / 250) % 4
      const tColStart = Math.floor(camX / TILE_SIZE)
      const tColEnd   = Math.ceil((camX + SCREEN_W) / TILE_SIZE)
      const tRowStart = Math.floor(camY / TILE_SIZE)
      const tRowEnd   = Math.ceil((camY + SCREEN_H) / TILE_SIZE)

      for (let r = tRowStart; r < tRowEnd; r++) {
        if (r < 0 || r >= TILE_ROWS) continue
        for (let c = tColStart; c < tColEnd; c++) {
          if (c < 0 || c >= TILE_COLS) continue
          if (tm[r * TILE_COLS + c] !== 0) continue
          const sx = c * 8 - camX
          const sy = r * 8 - camY
          ctx.drawImage(sprites, oceanFrame * 8, 4 * 8, 8, 8, sx, sy, 8, 8)
          const N = r > 0             ? tm[(r - 1) * TILE_COLS + c] : 0
          const S = r < TILE_ROWS - 1 ? tm[(r + 1) * TILE_COLS + c] : 0
          const W = c > 0             ? tm[r * TILE_COLS + (c - 1)] : 0
          const E = c < TILE_COLS - 1 ? tm[r * TILE_COLS + (c + 1)] : 0
          if (N > 0) ctx.drawImage(sprites, 0,  5 * 8, 8, 8, sx, sy, 8, 8)
          if (S > 0) ctx.drawImage(sprites, 8,  5 * 8, 8, 8, sx, sy, 8, 8)
          if (W > 0) ctx.drawImage(sprites, 16, 5 * 8, 8, 8, sx, sy, 8, 8)
          if (E > 0) ctx.drawImage(sprites, 24, 5 * 8, 8, 8, sx, sy, 8, 8)
        }
      }

      const starFrame = Math.floor(Date.now() / 400) % 4
      nearSampleRef.current = null

      for (const sp of samplesRef.current) {
        const sx = sp.wx - camX
        const sy = sp.wy - camY
        if (sx < -8 || sx > SCREEN_W + 8 || sy < -8 || sy > SCREEN_H + 8) continue
        const dist = Math.sqrt((char.x - sp.wx) ** 2 + (char.y - sp.wy) ** 2)
        if (visitedRef.current.has(sp.id)) {
          const s = spriteRect(4, 13)
          ctx.drawImage(sprites, s.sx, s.sy, 8, 8, sx, sy, 8, 8)
        } else {
          const s = spriteRect(starFrame, 13)
          ctx.drawImage(sprites, s.sx, s.sy, 8, 8, sx, sy, 8, 8)
          if (dist < 12) {
            nearSampleRef.current = sp.id
            const ex = spriteRect(2, 16)
            ctx.drawImage(sprites, ex.sx, ex.sy, 8, 8, sx, sy - 10, 8, 8)
          }
        }
      }

      const cs = charSprite(char.facing, char.walkFrame, onWater)
      ctx.drawImage(sprites, cs.sx, cs.sy, 8, 8, Math.round(char.x - camX), Math.round(char.y - camY), 8, 8)

      rafRef.current = requestAnimationFrame(loop)
    }

    const spritesPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = '/sprites.png'
    })
    const samplesPromise = fetch('/doump-samples.json').then(r => r.json())

    Promise.all([spritesPromise, samplesPromise]).then(([sprites, samplesRaw]) => {
      if (cancelled) return
      spritesRef.current = sprites
      const rawArr = Array.isArray(samplesRaw) ? samplesRaw : []
      rawArr.forEach((s: any) => sampleDataRef.current.set(String(s.id), s))
      samplesRef.current = rawArr
        .map((s: any) => {
          const lon = s.lon ?? s.coordinates?.[0]
          const lat = s.lat ?? s.coordinates?.[1]
          if (lon == null || lat == null) return null
          const [wx, wy] = projectToWorld(Number(lon), Number(lat))
          return { id: String(s.id), wx, wy }
        })
        .filter((s): s is { id: string; wx: number; wy: number } => s !== null)

      buildWorld(sprites).then(() => {
        if (cancelled) return
        worldReadyRef.current = true
        setWorldReady(true)
        rafRef.current = requestAnimationFrame(loop)
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); handleSpaceRef.current(); return }
      if (e.key === 'Escape') { handleEscapeRef.current(); return }
      keysRef.current.add(e.key.toLowerCase())
      if (e.key.startsWith('Arrow')) e.preventDefault()
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Escape') return
      keysRef.current.delete(e.key.toLowerCase())
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  const mono = "'Courier New', Courier, monospace"
  const canvasW = SCREEN_W * zoom
  const canvasH = SCREEN_H * zoom

  return (
    <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      {/* Game canvas — z-index 1 */}
      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        style={{ display: 'block', width: canvasW, height: canvasH, imageRendering: 'pixelated', position: 'relative', zIndex: 1 }}
      />

      {worldReady && (
        <>
          {/* CRT scanlines — z-index 10 */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
            background: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
          }} />

          {/* HUD: wordmark + sample count — top-left, z-index 20 */}
          <div style={{ position: 'absolute', top: 6 * zoom, left: 8 * zoom, zIndex: 20, pointerEvents: 'none' }}>
            <div style={{ fontFamily: mono, fontWeight: 'bold', color: '#ffffff', fontSize: 10 * zoom, textShadow: '1px 1px 0 #000', lineHeight: 1.3 }}>
              D.O.U.M.P.
            </div>
            <div style={{ fontFamily: mono, color: '#ffffff', fontSize: 8 * zoom, textShadow: '1px 1px 0 #000' }}>
              SAMPLES: {visitedCount} / {samplesRef.current.length}
            </div>
          </div>

          {/* Region + zoom buttons — top-right, z-index 20 */}
          <div style={{ position: 'absolute', top: 6 * zoom, right: 4 * zoom, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6 * zoom }}>
            <div style={{ fontFamily: mono, fontStyle: 'italic', color: '#ffffff', fontSize: 8 * zoom, textShadow: '1px 1px 0 #000' }}>
              {regionName}
            </div>
            {([1, 2, 3] as const).map(z => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                style={{
                  fontFamily: mono,
                  fontSize: 8 * zoom,
                  color: zoom === z ? '#ffcc00' : '#ffffff',
                  background: 'rgba(0,0,0,0.6)',
                  border: `1px solid ${zoom === z ? '#ffcc00' : '#ffffff'}`,
                  padding: `${2 * zoom}px ${4 * zoom}px`,
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >
                {z}×
              </button>
            ))}
          </div>
        </>
      )}

      {/* Dialogue box — z-index 30 */}
      {dlgOpen && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
          height: 56 * zoom,
          background: 'rgba(0,0,0,0.85)',
          borderTop: `2px solid #ffffff`,
          padding: `${8 * zoom}px ${12 * zoom}px`,
          boxSizing: 'border-box',
          fontFamily: mono,
          color: '#ffffff',
          fontSize: 11 * zoom,
          lineHeight: 1.4,
          whiteSpace: 'pre-line',
          overflow: 'hidden',
        }}>
          {dlgDisplayed}
          <span style={{
            position: 'absolute',
            bottom: 4 * zoom,
            right: 8 * zoom,
            fontSize: 9 * zoom,
            color: '#aaaaaa',
          }}>
            [SPACE] {dlgDone ? 'continue' : 'skip'}
          </span>
        </div>
      )}
    </div>
  )
}
