// The shop's Vite dev server options, apart from vite.config.ts so a unit test
// can check them (customer-app/tests/unit/dev-server.unit.ts). SEC-01: this dev
// server can be reached from phones (scripts/start-local.mjs --phone), over the
// Wi-Fi or a public trycloudflare.com link, so it serves only the shop's own
// files, answers only its own host names, and never passes /v1/dev on.
import path from 'node:path'

/** Hosts the dev server answers besides localhost and IP addresses (which Vite always allows). */
export const PHONE_LINK_HOSTS = ['.trycloudflare.com']

/**
 * The API paths passed on to SHOP_API_PROXY: every /v1 path except /v1/dev,
 * the free "pay" route that must never be reachable from a phone link.
 */
export const PROXY_PATH = '^/v1/(?!dev(?:/|$))'

/**
 * SEC-01 (24 Oct audit): the API routes case-insensitively and decodes paths,
 * so /v1/Dev/pay or /v1/%64ev/pay reach the same free "pay" route that
 * PROXY_PATH keeps out by its lowercase spelling. This second check, run on
 * every request the proxy would pass on, refuses any spelling of /v1/dev:
 * percent-decoded, lower-cased, with repeated and dot segments folded away.
 * A path that does not decode is refused too.
 */
export function isDevPath(url: string): boolean {
  let path = url.split(/[?#]/)[0]
  try {
    // Twice, so a double-encoded spelling (%2564ev) is caught as well.
    path = decodeURIComponent(decodeURIComponent(path))
  } catch {
    return true
  }
  const segments: string[] = []
  for (const s of path.toLowerCase().replace(/\\/g, '/').split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') segments.pop()
    else segments.push(s.trim())
  }
  return segments[0] === 'v1' && segments[1] === 'dev'
}

export interface ShopServerEnv {
  /** The API to pass /v1 on to (start-local --phone), so phones need only this server. */
  SHOP_API_PROXY?: string
  /** Extra host names to answer, comma separated (a named tunnel, say). */
  SHOP_ALLOWED_HOSTS?: string
}

export function shopServer(dir: string, env: ShopServerEnv) {
  const repo = path.resolve(dir, '..')
  return {
    port: 5174,
    // The shop, the shared design tokens in ../design, the code it shares with the panel in
    // ../shared and the packages it loads; not the rest of the repo (source, workflows,
    // lockfiles, .local's database files).
    fs: { strict: true, allow: [dir, path.join(repo, 'design'), path.join(repo, 'shared'), path.join(repo, 'node_modules')] },
    // Local runs for phones (scripts/start-local.mjs --phone): the shop calls its own address and
    // Vite passes /v1 on to the API, so a phone needs to reach only this server, by Wi-Fi address
    // or through the temporary phone link. The API then sees the request as coming from the shop.
    ...(env.SHOP_API_PROXY
      ? {
          allowedHosts: [...PHONE_LINK_HOSTS, ...(env.SHOP_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)],
          proxy: {
            [PROXY_PATH]: {
              target: env.SHOP_API_PROXY,
              // false: Vite answers 404 itself and nothing reaches the API.
              bypass: (req: { url?: string }) => (isDevPath(req.url ?? '') ? false : undefined),
              configure: (proxy: { on: (event: 'proxyReq', fn: (req: { getHeader: (h: string) => unknown; setHeader: (h: string, v: string) => void }) => void) => void }) =>
                proxy.on('proxyReq', (req) => {
                  if (req.getHeader('origin')) req.setHeader('origin', 'http://localhost:5174')
                }),
            },
          },
        }
      : {}),
  }
}
