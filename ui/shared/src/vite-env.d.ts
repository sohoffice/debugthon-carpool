/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string
  /** '1' in the static-site build (ui/static-site), where the mock backend runs in the browser. */
  readonly VITE_STATIC_SITE?: string
}
