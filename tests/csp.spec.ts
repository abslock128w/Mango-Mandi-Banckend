import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'
import { cspPlugin, header, KNOWN_APIS, policy, preconnectTags, type App } from '../scripts/csp'

// SEC-10: both apps send a Content-Security-Policy. The panel's policy is written
// once in scripts/csp.ts; vercel.json carries a copy, which must not drift. Every
// panel spec runs under the dev server's policy, and the fixture fails a test
// on any console error, so a violation ("Refused to load ...") fails the suite.
// The shop (shop/) is a static site; its policy lives in shop/vercel.json.

const root = path.join(import.meta.dirname, '..')
type VercelJson = { headers: { source: string; headers: { key: string; value: string }[] }[] }
const vercelCsp = (file: string, source?: string) => {
  const cfg = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as VercelJson
  return cfg.headers
    .filter((h) => source === undefined || h.source === source)
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy')?.value
}
const directive = (p: string, name: string) => p.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

test('vercel.json sends the panel policy from scripts/csp.ts', () => {
  expect(vercelCsp('vercel.json')).toBe(header('panel'))
})

test('the panel header fetches only from the known APIs, Google sign-in and Sentry, not any https: host', () => {
  const connect = directive(header('panel'), 'connect-src')
  expect(connect.split(' ')).not.toContain('https:')
  expect(connect).toBe(
    `connect-src 'self' ${KNOWN_APIS.join(' ')} https://accounts.google.com/gsi/ https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io`,
  )
  expect(KNOWN_APIS).toEqual(['https://api.mandimangoes.in', 'https://mandi-api-staging.vercel.app'])
  // The built page's meta tag names the one API it was built for.
  const built = directive(policy('panel', { api: 'https://mandi-api-staging.vercel.app/', meta: true }), 'connect-src')
  expect(built).toContain('https://mandi-api-staging.vercel.app')
  expect(built).not.toContain('https://api.mandimangoes.in')
})

// The shop's pages, and the One Mango film (shop/one-mango/), which the shop shows in a frame of its own.
const SHOP_PAGES = '/((?!one-mango/).*)'
const SHOP_FILM = '/one-mango/(.*)'

/** What the shop and its film share: the same sources, every one named. */
function expectShopSources(p: string) {
  // Razorpay Checkout, Turnstile and Google Maps (the address map, behind a key) are the only outside scripts.
  expect(directive(p, 'script-src')).toBe("script-src 'self' https://checkout.razorpay.com https://challenges.cloudflare.com https://maps.googleapis.com")
  const connect = directive(p, 'connect-src')
  expect(connect).toMatch(/^connect-src 'self' /)
  expect(connect.split(' ')).not.toContain('https:')
  expect(connect).toContain('https://api.mandimangoes.in')
  expect(connect).toContain('https://*.razorpay.com')
  expect(connect).toContain('https://challenges.cloudflare.com')
  expect(connect).toContain('https://maps.googleapis.com')
  // 'self': the shop frames its own One Mango film.
  expect(directive(p, 'frame-src')).toBe("frame-src 'self' https://*.razorpay.com https://challenges.cloudflare.com")
  expect(p).toContain("object-src 'none'")
  expect(p).toContain("default-src 'self'")
}

test('shop/vercel.json sends the shop policy on every page but the film, and no page can be framed', () => {
  const cfg = JSON.parse(readFileSync(path.join(root, 'shop/vercel.json'), 'utf8')) as VercelJson
  const withCsp = cfg.headers.filter((h) => h.headers.some((x) => x.key === 'Content-Security-Policy')).map((h) => h.source)
  expect(withCsp).toEqual([SHOP_PAGES, SHOP_FILM])
  const shop = vercelCsp('shop/vercel.json', SHOP_PAGES)
  expect(shop).toBeTruthy()
  expectShopSources(shop!)
  expect(shop).toContain("frame-ancestors 'none'")
})

test('the One Mango film may be framed by the shop itself, and nobody else', () => {
  const film = vercelCsp('shop/vercel.json', SHOP_FILM)
  expect(film).toBeTruthy()
  expectShopSources(film!)
  expect(directive(film!, 'frame-ancestors')).toBe("frame-ancestors 'self'")
  const xfo = (JSON.parse(readFileSync(path.join(root, 'shop/vercel.json'), 'utf8')) as VercelJson).headers
    .find((h) => h.source === SHOP_FILM)!.headers.find((h) => h.key === 'X-Frame-Options')?.value
  expect(xfo).toBe('SAMEORIGIN')
})

test('the policies allow what each app loads, and nothing inline', () => {
  const panel = policy('panel', { api: 'https://api.mandimangoes.in', meta: true })
  expect(panel).not.toContain('razorpay')
  expect(panel).not.toContain('frame-ancestors') // not allowed in a <meta> tag
  for (const p of [panel, header('panel'), vercelCsp('shop/vercel.json', SHOP_PAGES)!, vercelCsp('shop/vercel.json', SHOP_FILM)!]) {
    expect(p.match(/script-src [^;]*/)![0]).not.toContain('unsafe')
    expect(p).toContain("object-src 'none'")
  }
})

test('the built index.html of the panel preconnects to the API', () => {
  for (const app of ['panel'] as App[]) {
    const hook = cspPlugin(app, 'https://api.mandimangoes.in/').transformIndexHtml as { handler: (html: string, ctx: object) => unknown }
    const tags = hook.handler('', {}) as { tag: string; attrs: Record<string, string | boolean> }[]
    const links = tags.filter((t) => t.tag === 'link').map((t) => t.attrs)
    expect(links).toEqual([
      { rel: 'preconnect', href: 'https://api.mandimangoes.in' },
      { rel: 'preconnect', href: 'https://api.mandimangoes.in', crossorigin: true },
      { rel: 'dns-prefetch', href: 'https://api.mandimangoes.in' },
    ])
    expect(tags[0].attrs['http-equiv']).toBe('Content-Security-Policy')
    // The dev server sends the header and adds nothing to the page.
    expect(hook.handler('', { server: {} })).toEqual([])
  }
  // No API configured: no hint to a guessed address.
  expect(preconnectTags(undefined)).toEqual([])
  expect(preconnectTags('not a url')).toEqual([])
})

test('the dev server sends the policy', async ({ page }) => {
  const res = await page.goto('/')
  const csp = res!.headers()['content-security-policy']
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain('https://accounts.google.com/gsi/client')
})
