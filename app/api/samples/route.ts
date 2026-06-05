import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { REDIS_KEYS } from '@/lib/constants'
import type { DirtSample } from '@/lib/samples'
import samplesJson from '@/public/doump-samples.json'

async function getSamples(): Promise<DirtSample[]> {
  try {
    const cached = await redis.get<DirtSample[]>(REDIS_KEYS.samples)
    if (cached) return cached
  } catch {
    // fall through to static data if Redis unavailable
  }
  return samplesJson as DirtSample[]
}

export async function GET() {
  const samples = await getSamples()
  return NextResponse.json(samples)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as DirtSample
  const samples = await getSamples()
  samples.push(body)
  await redis.set(REDIS_KEYS.samples, samples)
  return NextResponse.json(body, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as DirtSample
  const samples = await getSamples()
  const idx = samples.findIndex(s => s.id === body.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  samples[idx] = body
  await redis.set(REDIS_KEYS.samples, samples)
  return NextResponse.json(body)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const samples = await getSamples()
  const filtered = samples.filter(s => s.id !== id)
  await redis.set(REDIS_KEYS.samples, filtered)
  return NextResponse.json({ ok: true })
}
