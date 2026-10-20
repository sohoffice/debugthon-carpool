import { defineConfig, devices } from '@playwright/test'

// UI end-to-end tests (T18B). They start their own mock backend and apps on ports of their own,
// so they never touch a running dev setup. The Go backend is not covered yet: it has no reset
// (T17) and no destination search (T20).
export const E2E_PORTS = { mock: 8091, driver: 5183, passenger: 5184, driverPlaces: 5185, passengerPlaces: 5186 }
const API = `http://localhost:${E2E_PORTS.mock}`
// No Maps key: the map shows its placeholder, so the tests use no Google quota and do not wait on it.
const APP_ENV = `API_PROXY_TARGET=${API} VITE_GOOGLE_MAPS_API_KEY=`
// A fake key turns the place search on; the tests serve a fake Maps API instead of Google's (e2e/fakeGoogleMaps.ts).
const PLACES_ENV = `API_PROXY_TARGET=${API} VITE_GOOGLE_MAPS_API_KEY=e2e-fake-key`

export default defineConfig({
  testDir: './e2e',
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
    { command: `MOCK_PORT=${E2E_PORTS.mock} npm run mock`, url: `${API}/api/ping`, reuseExistingServer: false },
    {
      command: `${APP_ENV} npm run dev -w driver -- --port ${E2E_PORTS.driver}`,
      url: `http://localhost:${E2E_PORTS.driver}`,
      reuseExistingServer: false,
    },
    {
      command: `${APP_ENV} npm run dev -w passenger -- --port ${E2E_PORTS.passenger}`,
      url: `http://localhost:${E2E_PORTS.passenger}`,
      reuseExistingServer: false,
    },
    {
      command: `${PLACES_ENV} npm run dev -w driver -- --port ${E2E_PORTS.driverPlaces}`,
      url: `http://localhost:${E2E_PORTS.driverPlaces}`,
      reuseExistingServer: false,
    },
    {
      command: `${PLACES_ENV} npm run dev -w passenger -- --port ${E2E_PORTS.passengerPlaces}`,
      url: `http://localhost:${E2E_PORTS.passengerPlaces}`,
      reuseExistingServer: false,
    },
  ],
})
