import samplesJson from '@/public/doump-samples.json'

export type DirtSample = {
  id: string
  name: string
  location: string
  city: string
  state: string
  country: string
  continent: string
  coordinates: [number, number]
  dateCollected: string
  collectedBy: string
  notes: string
  containerType: string
  condition: string
  photoUrl: string
  verified: boolean
}

export function getStaticSamples(): DirtSample[] {
  return samplesJson as DirtSample[]
}
