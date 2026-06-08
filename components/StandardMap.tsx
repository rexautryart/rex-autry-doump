'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import * as topojson from 'topojson-client'
import type { DoumpSample } from '@/lib/types'

// ─── Winkel Tripel projection ───────────────────────────────────────────────
const PHI_1 = Math.acos(2 / Math.PI)
const X_MAX = 0.5 * (Math.PI * Math.cos(PHI_1) + Math.PI) // ≈ 2.571
const Y_MAX = Math.PI / 2                                    // ≈ 1.5708

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

// ─── Continent colors for pins ───────────────────────────────────────────────
const CONT_COLORS: Record<string, string> = {
  'North America': '#4a90d9',
  'South America': '#7bc47e',
  'Europe': '#e8a84b',
  'Africa': '#d45f3a',
  'Asia': '#9b6bc5',
  'Australia': '#e8c84b',
  'Oceania': '#e8c84b',
  'Antarctica': '#9ec8d4',
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface StandardMapProps {
  samples: DoumpSample[]
  onSelectSample: (s: DoumpSample) => void
  darkMode?: boolean
}

// ─── GeoJSON path helpers ────────────────────────────────────────────────────
type ToCanvasFn = (lon: number, lat: number) => [number, number]

function traceRing(ctx: CanvasRenderingContext2D, ring: number[][], toCanvas: ToCanvasFn, close: boolean) {
  let prevLon: number | null = null
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i]
    const crossesMeridian = prevLon !== null && Math.abs(lon - prevLon) > 180
    const [sx, sy] = toCanvas(lon, lat)
    if (i === 0 || crossesMeridian) {
      ctx.moveTo(sx, sy)
    } else {
      ctx.lineTo(sx, sy)
    }
    prevLon = lon
  }
  if (close) ctx.closePath()
}

function traceGeometry(ctx: CanvasRenderingContext2D, geom: any, toCanvas: ToCanvasFn) {
  ctx.beginPath()
  if (!geom) return
  switch (geom.type) {
    case 'Polygon':
      for (const ring of geom.coordinates) traceRing(ctx, ring, toCanvas, true)
      break
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const ring of poly) traceRing(ctx, ring, toCanvas, true)
      break
    case 'MultiLineString':
      for (const line of geom.coordinates) traceRing(ctx, line, toCanvas, false)
      break
    case 'LineString':
      traceRing(ctx, geom.coordinates, toCanvas, false)
      break
    case 'GeometryCollection':
      for (const g of (geom.geometries ?? [])) traceGeometry(ctx, g, toCanvas)
      break
  }
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function StandardMap({ samples, onSelectSample, darkMode = false }: StandardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Cached topology features (computed once after fetch)
  const landRef = useRef<any>(null)
  const bordersRef = useRef<any>(null)
  const [topoLoaded, setTopoLoaded] = useState(false)

  // View state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [, setSize] = useState({ w: 0, h: 0 }) // triggers redraw on resize

  // Interaction refs (avoid re-renders during drag)
  const isDragging = useRef(false)
  const hasMoved = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panAtDragStart = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // Hover state
  const [hoveredSample, setHoveredSample] = useState<DoumpSample | null>(null)
  const hoveredRef = useRef<DoumpSample | null>(null)
  hoveredRef.current = hoveredSample

  // ── Fetch world atlas ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(topo => {
        landRef.current = topojson.feature(topo, topo.objects.land)
        bordersRef.current = topojson.mesh(
          topo,
          topo.objects.countries as any,
          (a: any, b: any) => a !== b
        )
        setTopoLoaded(true)
      })
  }, [])

  // ── Resize observer ──────────────────────────────────────────────────────
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
      setSize({ w: W, h: H })
    }

    const ro = new ResizeObserver(update)
    ro.observe(container)
    update()
    return () => ro.disconnect()
  }, [])

  // ── Projection helpers ───────────────────────────────────────────────────
  const getTransform = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    const PAD = 40
    const baseScale = Math.min(
      (W - 2 * PAD) / (2 * X_MAX),
      (H - 2 * PAD) / (2 * Y_MAX)
    )
    return {
      W, H,
      scale: baseScale * zoomRef.current,
      cx: W / 2 + panRef.current.x,
      cy: H / 2 + panRef.current.y,
    }
  }, [])

  const makeToCanvas = (scale: number, cx: number, cy: number): ToCanvasFn =>
    (lon, lat) => {
      const [px, py] = projectWT(lon, lat)
      return [px * scale + cx, -py * scale + cy]
    }

  const getSampleAtPos = useCallback((posX: number, posY: number): DoumpSample | null => {
    const t = getTransform()
    if (!t) return null
    const toCanvas = makeToCanvas(t.scale, t.cx, t.cy)
    for (const s of samples) {
      const [sx, sy] = toCanvas(s.coordinates[0], s.coordinates[1])
      if (Math.hypot(posX - sx, posY - sy) <= 12) return s
    }
    return null
  }, [samples, getTransform]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw ─────────────────────────────────────────────────────────────────
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

    const PAD = 40
    const baseScale = Math.min(
      (W - 2 * PAD) / (2 * X_MAX),
      (H - 2 * PAD) / (2 * Y_MAX)
    )
    const scale = baseScale * zoomRef.current
    const cx = W / 2 + panRef.current.x
    const cy = H / 2 + panRef.current.y
    const toCanvas = makeToCanvas(scale, cx, cy)

    // Colors
    const ocean   = darkMode ? '#0d1b2a' : '#e8f0f8'
    const land    = darkMode ? '#1e3a1e' : '#d4e4c8'
    const border  = darkMode ? '#2a4a2a' : '#a0b890'

    // Clear with ocean
    ctx.fillStyle = ocean
    ctx.fillRect(0, 0, W, H)

    if (!topoLoaded) return

    // Land fill
    if (landRef.current) {
      const geom = landRef.current.type === 'FeatureCollection'
        ? { type: 'GeometryCollection', geometries: landRef.current.features.map((f: any) => f.geometry) }
        : landRef.current.geometry
      ctx.fillStyle = land
      traceGeometry(ctx, geom, toCanvas)
      ctx.fill('evenodd')
    }

    // Country borders
    if (bordersRef.current) {
      ctx.strokeStyle = border
      ctx.lineWidth = 0.5
      traceGeometry(ctx, bordersRef.current, toCanvas)
      ctx.stroke()
    }

    // Sample pins
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
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + PAD_T * 2
      const h = LINE_H * lines.length + PAD_T * 2

      let tx = sx + 14
      let ty = sy - h / 2
      if (tx + w > W) tx = sx - w - 14
      if (ty < 4) ty = 4
      if (ty + h > H - 4) ty = H - h - 4

      const bg = darkMode ? '#1a1a1a' : '#ffffff'
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.18)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetX = 2
      ctx.shadowOffsetY = 3
      ctx.fillStyle = bg
      const rr = 2
      ctx.beginPath()
      ctx.moveTo(tx + rr, ty)
      ctx.lineTo(tx + w - rr, ty)
      ctx.arcTo(tx + w, ty, tx + w, ty + rr, rr)
      ctx.lineTo(tx + w, ty + h - rr)
      ctx.arcTo(tx + w, ty + h, tx + w - rr, ty + h, rr)
      ctx.lineTo(tx + rr, ty + h)
      ctx.arcTo(tx, ty + h, tx, ty + h - rr, rr)
      ctx.lineTo(tx, ty + rr)
      ctx.arcTo(tx, ty, tx + rr, ty, rr)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      lines.forEach((line, i) => {
        ctx.font = i === 0 ? 'bold 11px monospace' : '11px monospace'
        ctx.fillStyle = i === 0
          ? (darkMode ? '#e8e8e8' : '#111')
          : (darkMode ? '#888' : '#666')
        ctx.fillText(line, tx + PAD_T, ty + PAD_T + LINE_H * i + 11)
      })
    }
  }, [darkMode, topoLoaded, samples]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw whenever relevant state changes
  useEffect(() => { draw() }, [draw, zoom, pan, hoveredSample])

  // ── Mouse handlers ───────────────────────────────────────────────────────
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
      if (canvasRef.current)
        canvasRef.current.style.cursor = hit ? 'pointer' : 'grab'
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!hasMoved.current) {
      const pos = canvasPos(e)
      const hit = getSampleAtPos(pos.x, pos.y)
      if (hit) onSelectSample(hit)
    }
    isDragging.current = false
    if (canvasRef.current)
      canvasRef.current.style.cursor = hoveredSample ? 'pointer' : 'grab'
  }

  const handleMouseLeave = () => {
    setHoveredSample(null)
    isDragging.current = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight

    const factor = e.deltaY < 0 ? 1.15 : 0.87
    const newZoom = Math.max(1, Math.min(6, zoomRef.current * factor))
    const ratio = newZoom / zoomRef.current

    setPan(p => ({
      x: mx - (mx - (W / 2 + p.x)) * ratio - W / 2,
      y: my - (my - (H / 2 + p.y)) * ratio - H / 2,
    }))
    setZoom(newZoom)
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
      />
    </div>
  )
}
