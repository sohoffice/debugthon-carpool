import { readFileSync } from 'node:fs'
import type { LatLng } from '../geo.ts'
import { parseSeed, type Seed } from './seed.ts'

const REPO = new URL('../../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, REPO), 'utf8')

export interface CsvStop extends LatLng {
  name: string
}

/** One bus route direction with its stop ids in order. */
export interface BusRoute {
  name: string
  stopIds: number[]
}

export interface StaticData {
  seed: Seed
  /** Every Taipei bus stop by open-data stop id (corridors and bus alternatives use stops outside the park). */
  csvStops: Map<number, CsvStop>
  busRoutes: BusRoute[]
  /** Park boundary ring, [lng, lat] pairs. */
  parkRing: [number, number][]
}

/** Reads the Go migrations and the open data from the repo; fails loudly if a file moved. */
export function loadStaticData(): StaticData {
  const seed = parseSeed({
    schema: read('backend/migrations/20261018122058_create_schema.sql'),
    users: read('backend/migrations/20261018123407_seed_test_users.sql'),
    reference: read('backend/migrations/20261018140000_seed_reference_data.sql'),
  })

  const csvStops = new Map<number, CsvStop>()
  for (const line of read('docs/data/busstop/busstops.csv').trim().split('\n').slice(1)) {
    const [id, name, lat, lng] = line.split(',')
    csvStops.set(Number(id), { name, lat: Number(lat), lng: Number(lng) })
  }

  const byRoute = new Map<string, { name: string; stops: [number, number][] }>()
  for (const line of read('docs/data/busstop/stop_routes.csv').trim().split('\n').slice(1)) {
    const [stopId, routeId, routeName, goBack, seq] = line.split(',')
    const key = `${routeId}:${goBack}`
    const entry = byRoute.get(key) ?? { name: routeName, stops: [] }
    entry.stops.push([Number(seq), Number(stopId)])
    byRoute.set(key, entry)
  }
  const busRoutes = [...byRoute.values()].map((r) => ({
    name: r.name,
    stopIds: [...r.stops].sort((a, b) => a[0] - b[0]).map(([, id]) => id),
  }))

  const geojson = JSON.parse(read('docs/data/park/boundary.geojson'))
  const parkRing = geojson.features[0].geometry.coordinates[0] as [number, number][]

  return { seed, csvStops, busRoutes, parkRing }
}
