import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { REDIS_KEYS } from '@/lib/constants'

export async function GET() {
  try {
    const inventory = await redis.get(REDIS_KEYS.inventory)
    return NextResponse.json(inventory ?? { bottleKits: 0, filmCanisters: 0, vials: 0 })
  } catch {
    return NextResponse.json({ bottleKits: 0, filmCanisters: 0, vials: 0 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  await redis.set(REDIS_KEYS.inventory, body)
  return NextResponse.json(body, { status: 201 })
}
