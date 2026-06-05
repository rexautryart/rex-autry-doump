import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { REDIS_KEYS } from '@/lib/constants'

export const revalidate = 3600

export async function GET() {
  try {
    const events = await redis.get(REDIS_KEYS.events)
    return NextResponse.json(events ?? [])
  } catch {
    return NextResponse.json([])
  }
}
