/** An API error with the Go backend's body shape {"error":{"code","message"}}. */
export class MockError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
