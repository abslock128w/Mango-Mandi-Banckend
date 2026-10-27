import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'

// The shop in Hindi and Kannada (docs/languages.md) against the real API with SHOP_LANGUAGES on:
// a guest switches language on the sign-in page and sees the home page, a product and the cart in
// it; a customer's choice is saved to their account and follows them to a fresh browser; and while
// the switch is off the shop stays English with no control.

const API = (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  if (process.env.CI) expect(ok, `mango-api is not reachable at ${API}`).toBe(true)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
  const features = ((await (await request.get(`${API}/v1/policy`)).json()) as { features?: Record<string, boolean> }).features ?? {}
  // CI starts the API with it on (.github/workflows/ci.yml); locally it may be off.
  if (process.env.CI) expect(features.languages, 'SHOP_LANGUAGES is on').toBe(true)
  test.skip(features.languages !== true, 'the API runs with SHOP_LANGUAGES off')
})

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const phoneFor = (prefix: string, project: string) => `${prefix}${String(Date.now()).slice(-8)}${project === 'phone' ? 1 : 2}`

/** The words this spec looks for, in each language (the same entries as customer-app/src/i18n). */
const WORDS = {
  hi: {
    hero: 'आम, उस दिन के लिए चुने गए जब आप खाना चाहें',
    pincode: 'आपका डिलीवरी पिनकोड',
    show: 'आम दिखाएँ',
    pick: 'अपने आम चुनें',
    ripeness: 'पकावट चुनें',
    add: /^कार्ट में डालें/,
    added: /जोड़ा।|जोड़े।/,
    cart: 'आपकी कार्ट',
    signIn: 'साइन इन करें',
    mobile: 'मोबाइल नंबर',
    sendCode: 'कोड भेजें',
    testCode: /टेस्ट मोड: आपका कोड (\d{6}) है।/,
    code: '6 अंकों का कोड',
    language: 'भाषा',
    saved: 'सेव हो गया।',
  },
  kn: {
    hero: 'ನೀವು ತಿನ್ನಲು ಬಯಸುವ ದಿನಕ್ಕೆ ಆರಿಸಿದ ಮಾವು',
    pincode: 'ನಿಮ್ಮ ಡೆಲಿವರಿ ಪಿನ್‌ಕೋಡ್',
    show: 'ಮಾವು ತೋರಿಸಿ',
    pick: 'ನಿಮ್ಮ ಮಾವು ಆರಿಸಿ',
    ripeness: 'ಹಣ್ಣಾಗುವಿಕೆ ಆರಿಸಿ',
    add: /^ಕಾರ್ಟ್‌ಗೆ ಸೇರಿಸಿ/,
    added: /ಸೇರಿಸಲಾಗಿದೆ\./,
    cart: 'ನಿಮ್ಮ ಕಾರ್ಟ್',
    signIn: 'ಸೈನ್ ಇನ್ ಮಾಡಿ',
    mobile: 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ',
    sendCode: 'ಕೋಡ್ ಕಳುಹಿಸಿ',
    testCode: /ಪರೀಕ್ಷಾ ಮೋಡ್: ನಿಮ್ಮ ಕೋಡ್ (\d{6})\./,
    code: '6 ಅಂಕಿಯ ಕೋಡ್',
    language: 'ಭಾಷೆ',
    saved: 'ಉಳಿಸಲಾಗಿದೆ.',
  },
} as const
type Lang = keyof typeof WORDS

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

async function choose(page: Page, name: 'English' | 'हिन्दी' | 'ಕನ್ನಡ') {
  const button = page.getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/**
 * Home page in `lang` (the welcome and the pincode the first time, the list once a pincode is
 * kept), then one in-stock box from its product page into the cart.
 */
async function shopIn(page: Page, lang: Lang, { firstVisit }: { firstVisit: boolean }) {
  const w = WORDS[lang]
  await page.goto('/')
  if (firstVisit) {
    await expect(page.getByRole('heading', { name: w.hero })).toBeVisible()
    expect(await htmlLang(page)).toBe(lang)
    await noA11yViolations(page)
    await page.getByLabel(w.pincode).fill('560034')
    await page.getByRole('button', { name: w.show }).click()
  }
  await expect(page.getByRole('heading', { name: w.pick })).toBeVisible()
  expect(await htmlLang(page)).toBe(lang)
  // Prices keep Latin digits in every language.
  await expect(page.getByText(/₹[0-9][0-9,]*/).first()).toBeVisible()
  await noA11yViolations(page)
  expect(await noSidewaysScroll(page)).toBe(true)

  const links = page.getByRole('region', { name: w.pick }).getByRole('heading', { level: 3 }).getByRole('link')
  await expect(links.first()).toBeVisible()
  const total = await links.count()
  for (let i = 0; i < total; i++) {
    await page.goto('/')
    await links.nth(i).click()
    await expect(page.getByRole('group', { name: w.ripeness })).toBeVisible()
    if (!(await page.getByRole('radio', { checked: true }).count())) {
      const inStock = page.getByRole('radio', { disabled: false })
      if (!(await inStock.count())) continue
      await inStock.first().check()
    }
    const add = page.getByRole('button', { name: w.add })
    if (!(await add.count()) || (await add.isDisabled())) continue
    await noA11yViolations(page)
    await add.click()
    await expect(page.getByRole('status').filter({ hasText: w.added })).toBeVisible()
    await page.goto('/cart')
    await expect(page.getByRole('heading', { level: 1, name: w.cart })).toBeVisible()
    await expect(page.getByText(/₹[0-9][0-9,]*/).first()).toBeVisible()
    await noA11yViolations(page)
    expect(await noSidewaysScroll(page)).toBe(true)
    return
  }
  throw new Error('no box in stock')
}

async function signInIn(page: Page, lang: Lang | 'en', phone: string) {
  const w =
    lang === 'en'
      ? { mobile: 'Mobile number', sendCode: 'Send code', testCode: /Test mode: your code is (\d{6})/, code: '6-digit code', signIn: 'Sign in' }
      : WORDS[lang]
  await page.getByLabel(w.mobile).fill(phone)
  await page.getByRole('button', { name: w.sendCode }).click()
  const hint = await page.getByText(w.testCode).textContent()
  await page.getByLabel(w.code).fill(hint!.match(w.testCode)![1])
  await page.getByRole('button', { name: w.signIn, exact: true }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

async function savedLanguage(request: APIRequestContext, phone: string) {
  const asked = await request.post(`${API}/v1/auth/otp/request`, { data: { phone } })
  expect(asked.ok(), await asked.text()).toBeTruthy()
  const signIn = await request.post(`${API}/v1/auth/otp/verify`, { data: { phone, code: (await asked.json()).devCode } })
  expect(signIn.ok(), await signIn.text()).toBeTruthy()
  const token = ((await signIn.json()) as { accessToken: string }).accessToken
  return async () => {
    const r = await request.get(`${API}/v1/me/language`, { headers: { Authorization: `Bearer ${token}` } })
    expect(r.status(), await r.text()).toBe(200)
    return ((await r.json()) as { language: string | null }).language
  }
}

test('a guest switches to Hindi, then Kannada, and sees the home page, a product and the cart in it', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
  // Each language's name is in its own script and marked with its language.
  await expect(page.getByRole('button', { name: 'हिन्दी', exact: true })).toHaveAttribute('lang', 'hi')
  await expect(page.getByRole('button', { name: 'ಕನ್ನಡ', exact: true })).toHaveAttribute('lang', 'kn')
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await noA11yViolations(page)

  await choose(page, 'हिन्दी')
  await expect(page.getByRole('heading', { level: 1, name: WORDS.hi.signIn })).toBeVisible()
  expect(await htmlLang(page)).toBe('hi')
  await noA11yViolations(page)
  await shopIn(page, 'hi', { firstVisit: true })

  // The choice is kept on this device: a reload stays in Hindi.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: WORDS.hi.cart })).toBeVisible()

  await page.goto('/sign-in')
  await choose(page, 'ಕನ್ನಡ')
  await expect(page.getByRole('heading', { level: 1, name: WORDS.kn.signIn })).toBeVisible()
  expect(await htmlLang(page)).toBe('kn')
  await shopIn(page, 'kn', { firstVisit: false })

  // Back to English: the shop reads exactly as before.
  await page.goto('/sign-in')
  await choose(page, 'English')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Pick your mangoes' })).toBeVisible()
  await expect(page.getByRole('link', { name: /View cart/ })).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
})

test('a signed-in customer’s choice is saved to their account and follows them to another browser', async ({ page, browser, request }, info) => {
  const phone = phoneFor('8', info.project.name)

  // Chosen before signing in, kept through sign-in and saved to the new account.
  await page.goto('/sign-in')
  await choose(page, 'ಕನ್ನಡ')
  await signInIn(page, 'kn', phone)
  expect(await htmlLang(page)).toBe('kn')
  const saved = await savedLanguage(request, phone)
  await expect.poll(saved).toBe('kn')

  // A fresh browser with nothing stored: English until sign-in, then the account's Kannada.
  const other = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport })
  const fresh = await other.newPage()
  try {
    await fresh.goto('/sign-in')
    await expect(fresh.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await signInIn(fresh, 'en', phone)
    await expect.poll(() => htmlLang(fresh)).toBe('kn')
    await fresh.goto('/account')
    await expect(fresh.getByRole('heading', { level: 2, name: WORDS.kn.language })).toBeVisible()
    await expect(fresh.getByRole('button', { name: 'ಕನ್ನಡ', exact: true })).toHaveAttribute('aria-pressed', 'true')

    // Changed on the Account page: saved to the account at once.
    await choose(fresh, 'हिन्दी')
    await expect(fresh.getByRole('status').filter({ hasText: WORDS.hi.saved })).toBeVisible()
    await expect(fresh.getByRole('heading', { level: 2, name: WORDS.hi.language })).toBeVisible()
    expect(await htmlLang(fresh)).toBe('hi')
    await expect.poll(saved).toBe('hi')
    await noA11yViolations(fresh)
    expect(await noSidewaysScroll(fresh)).toBe(true)
  } finally {
    await other.close()
  }
})

test('with the switch off the shop is English only and offers no choice', async ({ page, request }) => {
  // The API's policy says off (as it does while SHOP_LANGUAGES is unset); a choice left on the
  // device from before is not used. The real policy is read once up front: a response fetched
  // inside the route can be thrown away when the page navigates mid-request.
  const real = await request.get(`${API}/v1/policy`)
  expect(real.ok()).toBe(true)
  const body = (await real.json()) as { features?: Record<string, unknown> }
  const off = JSON.stringify({ ...body, features: { ...(body.features ?? {}), languages: false } })
  await page.route(/\/v1\/policy(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: off }))
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mm.lang', 'hi')
    } catch {
      // Storage blocked: nothing to set.
    }
  })
  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'हिन्दी' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ಕನ್ನಡ' })).toHaveCount(0)
  expect(await htmlLang(page)).toBe('en')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mangoes picked for the day you want to eat them' })).toBeVisible()
  expect(await htmlLang(page)).toBe('en')
})
