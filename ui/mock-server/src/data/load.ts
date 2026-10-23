import { readdirSync, readFileSync } from 'node:fs'
import type { LatLng } from '../geo.ts'
import { parseSeed, type Seed } from './seed.ts'

const REPO = new URL('../../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, REPO), 'utf8')

export interface CsvStop extends LatLng {
  name: string
}

/** A gateway into Neihu from docs/data/tdx-vd/detectors.csv (DD-36): its static fields only. */
export interface CsvGateway {
  vd_id: string
  source: 'city' | 'freeway'
  gateway: string
  road_name: string
  road_direction: string
  bearing: string
  sort_order: number
  location_note: string
  lat: number
  lng: number
  shape: LatLng[] | null
  proxy: boolean
  proxy_note: string | null
  reference_speed_kmh: number
}

export interface StaticData {
  seed: Seed
  /** Every Taipei bus stop by open-data stop id (the corridors use stops outside the park). */
  csvStops: Map<number, CsvStop>
  /** Park boundary ring, [lng, lat] pairs. */
  parkRing: [number, number][]
  /** The 16 gateways into Neihu, by sort_order (UD-28). */
  gateways: CsvGateway[]
}

/** RFC 4180 rows: a field may be quoted, with "" for a quote inside; no quoted line breaks. */
function csvRows(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const fields: string[] = []
      let field = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted && ch === '"' && line[i + 1] === '"') {
          field += '"'
          i++
        } else if (ch === '"') {
          quoted = !quoted
        } else if (ch === ',' && !quoted) {
          fields.push(field)
          field = ''
        } else {
          field += ch
        }
      }
      return [...fields, field]
    })
}

function parseGateways(text: string): CsvGateway[] {
  const [header, ...rows] = csvRows(text)
  const gateways = rows.map((cells): CsvGateway => {
    const r = Object.fromEntries(header.map((h, i) => [h, cells[i]]))
    if (r.source !== 'city' && r.source !== 'freeway') throw new Error(`detectors.csv: bad source for ${r.vd_id}`)
    return {
      vd_id: r.vd_id,
      source: r.source,
      gateway: r.gateway,
      road_name: r.road_name,
      road_direction: r.road_direction,
      bearing: r.bearing,
      sort_order: Number(r.sort_order),
      location_note: r.location_note,
      lat: Number(r.lat),
      lng: Number(r.lng),
      shape: r.shape ? (JSON.parse(r.shape) as LatLng[]) : null,
      proxy: r.proxy === 'true',
      proxy_note: r.proxy_note || null,
      reference_speed_kmh: Number(r.reference_speed_kmh),
    }
  })
  return [...gateways].sort((a, b) => a.sort_order - b.sort_order)
}

/** Reads the Go migrations and the open data from the repo; fails loudly if a file moved. */
export function loadStaticData(): StaticData {
  const seed = parseSeed({
    schema: read('backend/migrations/20261018122058_create_schema.sql'),
    users: read('backend/migrations/20261018123407_seed_test_users.sql'),
    reference: read('backend/migrations/20261018140000_seed_reference_data.sql'),
    activities: read('backend/migrations/20261019130000_activities_and_vehicles.sql'),
    passMargin: read('backend/migrations/20261019150000_pass_margin_setting.sql'),
    points: read('backend/migrations/20261022100000_driver_points.sql'),
    tagRoles: read('backend/migrations/20261023100000_tag_roles.sql'),
    // Every migration's Up part in order: later ones may move driver2's destination again.
    migrationsUp: readdirSync(new URL('backend/migrations/', REPO))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => read(`backend/migrations/${f}`).split('-- +goose Down')[0])
      .join('\n'),
  })

  const csvStops = new Map<number, CsvStop>()
  for (const line of read('docs/data/busstop/busstops.csv').trim().split('\n').slice(1)) {
    const [id, name, lat, lng] = line.split(',')
    csvStops.set(Number(id), { name, lat: Number(lat), lng: Number(lng) })
  }

  const geojson = JSON.parse(read('backend/config/park/boundary.geojson'))
  const parkRing = geojson.features[0].geometry.coordinates[0] as [number, number][]

  const gateways = parseGateways(read('docs/data/tdx-vd/detectors.csv'))

  return { seed, csvStops, parkRing, gateways }
}
