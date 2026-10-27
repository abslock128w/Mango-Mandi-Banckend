// API contract helpers (SEC-02, SEC-09 of the 24 Oct 2026 audit), on with
// API_HARDENING=true: the methods each known path answers, so a wrong method
// gets 405 with an Allow header instead of 404, and which framework errors are
// the client's fault (4xx, not a 500 and a Sentry event).

/** The headers a cross-origin shop or panel may read (Retry-After on 429 and 503, the request id). */
export const EXPOSED_HEADERS = ['Retry-After', 'X-Request-Id', 'RateLimit', 'RateLimit-Policy']

const mountPath = (re) => (re.fast_slash ? '' : re.source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/'))
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Reads every route of the app's Express stacks (as test/security-readiness
 * does for the route inventory) and returns a lookup: path -> methods it
 * answers, upper case, sorted ([] for an unknown path). Matching is
 * case-insensitive with an optional trailing slash, as Express routes.
 */
export function routeMethods(app) {
  const routes = []
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route && typeof layer.route.path === 'string') {
        const full = `${prefix}${layer.route.path}`
        const re = new RegExp(`^${full.split('/').map((part) => (part.startsWith(':') ? '[^/]+' : escape(part))).join('/')}/?$`, 'i')
        routes.push({ re, methods: Object.keys(layer.route.methods).map((m) => m.toUpperCase()) })
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer.regexp))
      }
    }
  }
  walk(app._router?.stack ?? [], '')
  return (path) => {
    const out = new Set()
    for (const r of routes) if (r.re.test(path)) for (const m of r.methods) out.add(m)
    if (out.has('GET')) out.add('HEAD')
    return [...out].sort()
  }
}

// body-parser's own client errors (http-errors with a type), and Express's
// "Failed to decode param" (a URIError with status 400).
const PARSER_TYPES = new Set([
  'encoding.unsupported', 'charset.unsupported', 'request.aborted', 'request.size.invalid',
  'stream.encoding.set', 'stream.not.readable', 'parameters.too.many', 'entity.verify.failed',
])

/**
 * The status and code to answer for a framework error caused by the request
 * itself, or null for anything else (which stays a 500 and is reported).
 * Errors from our own code or a provider never match: only body-parser's
 * typed errors and Express's path decoding.
 */
export function clientErrorOf(err) {
  const status = Number(err?.status ?? err?.statusCode)
  if (!(status >= 400 && status < 500)) return null
  const parser = typeof err?.type === 'string' && PARSER_TYPES.has(err.type)
  const badPath = err instanceof URIError
  if (!parser && !badPath) return null
  if (status === 415) return { status, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This request body type or character set is not accepted' }
  if (badPath) return { status: 400, code: 'VALIDATION_ERROR', message: 'The address is not valid' }
  return { status, code: 'VALIDATION_ERROR', message: 'The request could not be read' }
}
