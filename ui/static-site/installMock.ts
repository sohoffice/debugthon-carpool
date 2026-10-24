// Static site only: answers every /api call in the browser with the mock backend (UD-14).
import { createMockApi } from '../mock-server/src/api.ts'
import { loadStaticData } from '../mock-server/src/data/load.ts'

type MockApi = ReturnType<typeof createMockApi>
const API_PREFIX = '/api'
const GLOBAL_KEY = '__carpoolMockApi'

/** The showcase embeds the apps in same-origin iframes; they share its mock so the Demo stays in one world. */
function sharedMock(): MockApi {
  try {
    const parentMock = window.parent !== window ? (window.parent as unknown as Record<string, MockApi | undefined>)[GLOBAL_KEY] : undefined
    if (parentMock) return parentMock
  } catch {
    // A cross-origin parent: keep a mock of our own.
  }
  // The showcase's simulator drives the cars, so its fast-forwards show (T63, T64).
  const own = createMockApi(loadStaticData(), Date.now, { followReports: true })
  ;(window as unknown as Record<string, MockApi>)[GLOBAL_KEY] = own
  return own
}

const api = sharedMock()
const realFetch = window.fetch.bind(window)

async function bodyOf(init: RequestInit | undefined): Promise<unknown> {
  if (typeof init?.body !== 'string' || init.body === '') return undefined
  return JSON.parse(init.body)
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return new Headers(init?.headers).get(name) ?? undefined
}

window.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
  if (!raw.startsWith(API_PREFIX)) return realFetch(input, init)
  const url = new URL(raw, 'http://localhost')
  let body: unknown
  try {
    body = await bodyOf(init)
  } catch {
    return Response.json({ error: { code: 'bad_request', message: '請求格式錯誤：不是 JSON' } }, { status: 400 })
  }
  const result = api.handle({
    method: init?.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    authorization: headerOf(init, 'Authorization'),
    body,
  })
  if (result.body === undefined) return new Response(null, { status: result.status })
  return Response.json(result.body, { status: result.status })
}
