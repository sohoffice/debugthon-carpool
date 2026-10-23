export type Role = 'driver' | 'passenger' | 'city'

export class ApiError extends Error {
  readonly status: number
  /** Backend error code, e.g. `already_active`; empty when the body was not the API error shape. */
  readonly code: string

  constructor(status: number, message: string, code = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
}

const API_BASE = '/api'

/** Reads `{"error":{"code","message"}}` (both backends); falls back to the raw text. */
function toApiError(status: number, text: string, statusText: string): ApiError {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }
    if (typeof parsed.error?.message === 'string') {
      return new ApiError(status, parsed.error.message, typeof parsed.error.code === 'string' ? parsed.error.code : '')
    }
  } catch {
    // Not JSON: use the text as is.
  }
  return new ApiError(status, text || statusText)
}

/** Fetch wrapper that sends the PoC identity token `Bearer <role>:<account>` (DD-18). */
export function createApiClient(role: Role, account: string): ApiClient {
  const authorization = `Bearer ${role}:${account}`

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authorization,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw toApiError(res.status, text, res.statusText)
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  }
}
