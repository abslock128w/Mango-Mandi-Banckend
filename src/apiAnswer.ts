// Reading mango-api's answers: no fetch, no window, so it is unit tested on its
// own (tests/unit/apiAnswer.unit.ts, run by `npm run test:unit`).

import type { ApiErrorBody } from './types'

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string
  /** Any other fields the API put on the error (e.g. `missing` on INCOMPLETE_SET). */
  extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, requestId?: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.extra = extra
  }
}

/** A refusal's body as an ApiError; a body that isn't the API's JSON falls back to the status line. */
export function errorFrom(status: number, statusText: string, text: string): ApiError {
  let body: ApiErrorBody | null = null
  try {
    body = JSON.parse(text) as ApiErrorBody
  } catch {
    // Not JSON (proxy error page, empty body).
  }
  const { code, message, requestId, ...extra } = body?.error ?? {}
  return new ApiError(status, code ?? `HTTP_${status}`, message ?? (statusText || 'Request failed'), requestId, extra)
}

/** A successful answer's body: empty is undefined; anything not JSON (a proxy's page) is an ApiError, not a SyntaxError. */
export function parseAnswer<T>(status: number, text: string): T {
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(status, 'BAD_RESPONSE', 'The server sent an answer we could not read. Please try again.')
  }
}
