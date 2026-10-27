import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'

// Gift orders to many recipients end to end against the real API (MULTI_GIFT,
// docs/gifting.md): Send to many from the gift part of checkout, the CSV
// template, a CSV with a row to fix, the API's own check of every recipient,
// one review and one (test) payment, then one recipient cancelled before
// packing; a manager sees the gift order and its deliveries in the panel.

const API = process.env.VITE_API_URL ?? 'http://localhost:3000'
const PANEL = process.env.PANEL_URL ?? `http://localhost:${process.env.PANEL_PORT ?? 5173}`
const GSTIN = '29ABCDE1234F1ZW'

type Item = { sku: string; name: string; stage: string; qty: number; price: number }

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
  const policy = await (await request.get(`${API}/v1/policy`)).json()
  test.skip(!policy.features?.multiGift, 'gift orders to many are switched off on this API (MULTI_GIFT)')
})

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}

async function noSideScroll(page: Page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(wide, 'no horizontal scroll').toBeLessThanOrEqual(0)
}

const STAGE_WORD: Record<string, string> = { RAW: 'raw', SEMI_RIPE: 'semi-ripe', RIPE: 'ripe' }
const cell = (s: string) => `"${s.replace(/"/g, '""')}"`

test('a business sends boxes to many from one CSV, pays once, cancels one recipient; a manager sees the gift order', async ({ page, request, context }, info) => {
  test.setTimeout(240_000)
  const narrow = info.project.name === 'phone'
  if (narrow) await page.setViewportSize({ width: 375, height: 812 })
  const phone = `8${String(Date.now()).slice(-8)}${narrow ? 1 : 2}`
  const business = `Kaveri Traders ${info.project.name}`

  const cat = await (await request.get(`${API}/v1/catalogue?pincode=560034`)).json()
  const item: Item | undefined = cat.items.find((i: Item) => i.qty >= 3)
  expect(item, 'a box with stock for three recipients').toBeTruthy()

  // Signed in, a box in the cart, at checkout: the gift part offers Send to many.
  await page.goto('/')
  await page.evaluate(
    ([item, date]) => {
      localStorage.setItem('mm.where', JSON.stringify({ pincode: '560034', date }))
      localStorage.setItem('mm.cart', JSON.stringify([{ sku: item.sku, stage: item.stage, qty: 1, name: item.name, price: item.price }]))
    },
    [item!, cat.deliveryDate] as const,
  )
  await page.goto(`/sign-in?next=${encodeURIComponent('/checkout')}`)
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const hint = await page.getByText(/Test mode: your code is \d{6}/).textContent()
  await page.getByLabel('6-digit code').fill(hint!.match(/\d{6}/)![0])
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Delivery details' })).toBeVisible()
  await page.getByLabel('This is a gift for someone else').check()
  await page.getByRole('link', { name: 'Send to many' }).click()
  await expect(page.getByRole('heading', { name: 'Send to many', level: 1 })).toBeVisible()

  // The template: the columns, an example row, and no cell a spreadsheet would run.
  const [template] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the template' }).click()])
  expect(template.suggestedFilename()).toBe('mandimangoes-gift-recipients.csv')
  const csv = (await readFile((await template.path())!)).toString()
  expect(csv.split(/\r?\n/)[0]).toBe('"name","phone","address","pincode","box","ripeness","boxes","note"')
  for (const c of csv.split(/\r?\n/).slice(1).join(',').split('","')) expect(c.replace(/^"/, '')).not.toMatch(/^[=+\-@]/)

  // A list with a row to fix: the shop says which row and what, before anything is sent.
  const head = '"name","phone","address","pincode","box","ripeness","boxes","note"'
  const row = (name: string, ph: string, pin: string, qty: number, note: string) =>
    [name, ph, `${name.split(' ')[0]}'s house, 4th Cross, Jayanagar, Bengaluru`, pin, item!.sku, STAGE_WORD[item!.stage], String(qty), note].map(cell).join(',')
  await page.getByLabel('Upload a recipients CSV').setInputFiles({
    name: 'bad.csv', mimeType: 'text/csv',
    buffer: Buffer.from([head, row('Ravi Kumar', '9876543210', '560034', 1, 'Happy Diwali'), row('No Phone', '12345', '560034', 1, '')].join('\n')),
  })
  await expect(page.getByRole('alert').filter({ hasText: 'Fix these rows' })).toContainText('Row 2: Enter a 10-digit Indian mobile number')

  // The fixed list. Its third recipient's pincode looks right but is not one we deliver to: only the API knows.
  await page.getByLabel('Upload a recipients CSV').setInputFiles({
    name: 'team.csv', mimeType: 'text/csv',
    buffer: Buffer.from(
      [head, row('Ravi Kumar', '9876543210', '560034', 1, 'Happy Diwali'), row('Meera Iyer', '9876543211', '560034', 1, '=thanks'), row('Far Away', '9876543212', '110001', 1, '')].join('\r\n'),
    ),
  })
  await expect(page.getByText('3 recipients loaded from team.csv.')).toBeVisible()
  await expect(page.locator('#r1-note')).toHaveValue('=thanks')
  await page.getByLabel('Your name (the sender)').fill('Kaveri Traders')
  await page.getByLabel('Buying for a business? Add its name and GSTIN to the one bill for this order').check()
  await page.getByLabel('Business name').fill(business)
  await page.getByLabel('GSTIN', { exact: true }).fill(GSTIN)
  const slots = page.getByRole('group', { name: 'Delivery time' })
  if (await slots.count()) await slots.locator('input:not([disabled])').first().check()
  await page.getByRole('button', { name: 'Review 3 recipients' }).click()
  await expect(page.locator('#r2-pincode')).toBeFocused()
  await expect(page.getByText('We do not deliver to 110001 yet')).toBeVisible()
  await noA11yViolations(page)
  await noSideScroll(page)
  await page.getByRole('button', { name: 'Remove recipient 3' }).click()
  await page.getByRole('button', { name: 'Review 2 recipients' }).click()

  // One review for everyone, one payment.
  await expect(page.getByRole('heading', { name: 'Review and pay' })).toBeVisible({ timeout: 30_000 })
  const list = page.getByRole('list').filter({ hasText: 'Ravi Kumar' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list).toContainText('Meera Iyer')
  await expect(list).toContainText('Note: =thanks')
  await expect(page.getByText(`GSTIN ${GSTIN}`)).toBeVisible()
  await noA11yViolations(page)
  await noSideScroll(page)
  if (narrow) await page.screenshot({ path: '../test-results-shop/gifting-01-review.png', fullPage: true })
  await page.getByRole('button', { name: /^Pay ₹/ }).click()

  // No gateway keys on the test API: the gift order's page offers the test payment.
  const heading = page.getByRole('heading', { name: /^Gift order GFT-\d+/ })
  await expect(heading).toBeVisible({ timeout: 30_000 })
  const number = (await heading.textContent())!.replace(/^Gift order /, '').trim()
  await expect(page.getByText('Waiting for payment', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  await expect(page.getByText('Paid', { exact: true })).toBeVisible({ timeout: 30_000 })
  const recipients = page.getByRole('region', { name: 'Recipients' })
  await expect(recipients.getByRole('listitem')).toHaveCount(2)
  await expect(recipients).toContainText(/Delivery ORD-\d+: Confirmed/)
  const bill = page.getByRole('region', { name: 'Your bill' })
  await expect(bill).toContainText(/(Bill of Supply|Receipt) MM\/\d{2}-\d{2}\/\d{6}/)
  await expect(bill).toContainText('one bill for every recipient')
  await expect(bill).toContainText(`Billed to ${business}, GSTIN ${GSTIN}.`)
  await noA11yViolations(page)
  await noSideScroll(page)
  if (narrow) await page.screenshot({ path: '../test-results-shop/gifting-02-paid.png', fullPage: true })

  // One recipient cancelled before packing: their part is refunded, the other still gets theirs.
  await recipients.getByRole('button', { name: 'Cancel for Meera Iyer' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel the delivery for Meera Iyer?' })
  await expect(dialog).toContainText('The other recipients still get theirs.')
  await dialog.getByRole('button', { name: 'Cancel this recipient' }).click()
  await expect(dialog).toBeHidden()
  const meera = recipients.getByRole('listitem').filter({ hasText: 'Meera Iyer' })
  await expect(meera).toContainText(/Cancelled, (refund of ₹[\d,.]+ on its way|₹[\d,.]+ refunded)/)
  await expect(meera.getByRole('button')).toHaveCount(0)
  await expect(recipients.getByRole('listitem').filter({ hasText: 'Ravi Kumar' })).toContainText('Confirmed')

  // The manager: the gift order with both deliveries on the panel's Orders page.
  const panel = await context.newPage()
  if (narrow) await panel.setViewportSize({ width: 375, height: 812 })
  await panel.goto(`${PANEL}/login`)
  await panel.getByLabel('Work email').fill('manager@mandimangoes.test')
  await panel.getByLabel('Password').fill('manager123')
  await panel.getByRole('button', { name: 'Sign in' }).click()
  await expect(panel).not.toHaveURL(/\/login/)
  await panel.goto(`${PANEL}/orders?view=gifts&q=${number}`)
  const gift = panel.getByRole('region', { name: number, exact: true })
  await expect(gift).toContainText('Paid')
  await expect(gift).toContainText(`One bill to ${business}, GSTIN ${GSTIN}`)
  await expect(gift.getByRole('row').filter({ hasText: 'Ravi Kumar' })).toContainText('Confirmed')
  await expect(gift.getByRole('row').filter({ hasText: 'Meera Iyer' })).toContainText('Cancelled')
  await gift.getByRole('row').filter({ hasText: 'Ravi Kumar' }).getByRole('link').click()
  await expect(panel.getByRole('status').filter({ hasText: `in gift order ${number}` })).toBeVisible()
  await panel.close()
})
