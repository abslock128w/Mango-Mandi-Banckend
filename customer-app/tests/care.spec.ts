import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'
import { managerToken } from './staff'

// Customer care (docs/care.md) against the real API with HELP_CENTRE and SUBSCRIPTIONS on (and a
// SUBSCRIPTION_SEASON_END ahead): a help request from an order page answered from the Help desk,
// and a season subscription started, paid for one box at a time, skipped, paused and cancelled.

const API = (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
  const care = ((await (await request.get(`${API}/v1/policy`)).json()) as { care?: Record<string, boolean> }).care ?? {}
  const on = Boolean(care.helpCentre && care.subscriptions && care.subscriptionsOpen)
  // CI starts the API with them on (.github/workflows/ci.yml); locally they may be off.
  if (process.env.CI) expect(on, 'the customer care switches are on').toBe(true)
  test.skip(!on, 'the API runs with the customer care switches off (HELP_CENTRE, SUBSCRIPTIONS, SUBSCRIPTION_SEASON_END)')
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

type Customer = Awaited<ReturnType<typeof apiCustomer>>

/** A paid order of one box for the customer, so they have an order and a saved address. */
async function paidOrder(request: APIRequestContext, c: Customer) {
  const cat = await (await request.get(`${API}/v1/catalogue?pincode=560034`, c.as)).json()
  const item = cat.items.find((i: { qty: number }) => i.qty > 0)
  expect(item, 'something in stock').toBeTruthy()
  expect((await request.post(`${API}/v1/cart/items`, { data: { sku: item.sku, stage: item.stage, qty: 1 }, ...c.as })).ok()).toBeTruthy()
  const slots = await (await request.get(`${API}/v1/delivery/slots?pincode=560034&delivery_date=${cat.deliveryDate}`, c.as)).json()
  const slotId = slots.slots.find((s: { available: boolean }) => s.available)?.id ?? null
  const q = await request.post(`${API}/v1/checkout/quote`, { data: { pincode: '560034', deliveryDate: cat.deliveryDate, slotId }, ...c.as })
  expect(q.ok(), await q.text()).toBeTruthy()
  const confirm = await request.post(`${API}/v1/checkout/confirm`, {
    data: { quoteId: (await q.json()).quoteId, address: '12, 4th Cross, Koramangala, Bengaluru' },
    headers: { ...c.as.headers, 'Idempotency-Key': `care-${c.phone}` },
  })
  expect(confirm.ok(), await confirm.text()).toBeTruthy()
  const { orderId, number } = await confirm.json()
  expect((await request.post(`${API}/v1/dev/pay`, { data: { orderId, outcome: 'captured' } })).ok()).toBeTruthy()
  return { orderId: orderId as string, number: number as string, catalogue: cat as { deliveryDate: string; items: { sku: string; name: string; stage: string; qty: number }[] } }
}

test('a customer asks about an order, the Help desk replies, and the thread shows it; damage goes to the claim form', async ({ page, request }, info) => {
  const c = await apiCustomer(request, phoneFor('9', info.project.name))
  const o = await paidOrder(request, c)
  await page.goto(`/orders/${o.orderId}`)
  await signInOnPage(page, c.phone)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(o.number)
  // The help centre link sits beside the WhatsApp link (shown because this build has the number).
  await expect(page.getByRole('link', { name: /Message us on WhatsApp/ })).toBeVisible()
  await page.getByRole('link', { name: 'Ask us about this order' }).click()

  await expect(page.getByRole('heading', { name: `Ask about order ${o.number}` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Report a problem with this order' })).toHaveAttribute('href', `/orders/${o.orderId}/claim`)
  const topics = await page.getByLabel('What is it about?').locator('option').allTextContents()
  expect(topics.join(' | ')).not.toMatch(/damage|missing|spoil/i)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Choose what it is about')).toBeVisible()
  await page.getByLabel('What is it about?').selectOption({ label: 'Delivery or the delivery day' })
  await page.getByLabel('Your message').fill('hi')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/Tell us a little more/)).toBeVisible()
  await page.getByLabel('Your message').fill('Can the box come after 6 pm on the day?')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page).toHaveURL(/\/help\/requests\/hlp_/)
  const ticketId = page.url().split('/').pop()!
  await expect(page.locator('.pill')).toHaveText('Open')
  await expect(page.getByText('Can the box come after 6 pm on the day?')).toBeVisible()
  await expect(page.getByRole('link', { name: `Order ${o.number}` })).toBeVisible()
  await noA11yViolations(page)
  expect(await noSidewaysScroll(page)).toBe(true)

  // The Help desk answers (as staff would from the panel).
  const staff = { headers: { Authorization: `Bearer ${await managerToken(request)}` } }
  const desk = await request.get(`${API}/admin/v1/help/requests/${ticketId}`, staff)
  expect(desk.status(), await desk.text()).toBe(200)
  const deskBody = await desk.json()
  expect(deskBody.customer.phoneMasked).toBe(`******${c.phone.slice(-4)}`)
  expect(JSON.stringify(deskBody)).not.toContain(c.phone)
  const reply = await request.post(`${API}/admin/v1/help/requests/${ticketId}/reply`, { data: { message: 'Yes, we can bring it between 6 and 8 pm.' }, ...staff })
  expect(reply.status(), await reply.text()).toBe(201)

  await page.reload()
  await expect(page.locator('.pill')).toHaveText('Waiting for you')
  await expect(page.getByText('Yes, we can bring it between 6 and 8 pm.')).toBeVisible()
  await expect(page.getByText(/^MandiMangoes ·/)).toBeVisible()
  await page.getByLabel('Write a reply').fill('Perfect, thank you!')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('Perfect, thank you!')).toBeVisible()
  await expect(page.locator('.pill')).toHaveText('Open')

  await page.getByRole('link', { name: '← Your questions' }).click()
  await expect(page.getByRole('heading', { name: 'Your questions' })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`HLP-\\d+ · Delivery or the delivery day · ${o.number}`) })).toBeVisible()
})

test("another customer can't open someone's help request", async ({ page, request }, info) => {
  const a = await apiCustomer(request, phoneFor('8', info.project.name))
  const made = await request.post(`${API}/v1/me/help/requests`, { data: { topic: 'OTHER', message: 'A question of my own' }, ...a.as })
  expect(made.status(), await made.text()).toBe(201)
  const b = phoneFor('7', info.project.name)
  await page.goto(`/help/requests/${(await made.json()).id}`)
  await signInOnPage(page, b)
  await expect(page.getByText('Help request not found')).toBeVisible()
  await expect(page.getByText('A question of my own')).toHaveCount(0)
})

/** ISO weekday (1 = Monday) of a YYYY-MM-DD date. */
const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

test('a season subscription: start it, pay for the box as an ordinary order, skip one, pause, resume and cancel', async ({ page, request }, info) => {
  const c = await apiCustomer(request, phoneFor('6', info.project.name))
  const o = await paidOrder(request, c)
  // A box in stock on the first delivery day, on that day's weekday, so the first box is set up straight away.
  const item = o.catalogue.items.find((i) => i.qty > 1) ?? o.catalogue.items.find((i) => i.qty > 0)!
  const first = o.catalogue.deliveryDate

  await page.goto('/account')
  await signInOnPage(page, c.phone)
  const card = page.getByRole('region', { name: 'Your subscriptions' })
  await expect(card).toContainText('nothing is taken from your account on its own')
  await card.getByRole('link', { name: 'Start a subscription' }).click()

  await expect(page.getByRole('heading', { name: 'Start a subscription' })).toBeVisible()
  await expect(page.getByText('there is no wallet')).toBeVisible()
  await page.getByRole('button', { name: 'Start subscription' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a box' })).toBeVisible()
  await page.getByLabel('Box', { exact: true }).selectOption(item.sku)
  await page.getByRole('radio', { name: { RAW: 'Raw', SEMI_RIPE: 'Semi-ripe', RIPE: 'Ripe' }[item.stage] }).check()
  await page.getByRole('radio', { name: 'Every week' }).check()
  await page.getByLabel('Delivery day').selectOption(String(isoWeekday(first)))
  await page.getByRole('radio', { name: /Koramangala/ }).check()
  const slot = page.getByRole('group', { name: 'Delivery time' })
  if (await slot.count()) await slot.getByRole('radio').first().check()
  const end = page.getByLabel('Last delivery no later than')
  const seasonEnd = await end.getAttribute('max')
  expect(seasonEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await end.fill(seasonEnd!)
  await noA11yViolations(page)
  expect(await noSidewaysScroll(page)).toBe(true)
  await page.getByRole('button', { name: 'Start subscription' }).click()

  await expect(page).toHaveURL(/\/account\/subscriptions\/sub_/)
  const subId = page.url().split('/').pop()!
  await expect(page.locator('.pill').first()).toHaveText('Running')
  const coming = page.getByRole('region', { name: 'Coming boxes' })
  // Set up, waiting for payment: nothing is ordered or held until Pay.
  const before = (await (await request.get(`${API}/v1/orders`, c.as)).json()) as unknown[]
  await coming.getByRole('button', { name: /Pay for this box/ }).click()
  await expect(page).toHaveURL(/\/orders\/ord_/)
  const orderId = page.url().split('/').pop()!
  await expect(page.getByText('Waiting for your payment to be confirmed.')).toBeVisible()
  expect(((await (await request.get(`${API}/v1/orders`, c.as)).json()) as unknown[]).length).toBe(before.length + 1)
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  await expect(page.getByText('Waiting for your payment to be confirmed.')).toHaveCount(0)

  await page.goto(`/account/subscriptions/${subId}`)
  await expect(coming.getByRole('link', { name: /Paid · order/ })).toHaveAttribute('href', `/orders/${orderId}`)
  // Skip the next one, ahead of time.
  const skips = coming.getByRole('button', { name: /^Skip/ })
  const skipCount = await skips.count()
  expect(skipCount).toBeGreaterThan(0)
  await skips.first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Skip this box' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Earlier boxes' })).toContainText('Skipped')

  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.locator('.pill').first()).toHaveText('Paused')
  await expect(page.getByText('Paused: no boxes are set up until you resume.')).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.locator('.pill').first()).toHaveText('Running')
  await noA11yViolations(page)

  // Staff see it with the phone masked.
  const staff = { headers: { Authorization: `Bearer ${await managerToken(request)}` } }
  const list = await (await request.get(`${API}/admin/v1/subscriptions`, staff)).json()
  const mine = list.items.find((s: { id: string }) => s.id === subId)
  expect(mine.customer.phoneMasked).toBe(`******${c.phone.slice(-4)}`)
  expect(mine.address).toBeNull()

  await page.getByRole('button', { name: 'Cancel subscription' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel subscription' }).click()
  await expect(page.locator('.pill').first()).toHaveText('Cancelled')
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0)
  // The paid box still comes.
  await expect(coming.getByRole('link', { name: /Paid · order/ })).toBeVisible()
})
