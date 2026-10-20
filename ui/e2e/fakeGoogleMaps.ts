import type { BrowserContext } from '@playwright/test'

/** Places the fake search knows: one outside the park (south of its boundary) and one inside. */
export const OUTSIDE_PARK = { name: '松山車站地下停車場', detail: '台北市松山區', lat: 25.0482556, lng: 121.5784564 }
export const INSIDE_PARK = { name: '瑞光路513巷22弄', detail: '台北市內湖區', lat: 25.0803579, lng: 121.5678812 }

/**
 * Runs in the page in place of the Maps JavaScript API. It finishes the loader's bootstrap like the
 * real script, answers `places` with a search over the two places above, and gives every other
 * library a do-nothing stand-in, so maps draw nothing instead of failing.
 */
function fakeMapsApi(places: (typeof OUTSIDE_PARK)[]) {
  const anything: unknown = new Proxy(function () {}, {
    get: (_, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => 0 : anything),
    apply: () => anything,
    construct: () => anything as object,
  })
  const placesLibrary = {
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions: async ({ input }: { input: string }) => ({
        suggestions: places
          .filter((p) => p.name.includes(input))
          .map((p) => ({
            placePrediction: {
              placeId: p.name,
              text: { text: p.name },
              mainText: { text: p.name },
              secondaryText: { text: p.detail },
              toPlace: () => ({ location: { lat: () => p.lat, lng: () => p.lng }, fetchFields: async () => ({}) }),
            },
          })),
      }),
    },
  }
  const w = window as unknown as { google: { maps: Record<string, unknown> } }
  const maps = w.google.maps
  maps.version = '3.0-e2e'
  maps.importLibrary = async (name: string) => (name === 'places' ? placesLibrary : anything)
  w.google.maps = new Proxy(maps, { get: (target, key) => (key in target ? target[key as string] : anything) })
  ;(maps.__ib__ as () => void)()
}

/**
 * Serves the fake Maps API instead of Google's and blocks every other Google request, so the test
 * never reaches Google (no key, no quota).
 */
export async function useFakeGoogleMaps(context: BrowserContext) {
  await context.route(/googleapis\.com|gstatic\.com/, (route) => {
    if (!route.request().url().startsWith('https://maps.googleapis.com/maps/api/js?')) return route.abort()
    return route.fulfill({ contentType: 'text/javascript', body: `(${fakeMapsApi.toString()})(${JSON.stringify([OUTSIDE_PARK, INSIDE_PARK])})` })
  })
}
