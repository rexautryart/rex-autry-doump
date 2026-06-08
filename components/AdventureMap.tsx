'use client'

import { useRef, useEffect } from 'react'
import * as topojson from 'topojson-client'
import { geoContains } from 'd3-geo'
import biomesData from '@/public/doump-biomes.json'

// ─── World constants ──────────────────────────────────────────────────────────
const WORLD_W   = 1024
const WORLD_H   = 512
const TILE_SIZE = 8
const TILE_COLS = 128
const TILE_ROWS = 64
const SCREEN_W  = 256
const SCREEN_H  = 224
export const worldScale = 1024 / 13.2

// ─── Module-level state (exported for part3) ──────────────────────────────────
export let tileMap: Uint8Array | null = null
export let collisionMap: Uint8Array | null = null
export let worldOffscreen: OffscreenCanvas | null = null

// ─── Winkel Tripel projection ─────────────────────────────────────────────────
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

// ─── Seeded random ────────────────────────────────────────────────────────────
function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233
  return x - Math.floor(x)
}

// ─── Tile type mapping ────────────────────────────────────────────────────────
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

// ─── Sprite helpers ───────────────────────────────────────────────────────────
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
    // Row 12: col 0-1=right frames, col 2=left (use right for down/up)
    if (facing === 'left') return spriteRect(2, 12)
    return spriteRect(walkFrame, 12)
  }
  // Row 11: col 0-1=down, 2-3=right, 4-5=up, 6-7=left
  switch (facing) {
    case 'down':  return spriteRect(walkFrame,     11)
    case 'right': return spriteRect(2 + walkFrame, 11)
    case 'up':    return spriteRect(4 + walkFrame, 11)
    case 'left':  return spriteRect(6 + walkFrame, 11)
  }
}

// ─── World builder ────────────────────────────────────────────────────────────
async function buildWorld(sprites: HTMLImageElement): Promise<void> {
  const topoRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
  const topo = await topoRes.json()

  const biomes = new Map(Object.entries(biomesData as Record<string, string>))
  const countries = topojson.feature(topo, topo.objects.countries as any) as any

  // Build tileMap — ocean by default
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

  // Collision map
  const cm = new Uint8Array(WORLD_W * WORLD_H)
  for (let py = 0; py < WORLD_H; py++) {
    for (let px = 0; px < WORLD_W; px++) {
      cm[py * WORLD_W + px] =
        tm[Math.floor(py / TILE_SIZE) * TILE_COLS + Math.floor(px / TILE_SIZE)] === 0 ? 0 : 1
    }
  }

  // Draw static world to offscreen canvas (ocean frame 0, terrain, coast)
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

  // Coast pass
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      if (tm[row * TILE_COLS + col] !== 0) continue
      const N = row > 0             ? tm[(row - 1) * TILE_COLS + col]     : 0
      const S = row < TILE_ROWS - 1 ? tm[(row + 1) * TILE_COLS + col]     : 0
      const W = col > 0             ? tm[row * TILE_COLS + (col - 1)]     : 0
      const E = col < TILE_COLS - 1 ? tm[row * TILE_COLS + (col + 1)]     : 0
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
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const spritesRef   = useRef<HTMLImageElement | null>(null)
  const worldReadyRef = useRef(false)
  const rafRef       = useRef(0)

  // Character state
  const [startX, startY] = projectToWorld(-95.37, 29.76)
  const charRef = useRef({
    x: startX,
    y: startY,
    facing: 'down' as 'down' | 'up' | 'left' | 'right',
    walkFrame: 0,
    frameCount: 0,
  })

  // Input
  const keysRef = useRef(new Set<string>())

  // Samples
  const samplesRef   = useRef<{ id: string; wx: number; wy: number }[]>([])
  const visitedRef   = useRef(new Set<string>())
  const nearSampleRef = useRef<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    // Loading screen
    ctx.fillStyle = '#0d1b2a'
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
    ctx.fillStyle = '#5a9a20'
    ctx.font = '6px "Press Start 2P"'
    ctx.fillText('BUILDING MAP...', 60, SCREEN_H / 2)

    let cancelled = false

    // ── Game loop (defined before async call so closure is ready) ────────────
    const loop = () => {
      if (!worldReadyRef.current || !worldOffscreen || !spritesRef.current) return
      const sprites = spritesRef.current
      const tm = tileMap!
      const cm = collisionMap!
      const char = charRef.current
      char.frameCount++

      // ── Input ──────────────────────────────────────────────────────────────
      const keys  = keysRef.current
      const up    = keys.has('w') || keys.has('arrowup')
      const down  = keys.has('s') || keys.has('arrowdown')
      const left  = keys.has('a') || keys.has('arrowleft')
      const right = keys.has('d') || keys.has('arrowright')

      let dx = (right ? 1 : 0) - (left ? 1 : 0)
      let dy = (down  ? 1 : 0) - (up   ? 1 : 0)
      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707 }

      // Facing (prefer horizontal)
      if (dx > 0) char.facing = 'right'
      else if (dx < 0) char.facing = 'left'
      else if (dy > 0) char.facing = 'down'
      else if (dy < 0) char.facing = 'up'

      char.walkFrame = Math.floor(char.frameCount / 8) % 2

      // ── Current tile ──────────────────────────────────────────────────────
      const tileCol = Math.max(0, Math.min(TILE_COLS - 1, Math.floor(char.x / TILE_SIZE)))
      const tileRow = Math.max(0, Math.min(TILE_ROWS - 1, Math.floor(char.y / TILE_SIZE)))
      const onWater = tm[tileRow * TILE_COLS + tileCol] === 0

      // ── Movement + collision ──────────────────────────────────────────────
      if (dx !== 0 || dy !== 0) {
        const speed = onWater ? 1.0 : 1.5
        const nx = Math.max(0, Math.min(WORLD_W - TILE_SIZE, char.x + dx * speed))
        const ny = Math.max(0, Math.min(WORLD_H - TILE_SIZE, char.y + dy * speed))

        // Feet = bottom-center of 8×8 sprite
        const feetLand = (x: number, y: number) => {
          const fx = Math.max(0, Math.min(WORLD_W - 1, Math.round(x + 4)))
          const fy = Math.max(0, Math.min(WORLD_H - 1, Math.round(y + 6)))
          return cm[fy * WORLD_W + fx] === 1
        }

        if (onWater) {
          char.x = nx; char.y = ny
        } else {
          // Slide along coast: try both axes, then each axis, then stop
          if (feetLand(nx, ny)) {
            char.x = nx; char.y = ny
          } else if (feetLand(nx, char.y)) {
            char.x = nx
          } else if (feetLand(char.x, ny)) {
            char.y = ny
          }
        }
      }

      // ── Camera ────────────────────────────────────────────────────────────
      const camX = Math.max(0, Math.min(WORLD_W - SCREEN_W, Math.round(char.x - 128 + 4)))
      const camY = Math.max(0, Math.min(WORLD_H - SCREEN_H, Math.round(char.y - 112 + 4)))

      // ── Draw ──────────────────────────────────────────────────────────────
      ctx.imageSmoothingEnabled = false

      // 1. Blit world offscreen (camera-offset region)
      ctx.drawImage(worldOffscreen!, camX, camY, SCREEN_W, SCREEN_H, 0, 0, SCREEN_W, SCREEN_H)

      // 2. Animated ocean tiles on top
      const oceanFrame  = Math.floor(Date.now() / 250) % 4
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
          // Redraw coast edges on top of animated ocean
          const N = r > 0             ? tm[(r - 1) * TILE_COLS + c]     : 0
          const S = r < TILE_ROWS - 1 ? tm[(r + 1) * TILE_COLS + c]     : 0
          const W = c > 0             ? tm[r * TILE_COLS + (c - 1)]     : 0
          const E = c < TILE_COLS - 1 ? tm[r * TILE_COLS + (c + 1)]     : 0
          if (N > 0) ctx.drawImage(sprites, 0,  5 * 8, 8, 8, sx, sy, 8, 8)
          if (S > 0) ctx.drawImage(sprites, 8,  5 * 8, 8, 8, sx, sy, 8, 8)
          if (W > 0) ctx.drawImage(sprites, 16, 5 * 8, 8, 8, sx, sy, 8, 8)
          if (E > 0) ctx.drawImage(sprites, 24, 5 * 8, 8, 8, sx, sy, 8, 8)
        }
      }

      // 3. Sample stars + "!" proximity indicator
      const starFrame = Math.floor(Date.now() / 400) % 4
      nearSampleRef.current = null

      for (const sp of samplesRef.current) {
        const sx = sp.wx - camX
        const sy = sp.wy - camY
        if (sx < -8 || sx > SCREEN_W + 8 || sy < -8 || sy > SCREEN_H + 8) continue

        const dist = Math.sqrt((char.x - sp.wx) ** 2 + (char.y - sp.wy) ** 2)

        if (visitedRef.current.has(sp.id)) {
          // Visited: gray star — col 4
          const s = spriteRect(4, 13)
          ctx.drawImage(sprites, s.sx, s.sy, 8, 8, sx, sy, 8, 8)
        } else {
          // Animated star
          const s = spriteRect(starFrame, 13)
          ctx.drawImage(sprites, s.sx, s.sy, 8, 8, sx, sy, 8, 8)

          if (dist < 12) {
            nearSampleRef.current = sp.id
            // 4. "!" sprite — row 16, col 2
            const ex = spriteRect(2, 16)
            ctx.drawImage(sprites, ex.sx, ex.sy, 8, 8, sx, sy - 10, 8, 8)
          }
        }
      }

      // 5. Character sprite
      const cs = charSprite(char.facing, char.walkFrame, onWater)
      ctx.drawImage(
        sprites, cs.sx, cs.sy, 8, 8,
        Math.round(char.x - camX), Math.round(char.y - camY), 8, 8,
      )

      rafRef.current = requestAnimationFrame(loop)
    }

    // ── Load sprites + samples, then build world ──────────────────────────────
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
        rafRef.current = requestAnimationFrame(loop)
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard input ────────────────────────────────────────────────────────
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase())
      // Prevent arrow key scrolling
      if (e.key.startsWith('Arrow')) e.preventDefault()
    }
    const onUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup',   onUp)
    }
  }, [])

  return (
    <div style={{ position: 'relative', display: 'block', width: '100%' }}>
      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          imageRendering: 'pixelated',
        }}
      />
      {/* CRT scanlines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'repeating-linear-gradient(transparent 0px, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 3px)',
      }} />
      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)',
      }} />
    </div>
  )
}
