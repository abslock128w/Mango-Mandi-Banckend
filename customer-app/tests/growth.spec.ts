import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page, Request } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'
import { reviewOrder } from './checkout'
import { managerToken } from './staff'

// Growth (docs/growth.md) against the real API with REFERRALS and FUNNEL_ANALYTICS on: a customer's
// code and link on the Account page, a friend arriving by the invite link and adding the code at
// checkout, and the anonymous funnel steps (no account, phone or cookie in them).

const API = (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
  const features = ((await (await request.get(`${API}/v1/policy`)).json()) as { features?: Record<string, boolean> }).features ?? {}
  const on = Boolean(features.referrals && features.funnel)
  if (process.env.CI) expect(on, 'the growth switches are on').toBe(true)
  test.skip(!on, 'the API runs with REFERRALS or FUNNEL_ANALYTICS off')
})

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}

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
  return { headers: { Authorization: `Bearer ${token}` } }
}

/** From the home page, the first box in stock goes into the cart from its own page. */
async function addOneBox(page: Page) {
  const links = page.getByRole('region', { name: 'Pick your mangoes' }).getByRole('heading', { level: 3 }).getByRole('link')
  await expect(links.first()).toBeVisible()
  const total = await links.count()
  for (let i = 0; i < total; i++) {
    await page.goto('/')
    await links.nth(i).click()
    await expect(page.getByRole('group', { name: 'Choose ripeness' })).toBeVisible()
    if (!(await page.getByRole('radio', { checked: true }).count())) {
      const inStock = page.getByRole('radio', { disabled: false })
      if (!(await inStock.count())) continue
      await inStock.first().check()
    }
    const add = page.getByRole('button', { name: /^Add to cart/ })
    if (!(await add.count()) || (await add.isDisabled())) continue
    await add.click()
    await expect(page.getByRole('status').filter({ hasText: /^Added / })).toBeVisible()
    return
  }
  throw new Error('no box in stock')
}

test('a customer shares their code; their own code is refused', async ({ page }, info) => {
  await page.goto('/sign-in?next=/account')
  await signInOnPage(page, phoneFor('8', info.project.name))
  const card = page.getByRole('region', { name: 'Refer a friend' })
  await expect(card.getByTestId('referral-code')).toHaveText(/^[A-Z0-9]{8}$/)
  const code = (await card.getByTestId('referral-code').textContent())!
  await expect(card.getByLabel('Your invite link')).toHaveValue(new RegExp(`/invite/${code}$`))
  await expect(card).toContainText('₹499 or more')
  await noA11yViolations(page)

  // A new customer may enter a friend's code, but not their own: the API says why.
  await card.getByLabel('Got a code from a friend?').fill(code)
  await card.getByRole('button', { name: 'Use code' }).click()
  await expect(card.getByRole('alert')).toContainText('That is your own referral code')
  await card.getByLabel('Got a code from a friend?').fill('NOSUCH99')
  await card.getByRole('button', { name: 'Use code' }).click()
  await expect(card.getByRole('alert')).toContainText('That referral code is not valid')
})

test('a friend arrives by the invite link, adds the code at checkout and pays; the funnel counts each step anonymously', async ({ page, request }, info) => {
  // The referrer, through the API.
  const referrer = await apiCustomer(request, phoneFor('7', info.project.name))
  const mine = await request.get(`${API}/v1/me/referral`, referrer)
  expect(mine.ok(), await mine.text()).toBeTruthy()
  const code = ((await mine.json()) as { code: string }).code

  const events: Request[] = []
  let confirm: Request | null = null
  page.on('request', (r) => {
    if (r.url() === `${API}/v1/events`) events.push(r)
    if (r.url() === `${API}/v1/checkout/confirm`) confirm = r
  })

  await page.goto(`/invite/${code.toLowerCase()}`)
  await expect(page.getByRole('heading', { name: 'A friend invited you' })).toBeVisible()
  await expect(page.getByText(`Your friend's code ${code} is saved`)).toBeVisible()
  await noA11yViolations(page)
  await page.getByRole('link', { name: 'Pick your mangoes' }).click()
  await page.getByLabel('Your delivery pincode').fill('560034')
  await page.getByRole('button', { name: 'Show mangoes' }).click()
  await addOneBox(page)
  await page.goto('/cart')
  await page.getByRole('button', { name: 'Sign in to check out' }).click()
  await signInOnPage(page, phoneFor('6', info.project.name))
  await expect(page.getByRole('heading', { name: 'Delivery details' })).toBeVisible()

  // The code from the link is waiting at checkout, apart from the promo code.
  const entry = page.getByLabel("Friend's referral code (optional)")
  await expect(entry).toHaveValue(code)
  await page.getByRole('button', { name: 'Use code' }).click()
  await expect(page.getByRole('status').filter({ hasText: "Friend's code added" })).toBeVisible()
  await noA11yViolations(page)

  await page.getByLabel('Your name').fill('Nisha Rao')
  await page.getByLabel('Delivery address').fill('House 12, 2nd Cross, Indiranagar, near the temple')
  const slots = page.getByRole('group', { name: 'Delivery time' })
  if (await slots.count()) await slots.getByRole('radio', { disabled: false }).first().check()
  await reviewOrder(page)
  await page.getByRole('button', { name: /^Pay ₹/ }).click()
  await expect(page.getByRole('heading', { name: /^Order ORD-/ })).toBeVisible()
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()

  // The funnel steps: only a random browser id and the step, no cookie or token, nothing else.
  const browserId = await page.evaluate(() => localStorage.getItem('mm.fid'))
  expect(browserId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  const steps = new Set<string>()
  for (const r of events) {
    const body = r.postDataJSON() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['browserId', 'step'])
    expect(body.browserId).toBe(browserId)
    const headers = await r.allHeaders()
    expect(headers.authorization).toBeUndefined()
    expect(headers.cookie).toBeUndefined()
    steps.add(String(body.step))
  }
  expect([...steps].sort()).toEqual(['add_to_cart', 'checkout_start', 'product_view', 'visit'])
  // Checkout passes the same id, so the API counts "paid" for this browser.
  expect((confirm as Request | null)?.postDataJSON()).toMatchObject({ funnelId: browserId })

  // The friend's Account page: the code is used, and no second one can be entered.
  await page.goto('/account')
  const card = page.getByRole('region', { name: 'Refer a friend' })
  // The reward comes at payment, on the next maintenance tick, so either text is right here.
  await expect(card.getByTestId('referral-entered')).toContainText(/as soon as your first order is paid|your thank-you code is below/)
  await expect(card.getByRole('button', { name: 'Use code' })).toHaveCount(0)

  // The manager sees the referral (waiting, or already rewarded), and today's funnel has a paid browser.
  const auth = { headers: { Authorization: `Bearer ${await managerToken(request)}` } }
  const list = (await (await request.get(`${API}/admin/v1/referrals`, auth)).json()) as { items: { code: string; friend: { name: string; phone: string } }[] }
  const row = list.items.find((x) => x.code === code)
  expect(row?.friend.name).toBe('Nisha Rao')
  expect(row?.friend.phone).toContain('••••')
  const funnel = (await (await request.get(`${API}/admin/v1/analytics/funnel`, auth)).json()) as { totals: { counts: Record<string, number> } }
  expect(funnel.totals.counts.paid).toBeGreaterThanOrEqual(1)
  expect(funnel.totals.counts.checkout_start).toBeGreaterThanOrEqual(1)
})
