// Minimal typings for the few Node built-ins the mock backend uses, so it type-checks without
// adding @types/node (the mock uses built-in modules only, no packages).

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string
}

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>
    on(event: 'data', listener: (chunk: Uint8Array) => void): this
    on(event: 'end', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
  }
  export interface ServerResponse {
    statusCode: number
    setHeader(name: string, value: string): void
    end(body?: string): void
  }
  export interface Server {
    listen(port: number, listener?: () => void): Server
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server
}

declare const process: {
  env: Record<string, string | undefined>
  exitCode?: number
}
