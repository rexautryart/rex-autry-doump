'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import * as topojson from 'topojson-client'
import type { DoumpSample } from '@/lib/types'

// ─── Winkel Tripel projection ─────────────────────────────────────────────────
const PHI_1 = Math.acos(2 / Math.PI)
const X_MAX = 0.5 * (Math.PI * Math.cos(PHI_1) + Math.PI) // ≈ 2.571
const Y_MAX = Math.PI / 2                                   // ≈ 1.5708

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

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function computeCentroid(geom: any): [number, number] | null {
  if (!geom) return null
  let ring: number[][] = []
  if (geom.type === 'Polygon') {
    ring = geom.coordinates[0] ?? []
  } else if (geom.type === 'MultiPolygon') {
    let max = 0
    for (const poly of geom.coordinates) {
      if (poly[0] && poly[0].length > max) { max = poly[0].length; ring = poly[0] }
    }
  }
  if (ring.length === 0) return null
  let sLon = 0, sLat = 0
  for (const [lon, lat] of ring) { sLon += lon; sLat += lat }
  return [sLon / ring.length, sLat / ring.length]
}

function getLonExtent(geom: any): [number, number] {
  let min = Infinity, max = -Infinity
  const visit = (r: number[][]) => {
    for (const [lon] of r) { if (lon < min) min = lon; if (lon > max) max = lon }
  }
  if (geom?.type === 'Polygon') geom.coordinates.forEach(visit)
  else if (geom?.type === 'MultiPolygon') { for (const p of geom.coordinates) p.forEach(visit) }
  return [min === Infinity ? -180 : min, max === -Infinity ? 180 : max]
}

// ─── GeoJSON path tracing (ctx: any — works for both Canvas and OffscreenCanvas contexts) ──
type ToCanvasFn = (lon: number, lat: number) => [number, number]

function makeToCanvas(scale: number, cx: number, cy: number): ToCanvasFn {
  return (lon, lat) => {
    const [px, py] = projectWT(lon, lat)
    return [px * scale + cx, -py * scale + cy]
  }
}

function traceRing(ctx: any, ring: number[][], toCanvas: ToCanvasFn, close: boolean) {
  const norm = normalizeRing(ring)
  for (let i = 0; i < norm.length; i++) {
    const lat = Math.max(-85, Math.min(85, norm[i][1]))
    const [sx, sy] = toCanvas(norm[i][0], lat)
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  if (close) ctx.closePath()
}

function traceGeomParts(ctx: any, geom: any, toCanvas: ToCanvasFn) {
  if (!geom) return
  switch (geom.type) {
    case 'Polygon':
      for (const r of geom.coordinates) traceRing(ctx, r, toCanvas, true)
      break
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const r of poly) traceRing(ctx, r, toCanvas, true)
      break
    case 'MultiLineString':
      for (const l of geom.coordinates) traceRing(ctx, l, toCanvas, false)
      break
    case 'LineString':
      traceRing(ctx, geom.coordinates, toCanvas, false)
      break
    case 'GeometryCollection':
      for (const g of (geom.geometries ?? [])) traceGeomParts(ctx, g, toCanvas)
      break
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CONT_COLORS: Record<string, string> = {
  'North America': '#4a90d9', 'South America': '#7bc47e', 'Europe': '#e8a84b',
  'Africa': '#d45f3a', 'Asia': '#9b6bc5', 'Australia': '#e8c84b',
  'Oceania': '#e8c84b', 'Antarctica': '#9ec8d4',
}

const COUNTRY_NAMES: Record<number, string> = {
  4: 'Afghanistan', 8: 'Albania', 12: 'Algeria', 24: 'Angola', 32: 'Argentina',
  36: 'Australia', 40: 'Austria', 50: 'Bangladesh', 56: 'Belgium', 68: 'Bolivia',
  70: 'Bosnia & Herz.', 76: 'Brazil', 100: 'Bulgaria', 104: 'Myanmar',
  116: 'Cambodia', 120: 'Cameroon', 124: 'Canada', 144: 'Sri Lanka',
  152: 'Chile', 156: 'China', 170: 'Colombia', 178: 'Congo', 180: 'DR Congo',
  191: 'Croatia', 192: 'Cuba', 196: 'Cyprus', 203: 'Czechia', 208: 'Denmark',
  218: 'Ecuador', 818: 'Egypt', 231: 'Ethiopia', 233: 'Estonia', 246: 'Finland',
  250: 'France', 266: 'Gabon', 276: 'Germany', 288: 'Ghana', 300: 'Greece',
  320: 'Guatemala', 332: 'Haiti', 340: 'Honduras', 348: 'Hungary', 356: 'India',
  360: 'Indonesia', 364: 'Iran', 368: 'Iraq', 372: 'Ireland', 376: 'Israel',
  380: 'Italy', 392: 'Japan', 400: 'Jordan', 398: 'Kazakhstan', 404: 'Kenya',
  408: 'North Korea', 410: 'South Korea', 414: 'Kuwait', 422: 'Lebanon',
  428: 'Latvia', 430: 'Liberia', 434: 'Libya', 440: 'Lithuania', 450: 'Madagascar',
  454: 'Malawi', 458: 'Malaysia', 466: 'Mali', 484: 'Mexico', 496: 'Mongolia',
  498: 'Moldova', 499: 'Montenegro', 504: 'Morocco', 508: 'Mozambique',
  516: 'Namibia', 524: 'Nepal', 528: 'Netherlands', 554: 'New Zealand',
  558: 'Nicaragua', 566: 'Nigeria', 578: 'Norway', 586: 'Pakistan',
  591: 'Panama', 600: 'Paraguay', 604: 'Peru', 608: 'Philippines',
  616: 'Poland', 620: 'Portugal', 634: 'Qatar', 642: 'Romania', 643: 'Russia',
  646: 'Rwanda', 682: 'Saudi Arabia', 686: 'Senegal', 688: 'Serbia',
  703: 'Slovakia', 705: 'Slovenia', 706: 'Somalia', 710: 'South Africa',
  724: 'Spain', 752: 'Sweden', 756: 'Switzerland', 760: 'Syria',
  764: 'Thailand', 780: 'Trinidad & Tobago', 788: 'Tunisia', 792: 'Türkiye',
  795: 'Turkmenistan', 800: 'Uganda', 804: 'Ukraine', 784: 'UAE',
  826: 'United Kingdom', 840: 'United States', 858: 'Uruguay',
  860: 'Uzbekistan', 862: 'Venezuela', 704: 'Vietnam', 807: 'N. Macedonia',
  887: 'Yemen', 716: 'Zimbabwe', 51: 'Armenia', 31: 'Azerbaijan',
  268: 'Georgia', 417: 'Kyrgyzstan', 762: 'Tajikistan', 834: 'Tanzania',
  384: "Côte d'Ivoire", 226: 'Eq. Guinea', 232: 'Eritrea', 270: 'Gambia',
  383: 'Kosovo',
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface StandardMapProps {
  samples: DoumpSample[]
  onSelectSample: (s: DoumpSample) => void
  darkMode?: boolean
}

interface CountryMeta {
  id: number
  name: string
  centroid: [number, number] | null
  lonExtent: [number, number]
}

interface OffscreenSnap {
  zoom: number
  panX: number
  panY: number
  dark: boolean
  resolution: string
}

// ─── Fetch + parse a topology URL ─────────────────────────────────────────────
async function fetchAndParseTopo(url: string) {
  const topo = await fetch(url).then(r => r.json())
  return {
    land: topojson.feature(topo, topo.objects.land),
    borders: topojson.mesh(topo, topo.objects.countries as any, (a: any, b: any) => a !== b),
    topo,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function StandardMap({ samples, onSelectSample, darkMode = false }: StandardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── Topology refs ─────────────────────────────────────────────────────────
  // 110m — always loaded immediately
  const land110 = useRef<any>(null)
  const borders110 = useRef<any>(null)
  const countriesRef = useRef<CountryMeta[]>([])
  const [topoLoaded, setTopoLoaded] = useState(false)

  // 50m — lazy at zoom > 5
  const land50 = useRef<any>(null)
  const borders50 = useRef<any>(null)
  const loading50 = useRef(false)
  const loaded50 = useRef(false)

  // 10m — lazy at zoom > 15
  const land10 = useRef<any>(null)
  const borders10 = useRef<any>(null)
  const loading10 = useRef(false)
  const loaded10 = useRef(false)

  // States — lazy at zoom > 10
  const statesRef = useRef<any>(null)
  const loadingStates = useRef(false)
  const loadedStates = useRef(false)

  // Counter incremented each time a lazy dataset finishes — triggers redraw
  const [extraLoaded, setExtraLoaded] = useState(0)

  // ── Offscreen canvas ──────────────────────────────────────────────────────
  const offscreenRef = useRef<OffscreenCanvas | null>(null)
  const offscreenSnap = useRef<OffscreenSnap | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // drawRef lets the debounce callback call the latest draw() without stale closure
  const drawRef = useRef<() => void>(() => {})

  // ── View state ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [, setSize] = useState({ w: 0, h: 0 })
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // ── Interaction refs ──────────────────────────────────────────────────────
  const isDragging = useRef(false)
  const hasMoved = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panAtDragStart = useRef({ x: 0, y: 0 })

  // ── Hover ─────────────────────────────────────────────────────────────────
  const [hoveredSample, setHoveredSample] = useState<DoumpSample | null>(null)
  const hoveredRef = useRef<DoumpSample | null>(null)
  hoveredRef.current = hoveredSample

  // ── Pick active resolution ─────────────────────────────────────────────
  const getActiveTopo = useCallback((): { land: any; borders: any; tag: string } => {
    const z = zoomRef.current
    if (z > 15 && loaded10.current) return { land: land10.current, borders: borders10.current, tag: '10m' }
    if (z > 5 && loaded50.current) return { land: land50.current, borders: borders50.current, tag: '50m' }
    return { land: land110.current, borders: borders110.current, tag: '110m' }
  }, [])

  // ── Initial 110m fetch ────────────────────────────────────────────────────
  useEffect(() => {
    fetchAndParseTopo('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(({ land, borders, topo }) => {
        land110.current = land
        borders110.current = borders
        const fc = topojson.feature(topo, topo.objects.countries as any) as any
        countriesRef.current = (fc.features ?? []).map((f: any) => ({
          id: f.id as number,
          name: COUNTRY_NAMES[f.id as number] ?? '',
          centroid: computeCentroid(f.geometry),
          lonExtent: getLonExtent(f.geometry),
        }))
        setTopoLoaded(true)
      })
  }, [])

  // ── Lazy-load higher-res data when zoom crosses thresholds ────────────────
  useEffect(() => {
    if (zoom > 5 && !loaded50.current && !loading50.current) {
      loading50.current = true
      fetchAndParseTopo('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json')
        .then(({ land, borders }) => {
          land50.current = land
          borders50.current = borders
          loaded50.current = true
          offscreenSnap.current = null // invalidate offscreen
          setExtraLoaded(n => n + 1)
        })
    }
    if (zoom > 10 && !loadedStates.current && !loadingStates.current) {
      loadingStates.current = true
      fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/states-10m.json')
        .then(r => r.json())
        .then(topo => {
          statesRef.current = topojson.mesh(
            topo, topo.objects.states as any, (a: any, b: any) => a !== b,
          )
          loadedStates.current = true
          offscreenSnap.current = null
          setExtraLoaded(n => n + 1)
        })
    }
    if (zoom > 15 && !loaded10.current && !loading10.current) {
      loading10.current = true
      fetchAndParseTopo('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-10m.json')
        .then(({ land, borders }) => {
          land10.current = land
          borders10.current = borders
          loaded10.current = true
          offscreenSnap.current = null
          setExtraLoaded(n => n + 1)
        })
    }
  }, [zoom])

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const update = () => {
      const dpr = window.devicePixelRatio || 1
      const W = container.clientWidth
      const H = Math.round(W * 0.56)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      canvas.width = W * dpr
      canvas.height = H * dpr
      offscreenSnap.current = null // invalidate on resize
      offscreenRef.current = null
      setSize({ w: W, h: H })
    }
    const ro = new ResizeObserver(update)
    ro.observe(container)
    update()
    return () => ro.disconnect()
  }, [])

  // ── Keyboard zoom ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(50, z * 1.3))
      else if (e.key === '-') setZoom(z => Math.max(1, z / 1.3))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Compute canvas transform ──────────────────────────────────────────────
  const getTransform = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    const PAD = 40
    const baseScale = Math.min((W - 2 * PAD) / (2 * X_MAX), (H - 2 * PAD) / (2 * Y_MAX))
    return {
      W, H,
      scale: baseScale * zoomRef.current,
      cx: W / 2 + panRef.current.x,
      cy: H / 2 + panRef.current.y,
    }
  }, [])

  // ── Hit test for sample pins ──────────────────────────────────────────────
  const getSampleAtPos = useCallback((posX: number, posY: number): DoumpSample | null => {
    const t = getTransform()
    if (!t) return null
    const toCanvas = makeToCanvas(t.scale, t.cx, t.cy)
    for (const s of samples) {
      const [sx, sy] = toCanvas(s.coordinates[0], s.coordinates[1])
      if (Math.hypot(posX - sx, posY - sy) <= 12) return s
    }
    return null
  }, [samples, getTransform])

  // ── Draw base layer (ocean + land + states + borders + labels) ────────────
  // Accepts any 2D context (main canvas or OffscreenCanvas).
  const drawBase = useCallback((
    ctx: any,
    W: number, H: number,
    scale: number, cx: number, cy: number,
  ) => {
    const toCanvas = makeToCanvas(scale, cx, cy)
    const curZoom = zoomRef.current
    const { land, borders } = getActiveTopo()

    const ocean       = darkMode ? '#0d1b2a' : '#e8f0f8'
    const landColor   = darkMode ? '#1e3a1e' : '#d4e4c8'
    const borderColor = darkMode ? '#2a4a2a' : '#a0b890'
    const stateColor  = darkMode ? '#1a3a1a' : '#c0d0b0'
    const labelColor  = darkMode ? '#999999' : '#666666'

    ctx.fillStyle = ocean
    ctx.fillRect(0, 0, W, H)

    // Land polygons
    if (land) {
      ctx.fillStyle = landColor
      ctx.beginPath()
      if (land.type === 'FeatureCollection') {
        for (const f of land.features) traceGeomParts(ctx, f.geometry, toCanvas)
      } else {
        traceGeomParts(ctx, land.geometry, toCanvas)
      }
      ctx.fill('evenodd')
    }

    // State/province borders at zoom > 10
    if (curZoom > 10 && statesRef.current) {
      ctx.strokeStyle = stateColor
      ctx.lineWidth = 0.3
      ctx.beginPath()
      traceGeomParts(ctx, statesRef.current, toCanvas)
      ctx.stroke()
    }

    // Country borders — stroke width scales with zoom above 10×
    if (borders) {
      ctx.strokeStyle = borderColor
      ctx.lineWidth = curZoom > 10 ? Math.min(2, curZoom * 0.08) : 0.5
      ctx.beginPath()
      traceGeomParts(ctx, borders, toCanvas)
      ctx.stroke()
    }

    // Country labels at zoom > 15
    if (curZoom > 15 && countriesRef.current.length > 0) {
      const fontSize = curZoom > 20 ? Math.min(14, curZoom * 0.5) : 11
      ctx.font = `${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      ctx.fillStyle = labelColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const meta of countriesRef.current) {
        if (!meta.name || !meta.centroid) continue
        const [sx, sy] = toCanvas(meta.centroid[0], meta.centroid[1])
        if (sx < -20 || sx > W + 20 || sy < -10 || sy > H + 10) continue
        const [lx1] = toCanvas(meta.lonExtent[0], meta.centroid[1])
        const [lx2] = toCanvas(meta.lonExtent[1], meta.centroid[1])
        if (Math.abs(lx2 - lx1) < 40) continue
        ctx.fillText(meta.name, sx, sy)
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
  }, [darkMode, getActiveTopo])

  // ── Rebuild offscreen canvas with current view ────────────────────────────
  const rebuildOffscreen = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof OffscreenCanvas === 'undefined') return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    if (!W || !H) return

    const physW = W * dpr
    const physH = H * dpr

    if (!offscreenRef.current || offscreenRef.current.width !== physW || offscreenRef.current.height !== physH) {
      offscreenRef.current = new OffscreenCanvas(physW, physH)
    }

    const octx = offscreenRef.current.getContext('2d')
    if (!octx) return

    const PAD = 40
    const baseScale = Math.min((W - 2 * PAD) / (2 * X_MAX), (H - 2 * PAD) / (2 * Y_MAX))
    const scale = baseScale * zoomRef.current
    const cx = W / 2 + panRef.current.x
    const cy = H / 2 + panRef.current.y

    octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawBase(octx, W, H, scale, cx, cy)

    const { tag } = getActiveTopo()
    offscreenSnap.current = {
      zoom: zoomRef.current,
      panX: panRef.current.x,
      panY: panRef.current.y,
      dark: darkMode,
      resolution: tag,
    }
  }, [darkMode, drawBase, getActiveTopo])

  // ── Main draw ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    if (!W || !H) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (!topoLoaded) {
      ctx.fillStyle = darkMode ? '#0d1b2a' : '#e8f0f8'
      ctx.fillRect(0, 0, W, H)
      return
    }

    const PAD = 40
    const baseScale = Math.min((W - 2 * PAD) / (2 * X_MAX), (H - 2 * PAD) / (2 * Y_MAX))
    const curZoom = zoomRef.current
    const scale = baseScale * curZoom
    const cx = W / 2 + panRef.current.x
    const cy = H / 2 + panRef.current.y
    const toCanvas = makeToCanvas(scale, cx, cy)

    // Check if offscreen is valid for the current view
    const snap = offscreenSnap.current
    const { tag } = getActiveTopo()
    const offscreenOk =
      snap !== null &&
      offscreenRef.current !== null &&
      snap.zoom === curZoom &&
      snap.panX === panRef.current.x &&
      snap.panY === panRef.current.y &&
      snap.dark === darkMode &&
      snap.resolution === tag

    if (offscreenOk && offscreenRef.current) {
      // Fast path: blit pre-rendered base layer
      ctx.drawImage(offscreenRef.current, 0, 0, W, H)
    } else {
      // Slow path: draw base directly, then schedule offscreen rebuild
      drawBase(ctx, W, H, scale, cx, cy)

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        rebuildOffscreen()
        drawRef.current() // re-composite from offscreen
      }, 150)
    }

    // Always draw pins on top of base layer
    for (const s of samples) {
      const [sx, sy] = toCanvas(s.coordinates[0], s.coordinates[1])
      const isHovered = hoveredRef.current?.id === s.id
      const r = isHovered ? 9 : 6
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = CONT_COLORS[s.continent] ?? '#888'
      ctx.fill()
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Tooltip
    const hs = hoveredRef.current
    if (hs) {
      const [sx, sy] = toCanvas(hs.coordinates[0], hs.coordinates[1])
      const PAD_T = 10
      const LINE_H = 16
      const lines = [hs.name, hs.location, hs.dateCollected]
      ctx.font = 'bold 11px monospace'
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + PAD_T * 2
      const th = LINE_H * lines.length + PAD_T * 2

      let tx = sx + 14
      let ty = sy - th / 2
      if (tx + tw > W) tx = sx - tw - 14
      if (ty < 4) ty = 4
      if (ty + th > H - 4) ty = H - th - 4

      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.18)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetX = 2
      ctx.shadowOffsetY = 3
      ctx.fillStyle = darkMode ? '#1a1a1a' : '#ffffff'
      const rr = 2
      ctx.beginPath()
      ctx.moveTo(tx + rr, ty); ctx.lineTo(tx + tw - rr, ty)
      ctx.arcTo(tx + tw, ty, tx + tw, ty + rr, rr)
      ctx.lineTo(tx + tw, ty + th - rr)
      ctx.arcTo(tx + tw, ty + th, tx + tw - rr, ty + th, rr)
      ctx.lineTo(tx + rr, ty + th)
      ctx.arcTo(tx, ty + th, tx, ty + th - rr, rr)
      ctx.lineTo(tx, ty + rr)
      ctx.arcTo(tx, ty, tx + rr, ty, rr)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      lines.forEach((line, i) => {
        ctx.font = i === 0 ? 'bold 11px monospace' : '11px monospace'
        ctx.fillStyle = i === 0 ? (darkMode ? '#e8e8e8' : '#111') : (darkMode ? '#888' : '#666')
        ctx.fillText(line, tx + PAD_T, ty + PAD_T + LINE_H * i + 11)
      })
    }
  }, [darkMode, topoLoaded, samples, drawBase, rebuildOffscreen, getActiveTopo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep drawRef current so the debounce callback always calls the latest draw
  drawRef.current = draw

  // Redraw whenever view or data state changes
  useEffect(() => { draw() }, [draw, zoom, pan, hoveredSample, extraLoaded])

  // ── Zoom helper ───────────────────────────────────────────────────────────
  const doZoomAt = useCallback((mx: number, my: number, factor: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    const newZoom = Math.max(1, Math.min(50, zoomRef.current * factor))
    const ratio = newZoom / zoomRef.current
    setPan(p => ({
      x: mx - (mx - (W / 2 + p.x)) * ratio - W / 2,
      y: my - (my - (H / 2 + p.y)) * ratio - H / 2,
    }))
    setZoom(newZoom)
  }, [])

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const canvasPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true
    hasMoved.current = false
    dragStart.current = { x: e.clientX, y: e.clientY }
    panAtDragStart.current = { ...panRef.current }
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved.current = true
      setPan({ x: panAtDragStart.current.x + dx, y: panAtDragStart.current.y + dy })
    } else {
      const pos = canvasPos(e)
      const hit = getSampleAtPos(pos.x, pos.y)
      setHoveredSample(hit)
      if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'grab'
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!hasMoved.current) {
      const pos = canvasPos(e)
      const hit = getSampleAtPos(pos.x, pos.y)
      if (hit) onSelectSample(hit)
    }
    isDragging.current = false
    if (canvasRef.current) canvasRef.current.style.cursor = hoveredSample ? 'pointer' : 'grab'
  }

  const handleMouseLeave = () => {
    setHoveredSample(null)
    isDragging.current = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    doZoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 0.87)
  }

  const handleDblClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    doZoomAt(e.clientX - rect.left, e.clientY - rect.top, 2)
  }

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ cursor: 'grab', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onDoubleClick={handleDblClick}
      />
    </div>
  )
}
