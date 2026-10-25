import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '../../tests/fixtures'

// Bulk Deals against the real API: a manager publishes a deal (through the admin
// API), a customer opens the Bulk Deals tab, picks a quantity, sees the tier price
// change, adds it, checks out and pays (test payment). Then: a price change and a
// deal taken down while in the cart. Empty and error states use mocked answers.

const API = process.env.VITE_API_URL ?? 'http://localhost:3000'
const PHOTO = fs.readFileSync(path.join(__dirname, 'fixtures', 'mango.jpg'))

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
})

type Req = import('@playwright/test').APIRequestContext
type Page = import('@playwright/test').Page

async function managerToken(request: Req) {
  const r = await request.post(`${API}/admin/v1/auth/login`, { data: { email: 'manager@mandimangoes.test', password: 'manager123' } })
  expect(r.status()).toBe(200)
  return ((await r.json()) as { accessToken: string }).accessToken
}

/** A box and ripeness with at least 6 in stock on the first open day, so a 2-box-step deal can sell 4. */
async function stockedBox(request: Req) {
  const cat = (await (await request.get(`${API}/v1/catalogue?pincode=560034`)).json()) as { items: { sku: string; stage: string; qty: number; price: number }[] }
  const hit = cat.items.find((i) => i.qty >= 6)
  test.skip(!hit, 'no box with 6 in stock on the first open day')
  return hit!
}

/** Publishes a deal for that box: 2 boxes or more in steps of 2, cheaper from 4. */
async function publishDeal(request: Req, token: string, box: { sku: string; stage: string; price: number }, title: string) {
  const auth = { Authorization: `Bearer ${token}` }
  const c = await request.post(`${API}/admin/v1/bulk-listings`, {
    headers: auth,
    data: {
      sku: box.sku, title, description: 'Full boxes packed together for an office or a family get-together.', origin: 'Ratnagiri, Maharashtra',
      stages: [box.stage], minQty: 2, qtyStep: 2, maxQty: 6, tiers: [{ minQty: 2, unitPrice: box.price - 5000 }, { minQty: 4, unitPrice: box.price - 10000 }],
    },
  })
  expect(c.status(), await c.text()).toBe(201)
  const id = ((await c.json()) as { id: string }).id
  expect((await request.post(`${API}/admin/v1/bulk-listings/${id}/photos`, { headers: { ...auth, 'Content-Type': 'image/jpeg' }, data: PHOTO })).status()).toBe(201)
  const p = await request.post(`${API}/admin/v1/bulk-listings/${id}/publish`, { headers: auth, data: {} })
  expect(p.status(), await p.text()).toBe(200)
  return id
}

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}

const rupee = (paise: number) => `₹${new Intl.NumberFormat('en-IN').format(paise / 100)}`

async function signIn(page: Page, phone: string) {
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const hint = await page.getByText(/Test mode: your code is \d{6}/).textContent()
  await page.getByLabel('6-digit code').fill(hint!.match(/\d{6}/)![0])
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('buy a bulk deal: tiers, add to cart, check out and pay', async ({ page, request }, info) => {
  const token = await managerToken(request)
  const box = await stockedBox(request)
  const title = `Office pack ${info.project.name} ${Date.now()}`
  await publishDeal(request, token, box, title)

  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('mm.where', JSON.stringify({ pincode: '560034', date: null })))
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Bulk Deals' }).first().click()
  await expect(page.getByRole('heading', { name: 'Bulk Deals', level: 1 })).toBeVisible()
  await noA11yViolations(page)
  await page.getByRole('link', { name: title }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  // The tiers, and the saving only where the tier is below the single-box price.
  const tiers = page.getByRole('table', { name: 'Price per box' })
  await expect(tiers).toContainText('2 to 3 boxes')
  await expect(tiers).toContainText('4 to 6 boxes')
  await expect(tiers).toContainText(`${rupee(5000)} less than a single box`)
  // Steps of 2 from the minimum of 2; the total and the tier follow the quantity.
  await expect(page.getByRole('button', { name: `Add 2 boxes · ${rupee((box.price - 5000) * 2)}` })).toBeVisible()
  await expect(page.getByRole('button', { name: '2 boxes fewer' })).toBeDisabled()
  await page.getByRole('button', { name: '2 boxes more' }).click()
  await expect(page.getByRole('button', { name: `Add 4 boxes · ${rupee((box.price - 10000) * 4)}` })).toBeVisible()
  await noA11yViolations(page)
  await page.getByRole('button', { name: /^Add 4 boxes/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'are in your cart' })).toBeVisible()

  await page.goto('/cart')
  await expect(page.getByRole('link', { name: title })).toBeVisible()
  await expect(page.locator('.total-row')).toContainText(rupee((box.price - 10000) * 4))
  await noA11yViolations(page)
  await page.getByRole('button', { name: 'Sign in to check out' }).click()
  await signIn(page, `9${String(Date.now()).slice(-8)}${info.project.name === 'phone' ? 3 : 4}`)

  await expect(page.getByRole('heading', { name: 'Delivery details' })).toBeVisible()
  await expect(page.getByText('Promo codes apply to regular boxes, not bulk deals.')).toBeVisible()
  await page.getByLabel('Delivery address').fill('Flat 4B, Lake View Apartments, 5th Main, near the park')
  const slots = page.getByRole('group', { name: 'Delivery time' })
  if (await slots.count()) await slots.getByRole('radio', { disabled: false }).first().check()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByRole('heading', { name: 'Review and pay' })).toBeVisible()
  await expect(page.getByText(`4 × ${title}`)).toBeVisible()
  await page.getByRole('button', { name: `Pay ${rupee((box.price - 10000) * 4)}` }).click()

  await expect(page.getByRole('heading', { name: /^Order ORD-/ })).toBeVisible()
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()
  // The order keeps the deal's name and the tier it was sold at.
  await expect(page.getByText(`4 × ${title}`)).toBeVisible()
  await expect(page.getByText(`${rupee(box.price - 10000)} a box, the price for 4 to 6 boxes`)).toBeVisible()
  await noA11yViolations(page)
  // Cancel, so the boxes go back for the other runs.
  await page.getByRole('button', { name: 'Cancel order' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click()
  await expect(page.getByText('This order was cancelled.')).toBeVisible()
})

test('a price change and a deal taken down while in the cart', async ({ page, request }, info) => {
  const token = await managerToken(request)
  const box = await stockedBox(request)
  const title = `Family pack ${info.project.name} ${Date.now()}`
  const id = await publishDeal(request, token, box, title)
  const auth = { Authorization: `Bearer ${token}` }

  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('mm.where', JSON.stringify({ pincode: '560034', date: null })))
  await page.goto(`/bulk/${id}`)
  await page.getByRole('button', { name: /^Add 2 boxes/ }).click()

  // The manager lowers the price: the cart shows the new one and says what it was.
  const patch = await request.patch(`${API}/admin/v1/bulk-listings/${id}`, {
    headers: auth,
    data: { tiers: [{ minQty: 2, unitPrice: box.price - 7000 }, { minQty: 4, unitPrice: box.price - 10000 }] },
  })
  expect(patch.status(), await patch.text()).toBe(200)
  await page.goto('/cart')
  await expect(page.getByText(`${rupee(box.price - 7000)} a box`)).toBeVisible()
  await expect(page.getByText(`Was ${rupee(box.price - 5000)} a box when you added it.`)).toBeVisible()
  await page.getByRole('button', { name: 'OK, got it' }).click()
  await expect(page.locator('.total-row')).toContainText(rupee((box.price - 7000) * 2))

  // Taken down: the cart says so, and checkout drops it rather than charging for it.
  expect((await request.post(`${API}/admin/v1/bulk-listings/${id}/unpublish`, { headers: auth, data: {} })).status()).toBe(200)
  await page.reload()
  await expect(page.getByText('This deal has ended. Remove it to check out.')).toBeVisible()
  await page.goto(`/bulk/${id}`)
  await expect(page.getByRole('heading', { name: 'This bulk deal is not available' })).toBeVisible()
  await page.goto('/cart')
  await page.getByRole('button', { name: new RegExp(`^Remove ${title}`) }).click()
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible()
})

test('empty and error states', async ({ page }) => {
  await page.route('**/v1/bulk-deals*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, serviceable: null }) }))
  await page.goto('/bulk')
  await expect(page.getByRole('heading', { name: 'No bulk deals right now' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Shop regular boxes' })).toBeVisible()
  await noA11yViolations(page)
  await page.unroute('**/v1/bulk-deals*')
  await page.route('**/v1/bulk-deals*', (r) =>
    r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The shop is busy. Try again in a moment.' } }) }),
  )
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('The shop is busy')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})
