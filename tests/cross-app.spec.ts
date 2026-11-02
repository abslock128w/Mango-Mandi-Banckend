import { execSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// One order through all three apps, in browsers, against a real API (scripts/qa-journey.sh starts
// a QA stack: its own database, production builds, and the API's clock set with QA_NOW):
//   the shop orders and pays -> the panel processes, allocates and packs -> the clock moves to
//   the delivery day -> the rider app picks up (photo), photographs the door and the open box,
//   and types the customer's code from the shop's tracking page -> the shop shows Delivered and
//   the WhatsApp updates are logged -> the customer claims and the panel approves a replacement.
// Then the failure paths. Skips unless CROSS_APP=1 (the harness sets it and the URLs).
const SHOP = process.env.QA_SHOP ?? 'http://localhost:3400'
const PANEL = process.env.QA_PANEL ?? 'http://localhost:4317'
const RIDER = process.env.QA_RIDER ?? 'http://localhost:3410'
const API = process.env.QA_API ?? 'http://localhost:3100'
const FIXTURES = path.join(import.meta.dirname, '..', 'rider-app', 'e2e', 'fixtures')

test.skip(!process.env.CROSS_APP, 'Run with scripts/qa-journey.sh (CROSS_APP=1)')
test.describe.configure({ mode: 'serial', timeout: 240_000 })

/** Restarts the QA API with its clock at `at` (the harness's command), and waits for it. */
async function clockTo(at: string) {
  execSync(`${process.env.QA_API_RESTART} ${at}`, { stdio: 'inherit' })
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('the QA API did not come back')
}

async function managerToken(request: APIRequestContext) {
  const r = await request.post(`${API}/admin/v1/auth/login`, { data: { email: 'manager@mandimangoes.test', password: 'manager123' }, headers: { Origin: PANEL } })
  expect(r.ok()).toBeTruthy()
  return (await r.json()).accessToken as string
}

async function shopOrder(page: Page, phone: string, { pay = true }: { pay?: boolean } = {}) {
  await page.goto(`${SHOP}/`)
  await page.getByRole('textbox', { name: 'Pincode' }).fill('560034')
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByRole('link', { name: /Pincode 560034/ }).first()).toBeVisible()
  await page.getByTestId('product-card').filter({ has: page.getByRole('button', { name: /^Add .* to cart$/ }) }).first().getByRole('button', { name: /^Add .* to cart$/ }).click()
  await page.goto(`${SHOP}/checkout`)
  await page.getByRole('textbox', { name: /mobile number/i }).fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const code = (await page.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0]
  await page.getByRole('textbox', { name: 'Digit 1' }).click()
  await page.keyboard.type(code)
  await expect(page).toHaveURL(/\/checkout$/)
  await page.getByRole('textbox', { name: 'Address' }).fill('12, 4th Cross, Koramangala, Bengaluru 560034')
  await page.getByRole('radiogroup', { name: 'Delivery time' }).getByRole('radio', { disabled: false }).first().click()
  await page.getByText('Pay now').click()
  if (!pay) return null
  await page.getByRole('button', { name: 'Pay (test)' }).click()
  await expect(page).toHaveURL(/\/order\/[^/]+\/success$/)
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible()
  return page.url().match(/\/order\/([^/]+)\/success/)![1]
}

async function panelSignIn(page: Page) {
  await page.goto(`${PANEL}/login`)
  await page.getByLabel('Work email').fill('manager@mandimangoes.test')
  await page.getByLabel('Password').fill('manager123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

async function panelPack(page: Page, orderId: string) {
  await page.goto(`${PANEL}/orders/${orderId}`)
  await page.getByRole('button', { name: 'Start processing' }).click()
  await page.getByRole('button', { name: 'Allocate stock' }).click()
  await expect(page.getByText('Stock allocated. Pick list is ready.')).toBeVisible()
  await page.getByRole('button', { name: 'Mark packed', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mark packed', exact: true })).toHaveCount(0)
}

const state: { orderId?: string; riderId?: string; phone?: string } = {}

test('day 1: the shop orders and pays; the panel packs it and gives it to a rider', async ({ browser, request }) => {
  await clockTo('2026-11-03T04:30:00Z') // 10:00 IST, before the 18:00 cutoff: the first delivery day is 4 Nov
  const shop = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  state.phone = `98${String(Date.now()).slice(-8)}`
  state.orderId = (await shopOrder(shop, state.phone))!
  // Tracking says Confirmed.
  await shop.getByRole('link', { name: /Track order/ }).click()
  await expect(shop).toHaveURL(new RegExp(`/order/${state.orderId}$`))
  await expect(shop.getByText('Confirmed').first()).toBeVisible()

  const panel = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await panelSignIn(panel)
  await panelPack(panel, state.orderId)

  // A rider with a mobile number (Staff), given the stop on Deliveries.
  const mgr = await managerToken(request)
  const add = await request.post(`${API}/admin/v1/staff`, {
    data: { email: `rider.${state.phone}@mandimangoes.test`, role: 'RIDER', password: 'long-enough-qa-9', phone: state.phone.replace(/^98/, '97'), displayName: 'QA Rider', confirmCode: 'manager123' },
    headers: { Authorization: `Bearer ${mgr}`, Origin: PANEL },
  })
  expect(add.status(), await add.text()).toBe(201)
  state.riderId = (await add.json()).id
  await panel.goto(`${PANEL}/deliveries?date=2026-11-04`)
  const stop = panel.getByRole('listitem', { name: new RegExp((await (await request.get(`${API}/admin/v1/orders/${state.orderId}`, { headers: { Authorization: `Bearer ${mgr}` } })).json()).number) })
  await expect(stop).toBeVisible()
  const assign = await request.post(`${API}/admin/v1/manifest/assign`, { data: { date: '2026-11-04', orderIds: [state.orderId], riderId: state.riderId }, headers: { Authorization: `Bearer ${mgr}`, Origin: PANEL } })
  expect(assign.ok(), await assign.text()).toBeTruthy()
})

test('day 2: the rider picks up and delivers with photos and the code; the shop and WhatsApp follow', async ({ browser, request }) => {
  await clockTo('2026-11-04T03:30:00Z') // 09:00 IST on the delivery day
  const rider = await (await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 12.9352, longitude: 77.6245 } })).newPage()
  // The browsers' clocks move with the API's: the rider app asks for "today's" run by the phone's date.
  await rider.clock.install({ time: new Date('2026-11-04T03:30:00Z') })
  await rider.goto(`${RIDER}/`)
  await rider.getByLabel('Mobile number').fill(state.phone!.replace(/^98/, '97'))
  await rider.getByRole('button', { name: 'Send code' }).click()
  const code = (await rider.getByText(/\b\d{6}\b/).first().textContent())!.match(/\d{6}/)![0]
  await rider.getByTestId('otp').fill(code)
  await rider.getByTestId('pin').fill('2468')
  await rider.getByRole('heading', { name: 'Enter it again' }).waitFor()
  await rider.getByTestId('pin').fill('2468')
  await rider.waitForURL('**/today')
  const card = rider.getByTestId('current-stop')
  await card.getByRole('link', { name: 'Pick up at warehouse' }).click()
  await rider.getByTestId('pickup-photo').setInputFiles(path.join(FIXTURES, 'sealed-box.jpg'))
  await rider.getByRole('button', { name: 'Mark picked up' }).click()
  await expect(rider.getByText('WhatsApp sent').or(rider.getByText(/queued|waiting/i)).first()).toBeVisible()
  await rider.getByRole('link', { name: 'Back to the run' }).click()
  await rider.getByTestId('current-stop').getByRole('link', { name: 'At the door' }).click()
  await rider.getByTestId('door-photo').setInputFiles(path.join(FIXTURES, 'sealed-box.jpg'))
  await rider.getByTestId('open-photo').setInputFiles(path.join(FIXTURES, 'open-box.jpg'))
  await expect(rider.getByTestId('step-4')).toHaveAttribute('data-state', 'active', { timeout: 30_000 })

  // The customer reads the code on the shop's tracking page.
  const shop = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await shop.clock.install({ time: new Date('2026-11-04T03:40:00Z') })
  await shop.goto(`${SHOP}/login?next=${encodeURIComponent(`/order/${state.orderId}`)}`)
  await shop.getByRole('textbox', { name: /mobile number/i }).fill(state.phone!)
  await shop.getByRole('button', { name: 'Send code' }).click()
  const otp = (await shop.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0]
  await shop.getByRole('textbox', { name: 'Digit 1' }).click()
  await shop.keyboard.type(otp)
  await expect(shop).toHaveURL(new RegExp(`/order/${state.orderId}$`))
  const deliveryCode = (await shop.getByTestId('delivery-code').textContent())!.replace(/\D/g, '')
  expect(deliveryCode).toMatch(/^\d{4}$/)

  await rider.getByTestId('delivery-code').fill(deliveryCode)
  await expect(rider.getByRole('heading', { name: 'Delivered' })).toBeVisible()
  await shop.reload()
  await expect(shop.getByText('Delivered').first()).toBeVisible()

  // The WhatsApp updates went out, in order (the log provider records them as sent).
  const mgr = await managerToken(request)
  const order = await (await request.get(`${API}/admin/v1/orders/${state.orderId}`, { headers: { Authorization: `Bearer ${mgr}` } })).json()
  const kinds = order.notifications.map((n: { kind: string }) => n.kind)
  for (const k of ['ORDER_CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERY_CODE']) expect(kinds, JSON.stringify(order.notifications)).toContain(k)
  expect(order.status).toBe('DELIVERED')
})

test('the customer claims, and the panel approves a free replacement', async ({ browser, request }) => {
  const shop = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await shop.clock.install({ time: new Date('2026-11-04T05:00:00Z') })
  await shop.goto(`${SHOP}/login?next=${encodeURIComponent(`/order/${state.orderId}/claim`)}`)
  await shop.getByRole('textbox', { name: /mobile number/i }).fill(state.phone!)
  await shop.getByRole('button', { name: 'Send code' }).click()
  const otp = (await shop.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0]
  await shop.getByRole('textbox', { name: 'Digit 1' }).click()
  await shop.keyboard.type(otp)
  await expect(shop).toHaveURL(new RegExp(`/order/${state.orderId}/claim$`))
  await shop.getByRole('radio', { name: /Damaged or spoilt/ }).check()
  // A one-item order has no item list to tick.
  const item = shop.getByRole('checkbox').first()
  if ((await item.count()) && !(await item.isChecked())) await item.check()
  await shop.locator('#desc').fill('The box arrived crushed on one side.')
  await shop.getByRole('button', { name: 'Send report' }).click()
  await expect(shop.getByText("Thanks. We've got your report.")).toBeVisible()

  const panel = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await panelSignIn(panel)
  await panel.goto(`${PANEL}/claims`)
  const mgr = await managerToken(request)
  const { number } = await (await request.get(`${API}/admin/v1/orders/${state.orderId}`, { headers: { Authorization: `Bearer ${mgr}` } })).json()
  await panel.getByRole('button', { name: `Start review for ${number}` }).click()
  await panel.getByRole('button', { name: `Resolve ${number}` }).click()
  await panel.getByRole('dialog').getByLabel(/Replacement/).check()
  await panel.getByRole('dialog').getByRole('button', { name: 'Approve replacement' }).click()
  await shop.goto(`${SHOP}/order/${state.orderId}/claim`)
  await expect(shop.getByRole('link', { name: /See replacement ORD-/ })).toBeVisible()
})

// ---------------------------------------------------------------- the failure paths

/** A paid order through the shop's API (the shop UI is covered above), for the given delivery day. */
async function apiOrder(request: APIRequestContext, deliveryDate?: string) {
  const phone = `96${String(Date.now()).slice(-8)}`
  const call = async (method: string, p: string, data?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await request.fetch(`${API}${p}`, { method, data, headers: { Origin: SHOP, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } })
    expect(r.ok(), `${method} ${p}: ${r.status()} ${await r.text()}`).toBeTruthy()
    return r.status() === 204 ? null : r.json()
  }
  const { devCode } = await call('POST', '/v1/auth/otp/request', { phone })
  const { accessToken } = await call('POST', '/v1/auth/otp/verify', { phone, code: devCode })
  const cat = await call('GET', `/v1/catalogue?pincode=560034${deliveryDate ? `&deliveryDate=${deliveryDate}` : ''}`)
  const item = cat.items.find((i: { qty: number }) => i.qty > 0)
  await call('POST', '/v1/cart/items', { sku: item.sku, stage: item.stage, qty: 1 }, accessToken)
  const { slots } = await call('GET', `/v1/delivery/slots?pincode=560034&date=${cat.deliveryDate}`)
  const q = await call('POST', '/v1/checkout/quote', { pincode: '560034', deliveryDate: cat.deliveryDate, slotId: slots.find((s: { available: boolean }) => s.available)?.id }, accessToken)
  const o = await call('POST', '/v1/checkout/confirm', { quoteId: q.quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' }, accessToken, { 'Idempotency-Key': `qa-${phone}` })
  await call('POST', '/v1/dev/pay', { orderId: o.orderId, outcome: 'captured' })
  return { id: o.orderId as string, number: o.number as string, date: cat.deliveryDate as string, phone }
}

async function shopSignIn(page: Page, phone: string, next: string) {
  await page.goto(`${SHOP}/login?next=${encodeURIComponent(next)}`)
  await page.getByRole('textbox', { name: /mobile number/i }).fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const otp = (await page.getByText(/your code is \d{6}/).textContent())!.match(/\d{6}/)![0]
  await page.getByRole('textbox', { name: 'Digit 1' }).click()
  await page.keyboard.type(otp)
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`))
}

test('payment failed: the shop says so at once, and the order still waits for payment', async ({ browser, request }) => {
  const shop = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await shop.clock.install({ time: new Date('2026-11-04T05:00:00Z') })
  await shopOrder(shop, `95${String(Date.now()).slice(-8)}`, { pay: false })
  await shop.getByRole('button', { name: 'Fail payment (test)' }).click()
  await expect(shop.getByTestId('dev-pay').getByRole('alert')).toHaveText("The payment didn't go through. Nothing was charged. Try again.")
  await shop.getByRole('link', { name: 'Go to the order' }).click()
  await expect(shop.getByText('Waiting for payment').first()).toBeVisible()
  const id = shop.url().match(/\/order\/([^/?]+)/)![1]
  const mgr = await managerToken(request)
  expect((await (await request.get(`${API}/admin/v1/orders/${id}`, { headers: { Authorization: `Bearer ${mgr}` } })).json()).status).toBe('PAYMENT_PENDING')
})

test('out of stock during checkout: QC writes the stock off while the customer pays, and the shop explains', async ({ browser, request }) => {
  const shop = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await shop.clock.install({ time: new Date('2026-11-04T05:00:00Z') })
  const phone = `94${String(Date.now()).slice(-8)}`
  await shop.goto(`${SHOP}/`)
  await shop.getByRole('textbox', { name: 'Pincode' }).fill('560034')
  await shop.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(shop.getByRole('link', { name: /Pincode 560034/ }).first()).toBeVisible()
  await shop.getByTestId('product-card').filter({ has: shop.getByRole('button', { name: /^Add .* to cart$/ }) }).first().getByRole('button', { name: /^Add .* to cart$/ }).click()
  // Which box it is ("ALP-3|SEMI_RIPE"), from the shop's saved cart.
  await expect.poll(() => shop.evaluate(() => JSON.parse(localStorage.getItem('mm.cart') ?? '{}').state?.lines?.length ?? 0)).toBe(1)
  const [sku, stage] = (await shop.evaluate(() => JSON.parse(localStorage.getItem('mm.cart')!).state.lines[0].skuId as string)).split('|')
  await shopSignIn(shop, phone, '/checkout')
  await shop.getByRole('textbox', { name: 'Address' }).fill('12, 4th Cross, Koramangala, Bengaluru 560034')
  await shop.getByRole('radiogroup', { name: 'Delivery time' }).getByRole('radio', { disabled: false }).first().click()
  // Meanwhile QC condemns every batch holding that box (mould found): its stock is written off.
  const mgr = await managerToken(request)
  const auth = { Authorization: `Bearer ${mgr}`, Origin: PANEL }
  const batches = await (await request.get(`${API}/admin/v1/batches`, { headers: auth })).json()
  for (const bt of batches.items ?? batches) {
    const detail = await (await request.get(`${API}/admin/v1/batches/${bt.id}`, { headers: auth })).json()
    if (!detail.lines?.some((l: { sku: string; available?: number; onHand?: number }) => l.sku === sku)) continue
    const r = await request.patch(`${API}/admin/v1/batches/${bt.id}/status`, { data: { status: 'CONDEMNED', reason: 'QC found mould', confirmCode: 'manager123' }, headers: auth })
    expect(r.ok() || r.status() === 409, `${bt.id}: ${r.status()} ${await r.text()}`).toBeTruthy()
  }
  const left = (await (await request.get(`${API}/v1/catalogue?pincode=560034`)).json()).items.find((i: { sku: string; stage: string }) => i.sku === sku && i.stage === stage).qty
  expect(left, `${sku} ${stage} still on sale`).toBe(0)

  await shop.getByText('Pay now').click()
  // Said once, where the cart can be changed (it used to show twice: the quote and the Pay button).
  const short = shop.getByRole('alert').filter({ hasText: /is running short for this day\. Lower the quantity or pick another day\./ })
  await expect(short).toHaveCount(1)
  await expect(short.getByRole('button', { name: 'Edit cart' })).toBeVisible()
  await expect(shop).toHaveURL(/\/checkout$/)
})

test('cancelled after packing: the panel cancels and refunds; the shop shows it cancelled', async ({ browser, request }) => {
  const o = await apiOrder(request)
  const panel = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await panelSignIn(panel)
  await panelPack(panel, o.id)
  await panel.getByRole('button', { name: 'Cancel and refund' }).click()
  const dialog = panel.getByRole('dialog', { name: `Cancel and refund order ${o.number}?` })
  await dialog.getByLabel(/Reason/).fill('Customer moved away')
  await dialog.getByRole('button', { name: 'Cancel and refund' }).click()
  // Money moves: the manager confirms it is them.
  const confirm = panel.getByRole('dialog', { name: "Confirm it's you" })
  await confirm.getByLabel('Your password').fill('manager123')
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(panel.getByText('Cancelled').first()).toBeVisible()

  const shop = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await shop.clock.install({ time: new Date('2026-11-04T05:00:00Z') })
  await shopSignIn(shop, o.phone, `/order/${o.id}`)
  await expect(shop.getByText('This order was cancelled.')).toBeVisible()
  await expect(shop.getByText(/refund/i).first()).toBeVisible()
})

test('delivery failed: the rider says why, the order is retried, and finally comes back (RTO)', async ({ browser, request }) => {
  const o = await apiOrder(request)
  const mgr = await managerToken(request)
  const auth = { Authorization: `Bearer ${mgr}`, Origin: PANEL }
  for (const step of ['PROCESSING', 'allocate', 'PACKED']) {
    const r = step === 'allocate' ? await request.post(`${API}/admin/v1/orders/${o.id}/allocate`, { headers: auth }) : await request.patch(`${API}/admin/v1/orders/${o.id}/status`, { data: { status: step }, headers: auth })
    expect(r.ok(), await r.text()).toBeTruthy()
  }
  expect((await request.post(`${API}/admin/v1/manifest/assign`, { data: { date: o.date, orderIds: [o.id], riderId: state.riderId }, headers: auth })).ok()).toBeTruthy()
  await clockTo(`${o.date}T03:30:00Z`)

  const rider = await (await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 12.9352, longitude: 77.6245 } })).newPage()
  await rider.clock.install({ time: new Date(`${o.date}T03:30:00Z`) })
  await rider.goto(`${RIDER}/`)
  await rider.getByLabel('Mobile number').fill(state.phone!.replace(/^98/, '97'))
  await rider.getByRole('button', { name: 'Send code' }).click()
  const code = (await rider.getByText(/\b\d{6}\b/).first().textContent())!.match(/\d{6}/)![0]
  await rider.getByTestId('otp').fill(code)
  await rider.getByTestId('pin').fill('2468')
  await rider.getByRole('heading', { name: 'Enter it again' }).waitFor()
  await rider.getByTestId('pin').fill('2468')
  await rider.waitForURL('**/today')
  await rider.getByTestId('current-stop').getByRole('link', { name: 'Pick up at warehouse' }).click()
  await rider.getByTestId('pickup-photo').setInputFiles(path.join(FIXTURES, 'sealed-box.jpg'))
  await rider.getByRole('button', { name: 'Mark picked up' }).click()
  await expect(rider.getByText('WhatsApp sent').first()).toBeVisible()
  await rider.getByRole('link', { name: 'Back to the run' }).click()
  await rider.getByTestId('current-stop').getByRole('link', { name: 'At the door' }).click()
  await rider.getByRole('button', { name: 'Customer not home' }).click()
  const sheet = rider.getByRole('dialog')
  await sheet.getByRole('radio').first().check()
  await sheet.getByRole('button', { name: /save|mark|missed|done/i }).last().click()
  await expect.poll(async () => (await (await request.get(`${API}/admin/v1/orders/${o.id}`, { headers: auth })).json()).status, { timeout: 30_000 }).toBe('DELIVERY_FAILED')

  // The retry is on the next delivery day with room; on the panel the order can then be marked returned.
  const failed = await (await request.get(`${API}/admin/v1/orders/${o.id}`, { headers: auth })).json()
  expect(failed.deliveryDate > o.date, `retry date ${failed.deliveryDate}`).toBeTruthy()
  const panel = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await panelSignIn(panel)
  await panel.goto(`${PANEL}/orders/${o.id}`)
  await panel.getByRole('button', { name: 'Mark as returned' }).click()
  await panel.getByRole('dialog', { name: `Mark ${o.number} as returned?` }).getByRole('button', { name: 'Mark as returned' }).click()
  await expect.poll(async () => (await (await request.get(`${API}/admin/v1/orders/${o.id}`, { headers: auth })).json()).status).toBe('RTO')
})
