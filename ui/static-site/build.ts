// Builds the static site: the portal at the root (DD-46), the showcase beside it as showcase.html,
// each app in its own folder, all against the in-browser mock backend.
// Run: node static-site/build.ts  (output in static-site/dist)
import { build, mergeConfig, type InlineConfig, type Plugin, type UserConfig } from 'vite'
import { withCityHomeLink } from './cityHomeLink.ts'

const UI_DIR = new URL('..', import.meta.url).pathname
const SITE_DIR = new URL('.', import.meta.url).pathname
const OUT_DIR = `${SITE_DIR}dist`
const INSTALL_MOCK = `${SITE_DIR}installMock.ts`
const FS_SHIM = `${SITE_DIR}fsShim.ts`
const DEV_PORT = 0

/**
 * The showcase builds first, into the root, as showcase.html: the live Demo
 * still opens it (DD-45), the portal does not link to it. The apps sit in folders beside it.
 */
const APPS = [
  { name: 'showcase', root: `${UI_DIR}showcase`, outDir: OUT_DIR },
  { name: 'driver', root: `${UI_DIR}driver`, outDir: `${OUT_DIR}/driver` },
  { name: 'passenger', root: `${UI_DIR}passenger`, outDir: `${OUT_DIR}/passenger` },
  { name: 'city', root: `${UI_DIR}city`, outDir: `${OUT_DIR}/city` },
  // Last, so its index.html is the one left at the root.
  { name: 'portal', root: `${SITE_DIR}portal`, outDir: OUT_DIR },
]
const SHOWCASE_PAGE = 'showcase.html'

/** Each role's tour and coach bar (DD-46), imported right after the mock in that app's entry. */
const TOURS: Record<string, string> = {
  driver: `${SITE_DIR}driverTour.ts`,
}

/**
 * Imports the mock first in each app's entry, so fetch is patched before the app's first /api call,
 * then the app's tour if it has one.
 */
function installMockFirst(app: string): Plugin {
  const imports = [INSTALL_MOCK, ...(TOURS[app] ? [TOURS[app]] : [])].map((file) => `import ${JSON.stringify(file)}\n`).join('')
  return {
    name: 'static-site-install-mock',
    enforce: 'pre',
    transform(code, id) {
      return id.endsWith('/src/main.tsx') ? `${imports}${code}` : null
    },
  }
}

/** Writes the showcase's page as showcase.html, so the root's index.html is left to the portal. */
function showcaseAsShowcaseHtml(): Plugin {
  return {
    name: 'static-site-showcase-html',
    // After Vite's own html plugin has emitted the page.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle['index.html']
      if (page) page.fileName = SHOWCASE_PAGE
    },
  }
}

/** The city war room's 「← 首頁」, in the static site's copy only (DD-46). */
function cityHomeLink(): Plugin {
  return { name: 'static-site-city-home-link', transformIndexHtml: withCityHomeLink }
}

const PAGE_PLUGINS: Record<string, Plugin[]> = { showcase: [showcaseAsShowcaseHtml()], city: [cityHomeLink()] }

process.env.VITE_STATIC_SITE = '1'
const { defineAppConfig } = await import('../vite.config.base.ts')
const baseConfig = defineAppConfig({ port: DEV_PORT }) as (env: { mode: string; command: 'build' }) => UserConfig

for (const app of APPS) {
  const config: InlineConfig = {
    root: app.root,
    configFile: false,
    // Relative asset paths: the site works from any folder, e.g. a bucket path.
    base: './',
    plugins: [installMockFirst(app.name), ...(PAGE_PLUGINS[app.name] ?? [])],
    resolve: { alias: { 'node:fs': FS_SHIM } },
    build: { outDir: app.outDir, emptyOutDir: app.name === 'showcase' },
  }
  await build(mergeConfig(baseConfig({ mode: 'production', command: 'build' }), config))
}
