import { defineConfig, devices } from '@playwright/test'

// The built static site's portal (T68, DD-46), served under the bucket's sub-path. Build first:
// `just ui static-e2e` does both.
export const STATIC_PORT = 8095
export const SITE_URL = `http://localhost:${STATIC_PORT}/carpool-neihu-static/`

export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results/static-site',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Under the bucket's sub-path, so links that only work from the domain root fail here too.
    command: `npx vite preview --outDir static-site/dist --base /carpool-neihu-static/ --port ${STATIC_PORT} --strictPort`,
    cwd: '..',
    url: `${SITE_URL}index.html`,
    reuseExistingServer: false,
  },
})
