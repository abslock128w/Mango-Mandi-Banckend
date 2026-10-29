import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import type { Download, Page } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'
import { reviewOrder } from './checkout'
import { managerToken } from './staff'

// Bills, the customer profile and CSV exports end to end against the real API
// (docs/trust.md): a business buys with its GSTIN, pays (test payment), and
// downloads its numbered bill; a manager downloads the same bill in the
// panel, opens the customer's profile, reveals the number and exports orders.

const API = process.env.VITE_API_URL ?? 'http://localhost:3000'
const PANEL = process.env.PANEL_URL ?? `http://localhost:${process.env.PANEL_PORT ?? 5173}`
const GSTIN = '29ABCDE1234F1ZW'

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
  const policy = await (await request.get(`${API}/v1/policy`)).json()
  test.skip(!policy.bills, 'bills are switched off on this API (BILLS_ENABLED)')
})

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}

async function noSideScroll(page: Page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(wide, 'no horizontal scroll').toBeLessThanOrEqual(0)
}

/** The text of a downloaded PDF, as pdftotext reads it. */
async function pdfText(download: Download) {
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  return execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes }).toString()
}

test('a business pays, downloads its bill; a manager downloads it, opens the profile, reveals the number and exports orders', async ({ page, request, context }, info) => {
  // A whole journey in two apps: checkout, payment, three downloads.
  test.setTimeout(120_000)
  // The narrowest phone the shop supports (375px), for the business fields and the bill card.
  const narrow = info.project.name === 'phone'
  if (narrow) await page.setViewportSize({ width: 375, height: 812 })
  const phone = `7${String(Date.now()).slice(-8)}${info.project.name === 'phone' ? 1 : 2}`
  const business = `Lakshmi Fruit Stores ${info.project.name}`

  // A box in the cart for the earliest day.
  const cat = await (await request.get(`${API}/v1/catalogue?pincode=560034`)).json()
  const item = cat.items.find((i: { qty: number }) => i.qty > 0)
  expect(item, 'something in stock').toBeTruthy()
  await page.goto('/')
  // The shop saves its own empty choices once it has rendered; wait for that, then set ours.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.evaluate(
    ([item, date]) => {
      localStorage.setItem('mm.where', JSON.stringify({ pincode: '560034', date }))
      localStorage.setItem('mm.cart', JSON.stringify([{ sku: item.sku, stage: item.stage, qty: 1, name: item.name, price: item.price }]))
    },
    [item, cat.deliveryDate] as const,
  )
  await page.goto(`/sign-in?next=${encodeURIComponent('/checkout')}`)
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const hint = await page.getByText(/Test mode: your code is \d{6}/).textContent()
  await page.getByLabel('6-digit code').fill(hint!.match(/\d{6}/)![0])
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Delivery details' })).toBeVisible()

  await expect(page.getByRole('radiogroup', { name: 'When should it arrive?' }).getByRole('radio', { checked: true })).toBeVisible()
  const slots = page.getByRole('group', { name: 'Delivery time' })
  if (await slots.count()) await slots.locator('input:not([disabled])').first().check()
  await page.getByLabel('Delivery address').fill('Shop 3, Market Road, Koramangala, Bengaluru')

  // The business details: a typo in the GSTIN is caught before anything is sent.
  await page.getByLabel('Buying for a business? Add its name and GSTIN to the bill').check()
  await page.getByLabel('Business name').fill(business)
  await page.getByLabel('GSTIN', { exact: true }).fill('29ABCDE1234F1ZX')
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByText('That GSTIN has a typo: check it against the GST certificate.')).toBeVisible()
  await expect(page.getByLabel('GSTIN', { exact: true })).toBeFocused()
  await noA11yViolations(page)
  await noSideScroll(page)
  await page.getByLabel('GSTIN', { exact: true }).fill(GSTIN.toLowerCase())
  await reviewOrder(page, 15_000)
  await expect(page.getByText(`GSTIN ${GSTIN}`)).toBeVisible()
  await expect(page.getByText(business)).toBeVisible()
  await page.getByRole('button', { name: /^Pay ₹/ }).click()

  // No gateway keys on the test API: the order page offers the test payment.
  const heading = page.getByRole('heading', { name: /^Order ORD-/ })
  await expect(heading).toBeVisible()
  const orderNumber = (await heading.textContent())!.replace(/^Order /, '').trim()
  const orderId = new URL(page.url()).pathname.split('/').pop()!
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  const bill = page.getByRole('region', { name: 'Your bill' })
  await expect(bill).toBeVisible({ timeout: 15_000 })
  // A registered seller's exempt fruit is a Bill of Supply; without a GSTIN it is a Receipt. Never a Tax Invoice.
  await expect(bill).toContainText(/(Bill of Supply|Receipt) MM\/\d{2}-\d{2}\/\d{6}/)
  await expect(bill).toContainText(`Billed to ${business}, GSTIN ${GSTIN}.`)
  await noA11yViolations(page)
  await noSideScroll(page)
  if (info.project.name === 'phone') await page.screenshot({ path: 'test-results-shop/trust-01-bill.png', fullPage: true })

  const [shopDownload] = await Promise.all([page.waitForEvent('download'), bill.getByRole('button', { name: 'Download bill (PDF)' }).click()])
  expect(shopDownload.suggestedFilename()).toMatch(/^MandiMangoes-bill-MM-\d{2}-\d{2}-\d{6}\.pdf$/)
  const text = await pdfText(shopDownload)
  expect(text).toMatch(/Bill of Supply|Receipt/)
  expect(text).not.toMatch(/Tax Invoice/)
  expect(text).toContain(business)
  expect(text).toContain(GSTIN)
  expect(text).toContain('Rs.')
  const number = (await bill.locator('strong').first().textContent())!.trim()
  expect(text).toContain(number)

  // Someone else's bill is not there for them.
  const other = await request.post(`${API}/v1/auth/otp/request`, { data: { phone: `6${phone.slice(1)}` } })
  const otherTokens = await (await request.post(`${API}/v1/auth/otp/verify`, { data: { phone: `6${phone.slice(1)}`, code: (await other.json()).devCode } })).json()
  const theirs = await request.get(`${API}/v1/orders/${orderId}/bill`, { headers: { Authorization: `Bearer ${otherTokens.accessToken}` } })
  expect(theirs.status()).toBe(404)

  // The manager: the same bill on the order, the profile, the reveal, an export.
  const panel = await context.newPage()
  if (narrow) await panel.setViewportSize({ width: 375, height: 812 })
  await panel.goto(`${PANEL}/login`)
  await panel.getByLabel('Work email').fill('manager@mandimangoes.test')
  await panel.getByLabel('Password').fill('manager123')
  await panel.getByRole('button', { name: 'Sign in' }).click()
  await expect(panel).not.toHaveURL(/\/login/)
  await panel.goto(`${PANEL}/orders/${orderId}`)
  const card = panel.getByRole('region', { name: 'Bill' })
  await expect(card).toContainText(number)
  await expect(panel.getByText(business)).toBeVisible()
  const [staffDownload] = await Promise.all([panel.waitForEvent('download'), card.getByRole('button', { name: 'Download bill (PDF)' }).click()])
  const staffText = await pdfText(staffDownload)
  expect(staffText).toContain(number)
  expect(staffText).toContain(GSTIN)

  await panel.getByRole('link', { name: 'Customer profile' }).click()
  await expect(panel.getByRole('heading', { level: 1 })).toBeVisible()
  const customerId = new URL(panel.url()).pathname.split('/').pop()!
  const contact = panel.getByRole('region', { name: 'Contact' })
  await expect(contact).toContainText(`******${phone.slice(-4)}`)
  await expect(contact).not.toContainText(phone)
  await expect(panel.getByRole('region', { name: /^Orders/ })).toContainText(/ORD-/)
  await noA11yViolations(panel)
  await noSideScroll(panel)
  if (info.project.name === 'phone') await panel.screenshot({ path: 'test-results-shop/trust-02-profile.png', fullPage: true })
  await contact.getByRole('button', { name: 'Show full number and email' }).click()
  await expect(contact).toContainText(phone.slice(-10))

  // Find the same customer by the last digits of the phone.
  await panel.goto(`${PANEL}/customers`)
  await panel.getByLabel(/Mobile number/).fill(phone)
  await panel.getByRole('button', { name: /^Find/ }).click()
  await expect(panel.getByRole('region', { name: 'Found' })).toContainText(phone.slice(-4))

  // An orders export for the last 30 days holds this order, with customer ids, not phone numbers.
  await panel.goto(`${PANEL}/orders`)
  const exportCard = panel.getByRole('region', { name: 'Download as CSV' })
  const [csv] = await Promise.all([panel.waitForEvent('download'), exportCard.getByRole('button', { name: 'Download Orders CSV' }).click()])
  const rows = await readFile((await csv.path())!, 'utf8')
  expect(rows.split('\n')[0]).toMatch(/^"order","placed_at",/)
  expect(rows).toContain(orderNumber)
  expect(rows).toContain(GSTIN)
  expect(rows).not.toContain(phone)
  await noA11yViolations(panel)
  await noSideScroll(panel)

  await panel.close()

  // The activity log has the bill download, the profile view and the reveal, under the manager's name.
  const audit = async (target: string) => {
    const r = await request.get(`${API}/admin/v1/audit?target=${encodeURIComponent(target)}`, { headers: { Authorization: `Bearer ${await managerToken(request)}` } })
    expect(r.ok(), await r.text()).toBeTruthy()
    return ((await r.json()).items as { action: string; email: string }[]).map((a) => `${a.email} ${a.action}`)
  }
  expect(await audit(orderId)).toContain('manager@mandimangoes.test DOWNLOAD bill')
  expect(await audit(customerId)).toEqual(expect.arrayContaining(['manager@mandimangoes.test VIEW customer profile', 'manager@mandimangoes.test REVEAL customer phone and email']))
  expect(await audit('orders')).toContain('manager@mandimangoes.test EXPORT orders')
})
