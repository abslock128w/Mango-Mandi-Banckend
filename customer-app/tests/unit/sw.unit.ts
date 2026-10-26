import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The shop's service worker (customer-app/public/sw.js) keeps only the static app shell: never an
// API answer, nothing from another address, nothing but GET. Run here in a bare context with a
// stand-in `self`, so the rules are checked without a browser.

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function load(href = 'https://shop.mandimangoes.in/sw.js') {
  const handlers: Record<string, (e: unknown) => void> = {}
  const self = { location: new URL(href), addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn) }
  const ctx = vm.createContext({ self, URL, Request, Response, console, caches: {}, fetch: () => Promise.reject(new Error('no network in tests')) })
  vm.runInContext(source, ctx)
  return { ctx: ctx as unknown as { cacheKind: (r: { method: string; url: string; mode: string }, origin: string) => string | null; shopPath: (u: unknown) => string }, handlers }
}

const ORIGIN = 'https://shop.mandimangoes.in'
const req = (url: string, { method = 'GET', mode = 'cors' } = {}) => ({ method, url, mode })

test('pages and the built shell are kept; API answers, other addresses and writes never are', () => {
  const { ctx, handlers } = load()
  assert.deepEqual(Object.keys(handlers).sort(), ['activate', 'fetch', 'install', 'notificationclick', 'push'])
  const kind = (url: string, opts?: { method?: string; mode?: string }) => ctx.cacheKind(req(url, opts), ORIGIN)
  assert.equal(kind(`${ORIGIN}/`, { mode: 'navigate' }), 'page')
  assert.equal(kind(`${ORIGIN}/orders/ord_1`, { mode: 'navigate' }), 'page')
  assert.equal(kind(`${ORIGIN}/assets/index-abc123.js`), 'static')
  assert.equal(kind(`${ORIGIN}/brand/mark-96.webp`), 'static')
  assert.equal(kind(`${ORIGIN}/icon-512.png`), 'static')
  assert.equal(kind(`${ORIGIN}/manifest.webmanifest`), 'static')
  // The API: on its own address, or passed on through this one (local phone runs), even as a navigation.
  assert.equal(kind('https://api.mandimangoes.in/v1/catalogue?pincode=560034'), null)
  assert.equal(kind(`${ORIGIN}/v1/orders/ord_1`), null)
  assert.equal(kind(`${ORIGIN}/v1/me/export`, { mode: 'navigate' }), null)
  assert.equal(kind(`${ORIGIN}/v1`), null)
  assert.equal(kind(`${ORIGIN}/admin/v1/auth/me`), null)
  // Not GET, a query on a static path, or anything that isn't the shell.
  assert.equal(kind(`${ORIGIN}/assets/index-abc123.js`, { method: 'POST' }), null)
  assert.equal(kind(`${ORIGIN}/assets/index-abc123.js?v=2`), null)
  assert.equal(kind(`${ORIGIN}/src/main.tsx`), null)
  assert.equal(kind('https://checkout.razorpay.com/v1/checkout.js'), null)
})

test('a notification can only open a page of the shop', () => {
  const { ctx } = load()
  assert.equal(ctx.shopPath('/orders/ord_1'), '/orders/ord_1')
  assert.equal(ctx.shopPath('//evil.example/x'), '/orders')
  assert.equal(ctx.shopPath('https://evil.example/'), '/orders')
  assert.equal(ctx.shopPath('/orders/<script>'), '/orders')
  assert.equal(ctx.shopPath(undefined), '/orders')
})

test('registered for notifications only (?shell=off), it answers no fetch', () => {
  const { handlers } = load('https://shop.mandimangoes.in/sw.js?shell=off')
  let answered = false
  handlers.fetch({ request: req(`${ORIGIN}/`, { mode: 'navigate' }), respondWith: () => (answered = true) })
  assert.equal(answered, false)
})
