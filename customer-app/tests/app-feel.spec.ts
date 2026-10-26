import AxeBuilder from '@axe-core/playwright'
import { createECDH, randomBytes } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'
import { managerToken } from './staff'

// "Feels like an app" (docs/app-feel.md) against the real API, with its switches on (LIVE_TRACKING,
// FAVOURITES, SHOP_INSTALL, SHOP_SORT_FILTER, WEB_PUSH with the log provider): the installable
// shell, sort and filter, favourites, notifications opt-in and "N stops away".

const API = (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
  const features = ((await (await request.get(`${API}/v1/policy`)).json()) as { features?: Record<string, boolean> }).features ?? {}
  const on = ['installApp', 'push', 'tracking', 'favourites', 'sortFilter'].every((k) => features[k])
  // CI starts the API with them on (.github/workflows/ci.yml); locally they may be off.
  if (process.env.CI) expect(on, 'the app-feel switches are on').toBe(true)
  test.skip(!on, 'the API runs with the app-feel switches off')
})

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** A new phone number per test and project, so parallel projects never share a customer. */
const phoneFor = (prefix: string, project: string) => `${prefix}${String(Date.now()).slice(-8)}${project === 'phone' ? 1 : 2}`

async function signInOnPage(page: Page, phone: string) {
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const hint = await page.getByText(/Test mode: your code is \d{6}/).textContent()
  await page.getByLabel('6-digit code').fill(hint!.match(/\d{6}/)![0])
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function apiCustomer(request: APIRequestContext, phone: string) {
  const asked = await request.post(`${API}/v1/auth/otp/request`, { data: { phone } })
  expect(asked.ok(), await asked.text()).toBeTruthy()
  const signIn = await request.post(`${API}/v1/auth/otp/verify`, { data: { phone, code: (await asked.json()).devCode } })
  expect(signIn.ok(), await signIn.text()).toBeTruthy()
  const token = ((await signIn.json()) as { accessToken: string }).accessToken
  return { phone, token, as: { headers: { Authorization: `Bearer ${token}` } } }
}

/** The home page's boxes, once the real tiles replace the placeholders. */
async function catalogueLoaded(page: Page) {
  await expect(page.getByRole('heading', { name: /Pick your mangoes|Mangoes matching/ })).toBeVisible()
  await expect(page.locator('section[aria-busy="true"]')).toHaveCount(0)
}
const prices = async (page: Page) =>
  (await page.getByRole('region', { name: /Pick your mangoes|Mangoes matching/ }).locator('.tile .price').allTextContents()).map((t) => Number(t.replace(/\D/g, '')))

test('the shop installs as an app: manifest, a worker that keeps only the shell, and a quiet install card', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ name: 'MandiMangoes', short_name: 'MandiMangoes', start_url: '/', display: 'standalone' })
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512'])

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe('/')
  // Use the shop (pincode, catalogue, a product page) and look in the cache: the shell only.
  await page.reload()
  await page.getByLabel('Your delivery pincode').fill('560034')
  await page.getByRole('button', { name: 'Show mangoes' }).click()
  await expect(page.getByRole('heading', { name: 'Pick your mangoes' })).toBeVisible()
  await page.getByRole('region', { name: 'Pick your mangoes' }).getByRole('heading', { level: 3 }).getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const kept = await page.evaluate(async () => {
    const out: string[] = []
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(`${name} ${r.url}`)
    return out
  })
  expect(kept.length).toBeGreaterThan(0)
  for (const entry of kept) {
    const url = new URL(entry.split(' ')[1])
    expect(entry.startsWith('mm-shell-'), entry).toBe(true)
    expect(url.origin, entry).toBe(new URL(page.url()).origin)
    expect(url.pathname, entry).not.toMatch(/^\/v1/)
  }

  // The browser offers to install: a quiet card on the home page, gone for a month after "Not now".
  const offer = () =>
    page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
      e.prompt = async () => undefined
      e.userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(e)
    })
  await page.goto('/')
  await offer()
  const card = page.getByRole('region', { name: 'Add MandiMangoes to your home screen' })
  await expect(card).toBeVisible()
  await noA11yViolations(page)
  await card.getByRole('button', { name: 'Not now' }).click()
  await expect(card).toHaveCount(0)
  await page.reload()
  await offer()
  await expect(page.getByRole('heading', { name: 'Pick your mangoes' })).toBeVisible()
  await expect(card).toHaveCount(0)
})

test('sort and filter the home page; the choice lives in the address with the search', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/')
  await page.getByLabel('Your delivery pincode').fill('560034')
  await page.getByRole('button', { name: 'Show mangoes' }).click()
  await catalogueLoaded(page)
  const controls = page.getByRole('group', { name: 'Sort and filter' })
  await expect(controls).toBeVisible()
  const all = (await prices(page)).length
  expect(all).toBeGreaterThan(1)

  await controls.getByLabel('Sort by').selectOption('price-high')
  await expect(page).toHaveURL(/sort=price-high/)
  const high = await prices(page)
  expect(high).toEqual([...high].sort((a, b) => b - a))
  await controls.getByLabel('Sort by').selectOption('price-low')
  const low = await prices(page)
  expect(low).toEqual([...low].sort((a, b) => a - b))

  // In stock only: no sold-out tile is left.
  await controls.getByLabel('In stock only').check()
  await expect(page).toHaveURL(/stock=1/)
  await expect(page.locator('.tile-sold-out')).toHaveCount(0)
  await expect(controls.getByRole('status')).toContainText(/Showing \d+ of \d+ box/)

  // One variety; then a search on top keeps the sort and filters.
  const variety = (await controls.getByLabel('Variety').locator('option').nth(1).textContent())!
  await controls.getByLabel('Variety').selectOption(variety)
  await expect(page).toHaveURL(new RegExp(`variety=${encodeURIComponent(variety)}`))
  for (const name of await page.locator('.tile .tile-name').allTextContents()) expect(name).toContain(variety)
  await page.getByRole('searchbox', { name: 'Search mangoes' }).fill(variety.slice(0, 3))
  await expect(page).toHaveURL(/q=/)
  await expect(page).toHaveURL(/sort=price-low/)
  await expect(page).toHaveURL(/stock=1/)
  await noA11yViolations(page)
  expect(await noSidewaysScroll(page)).toBe(true)

  // A reload (or a shared link) shows the same list.
  await page.reload()
  await expect(controls.getByLabel('Sort by')).toHaveValue('price-low')
  await expect(controls.getByLabel('Variety')).toHaveValue(variety)
  await expect(controls.getByLabel('In stock only')).toBeChecked()

  // A ripeness in stock, then Clear filters keeps the sort.
  await controls.getByLabel('Ripeness', { exact: true }).selectOption('RIPE')
  await expect(page).toHaveURL(/ripe=RIPE/)
  await controls.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).not.toHaveURL(/stock=1|ripe=|variety=/)
  await expect(page).toHaveURL(/sort=price-low/)
})

test('favourites: a guest hearts boxes, they follow the sign-in, and the Account list adds to the cart or offers the alert', async ({ page, request }, info) => {
  // A box with no stock at all, so one favourite is sold out for real.
  const staff = { headers: { Authorization: `Bearer ${await managerToken(request)}` } }
  const sku = `FAV-${randomBytes(3).toString('hex').toUpperCase()}`
  const name = `Kesar Heart ${sku.slice(4)} Box`
  const made = await request.post(`${API}/admin/v1/products`, { data: { sku, name, variety: 'Kesar', boxSize: '3kg', price: 149900 }, ...staff })
  expect(made.status(), await made.text()).toBe(201)
  try {
    await page.goto('/')
    await page.getByLabel('Your delivery pincode').fill('560034')
    await page.getByRole('button', { name: 'Show mangoes' }).click()
    await catalogueLoaded(page)
    const region = page.getByRole('region', { name: 'Pick your mangoes' })
    const inStock = region.locator('.tile:not(.tile-sold-out)').first()
    const inStockName = (await inStock.locator('.tile-name').textContent())!.trim()
    // The heart is a toggle named after its box.
    const heart = inStock.getByRole('button', { name: `Favourite: ${inStockName}` })
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    expect((await heart.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await region.getByRole('button', { name: `Favourite: ${name}` }).click()
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('mm.favourites')))!)).toHaveLength(2)
    // And on the product page.
    await region.getByRole('link', { name }).click()
    await expect(page.getByRole('button', { name: `Favourite: ${name}` })).toHaveAttribute('aria-pressed', 'true')
    await noA11yViolations(page)

    // Signing in hands the hearts to the account, and the device forgets its copy.
    const phone = phoneFor('6', info.project.name)
    await page.goto('/sign-in?next=/account')
    await signInOnPage(page, phone)
    const favourites = page.getByRole('region', { name: 'Favourites' })
    await expect(favourites.getByRole('listitem')).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mm.favourites'))).toBeNull()
    const me = await apiCustomer(request, phone)
    const stored = await (await request.get(`${API}/v1/me/favourites`, me.as)).json()
    expect(stored.items.map((i: { sku: string }) => i.sku)).toContain(sku)

    // In stock: one tap adds a box of that ripeness to the cart.
    const row = favourites.getByRole('listitem').filter({ hasText: inStockName })
    const add = row.getByRole('group', { name: `Add ${inStockName} to the cart` }).getByRole('button').first()
    await add.click()
    await expect(page.getByRole('status').filter({ hasText: /^Added one / })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Cart, 1 box$/ }).first()).toBeAttached()
    // Sold out: the back-in-stock alert, as on the product page.
    const sold = favourites.getByRole('listitem').filter({ hasText: name })
    await expect(sold).toContainText('Sold out for')
    await sold.getByRole('button', { name: `Tell me when ${name}, Ripe is back` }).click()
    await expect(sold.getByText("We'll message you on WhatsApp when it's back")).toBeVisible()
    await noA11yViolations(page)
    expect(await noSidewaysScroll(page)).toBe(true)

    // Removing it from the list un-hearts it everywhere.
    await sold.getByRole('button', { name: `Remove ${name} from favourites` }).click()
    await expect(favourites.getByRole('listitem')).toHaveCount(1)
    expect((await (await request.get(`${API}/v1/me/favourites`, me.as)).json()).items.map((i: { sku: string }) => i.sku)).not.toContain(sku)
  } finally {
    await request.delete(`${API}/admin/v1/products/${sku}`, staff)
  }
})

/** A browser push subscription without a real push service: the browser's prompt says yes and PushManager hands back a made-up endpoint with real keys. */
async function fakePushService(page: Page) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(8).toString('hex')}`
  await page.addInitScript(
    ({ endpoint, keys }) => {
      let current: unknown = null
      const make = (key: ArrayBuffer | null) => ({
        endpoint,
        options: { applicationServerKey: key },
        toJSON: () => ({ endpoint, expirationTime: null, keys }),
        unsubscribe: async () => {
          current = null
          return true
        },
      })
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
      Notification.requestPermission = async () => 'granted'
      PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
        const raw = opts?.applicationServerKey as Uint8Array
        current = make(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
        return current as PushSubscription
      }
      PushManager.prototype.getSubscription = async () => current as PushSubscription | null
    },
    { endpoint, keys },
  )
  return endpoint
}

test('notifications are turned on only from the Account page, and off there or by signing out', async ({ page, request }, info) => {
  const endpoint = await fakePushService(page)
  const phone = phoneFor('8', info.project.name)
  const me = await apiCustomer(request, phone)
  let asked = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/me/push/subscription') && r.method() === 'PUT') asked++
  })
  // Browsing the shop never asks.
  await page.goto('/')
  await page.goto('/sign-in?next=/account')
  await signInOnPage(page, phone)
  const card = page.getByRole('region', { name: 'Order updates in this browser' })
  await expect(card.getByRole('status')).toHaveText('Off in this browser.')
  expect(asked).toBe(0)
  await noA11yViolations(page)

  await card.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(card.getByRole('status')).toHaveText('On in this browser.')
  expect(asked).toBe(1)
  expect((await (await request.get(`${API}/v1/me/push`, me.as)).json()).browsers).toBe(1)
  const exported = await (await request.get(`${API}/v1/me/export`, me.as)).json()
  // The export names the push service, never the endpoint (a capability URL) or the keys.
  expect(exported.notificationBrowsers).toEqual([expect.objectContaining({ pushService: 'fcm.googleapis.com' })])
  expect(JSON.stringify(exported)).not.toContain(endpoint)

  await card.getByRole('button', { name: 'Turn off notifications' }).click()
  await expect(card.getByRole('status')).toHaveText('Off in this browser.')
  expect((await (await request.get(`${API}/v1/me/push`, me.as)).json()).browsers).toBe(0)

  // On again, then signing out on this browser ends them.
  await card.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(card.getByRole('status')).toHaveText('On in this browser.')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  await expect.poll(async () => (await (await request.get(`${API}/v1/me/push`, me.as)).json()).browsers).toBe(0)
})

test('out for delivery: "your rider is N stops away", counted along the rider\'s route', async ({ page, request }, info) => {
  const staff = { headers: { Authorization: `Bearer ${await managerToken(request)}` } }
  const riderEmail = `rider-${randomBytes(4).toString('hex')}@mandimangoes.test`
  const rider = await request.post(`${API}/admin/v1/staff`, { data: { email: riderEmail, role: 'RIDER', password: `long-enough-${randomBytes(4).toString('hex')}` }, ...staff })
  expect(rider.status(), await rider.text()).toBe(201)
  const riderId = ((await rider.json()) as { id: string }).id

  /** A paid, packed order for one box from a new customer, to its own address. */
  async function packedOrder(prefix: string, address: string) {
    const c = await apiCustomer(request, phoneFor(prefix, info.project.name))
    const cat = await (await request.get(`${API}/v1/catalogue?pincode=560034`, c.as)).json()
    const item = cat.items.find((i: { qty: number }) => i.qty > 0)
    expect(item, 'something in stock').toBeTruthy()
    expect((await request.post(`${API}/v1/cart/items`, { data: { sku: item.sku, stage: item.stage, qty: 1 }, ...c.as })).ok()).toBeTruthy()
    // The first open slot, the same for both orders, so they sit in one run.
    const slots = await (await request.get(`${API}/v1/delivery/slots?pincode=560034&delivery_date=${cat.deliveryDate}`, c.as)).json()
    const slotId = slots.slots.find((s: { available: boolean }) => s.available)?.id ?? null
    const q = await request.post(`${API}/v1/checkout/quote`, { data: { pincode: '560034', deliveryDate: cat.deliveryDate, slotId }, ...c.as })
    expect(q.ok(), await q.text()).toBeTruthy()
    const confirm = await request.post(`${API}/v1/checkout/confirm`, {
      data: { quoteId: (await q.json()).quoteId, address },
      headers: { ...c.as.headers, 'Idempotency-Key': `e2e-${c.phone}` },
    })
    expect(confirm.ok(), await confirm.text()).toBeTruthy()
    const { orderId } = await confirm.json()
    expect((await request.post(`${API}/v1/dev/pay`, { data: { orderId, outcome: 'captured' } })).ok()).toBeTruthy()
    for (const step of [
      () => request.patch(`${API}/admin/v1/orders/${orderId}/status`, { data: { status: 'PROCESSING' }, ...staff }),
      () => request.post(`${API}/admin/v1/orders/${orderId}/allocate`, staff),
      () => request.patch(`${API}/admin/v1/orders/${orderId}/status`, { data: { status: 'PACKED' }, ...staff }),
    ]) {
      const r = await step()
      expect(r.ok(), await r.text()).toBeTruthy()
    }
    return { ...c, orderId: orderId as string, date: cat.deliveryDate as string }
  }
  // Ordered first, so it comes first on the route (same pincode, no slot: by order number).
  const first = await packedOrder('9', '1 First Main, Koramangala, Bengaluru')
  const mine = await packedOrder('7', '9 Ninth Main, Koramangala, Bengaluru')
  // Both stops go to the new rider, then out for delivery.
  const assign = await request.post(`${API}/admin/v1/manifest/assign`, { data: { date: mine.date, orderIds: [first.orderId, mine.orderId], riderId }, ...staff })
  expect(assign.ok(), await assign.text()).toBeTruthy()
  for (const o of [first, mine]) expect((await request.post(`${API}/admin/v1/orders/${o.orderId}/dispatch`, staff)).ok()).toBeTruthy()

  await page.goto(`/orders/${mine.orderId}`)
  await signInOnPage(page, mine.phone)
  const card = page.getByRole('region', { name: "Where's my rider?" })
  await expect(card.getByRole('status')).toContainText('Your rider is 1 stop away.')
  await expect(card.getByRole('status')).toContainText('Expect them in about 20 minutes.')
  // Only a count: nothing about the other stop.
  await expect(page.getByText('First Main')).toHaveCount(0)
  // The status timeline is there too.
  await expect(page.getByRole('list', { name: 'Progress' })).toContainText('Out for delivery')
  await noA11yViolations(page)
  expect(await noSidewaysScroll(page)).toBe(true)

  // The first stop is delivered with its code: this one is next (the page also asks again every 30 seconds).
  const code = (await (await request.get(`${API}/v1/orders/${first.orderId}`, first.as)).json()).deliveryCode
  const delivered = await request.post(`${API}/admin/v1/orders/${first.orderId}/delivery`, { data: { outcome: 'DELIVERED', code }, ...staff })
  expect(delivered.ok(), await delivered.text()).toBeTruthy()
  await page.reload()
  await expect(card.getByRole('status')).toContainText("You're the rider's next stop.")
  await expect(card.getByRole('status')).toContainText('about 10 minutes')
})
