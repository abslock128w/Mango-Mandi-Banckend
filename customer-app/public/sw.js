// The MandiMangoes shop's service worker (docs/app-feel.md).
//
// 1. The app shell (SHOP_INSTALL): the page itself, the built files under /assets/ (their names
//    change with every build) and the icons, so the shop opens quickly and installs as an app.
//    Nothing else is ever cached: no API answer (/v1, on this address or the API's own), nothing
//    from another address, nothing but GET. Orders, carts, prices and stock always come live.
//    Registered as /sw.js?shell=off (push without the shell), it caches nothing and clears the cache.
// 2. Order updates (WEB_PUSH): shows the notification the API sends, whose text holds nothing
//    personal, and opens the order when it is tapped.
//
// Plain JavaScript, served as is: no build step touches it.

const CACHE = 'mm-shell-v1'
const SHELL_ON = new URL(self.location.href).searchParams.get('shell') !== 'off'
/** Fetched when the worker installs, so the shop opens with no network. */
const PRECACHE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/brand/mark-96.webp']
const STATIC_FILES = new Set(['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon-32.png'])

/**
 * What a request is to the cache: 'page' (a navigation, answered network first, with the shell
 * kept for when there is no network), 'static' (cache first) or null (left to the browser).
 */
function cacheKind(request, scopeOrigin) {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.origin !== scopeOrigin) return null
  // The API, when it is reached through this address (local phone runs pass /v1 on to it).
  if (url.pathname === '/v1' || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/admin/')) return null
  if (request.mode === 'navigate') return 'page'
  if (url.search) return null
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand/') || STATIC_FILES.has(url.pathname)) return 'static'
  return null
}

/** Only plain, complete answers from this address go in the cache. */
const keepable = (res) => res && res.ok && res.status === 200 && res.type === 'basic' && !res.headers.has('Set-Cookie')

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (SHELL_ON) {
        const cache = await caches.open(CACHE)
        await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' })))
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // An older shell, or every shell when this worker keeps none.
      for (const key of await caches.keys()) if (key.startsWith('mm-shell-') && (!SHELL_ON || key !== CACHE)) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (!SHELL_ON) return
  const kind = cacheKind(event.request, self.location.origin)
  if (kind === 'page') event.respondWith(page(event))
  else if (kind === 'static') event.respondWith(staticFile(event))
})

/** Keeps a copy of an answer; the worker stays alive until it is written. */
function keep(event, key, res) {
  const copy = res.clone()
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)))
}

/** Pages: the network first, so a new release shows at once; the kept shell when offline. */
async function page(event) {
  try {
    const res = await fetch(event.request)
    // Every page is the same shell (the app routes in the browser), kept under "/".
    if (keepable(res) && (res.headers.get('Content-Type') ?? '').includes('text/html')) keep(event, '/', res)
    return res
  } catch (err) {
    const kept = await caches.match('/', { cacheName: CACHE })
    if (kept) return kept
    throw err
  }
}

/** Built files never change under one name, and icons rarely: the cache first. */
async function staticFile(event) {
  const kept = await caches.match(event.request, { cacheName: CACHE })
  if (kept) return kept
  const res = await fetch(event.request)
  if (keepable(res)) keep(event, event.request, res)
  return res
}

// ---------------------------------------------------------------- order updates (WEB_PUSH)

/** A link inside the shop only: a message can never send the customer elsewhere. */
function shopPath(url) {
  return typeof url === 'string' && /^\/[A-Za-z0-9/_.~%-]*$/.test(url) && !url.startsWith('//') ? url : '/orders'
}

self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = {}
  }
  const title = typeof msg.title === 'string' && msg.title ? msg.title.slice(0, 80) : 'MandiMangoes'
  const body = typeof msg.body === 'string' && msg.body ? msg.body.slice(0, 200) : 'There is news about your MandiMangoes order'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      // One notification per order: a newer step replaces the older one.
      tag: typeof msg.tag === 'string' ? msg.tag.slice(0, 64) : undefined,
      data: { url: shopPath(msg.url) },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(shopPath(event.notification.data && event.notification.data.url), self.location.origin).href
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const tab = open.find((client) => new URL(client.url).origin === self.location.origin)
      if (tab) {
        const shown = await tab.focus()
        // A tab this worker controls can be moved to the order; otherwise a new one opens.
        if (shown && 'navigate' in shown && (await shown.navigate(target).then(Boolean, () => false))) return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
