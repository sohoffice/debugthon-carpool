// Mock backend for UI development (docs/ui-design.md 10.2, UD-14). Run: node mock-server/src/main.ts
import { createServer } from 'node:http'
import { createMockApi } from './api.ts'
import { MOCK_PORT } from './config.ts'
import { loadStaticData } from './data/load.ts'

const port = Number(process.env.MOCK_PORT) || MOCK_PORT
const api = createMockApi(loadStaticData())

createServer((req, res) => {
  const chunks: Uint8Array[] = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const text = new TextDecoder().decode(concat(chunks))
    let body: unknown = undefined
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      return send(res, 400, { error: { code: 'bad_request', message: '請求格式錯誤：不是 JSON' } })
    }
    const auth = req.headers.authorization
    const result = api.handle({
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      authorization: Array.isArray(auth) ? auth[0] : auth,
      body,
    })
    send(res, result.status, result.body)
    console.info(`${req.method} ${url.pathname} ${result.status}`)
  })
}).listen(port, () => console.info(`mock backend on http://localhost:${port} (POST /api/_mock/scenario to switch scenarios)`))

function send(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  chunks.reduce((offset, c) => (out.set(c, offset), offset + c.length), 0)
  return out
}
