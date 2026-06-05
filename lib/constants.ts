export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://doump.rexautry.com'
export const REXAUTRY_SITE_URL = process.env.REXAUTRY_SITE_URL ?? 'https://www.rexautry.com'

export const COLORS = {
  red: '#df1b12',
  snesGreen: '#5a9a20',
  black: '#000000',
  white: '#ffffff',
} as const

export const REDIS_KEYS = {
  samples: 'doump:samples',
  inventory: 'doump:inventory',
  events: 'doump:events',
} as const
