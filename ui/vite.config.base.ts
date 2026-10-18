import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// Secrets and keys live in the repo-root .env (shared with the backend).
const ENV_DIR = new URL('..', import.meta.url).pathname
const DEFAULT_API_TARGET = 'http://localhost:8080'

/** Shared Vite config for every UI app. Each app only picks its dev port. */
export function defineAppConfig({ port }: { port: number }) {
  return defineConfig(({ mode }) => {
    const env = loadEnv(mode, ENV_DIR, '')
    return {
      plugins: [react(), tailwindcss()],
      envDir: ENV_DIR,
      server: {
        port,
        strictPort: true,
        // Same-origin /api calls in dev, so the backend needs no CORS setup.
        proxy: { '/api': env.API_PROXY_TARGET || DEFAULT_API_TARGET },
      },
    }
  })
}
