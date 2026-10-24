import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['*/src/**/*.test.{ts,tsx}', 'scripts/*.test.ts', 'static-site/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
