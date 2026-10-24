// Browser stand-in for node:fs, so the mock backend's loader reads repo files bundled at build time.
const FILES = import.meta.glob(
  [
    '../../backend/migrations/*.sql',
    '../../docs/data/busstop/busstops.csv',
    '../../docs/data/tdx-vd/detectors.csv',
    '../../backend/config/park/boundary.geojson',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const REPO_PREFIX = '../../'
const byRepoPath = new Map(Object.entries(FILES).map(([key, text]) => [key.slice(REPO_PREFIX.length), text]))

/** The loader builds URLs from import.meta.url; match on the repo-relative tail of the path. */
function repoPath(path: string | URL): string {
  const pathname = decodeURIComponent(new URL(String(path), 'http://x/').pathname)
  const hit = [...byRepoPath.keys(), 'backend/migrations/'].find((p) => pathname.endsWith(`/${p}`))
  if (!hit) throw new Error(`static site: ${pathname} is not bundled`)
  return hit
}

export function readFileSync(path: string | URL): string {
  const text = byRepoPath.get(repoPath(path))
  if (text === undefined) throw new Error(`static site: ${String(path)} is not a file`)
  return text
}

export function readdirSync(path: string | URL): string[] {
  const dir = repoPath(path)
  return [...byRepoPath.keys()].filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length))
}
