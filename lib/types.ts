export interface DoumpSample {
  id: string
  name: string
  location: string
  city: string
  state: string
  country: string
  continent: string
  coordinates: [number, number] // [longitude, latitude]
  dateCollected: string
  collectedBy: string
  notes: string
  containerType: string
  condition: string
  photoUrl: string
  verified: boolean
}
