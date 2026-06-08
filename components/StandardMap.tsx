'use client'

import { useRef, useEffect, useState } from 'react'
import * as topojson from 'topojson-client'
import type { DoumpSample } from '@/lib/types'

// ─── Winkel Tripel projection ─────────────────────────────────────────────────
const PHI_1 = Math.acos(2 / Math.PI)
const X_MAX = 0.5 * (Math.PI * Math.cos(PHI_1) + Math.PI) // ≈ 2.571
const Y_MAX = Math.PI / 2                                   // ≈ 1.5708
const MIN_ZOOM = 1
const MAX_ZOOM = 50
const PAD_CSS  = 40  // logical padding in CSS px — multiplied by dpr inside draw

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

// ─── CSS → physical canvas pixel coordinate ──────────────────────────────────
function getCursorCanvasPos(
  e: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height),
  }
}

// ─── GeoJSON path tracing with optional point simplification ──────────────────
type ToCanvasFn = (lon: number, lat: number) => [number, number]

function makeToCanvas(scale: number, cx: number, cy: number): ToCanvasFn {
  return (lon, lat) => {
    const [px, py] = projectWT(lon, lat)
    return [px * scale + cx, -py * scale + cy]
  }
}

// minDist > 0 skips projected points closer than minDist physical pixels to
// the previous accepted point. Used at low zoom to reduce draw call count.
function traceRing(
  ctx: any,
  ring: number[][],
  toCanvas: ToCanvasFn,
  close: boolean,
  minDist = 0,
) {
  const norm = normalizeRing(ring)
  let px = 0, py = 0, started = false
  for (let i = 0; i < norm.length; i++) {
    const lat = Math.max(-85, Math.min(85, norm[i][1]))
    const [sx, sy] = toCanvas(norm[i][0], lat)
    if (!started) {
      ctx.moveTo(sx, sy); px = sx; py = sy; started = true
    } else {
      if (minDist > 0 && i < norm.length - 1) {
        const dx = sx - px, dy = sy - py
        if (dx * dx + dy * dy <= minDist * minDist) continue
      }
      ctx.lineTo(sx, sy); px = sx; py = sy
    }
  }
  if (close) ctx.closePath()
}

function traceGeomParts(ctx: any, geom: any, toCanvas: ToCanvasFn, minDist = 0) {
  if (!geom) return
  switch (geom.type) {
    case 'Polygon':
      for (const r of geom.coordinates) traceRing(ctx, r, toCanvas, true, minDist); break
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const r of poly) traceRing(ctx, r, toCanvas, true, minDist)
      break
    case 'MultiLineString':
      for (const l of geom.coordinates) traceRing(ctx, l, toCanvas, false, minDist); break
    case 'LineString':
      traceRing(ctx, geom.coordinates, toCanvas, false, minDist); break
    case 'GeometryCollection':
      for (const g of (geom.geometries ?? [])) traceGeomParts(ctx, g, toCanvas, minDist); break
  }
}

// ─── Static base-layer draw (called only on offscreen rebuilds) ───────────────
interface CountryMeta {
  id: number; name: string
  centroid: [number, number] | null
  lonExtent: [number, number]
}

function drawBaseLayer(
  ctx: any,
  W: number, H: number,
  scale: number, cx: number, cy: number,
  curZoom: number,
  isDark: boolean, dpr: number,
  land: any, borders: any, states: any,
  countries: CountryMeta[],
) {
  const toCanvas = makeToCanvas(scale, cx, cy)
  // At low zoom, skip points that project within minDist physical px of previous.
  const minDist = Math.max(1, 3 / curZoom)

  ctx.fillStyle = isDark ? '#0d1b2a' : '#e8f0f8'
  ctx.fillRect(0, 0, W, H)

  if (land) {
    ctx.fillStyle = isDark ? '#1e3a1e' : '#d4e4c8'
    ctx.beginPath()
    if (land.type === 'FeatureCollection') {
      for (const f of land.features) traceGeomParts(ctx, f.geometry, toCanvas, minDist)
    } else {
      traceGeomParts(ctx, land.geometry, toCanvas, minDist)
    }
    ctx.fill('evenodd')
  }

  if (curZoom > 10 && states) {
    ctx.strokeStyle = isDark ? '#1a3a1a' : '#c0d0b0'
    ctx.lineWidth = 0.3 * dpr
    ctx.beginPath()
    traceGeomParts(ctx, states, toCanvas, minDist)
    ctx.stroke()
  }

  if (borders) {
    ctx.strokeStyle = isDark ? '#2a4a2a' : '#a0b890'
    ctx.lineWidth = (curZoom > 10 ? Math.min(2, curZoom * 0.08) : 0.5) * dpr
    ctx.beginPath()
    traceGeomParts(ctx, borders, toCanvas, minDist)
    ctx.stroke()
  }

  if (curZoom > 15 && countries.length > 0) {
    const basePx = curZoom > 20 ? Math.min(14, curZoom * 0.5) : 11
    ctx.font = `${basePx * dpr}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    ctx.fillStyle = isDark ? '#999999' : '#666666'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const meta of countries) {
      if (!meta.name || !meta.centroid) continue
      const [sx, sy] = toCanvas(meta.centroid[0], meta.centroid[1])
      if (sx < -20 || sx > W + 20 || sy < -10 || sy > H + 10) continue
      const [lx1] = toCanvas(meta.lonExtent[0], meta.centroid[1])
      const [lx2] = toCanvas(meta.lonExtent[1], meta.centroid[1])
      if (Math.abs(lx2 - lx1) < 40 * dpr) continue
      ctx.fillText(meta.name, sx, sy)
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
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

// ─── Props ────────────────────────────────────────────────────────────────────
interface StandardMapProps {
  samples: DoumpSample[]
  onSelectSample: (s: DoumpSample) => void
  darkMode?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function StandardMap({ samples, onSelectSample, darkMode = false }: StandardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  // ── View state — physical canvas pixels throughout ────────────────────────
  const zoomRef = useRef(MIN_ZOOM)
  const panRef  = useRef({ x: 0, y: 0 })
  const darkModeRef = useRef(darkMode)
  darkModeRef.current = darkMode
  const samplesRef = useRef(samples)
  samplesRef.current = samples

  // ── RAF / wheel accumulator ───────────────────────────────────────────────
  const rafId             = useRef(0)
  const pendingZoomFactor = useRef(1)
  const pendingZoomMx     = useRef(0)
  const pendingZoomMy     = useRef(0)

  // ── Two-layer offscreen refs ──────────────────────────────────────────────
  // Layer 1: static base (ocean, land, borders, labels) in offscreenRef.
  // Built once per debounce period; composited via drawImage offset for pan.
  const offscreenRef  = useRef<OffscreenCanvas | null>(null)
  const baseOxRef     = useRef(0)   // panRef.x when offscreen was built
  const baseOyRef     = useRef(0)   // panRef.y when offscreen was built
  const baseZoomRef   = useRef(MIN_ZOOM) // zoom when offscreen was built
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Topology refs ─────────────────────────────────────────────────────────
  const land110      = useRef<any>(null)
  const borders110   = useRef<any>(null)
  const countriesRef = useRef<CountryMeta[]>([])
  const land50       = useRef<any>(null)
  const borders50    = useRef<any>(null)
  const loading50    = useRef(false)
  const loaded50     = useRef(false)
  const land10       = useRef<any>(null)
  const borders10    = useRef<any>(null)
  const loading10    = useRef(false)
  const loaded10     = useRef(false)
  const statesRef    = useRef<any>(null)
  const loadingStates = useRef(false)
  const loadedStates  = useRef(false)

  // ── Hover / drag ──────────────────────────────────────────────────────────
  const hoveredRef  = useRef<DoumpSample | null>(null)
  const isDragging  = useRef(false)
  const hasMoved    = useRef(false)
  const lastDragX   = useRef(0)
  const lastDragY   = useRef(0)

  // ── React state — only for lazy-fetch triggers ────────────────────────────
  const [topoLoaded, setTopoLoaded]                   = useState(false)
  const topoLoadedRef                                  = useRef(false)
  const [zoomForThresholds, setZoomForThresholds]     = useState(MIN_ZOOM)
  const [extraLoaded, setExtraLoaded]                 = useState(0)

  // ── Active resolution ─────────────────────────────────────────────────────
  const getActiveTopo = () => {
    const z = zoomRef.current
    if (z > 15 && loaded10.current) return { land: land10.current, borders: borders10.current }
    if (z > 5  && loaded50.current) return { land: land50.current, borders: borders50.current }
    return { land: land110.current, borders: borders110.current }
  }

  // ── Layer 1: build static base into offscreen canvas ─────────────────────
  // Expensive — only called when content actually changes, via scheduleRebuild.
  const buildOffscreen = () => {
    const canvas = canvasRef.current
    if (!canvas || !topoLoadedRef.current) return

    const dpr = window.devicePixelRatio || 1
    const W   = canvas.width
    const H   = canvas.height
    if (!W || !H) return

    if (typeof OffscreenCanvas === 'undefined') return

    if (!offscreenRef.current || offscreenRef.current.width !== W || offscreenRef.current.height !== H) {
      offscreenRef.current = new OffscreenCanvas(W, H)
    }

    const octx = offscreenRef.current.getContext('2d')
    if (!octx) return

    const PAD = PAD_CSS * dpr
    const baseScale = Math.min((W - 2*PAD) / (2*X_MAX), (H - 2*PAD) / (2*Y_MAX))
    const scale = baseScale * zoomRef.current
    const cx = W / 2 + panRef.current.x
    const cy = H / 2 + panRef.current.y
    const { land, borders } = getActiveTopo()

    octx.setTransform(1, 0, 0, 1, 0, 0)
    drawBaseLayer(octx, W, H, scale, cx, cy, zoomRef.current,
      darkModeRef.current, dpr, land, borders, statesRef.current, countriesRef.current)

    // Record the pan/zoom state at which this offscreen was built
    baseOxRef.current   = panRef.current.x
    baseOyRef.current   = panRef.current.y
    baseZoomRef.current = zoomRef.current
  }

  // ── Layer 2: draw dynamic overlay (pins + tooltip) ────────────────────────
  // Cheap — always redrawn from current zoom/pan refs.
  const drawPinsAndTooltip = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
    const dpr = window.devicePixelRatio || 1
    const PAD = PAD_CSS * dpr
    const baseScale = Math.min((W - 2*PAD) / (2*X_MAX), (H - 2*PAD) / (2*Y_MAX))
    const scale = baseScale * zoomRef.current
    const cx = W / 2 + panRef.current.x
    const cy = H / 2 + panRef.current.y
    const toCanvas = makeToCanvas(scale, cx, cy)

    const pinR    = 6   * dpr
    const pinRHov = 9   * dpr
    const strokeW = 1.5 * dpr
    for (const s of samplesRef.current) {
      const [sx, sy] = toCanvas(s.coordinates[0], s.coordinates[1])
      const r = hoveredRef.current?.id === s.id ? pinRHov : pinR
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = CONT_COLORS[s.continent] ?? '#888'
      ctx.fill()
      ctx.strokeStyle = 'white'
      ctx.lineWidth = strokeW
      ctx.stroke()
    }

    const hs = hoveredRef.current
    if (!hs) return
    const [sx, sy] = toCanvas(hs.coordinates[0], hs.coordinates[1])
    const PT = 10 * dpr, LH = 16 * dpr, offset = 14 * dpr
    const lines = [hs.name, hs.location, hs.dateCollected]
    ctx.font = `bold ${11 * dpr}px monospace`
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + PT * 2
    const th = LH * lines.length + PT * 2
    let tx = sx + offset, ty = sy - th / 2
    if (tx + tw > W) tx = sx - tw - offset
    if (ty < 4) ty = 4
    if (ty + th > H - 4) ty = H - th - 4

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 10 * dpr
    ctx.shadowOffsetX = 2 * dpr; ctx.shadowOffsetY = 3 * dpr
    ctx.fillStyle = darkModeRef.current ? '#1a1a1a' : '#ffffff'
    const rr = 2 * dpr
    ctx.beginPath()
    ctx.moveTo(tx+rr, ty); ctx.lineTo(tx+tw-rr, ty)
    ctx.arcTo(tx+tw, ty, tx+tw, ty+rr, rr)
    ctx.lineTo(tx+tw, ty+th-rr)
    ctx.arcTo(tx+tw, ty+th, tx+tw-rr, ty+th, rr)
    ctx.lineTo(tx+rr, ty+th)
    ctx.arcTo(tx, ty+th, tx, ty+th-rr, rr)
    ctx.lineTo(tx, ty+rr)
    ctx.arcTo(tx, ty, tx+rr, ty, rr)
    ctx.closePath(); ctx.fill()
    ctx.restore()
    lines.forEach((line, i) => {
      ctx.font = i === 0 ? `bold ${11*dpr}px monospace` : `${11*dpr}px monospace`
      ctx.fillStyle = i === 0
        ? (darkModeRef.current ? '#e8e8e8' : '#111')
        : (darkModeRef.current ? '#888' : '#666')
      ctx.fillText(line, tx + PT, ty + PT + LH * i + 11 * dpr)
    })
  }

  // ── drawFrame: composite layers onto main canvas ──────────────────────────
  // Called every RAF. Fast path: blit offscreen with pan delta + draw pins.
  const drawFrame = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width, H = canvas.height
    if (!W || !H) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (!topoLoadedRef.current) {
      ctx.fillStyle = darkModeRef.current ? '#0d1b2a' : '#e8f0f8'
      ctx.fillRect(0, 0, W, H)
      drawPinsAndTooltip(ctx, W, H)
      return
    }

    const ocean = darkModeRef.current ? '#0d1b2a' : '#e8f0f8'

    if (!offscreenRef.current) {
      // No offscreen yet (first frame or after resize) — draw base directly once
      const dpr = window.devicePixelRatio || 1
      const PAD = PAD_CSS * dpr
      const baseScale = Math.min((W-2*PAD)/(2*X_MAX), (H-2*PAD)/(2*Y_MAX))
      const scale = baseScale * zoomRef.current
      const cx = W/2 + panRef.current.x
      const cy = H/2 + panRef.current.y
      const { land, borders } = getActiveTopo()
      drawBaseLayer(ctx, W, H, scale, cx, cy, zoomRef.current,
        darkModeRef.current, dpr, land, borders, statesRef.current, countriesRef.current)
    } else {
      // Compute delta between current view and the view the offscreen was built for
      const dx = panRef.current.x - baseOxRef.current
      const dy = panRef.current.y - baseOyRef.current
      const zoomRatio = zoomRef.current / baseZoomRef.current

      // Fill background first so pan-exposed edges show ocean, not black
      ctx.fillStyle = ocean
      ctx.fillRect(0, 0, W, H)

      if (Math.abs(zoomRatio - 1) < 0.02) {
        // Pure pan — free: just blit with pixel offset
        ctx.drawImage(offscreenRef.current, dx, dy)
      } else {
        // Active zoom — scale the cached base as approximation.
        // After 200ms settle, scheduleRebuild fires and redraws exactly.
        // The zoom center in screen space is where the cursor is, which
        // corresponds to (W/2 + dx, H/2 + dy) relative to offscreen center.
        ctx.save()
        ctx.translate(W / 2 + dx, H / 2 + dy)
        ctx.scale(zoomRatio, zoomRatio)
        ctx.translate(-W / 2, -H / 2)
        ctx.drawImage(offscreenRef.current, 0, 0)
        ctx.restore()
      }
    }

    drawPinsAndTooltip(ctx, W, H)
  }
  const drawFrameRef = useRef(drawFrame)
  drawFrameRef.current = drawFrame

  // ── scheduleRebuild: deferred high-quality base rebuild ───────────────────
  // Debounced 200ms after the last call. Rebuilds offscreen then redraws.
  // Pass delay=0 for immediate rebuild (resize, dark mode, new topo data).
  const scheduleRebuild = (delay = 200) => {
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
    rebuildTimerRef.current = setTimeout(() => {
      rebuildTimerRef.current = null
      buildOffscreen()
      drawFrameRef.current()
    }, delay)
  }
  const scheduleRebuildRef = useRef(scheduleRebuild)
  scheduleRebuildRef.current = scheduleRebuild

  // ── scheduleDraw: RAF-batched frame composite (cheap, every interaction) ──
  const scheduleDraw = () => {
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0
      // Apply accumulated wheel zoom (one shot, eliminates FP drift)
      if (pendingZoomFactor.current !== 1) {
        const factor = pendingZoomFactor.current
        pendingZoomFactor.current = 1
        const canvas = canvasRef.current
        if (canvas) {
          const W = canvas.width, H = canvas.height
          const mx = pendingZoomMx.current
          const my = pendingZoomMy.current
          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor))
          const af  = newZoom / zoomRef.current
          const mxc = mx - W / 2
          const myc = my - H / 2
          panRef.current = {
            x: mxc - af * (mxc - panRef.current.x),
            y: myc - af * (myc - panRef.current.y),
          }
          zoomRef.current = newZoom
          setZoomForThresholds(newZoom)
        }
        // Defer quality rebuild until zoom settles
        scheduleRebuildRef.current(200)
      }
      drawFrameRef.current()
    })
  }
  const scheduleDrawRef = useRef(scheduleDraw)
  scheduleDrawRef.current = scheduleDraw

  // ── doZoomAt: precise cursor-centered zoom (double-click + keyboard) ──────
  const doZoomAt = (mx: number, my: number, factor: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.width, H = canvas.height
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor))
    const af = newZoom / zoomRef.current
    const mxc = mx - W / 2, myc = my - H / 2
    panRef.current = {
      x: mxc - af * (mxc - panRef.current.x),
      y: myc - af * (myc - panRef.current.y),
    }
    zoomRef.current = newZoom
    setZoomForThresholds(newZoom)
    scheduleDraw()
    scheduleRebuildRef.current(200)
  }
  const doZoomAtRef = useRef(doZoomAt)
  doZoomAtRef.current = doZoomAt

  // ── Initial 110m fetch ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(topo => {
        land110.current    = topojson.feature(topo, topo.objects.land)
        borders110.current = topojson.mesh(topo, topo.objects.countries as any, (a: any, b: any) => a !== b)
        const fc = topojson.feature(topo, topo.objects.countries as any) as any
        countriesRef.current = (fc.features ?? []).map((f: any) => ({
          id: f.id as number,
          name: COUNTRY_NAMES[f.id as number] ?? '',
          centroid: computeCentroid(f.geometry),
          lonExtent: getLonExtent(f.geometry),
        }))
        topoLoadedRef.current = true
        setTopoLoaded(true)
      })
  }, [])

  // ── Lazy higher-res fetches ───────────────────────────────────────────────
  useEffect(() => {
    if (zoomForThresholds > 5 && !loaded50.current && !loading50.current) {
      loading50.current = true
      fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json')
        .then(r => r.json())
        .then(topo => {
          land50.current    = topojson.feature(topo, topo.objects.land)
          borders50.current = topojson.mesh(topo, topo.objects.countries as any, (a: any, b: any) => a !== b)
          loaded50.current  = true
          setExtraLoaded(n => n + 1)
        })
    }
    if (zoomForThresholds > 10 && !loadedStates.current && !loadingStates.current) {
      loadingStates.current = true
      fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/states-10m.json')
        .then(r => r.json())
        .then(topo => {
          statesRef.current    = topojson.mesh(topo, topo.objects.states as any, (a: any, b: any) => a !== b)
          loadedStates.current = true
          setExtraLoaded(n => n + 1)
        })
    }
    if (zoomForThresholds > 15 && !loaded10.current && !loading10.current) {
      loading10.current = true
      fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-10m.json')
        .then(r => r.json())
        .then(topo => {
          land10.current    = topojson.feature(topo, topo.objects.land)
          borders10.current = topojson.mesh(topo, topo.objects.countries as any, (a: any, b: any) => a !== b)
          loaded10.current  = true
          setExtraLoaded(n => n + 1)
        })
    }
  }, [zoomForThresholds])

  // New topo / dark mode: rebuild immediately (delay=0), then frame
  useEffect(() => {
    scheduleRebuildRef.current(0)
  }, [topoLoaded, extraLoaded, darkMode])

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const update = () => {
      const dpr = window.devicePixelRatio || 1
      const W   = container.clientWidth
      const H   = Math.round(W * 0.56)
      canvas.style.width  = `${W}px`
      canvas.style.height = `${H}px`
      canvas.width  = W * dpr
      canvas.height = H * dpr
      offscreenRef.current = null // size changed — must rebuild
      scheduleRebuildRef.current(0)
    }
    const ro = new ResizeObserver(update)
    ro.observe(container)
    update()
    return () => ro.disconnect()
  }, [])

  // ── Native wheel (passive:false) ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const pos = getCursorCanvasPos(e, canvas)
      pendingZoomMx.current      = pos.x
      pendingZoomMy.current      = pos.y
      pendingZoomFactor.current *= factor
      scheduleDrawRef.current()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // ── Keyboard zoom ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (e.key === '+' || e.key === '=')
        doZoomAtRef.current(canvas.width / 2, canvas.height / 2, 1.3)
      else if (e.key === '-')
        doZoomAtRef.current(canvas.width / 2, canvas.height / 2, 1 / 1.3)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Hit test ──────────────────────────────────────────────────────────────
  const getSampleAtPos = (posX: number, posY: number): DoumpSample | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const dpr  = window.devicePixelRatio || 1
    const W    = canvas.width, H = canvas.height
    const PAD  = PAD_CSS * dpr
    const base = Math.min((W-2*PAD)/(2*X_MAX), (H-2*PAD)/(2*Y_MAX))
    const tc   = makeToCanvas(base * zoomRef.current, W/2 + panRef.current.x, H/2 + panRef.current.y)
    const hitR = 12 * dpr
    for (const s of samplesRef.current) {
      const [sx, sy] = tc(s.coordinates[0], s.coordinates[1])
      if (Math.hypot(posX - sx, posY - sy) <= hitR) return s
    }
    return null
  }

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true
    hasMoved.current   = false
    lastDragX.current  = e.clientX
    lastDragY.current  = e.clientY
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (isDragging.current) {
      const dpr = window.devicePixelRatio || 1
      const dx  = (e.clientX - lastDragX.current) * dpr
      const dy  = (e.clientY - lastDragY.current) * dpr
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved.current = true
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy }
      lastDragX.current = e.clientX
      lastDragY.current = e.clientY
      scheduleDrawRef.current()
      scheduleRebuildRef.current(200) // rebuild after drag settles
    } else {
      const pos = getCursorCanvasPos(e, canvas)
      const hit = getSampleAtPos(pos.x, pos.y)
      if (hit?.id !== hoveredRef.current?.id) {
        hoveredRef.current = hit
        scheduleDrawRef.current()
      }
      canvas.style.cursor = hit ? 'pointer' : 'grab'
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!hasMoved.current && canvas) {
      const pos = getCursorCanvasPos(e, canvas)
      const hit = getSampleAtPos(pos.x, pos.y)
      if (hit) onSelectSample(hit)
    }
    isDragging.current = false
    if (canvas) canvas.style.cursor = hoveredRef.current ? 'pointer' : 'grab'
  }

  const handleMouseLeave = () => {
    if (hoveredRef.current) { hoveredRef.current = null; scheduleDrawRef.current() }
    isDragging.current = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }

  const handleDblClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pos = getCursorCanvasPos(e, canvas)
    doZoomAtRef.current(pos.x, pos.y, 2)
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
        onDoubleClick={handleDblClick}
      />
    </div>
  )
}
