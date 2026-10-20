import { readFileSync } from 'node:fs'
import type { LatLng } from '../geo.ts'
import { parseSeed, type Seed } from './seed.ts'

const REPO = new URL('../../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, REPO), 'utf8')

export interface CsvStop extends LatLng {
  name: string
}

export interface StaticData {
  seed: Seed
  /** Every Taipei bus stop by open-data stop id (the corridors use stops outside the park). */
  csvStops: Map<number, CsvStop>
  /** Park boundary ring, [lng, lat] pairs. */
  parkRing: [number, number][]
}

/** Reads the Go migrations and the open data from the repo; fails loudly if a file moved. */
export function loadStaticData(): StaticData {
  const seed = parseSeed({
    schema: read('backend/migrations/20261018122058_create_schema.sql'),
    users: read('backend/migrations/20261018123407_seed_test_users.sql'),
    reference: read('backend/migrations/20261018140000_seed_reference_data.sql'),
    activities: read('backend/migrations/20261019130000_activities_and_vehicles.sql'),
    passMargin: read('backend/migrations/20261019150000_pass_margin_setting.sql'),
  })

  const csvStops = new Map<number, CsvStop>()
  for (const line of read('docs/data/busstop/busstops.csv').trim().split('\n').slice(1)) {
    const [id, name, lat, lng] = line.split(',')
    csvStops.set(Number(id), { name, lat: Number(lat), lng: Number(lng) })
  }

  const geojson = JSON.parse(read('backend/config/park/boundary.geojson'))
  const parkRing = geojson.features[0].geometry.coordinates[0] as [number, number][]

  return { seed, csvStops, parkRing }
}
