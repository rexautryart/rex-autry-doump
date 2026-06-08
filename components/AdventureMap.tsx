'use client'

import { useRef, useEffect } from 'react'
import * as topojson from 'topojson-client'
import type { DoumpSample } from '@/lib/types'
import samplesData from '@/public/doump-samples.json'
import biomesData from '@/public/doump-biomes.json'

// ─── World constants ──────────────────────────────────────────────────────────
const WORLD_W  = 1024
const WORLD_H  = 512
const SCREEN_W = 256
const SCREEN_H = 224
const WORLD_SCALE = WORLD_W / 13.2   // ≈ 77.6 — fits world into 1024px

// ─── Winkel Tripel projection ─────────────────────────────────────────────────
const PHI_1 = Math.acos(2 / Math.PI)

function projectWT(lon: number, lat: number): [number, number] {
  const lam = (lon * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const a = Math.acos(Math.max(-1, Math.min(1, Math.cos(phi) * Math.cos(lam / 2))))
  const s = a < 1e-10 ? 1 : Math.sin(a) / a
  return [
    0.5 * (lam * Math.cos(PHI_1) + (2 * Math.cos(phi) * Math.sin(lam / 2)) / s),
    0.5 * (phi + Math.sin(phi) / s),
  ]
}

// ─── World coordinate transform ───────────────────────────────────────────────
// Snaps to 2×2 pixel grid for crisp pixel art. shadowOffset adds the +2 extrusion.
type WorldFn = (lon: number, lat: number) => [number, number]

function makeWorldCoord(shadowOffset = 0): WorldFn {
  return (lon, lat) => {
    const [px, py] = projectWT(lon, lat)
    const wx = Math.round((px * WORLD_SCALE + WORLD_W / 2) / 2) * 2
    const wy = Math.round((-py * WORLD_SCALE + WORLD_H / 2) / 2) * 2
    return [wx + shadowOffset, wy + shadowOffset]
  }
}

// Lon/lat of a world pixel (approximate inverse for region detection)
function worldToApproxLL(wx: number, wy: number): [number, number] {
  const px = (wx - WORLD_W / 2) / WORLD_SCALE
  const py = -(wy - WORLD_H / 2) / WORLD_SCALE
  const lon = (px / 0.818) * (180 / Math.PI)      // 0.818 ≈ (cos(PHI_1)+1)/2
  const lat = py * (180 / Math.PI)
  return [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))]
}

// ─── Antimeridian normalization ───────────────────────────────────────────────
function normalizeRing(coords: number[][]): [number, number][] {
  if (coords.length === 0) return []
  const out: [number, number][] = [[coords[0][0], coords[0][1]]]
  for (let i = 1; i < coords.length; i++) {
    let lon = coords[i][0]
    const prev = out[i - 1][0]
    while (lon - prev > 180) lon -= 360
    while (prev - lon > 180) lon += 360
    out.push([lon, coords[i][1]])
  }
  return out
}

// ─── GeoJSON path tracing (world space) ──────────────────────────────────────
function traceRingW(ctx: any, ring: number[][], toW: WorldFn, close: boolean) {
  const norm = normalizeRing(ring)
  for (let i = 0; i < norm.length; i++) {
    const lat = Math.max(-85, Math.min(85, norm[i][1]))
    const [wx, wy] = toW(norm[i][0], lat)
    if (i === 0) ctx.moveTo(wx, wy)
    else ctx.lineTo(wx, wy)
  }
  if (close) ctx.closePath()
}

function traceGeomW(ctx: any, geom: any, toW: WorldFn) {
  if (!geom) return
  switch (geom.type) {
    case 'Polygon':
      for (const r of geom.coordinates) traceRingW(ctx, r, toW, true); break
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const r of poly) traceRingW(ctx, r, toW, true)
      break
    case 'MultiLineString':
      for (const l of geom.coordinates) traceRingW(ctx, l, toW, false); break
    case 'GeometryCollection':
      for (const g of (geom.geometries ?? [])) traceGeomW(ctx, g, toW); break
  }
}

// ─── Biome colors ─────────────────────────────────────────────────────────────
const BIOME_COLORS: Record<string, string> = {
  forest:        '#3a7d44',
  tropical:      '#4aa820',
  grassland:     '#7db84e',
  savanna:       '#c5a028',
  desert:        '#c8a852',
  tundra:        '#8a9a9a',
  arctic:        '#d4e4e8',
  mediterranean: '#8aaa54',
}
const BIOME_DARK: Record<string, string> = {
  forest:        '#2a5c30',
  tropical:      '#307a14',
  grassland:     '#5a8a38',
  savanna:       '#9a7a18',
  desert:        '#a07838',
  tundra:        '#607078',
  arctic:        '#a0b4b8',
  mediterranean: '#5a7a38',
}

// ─── Star sprite ──────────────────────────────────────────────────────────────
// 8×8 bit pattern:
//   Row 0: . . . X . . . .   Row 4: X X X X X X X .
//   Row 1: . . . X . . . .   Row 5: . X X X X X . .
//   Row 2: X . X X X . X .   Row 6: . . X . X . . .
//   Row 3: . X X X X X . .   Row 7: . X . . . X . .
const STAR_ROWS = [16, 16, 186, 124, 254, 124, 40, 68]

function drawStar(ctx: any, x: number, y: number, color: string, outline = false) {
  if (outline) {
    ctx.fillStyle = '#ffffff'
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (STAR_ROWS[row] & (0x80 >> col)) {
          ctx.fillRect(x + col - 1, y + row - 1, 3, 3)
        }
      }
    }
  }
  ctx.fillStyle = color
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (STAR_ROWS[row] & (0x80 >> col)) {
        ctx.fillRect(x + col, y + row, 1, 1)
      }
    }
  }
}

// ─── Player sprite ────────────────────────────────────────────────────────────
function drawPlayer(ctx: any, x: number, y: number, walkFrame: number) {
  const bob = walkFrame === 1 ? 1 : 0
  ctx.fillStyle = '#f4a460'   // skin — head 4×4
  ctx.fillRect(x + 2, y, 4, 4)
  ctx.fillStyle = '#df1b12'   // brand red — body 4×4
  ctx.fillRect(x + 2, y + 4 + bob, 4, 4)
}

// ─── Region detection ─────────────────────────────────────────────────────────
const REGIONS = [
  { n: 'ARCTIC / TUNDRA',    minLon: -180, maxLon: 180, minLat: 60,  maxLat: 90  },
  { n: 'ANTARCTICA',          minLon: -180, maxLon: 180, minLat: -90, maxLat: -60 },
  { n: 'NORTH AMERICA',       minLon: -168, maxLon: -52, minLat: 15,  maxLat: 72  },
  { n: 'CENTRAL AMERICA',     minLon: -92,  maxLon: -60, minLat: 7,   maxLat: 22  },
  { n: 'CARIBBEAN',           minLon: -85,  maxLon: -59, minLat: 10,  maxLat: 27  },
  { n: 'SOUTH AMERICA',       minLon: -82,  maxLon: -34, minLat: -56, maxLat: 13  },
  { n: 'WEST EUROPE',         minLon: -10,  maxLon: 15,  minLat: 36,  maxLat: 60  },
  { n: 'EAST EUROPE',         minLon: 15,   maxLon: 40,  minLat: 36,  maxLat: 60  },
  { n: 'MIDDLE EAST & NAFR',  minLon: -18,  maxLon: 60,  minLat: 10,  maxLat: 38  },
  { n: 'SOUTH ASIA',          minLon: 60,   maxLon: 90,  minLat: 5,   maxLat: 38  },
  { n: 'EAST ASIA',           minLon: 100,  maxLon: 145, minLat: 20,  maxLat: 50  },
  { n: 'SOUTH EAST ASIA',     minLon: 90,   maxLon: 141, minLat: -10, maxLat: 22  },
  { n: 'OCEANIA',             minLon: 110,  maxLon: 180, minLat: -50, maxLat: 5   },
]

function getRegion(lon: number, lat: number): string {
  for (const r of REGIONS) {
    if (lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat) return r.n
  }
  return 'OCEAN'
}

// ─── Game data ────────────────────────────────────────────────────────────────
const BIOMES = biomesData as Record<string, string>
const SAMPLES = samplesData as DoumpSample[]

// ─── Component ────────────────────────────────────────────────────────────────
export default function AdventureMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  // World layers (built once)
  const worldCanvasRef = useRef<OffscreenCanvas | null>(null)
  const collMapRef     = useRef<Uint8Array | null>(null)
  const worldLoadedRef = useRef(false)

  // Sample world positions — computed once after world loads
  const samplePosRef = useRef<{ id: string; wx: number; wy: number }[]>([])

  // ── Game state refs (no React re-renders needed) ───────────────────────────
  const playerRef = useRef({ x: 512, y: 256, walkFrame: 0, framesSinceStep: 0 })
  const camRef    = useRef({ x: 0, y: 0 })
  const zoomRef   = useRef(1)
  const keysRef   = useRef(new Set<string>())
  const frameRef  = useRef(0)
  const rafRef    = useRef(0)
  const visitedRef = useRef(new Set<string>())
  const regionRef  = useRef('NORTH AMERICA')

  const dlgRef = useRef({
    active:    false,
    sampleId:  '',
    lines:     [] as string[],
    totalChars: 0,
    charIdx:   0,
    blinkFrame: 0,
  })

  // ── Collision helper ───────────────────────────────────────────────────────
  const isLand = (x: number, y: number): boolean => {
    const ix = Math.round(x), iy = Math.round(y)
    if (ix < 0 || ix >= WORLD_W || iy < 0 || iy >= WORLD_H) return false
    const map = collMapRef.current
    return map ? map[iy * WORLD_W + ix] === 1 : true
  }

  // ── Build world (called once after topo loads) ─────────────────────────────
  const buildWorld = (countryFeatures: any[], bordersMesh: any) => {
    if (typeof OffscreenCanvas === 'undefined') return

    // ── Static world canvas ──────────────────────────────────────────────────
    const wc   = new OffscreenCanvas(WORLD_W, WORLD_H)
    const wctx = wc.getContext('2d')!
    wctx.imageSmoothingEnabled = false

    const toW     = makeWorldCoord(0)
    const toWShadow = makeWorldCoord(2)

    // Ocean
    wctx.fillStyle = '#0d1b2a'
    wctx.fillRect(0, 0, WORLD_W, WORLD_H)

    // Ocean wave dots
    wctx.fillStyle = '#162840'
    for (let y = 0; y < WORLD_H; y += 4) {
      for (let x = 0; x < WORLD_W; x += 8) wctx.fillRect(x, y, 1, 1)
    }

    // Shadow pass — all countries offset (+2,+2) in dark biome color
    for (const f of countryFeatures) {
      const biome = BIOMES[String(f.id)] ?? 'grassland'
      wctx.fillStyle = BIOME_DARK[biome] ?? '#333'
      wctx.beginPath()
      traceGeomW(wctx, f.geometry, toWShadow)
      wctx.fill('evenodd')
    }

    // Fill pass — all countries in biome color
    for (const f of countryFeatures) {
      const biome = BIOMES[String(f.id)] ?? 'grassland'
      wctx.fillStyle = BIOME_COLORS[biome] ?? '#3a7d44'
      wctx.beginPath()
      traceGeomW(wctx, f.geometry, toW)
      wctx.fill('evenodd')
    }

    // Country borders
    wctx.strokeStyle = '#1a0800'
    wctx.lineWidth = 1
    wctx.beginPath()
    traceGeomW(wctx, bordersMesh, toW)
    wctx.stroke()

    worldCanvasRef.current = wc

    // ── Collision map ────────────────────────────────────────────────────────
    const cc   = new OffscreenCanvas(WORLD_W, WORLD_H)
    const cctx = cc.getContext('2d')!
    cctx.fillStyle = '#000000'
    cctx.fillRect(0, 0, WORLD_W, WORLD_H)
    cctx.fillStyle = '#ffffff'
    for (const f of countryFeatures) {
      cctx.beginPath()
      traceGeomW(cctx, f.geometry, toW)
      cctx.fill('evenodd')
    }
    const imgData = cctx.getImageData(0, 0, WORLD_W, WORLD_H)
    const cmap = new Uint8Array(WORLD_W * WORLD_H)
    for (let i = 0; i < cmap.length; i++) cmap[i] = imgData.data[i * 4] > 128 ? 1 : 0
    collMapRef.current = cmap

    // ── Sample positions ─────────────────────────────────────────────────────
    samplePosRef.current = SAMPLES.map(s => {
      const [wx, wy] = toW(s.coordinates[0], s.coordinates[1])
      return { id: s.id, wx, wy }
    })

    // ── Spawn player at Houston TX ────────────────────────────────────────────
    const [hx, hy] = toW(-95.37, 29.76)
    // Find nearest land pixel if spawn is ocean
    let spawnX = hx, spawnY = hy
    if (!isLand(spawnX, spawnY)) {
      outer:
      for (let r = 1; r <= 20; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (isLand(spawnX + dx, spawnY + dy)) {
              spawnX += dx; spawnY += dy; break outer
            }
          }
        }
      }
    }
    playerRef.current.x = spawnX
    playerRef.current.y = spawnY

    worldLoadedRef.current = true
  }

  // ── Render frame ───────────────────────────────────────────────────────────
  const renderFrame = () => {
    const canvas = canvasRef.current
    const worldCanvas = worldCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H)

    const zoom   = zoomRef.current
    const player = playerRef.current
    const screenW = SCREEN_W / zoom
    const screenH = SCREEN_H / zoom
    const camX = Math.max(0, Math.min(WORLD_W - screenW, Math.floor(player.x - screenW / 2)))
    const camY = Math.max(0, Math.min(WORLD_H - screenH, Math.floor(player.y - screenH / 2)))
    camRef.current = { x: camX, y: camY }

    if (!worldLoadedRef.current || !worldCanvas) {
      // Loading screen
      ctx.fillStyle = '#0d1b2a'
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
      ctx.fillStyle = '#5a9a20'
      ctx.font = '6px "Press Start 2P"'
      ctx.fillText('LOADING MAP...', 60, SCREEN_H / 2)
      return
    }

    // ── Scaled world layer ────────────────────────────────────────────────────
    ctx.save()
    ctx.scale(zoom, zoom)

    // Draw world at camera offset
    ctx.drawImage(worldCanvas, -camX, -camY)

    // Sample stars
    const now = Date.now()
    const starFrame = Math.floor(now / 500) % 4
    const starColors  = ['#ffcc00', '#ffee44', '#ffcc00', '#ccaa00']
    const starColor   = starColors[starFrame]

    for (const sp of samplePosRef.current) {
      const sx = sp.wx - camX
      const sy = sp.wy - camY
      if (sx < -16 || sx > screenW + 8 || sy < -16 || sy > screenH + 8) continue

      const dist = Math.hypot(player.x - sp.wx, player.y - sp.wy)
      const visited = visitedRef.current.has(sp.id)

      if (!visited) {
        const outline = starFrame === 1
        if (dist < 12) {
          // Larger pulsing star
          ctx.fillStyle = '#ffee44'
          ctx.fillRect(sx - 1, sy - 1, 10, 10)
          drawStar(ctx, sx, sy, '#ffff88', false)
          // "!" indicator
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(sx + 3, sy - 8, 2, 5)
          ctx.fillRect(sx + 3, sy - 2, 2, 2)
        } else {
          drawStar(ctx, sx, sy, starColor, outline)
        }
      } else {
        // Visited: faint gray
        drawStar(ctx, sx, sy, '#555544', false)
      }
    }

    // Player
    drawPlayer(ctx, Math.floor(player.x - camX) - 4, Math.floor(player.y - camY) - 8, player.walkFrame)

    ctx.restore()

    // ── HUD (unscaled, always 256×224) ────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, SCREEN_W, 12)

    ctx.font = '6px "Press Start 2P"'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.fillText('D.O.U.M.P.', 3, 9)

    ctx.textAlign = 'right'
    ctx.fillStyle = '#ffcc00'
    ctx.fillText(`${visitedRef.current.size}/${SAMPLES.length} FOUND`, SCREEN_W - 3, 9)
    ctx.textAlign = 'left'

    // Region name (bottom-left, above dialogue)
    const dlg = dlgRef.current
    if (!dlg.active) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, SCREEN_H - 14, 120, 14)
      ctx.fillStyle = '#aaaaff'
      ctx.font = '5px "Press Start 2P"'
      ctx.fillText(regionRef.current, 3, SCREEN_H - 4)
    }

    // Zoom buttons (bottom-right)
    const btnY = SCREEN_H - 18
    ctx.fillStyle = '#222222'
    ctx.fillRect(SCREEN_W - 26, btnY, 11, 10)
    ctx.fillRect(SCREEN_W - 13, btnY, 11, 10)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.strokeRect(SCREEN_W - 26, btnY, 11, 10)
    ctx.strokeRect(SCREEN_W - 13, btnY, 11, 10)
    ctx.fillStyle = '#ffffff'
    ctx.font = '6px "Press Start 2P"'
    ctx.textAlign = 'center'
    ctx.fillText('+', SCREEN_W - 20, btnY + 8)
    ctx.fillText('-', SCREEN_W - 7, btnY + 8)
    ctx.textAlign = 'left'

    // ── Dialogue box ─────────────────────────────────────────────────────────
    if (dlg.active) {
      const boxY = SCREEN_H - 56
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, boxY, SCREEN_W, 56)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(1, boxY + 1, SCREEN_W - 2, 54)

      // Typewriter text
      let drawn = 0
      ctx.font = '6px "Press Start 2P"'
      for (let li = 0; li < dlg.lines.length; li++) {
        const line = dlg.lines[li]
        const visible = Math.max(0, dlg.charIdx - drawn)
        if (visible === 0) break
        const show = line.substring(0, visible)
        ctx.fillStyle = li === 0 ? '#ffffff' : '#aaaaaa'
        ctx.font = li === 0 ? '6px "Press Start 2P"' : '5px "Press Start 2P"'
        ctx.fillText(show, 5, boxY + 14 + li * 14)
        drawn += line.length
      }

      // Blinking cursor ▼
      if (dlg.charIdx >= dlg.totalChars) {
        dlg.blinkFrame++
        if (Math.floor(dlg.blinkFrame / 30) % 2 === 0) {
          ctx.fillStyle = '#ffffff'
          ctx.font = '6px "Press Start 2P"'
          ctx.textAlign = 'right'
          ctx.fillText('▼', SCREEN_W - 5, SCREEN_H - 5)
          ctx.textAlign = 'left'
        }
      }

      ctx.fillStyle = '#555555'
      ctx.font = '5px "Press Start 2P"'
      ctx.fillText('SPACE to continue', 5, SCREEN_H - 5)
    }
  }

  // ── Game loop ──────────────────────────────────────────────────────────────
  const gameLoop = () => {
    frameRef.current++
    const frame = frameRef.current
    const player = playerRef.current
    const dlg    = dlgRef.current
    const keys   = keysRef.current

    if (worldLoadedRef.current) {
      // ── Movement (blocked during dialogue) ────────────────────────────────
      if (!dlg.active) {
        const up    = keys.has('w') || keys.has('arrowup')
        const down  = keys.has('s') || keys.has('arrowdown')
        const left  = keys.has('a') || keys.has('arrowleft')
        const right = keys.has('d') || keys.has('arrowright')

        const dx = (right ? 1 : 0) - (left ? 1 : 0)
        const dy = (down  ? 1 : 0) - (up   ? 1 : 0)

        if (dx !== 0 || dy !== 0) {
          const speed = (dx !== 0 && dy !== 0) ? 0.707 : 1
          const nx = player.x + dx * speed
          const ny = player.y + dy * speed

          // Separate axis collision
          if (isLand(nx, player.y)) player.x = nx
          if (isLand(player.x, ny)) player.y = ny

          // Walk animation
          player.framesSinceStep++
          if (player.framesSinceStep >= 8) {
            player.walkFrame = player.walkFrame === 0 ? 1 : 0
            player.framesSinceStep = 0
          }
        } else {
          player.walkFrame = 0
          player.framesSinceStep = 0
        }

        // ── Proximity check for samples ──────────────────────────────────────
        for (const sp of samplePosRef.current) {
          if (visitedRef.current.has(sp.id)) continue
          const dist = Math.hypot(player.x - sp.wx, player.y - sp.wy)
          if (dist < 12) {
            const sample = SAMPLES.find(s => s.id === sp.id)!
            dlg.active    = true
            dlg.sampleId  = sp.id
            dlg.lines     = [
              sample.name,
              sample.location + '  ' + sample.dateCollected,
              sample.collectedBy,
            ]
            dlg.totalChars = dlg.lines.reduce((sum, l) => sum + l.length, 0)
            dlg.charIdx   = 0
            dlg.blinkFrame = 0
            break
          }
        }

        // ── Region update (every 30 frames) ─────────────────────────────────
        if (frame % 30 === 0) {
          const [lon, lat] = worldToApproxLL(player.x, player.y)
          regionRef.current = getRegion(lon, lat)
        }
      }

      // ── Dialogue typewriter ───────────────────────────────────────────────
      if (dlg.active && dlg.charIdx < dlg.totalChars) {
        dlg.charIdx = Math.min(dlg.totalChars, dlg.charIdx + 2)
      }
    }

    renderFrame()
    rafRef.current = requestAnimationFrame(gameLoop)
  }

  // ── Main effect: fetch → build → start loop ────────────────────────────────
  useEffect(() => {
    let cancelled = false

    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(topo => {
        if (cancelled) return
        const fc = topojson.feature(topo, topo.objects.countries as any) as any
        const borders = topojson.mesh(topo, topo.objects.countries as any, () => true)
        buildWorld(fc.features ?? [], borders)
        rafRef.current = requestAnimationFrame(gameLoop)
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase())
      const dlg = dlgRef.current

      if ((e.key === ' ' || e.key === 'Enter') && dlg.active) {
        e.preventDefault()
        if (dlg.charIdx < dlg.totalChars) {
          // Skip typewriter
          dlg.charIdx = dlg.totalChars
        } else {
          // Dismiss
          visitedRef.current = new Set([...visitedRef.current, dlg.sampleId])
          dlg.active = false
        }
      }
    }
    const onUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  // ── Canvas click (zoom buttons) ────────────────────────────────────────────
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (SCREEN_W / rect.width)
    const cy = (e.clientY - rect.top)  * (SCREEN_H / rect.height)
    const btnY = SCREEN_H - 18
    if (cy >= btnY && cy <= btnY + 10) {
      if (cx >= SCREEN_W - 26 && cx <= SCREEN_W - 15) zoomRef.current = Math.min(3, zoomRef.current + 1)
      if (cx >= SCREEN_W - 13 && cx <= SCREEN_W - 2) zoomRef.current = Math.max(1, zoomRef.current - 1)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'block', width: '100%' }}>
      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          imageRendering: 'pixelated',
          cursor: 'default',
        }}
        onClick={handleClick}
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
