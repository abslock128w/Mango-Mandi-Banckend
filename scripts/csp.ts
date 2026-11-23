// Content-Security-Policy for the staff panel (SEC-10). The shop (shop/) is a static site
// whose policy is written in shop/vercel.json (and deploy/Caddyfile); tests/csp.spec.ts checks it.
//
// The panel's policy, in two places:
// - a response header (vercel.json, and the Vite dev and preview servers), which
//   also carries frame-ancestors; vercel.json is static and cannot know the API
//   address the build was given, so the header (`api: null`) lets the panel talk
//   to the shop's known API origins only (KNOWN_APIS: production and staging),
//   not any https: host. A panel built for another API needs its origin added there;
// - a <meta> tag that `cspPlugin` writes into the built index.html with the
//   exact API origin from VITE_API_URL. Browsers enforce both, so the stricter
//   connect-src and img-src of the meta tag win wherever the app is hosted
//   (Vercel or the Caddy images in deploy/).
// tests/csp.spec.ts checks that vercel.json matches header() below.
//
// The same plugin also writes a preconnect hint for the API into the built
// index.html, so the browser opens the connection to the API while it is still
// fetching the app's script instead of after it.
import type { HtmlTagDescriptor, Plugin } from 'vite'

export type App = 'panel'

const SENTRY = ['https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io', 'https://*.ingest.de.sentry.io']
/**
 * The APIs a deployed panel is built against (VITE_API_URL): production and staging (previews).
 * Everything the panel fetches goes to its API (src/api.ts), Sentry or Google sign-in: photo
 * uploads go through the API, map tiles and Blob photos are images (img-src), not fetches.
 */
export const KNOWN_APIS = ['https://api.mandimangoes.in', 'https://mandi-api-staging.vercel.app']
const GOOGLE = 'https://accounts.google.com'
// Photos may be served from Vercel Blob directly; profile pictures in the Google button.
const IMAGES = ['https://*.public.blob.vercel-storage.com', 'https://*.googleusercontent.com']
/**
 * The panel's map tiles (Deliveries, Today, Analytics): VITE_MAP_TILES_URL, else OpenStreetMap's
 * standard tiles. The header's https: already allows any tile host; the meta tag names this one.
 */
export const DEFAULT_MAP_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const tileOrigin = (tiles: string | undefined) => (tiles === 'none' ? null : originOf((tiles || DEFAULT_MAP_TILES).replace(/\{[a-z]\}/g, 'a')))

function originOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

interface Options {
  /** The API's URL; null for the static vercel.json header (KNOWN_APIS to fetch from, any https: image). */
  api: string | null
  /** Vite's dev server: its inline React-refresh preamble and HMR websocket. */
  dev?: boolean
  /** For the <meta> tag, which may not carry frame-ancestors. */
  meta?: boolean
  /** The panel's map tile URL template (VITE_MAP_TILES_URL); 'none' turns the tiles off. */
  tiles?: string
}

export function policy(app: App, { api, dev = false, meta = false, tiles }: Options): string {
  const apiSrc = api === null ? KNOWN_APIS : [originOf(api)].filter((x): x is string => Boolean(x))
  // Images: the static header can't know the tile host (VITE_MAP_TILES_URL), so it allows any https: image.
  const imgSrc = api === null ? ['https:'] : apiSrc
  void app // the panel is the only app with a policy here
  const mapTiles = api !== null ? [tileOrigin(tiles)].filter((x): x is string => Boolean(x)) : []
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `${GOOGLE}/gsi/client`, ...(dev ? ["'unsafe-inline'"] : [])],
    // Google's button adds its own inline styles.
    'style-src': ["'self'", "'unsafe-inline'", `${GOOGLE}/gsi/style`],
    'img-src': ["'self'", 'data:', 'blob:', ...imgSrc, ...IMAGES, ...mapTiles],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...apiSrc, `${GOOGLE}/gsi/`, ...SENTRY, ...(dev ? ['ws:', 'wss:'] : [])],
    'frame-src': [GOOGLE],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  }
  if (!meta) d['frame-ancestors'] = ["'none'"]
  return Object.entries(d)
    .map(([k, v]) => `${k} ${[...new Set(v)].join(' ')}`)
    .join('; ')
}

/** The header vercel.json sends: the known APIs (KNOWN_APIS). */
export const header = (app: App) => policy(app, { api: null })

/**
 * <link rel="preconnect"> (and a dns-prefetch fallback) for the API's origin.
 * Two preconnects: the apps call the API with cookies (credentials: 'include'),
 * while CORS preflights and the plain config call go without, and browsers
 * keep those connections apart.
 */
export function preconnectTags(apiUrl: string | null | undefined): HtmlTagDescriptor[] {
  const origin = originOf(apiUrl)
  if (!origin) return []
  return [
    { tag: 'link', attrs: { rel: 'preconnect', href: origin }, injectTo: 'head' },
    { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: true }, injectTo: 'head' },
    { tag: 'link', attrs: { rel: 'dns-prefetch', href: origin }, injectTo: 'head' },
  ]
}

/**
 * Serves the policy from `vite` and `vite preview`, and writes the exact-API
 * <meta> tag and the API preconnect hints into the built index.html.
 */
export function cspPlugin(app: App, apiUrl: string | undefined, tiles?: string): Plugin {
  const api = apiUrl ?? 'http://localhost:3000'
  return {
    name: 'mango-csp',
    configureServer(server) {
      const value = policy(app, { api, dev: true, tiles })
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', value)
        next()
      })
    },
    configurePreviewServer(server) {
      const value = policy(app, { api, tiles })
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', value)
        next()
      })
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (ctx.server) return [] // the dev server sends the header instead
        return [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy(app, { api, meta: true, tiles }) }, injectTo: 'head-prepend' },
          // Only for a configured API: a build without VITE_API_URL can't reach one anyway.
          ...preconnectTags(apiUrl),
        ]
      },
    },
  }
}
