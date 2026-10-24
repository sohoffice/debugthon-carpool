// Builds the static site: the showcase at the root, each app in its own folder, all against the
// in-browser mock backend. Run: node static-site/build.ts  (output in static-site/dist)
import { build, mergeConfig, type InlineConfig, type Plugin, type UserConfig } from 'vite'

const UI_DIR = new URL('..', import.meta.url).pathname
const SITE_DIR = new URL('.', import.meta.url).pathname
const OUT_DIR = `${SITE_DIR}dist`
const INSTALL_MOCK = `${SITE_DIR}installMock.ts`
const FS_SHIM = `${SITE_DIR}fsShim.ts`
const DEV_PORT = 0

/** The showcase sits at the site's root; the apps it embeds sit beside it. */
const APPS = [
  { name: 'showcase', outDir: OUT_DIR },
  { name: 'driver', outDir: `${OUT_DIR}/driver` },
  { name: 'passenger', outDir: `${OUT_DIR}/passenger` },
  { name: 'city', outDir: `${OUT_DIR}/city` },
]

/** Imports the mock first in each app's entry, so fetch is patched before the app's first /api call. */
function installMockFirst(): Plugin {
  return {
    name: 'static-site-install-mock',
    enforce: 'pre',
    transform(code, id) {
      return id.endsWith('/src/main.tsx') ? `import ${JSON.stringify(INSTALL_MOCK)}\n${code}` : null
    },
  }
}

process.env.VITE_STATIC_SITE = '1'
const { defineAppConfig } = await import('../vite.config.base.ts')
const baseConfig = defineAppConfig({ port: DEV_PORT }) as (env: { mode: string; command: 'build' }) => UserConfig

for (const app of APPS) {
  const root = `${UI_DIR}${app.name}`
  const config: InlineConfig = {
    root,
    configFile: false,
    // Relative asset paths: the site works from any folder, e.g. a bucket path.
    base: './',
    plugins: [installMockFirst()],
    resolve: { alias: { 'node:fs': FS_SHIM } },
    build: { outDir: app.outDir, emptyOutDir: app.name === 'showcase' },
  }
  await build(mergeConfig(baseConfig({ mode: 'production', command: 'build' }), config))
}
