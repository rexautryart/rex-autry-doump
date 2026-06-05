import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-doump-secret')
  if (secret !== process.env.DOUMP_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()
  // TODO: handle sales events from rexautry.com (e.g. kit sold → decrement inventory)
  console.log('DOUMP webhook received:', body)
  return NextResponse.json({ ok: true })
}
