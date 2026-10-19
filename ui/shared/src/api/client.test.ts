import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createApiClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the role:account bearer token and parses JSON', async () => {
    const fetchMock = mockFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))

    const data = await createApiClient('driver', 'driver1').get('/trips/current')

    expect(data).toEqual({ ok: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/trips/current')
    expect(init.headers.Authorization).toBe('Bearer driver:driver1')
  })

  it('sends a JSON body on POST', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }))

    await createApiClient('passenger', 'p1').post('/requests', { stopId: 'x' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"stopId":"x"}')
  })

  it('throws ApiError with status and server message on failure', async () => {
    mockFetch(new Response('too far from pickup', { status: 422 }))

    const request = createApiClient('passenger', 'p1').post('/requests')

    await expect(request).rejects.toBeInstanceOf(ApiError)
    await expect(request).rejects.toMatchObject({ status: 422, message: 'too far from pickup' })
  })

  it('reads the code and message from the backend error body', async () => {
    mockFetch(new Response(JSON.stringify({ error: { code: 'too_far', message: '離上車點太遠' } }), { status: 422 }))

    const request = createApiClient('passenger', 'p1').post('/passenger/requests')

    await expect(request).rejects.toMatchObject({ status: 422, code: 'too_far', message: '離上車點太遠' })
  })
})
