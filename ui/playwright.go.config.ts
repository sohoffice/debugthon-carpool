import { defineConfig, devices } from '@playwright/test'

// UI end-to-end tests on the Go backend (T18B). They start the Go backend on a database of its own
// (e2e/go/backend.sh) and the apps on ports of their own, and reset the Demo before and after each
// test (DD-29). Needs PostgreSQL from `just infra up`.
export const E2E_GO_PORTS = { backend: 8092, driver: 5187, passenger: 5188 }
const API = `http://localhost:${E2E_GO_PORTS.backend}`
// No Maps key: the map shows its placeholder; prefilled destinations need no place search.
const APP_ENV = `API_PROXY_TARGET=${API} VITE_GOOGLE_MAPS_API_KEY=`

export default defineConfig({
  testDir: './e2e/go',
  // One shared backend: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    // Building the backend and migrating its database can take a while the first time.
    { command: `e2e/go/backend.sh ${E2E_GO_PORTS.backend}`, url: `${API}/api/ping`, reuseExistingServer: false, timeout: 180_000 },
    {
      command: `${APP_ENV} npm run dev -w driver -- --port ${E2E_GO_PORTS.driver}`,
      url: `http://localhost:${E2E_GO_PORTS.driver}`,
      reuseExistingServer: false,
    },
    {
      command: `${APP_ENV} npm run dev -w passenger -- --port ${E2E_GO_PORTS.passenger}`,
      url: `http://localhost:${E2E_GO_PORTS.passenger}`,
      reuseExistingServer: false,
    },
  ],
})
