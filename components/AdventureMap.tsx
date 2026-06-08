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

// ─── Module-level state (exported for part2) ──────────────────────────────────
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

// ─── Seeded random ────────────────────────────────────────────────────────────
function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233
  return x - Math.floor(x)
}

// ─── Tile type mapping ────────────────────────────────────────────────────────
// 0=ocean, 1=temperate, 2=forest, 3=desert, 4=tundra, 5=mountain,
// 6=savanna, 7=tropical, 8=mediterranean
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
    default:              return 1  // unknown land → temperate
  }
}

// ─── Sprite sheet helpers ─────────────────────────────────────────────────────
function spriteRect(col: number, row: number) {
  return { sx: col * 8, sy: row * 8 }
}

function baseSpriteForType(t: number): { sx: number; sy: number } {
  switch (t) {
    case 1: return spriteRect(0, 0)  // temperate
    case 2: return spriteRect(0, 1)  // forest
    case 3: return spriteRect(0, 2)  // desert
    case 4: return spriteRect(0, 3)  // tundra
    case 0: return spriteRect(0, 4)  // ocean
    case 5: return spriteRect(0, 6)  // mountain
    case 6: return spriteRect(0, 7)  // savanna
    case 7: return spriteRect(0, 8)  // tropical
    case 8: return spriteRect(0, 9)  // mediterranean
    default: return spriteRect(0, 0)
  }
}

// ─── Async world builder ──────────────────────────────────────────────────────
async function buildWorld(): Promise<void> {
  // Step 1: Fetch world TopoJSON
  const topoRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
  const topo = await topoRes.json()

  // Step 2: Biome lookup
  const biomes = new Map(Object.entries(biomesData as Record<string, string>))

  // Step 3: GeoJSON features
  const countries = topojson.feature(topo, topo.objects.countries as any) as any

  // Step 4: Build tileMap — ocean by default
  const tm = new Uint8Array(TILE_COLS * TILE_ROWS)

  for (const feature of countries.features) {
    if (!feature.geometry) continue
    const biome = biomes.get(String(feature.id))
    const tileType = biomeToTileType(biome)

    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const lon = (col + 0.5) / TILE_COLS * 360 - 180
        const lat = 90 - (row + 0.5) / TILE_ROWS * 180
        if (geoContains(feature, [lon, lat])) {
          tm[row * TILE_COLS + col] = tileType
        }
      }
    }
  }

  // Step 5: Collision map
  const cm = new Uint8Array(WORLD_W * WORLD_H)
  for (let py = 0; py < WORLD_H; py++) {
    for (let px = 0; px < WORLD_W; px++) {
      const tc = Math.floor(px / TILE_SIZE)
      const tr = Math.floor(py / TILE_SIZE)
      cm[py * WORLD_W + px] = tm[tr * TILE_COLS + tc] === 0 ? 0 : 1
    }
  }

  // Step 6: Load sprite sheet
  const sprites = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = '/sprites.png'
  })

  const wc = new OffscreenCanvas(WORLD_W, WORLD_H)
  const ctx = wc.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Terrain pass
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const idx = row * TILE_COLS + col
      const t = tm[idx]
      const b = baseSpriteForType(t)
      ctx.drawImage(sprites, b.sx, b.sy, 8, 8, col * 8, row * 8, 8, 8)

      // Decoration: forest trees (row 1), desert cacti (row 2), mountain slopes (row 6)
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

  // Coast pass — row 5: col 0=N, 1=S, 2=W, 3=E
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
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    // Loading state
    ctx.fillStyle = '#0d1b2a'
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
    ctx.fillStyle = '#5a9a20'
    ctx.font = '6px "Press Start 2P"'
    ctx.fillText('BUILDING MAP...', 60, SCREEN_H / 2)

    let cancelled = false
    buildWorld().then(() => {
      if (cancelled || !worldOffscreen) return
      ctx.imageSmoothingEnabled = false
      // Blit top-left 256×224 chunk of world to display canvas
      ctx.drawImage(worldOffscreen, 0, 0, SCREEN_W, SCREEN_H, 0, 0, SCREEN_W, SCREEN_H)
    })

    return () => { cancelled = true }
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
