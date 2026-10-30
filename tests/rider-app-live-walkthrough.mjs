// Docs only, not CI: the panel side of one real rider-app delivery, at 1280 px, against a
// running mango-api (WHATSAPP_PROVIDER=log). Screenshots go to docs/rider-app/panel-*.png.
//   PANEL_URL=http://localhost:5183 API_URL=http://localhost:3200 ORDER_ID=ord_… CUST_PHONE=98… node tests/rider-app-live-walkthrough.mjs
// The rider's steps are made through the API as the rider app makes them (photos with X- headers).
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'docs', 'rider-app')
const PANEL = process.env.PANEL_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3000'
const ORDER_ID = process.env.ORDER_ID
const jpeg = (name) => readFileSync(path.join(here, '..', 'rider-app', 'e2e', 'fixtures', name))

async function call(method, p, body, token, headers = {}) {
  const raw = Buffer.isBuffer(body)
  const r = await fetch(API + p, {
    method,
    headers: { ...(raw ? { 'Content-Type': 'image/jpeg' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await r.text()
  const b = t ? JSON.parse(t) : null
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t}`)
  return b
}
const rider = (await call('POST', '/admin/v1/auth/login', { email: 'ravi.rider@mandimangoes.test', password: 'rider12345' })).accessToken
let n = 0
const photo = (step, name) =>
  call('POST', `/admin/v1/orders/${ORDER_ID}/photos`, jpeg(name), rider, {
    'X-Step': step, 'X-Client-Id': `walk-${step}-${Date.now()}-${n++}`, 'X-Lat': String(12.9352 + n / 1e4), 'X-Lng': '77.6245', 'X-Accuracy': '9', 'X-Taken-At': String(Date.now()),
  })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const shot = async (name, full = false) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(out, `panel-${name}.png`), fullPage: full })
  console.log('shot', name)
}

await page.goto(PANEL)
await page.getByLabel(/email/i).fill('manager@mandimangoes.test')
await page.getByLabel(/password/i).fill('manager123')
await page.getByRole('button', { name: /sign in/i }).click()
await page.waitForTimeout(3000)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
if (!process.env.SHOTS_ONLY) {
// Today: the first poll only takes a cursor; the pickup below raises a notice within 10 seconds.
await page.waitForTimeout(11_000)
await photo('pickup', 'sealed-box.jpg')
const picked = await call('POST', `/admin/v1/orders/${ORDER_ID}/pickup`, { clientId: 'walk-pickup-1' }, rider)
console.log('pickup', picked.messages.map((m) => `${m.kind}:${m.status}:${m.providerId}`).join(' '))
const t0 = Date.now()
await page.getByText(/picked up/i).first().waitFor({ timeout: 15_000 })
console.log('toast after', Date.now() - t0, 'ms')
await shot('01-today-picked-up-toast')

// At the door: door photo, open box, the check (no working key here: it can't run, so it passes for review), the code.
await photo('door', 'sealed-box.jpg')
const box = await photo('open_box', 'open-box.jpg')
const check = await call('POST', `/admin/v1/orders/${ORDER_ID}/photos/${box.id}/check`, {}, rider)
console.log('check', JSON.stringify({ passed: check.passed, needsReview: check.needsReview, mode: check.mode, reason: check.reason }))
const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())
const otp = await post('/v1/auth/otp/request', { phone: process.env.CUST_PHONE })
const cust = await post('/v1/auth/otp/verify', { phone: process.env.CUST_PHONE, code: otp.devCode })
const mine = await fetch(`${API}/v1/orders/${ORDER_ID}`, { headers: { Authorization: `Bearer ${cust.accessToken}` } }).then((r) => r.json())
console.log('shop shows', mine.status, mine.rider)
console.log('delivered', JSON.stringify(await call('POST', `/admin/v1/orders/${ORDER_ID}/delivery`, { outcome: 'DELIVERED', code: mine.deliveryCode }, rider)))
}

await page.goto(`${PANEL}/deliveries?date=${today}`)
await page.getByText(/live proof/i).first().waitFor({ timeout: 15_000 })
await page.waitForTimeout(2500)
await shot('02-deliveries-live', true)
const chip = page.getByRole('button', { name: /needs review/i }).first()
if (await chip.isVisible().catch(() => false)) {
  await chip.click()
  await page.waitForTimeout(1500)
  await shot('03-needs-review-dialog')
  await page.keyboard.press('Escape')
}
await page.goto(`${PANEL}/orders/${ORDER_ID}`)
await page.getByText(/^Proof$/).first().waitFor({ timeout: 15_000 })
const details = page.locator('details').filter({ hasText: /verdict/i }).first()
if (await details.isVisible().catch(() => false)) await details.locator('summary').click()
await page.getByText(/^Proof$/).first().scrollIntoViewIfNeeded()
await shot('04-order-proof')
await shot('04b-order-proof-full', true)
await page.goto(`${PANEL}/staff`)
await page.waitForTimeout(3000)
await shot('05-staff-riders')
const phones = page.getByRole('button', { name: /number and phones/i }).first()
if (await phones.isVisible().catch(() => false)) {
  await phones.click()
  await page.waitForTimeout(1200)
  await shot('06-staff-rider-phones')
}
await browser.close()
