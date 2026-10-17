import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '../../tests/fixtures'

// A customer's whole journey against the real API: pincode, pick boxes, sign in
// by code, choose a slot, pay (test payment), then cancel for a full refund.

const API = process.env.VITE_API_URL ?? 'http://localhost:3000'

test.beforeAll(async ({ request }) => {
  const ok = await request.get(`${API}/ready`).then((r) => r.ok()).catch(() => false)
  test.skip(!ok, `mango-api is not reachable at ${API}`)
})

async function noA11yViolations(page: import('@playwright/test').Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}

test('order mangoes, pay and cancel for a refund', async ({ page }, info) => {
  const phone = `9${String(Date.now()).slice(-8)}${info.project.name === 'phone' ? 1 : 2}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mangoes picked for the day you want to eat them' })).toBeVisible()
  await noA11yViolations(page)
  await page.getByLabel('Your delivery pincode').fill('999999')
  await page.getByRole('button', { name: 'Show mangoes' }).click()
  await expect(page.getByRole('alert')).toContainText("We don't deliver to 999999 yet.")
  await page.getByLabel('Your delivery pincode').fill('560034')
  await page.getByRole('button', { name: 'Show mangoes' }).click()

  await expect(page.getByRole('heading', { name: /^Pick your mangoes for/ })).toBeVisible()
  const dates = page.getByRole('radiogroup', { name: 'When should it arrive?' }).getByRole('radio')
  await dates.nth(1).click()
  await expect(dates.nth(1)).toHaveAttribute('aria-checked', 'true')
  await noA11yViolations(page)

  // Stock differs by day, so take whatever is in stock: two of one box, one of another.
  const adds = page.getByRole('button', { name: /^Add / })
  const first = (await adds.first().getAttribute('aria-label'))!.slice(4)
  await adds.first().click()
  await page.getByRole('button', { name: `One more ${first}` }).click()
  const second = (await adds.first().getAttribute('aria-label'))!.slice(4)
  await adds.first().click()
  await page.getByRole('link', { name: /View cart · 3 boxes/ }).click()

  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible()
  await page.getByRole('button', { name: `One less ${second}` }).click()
  await expect(page.getByRole('group', { name: `${second} quantity` })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign in to check out' }).click()

  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const hint = await page.getByText(/Test mode: your code is \d{6}/).textContent()
  await page.getByLabel('6-digit code').fill(hint!.match(/\d{6}/)![0])
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Delivery details' })).toBeVisible()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByRole('alert')).toContainText('Enter the full delivery address')
  await page.getByLabel('Your name').fill('Asha Rao')
  await page.getByLabel('Delivery address').fill('Flat 4B, Lake View Apartments, 5th Main, near the park')
  const slots = page.getByRole('group', { name: 'Delivery time' })
  if (await slots.count()) await slots.getByRole('radio').first().check()
  await noA11yViolations(page)
  await page.getByRole('button', { name: 'Review order' }).click()

  await expect(page.getByRole('heading', { name: 'Review and pay' })).toBeVisible()
  await expect(page.getByText(`2 × ${first.split(', ')[0]}`)).toBeVisible()
  await page.getByRole('button', { name: /^Pay ₹/ }).click()

  await expect(page.getByRole('heading', { name: /^Order ORD-/ })).toBeVisible()
  await expect(page.getByText('Waiting for your payment to be confirmed.')).toBeVisible()
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'Progress' })).toContainText('Confirmed, done')
  await noA11yViolations(page)

  await page.getByRole('link', { name: 'Cart, 0 boxes' }).waitFor()
  await page.getByRole('button', { name: 'Cancel order' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText("You'll get a full refund")
  await dialog.getByRole('button', { name: 'Cancel order' }).click()
  await expect(page.getByText('This order was cancelled.')).toBeVisible()
  await expect(page.getByText(/refund of ₹[\d,]+ (has been sent|is on its way)/)).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Orders', exact: true }).click()
  await expect(page.getByRole('link', { name: /Order ORD-.*Cancelled/ })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})

/** A Monday a few weeks out, past the regular booking days. */
function bookableMonday() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 15)
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

test('book a box ahead, pay, then cancel for a refund', async ({ page, request }, info) => {
  // A manager opens the week for booking.
  const login = await request.post(`${API}/admin/v1/auth/login`, { data: { email: 'manager@mandimangoes.test', password: 'manager123' } })
  expect(login.ok()).toBeTruthy()
  const { accessToken } = await login.json()
  const week = bookableMonday()
  const open = await request.put(`${API}/admin/v1/preorder-capacity/${week}/ALP-3`, {
    data: { capacity: 200 },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  expect(open.ok(), await open.text()).toBeTruthy()

  const phone = `8${String(Date.now()).slice(-8)}${info.project.name === 'phone' ? 1 : 2}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Book a box ahead' }).click()
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Send code' }).click()
  const hint = await page.getByText(/Test mode: your code is \d{6}/).textContent()
  await page.getByLabel('6-digit code').fill(hint!.match(/\d{6}/)![0])
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Book ahead' })).toBeVisible()
  const weeks = page.getByRole('radiogroup', { name: 'Delivery week' }).getByRole('radio')
  const label = new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'UTC' }).format(new Date(`${week}T00:00:00Z`))
  await weeks.filter({ hasText: new RegExp(`^${label} `) }).first().click()
  await page.getByRole('radio', { name: /Alphonso 3kg Box/ }).check()
  await page.getByRole('radio', { name: /^Ripe/ }).check()
  await page.getByRole('button', { name: 'One box more' }).click()
  await page.getByLabel('Your name').fill('Asha Rao')
  await page.getByLabel('Delivery address').fill('Flat 4B, Lake View Apartments, 5th Main, near the park')
  await page.getByLabel('Pincode').fill('560034')
  await noA11yViolations(page)
  await page.getByRole('button', { name: /^Book and pay ₹/ }).click()

  await expect(page.getByRole('heading', { name: /^Booking PRE-/ })).toBeVisible()
  await expect(page.getByText('Pay to confirm your booking.')).toBeVisible()
  await expect(page.getByText('2 × Alphonso 3kg Box')).toBeVisible()
  await page.getByRole('button', { name: 'Payment succeeds' }).click()
  await expect(page.getByText(/You're booked for the week of/)).toBeVisible()
  await noA11yViolations(page)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Orders', exact: true }).click()
  await page.getByRole('link', { name: /Booking PRE-.*Booked/ }).click()
  await page.getByRole('button', { name: 'Cancel booking' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText("You'll get a full refund")
  await dialog.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByText('This booking was cancelled.')).toBeVisible()
  await expect(page.getByText(/refund of ₹[\d,]+ (has been sent|is on its way)/)).toBeVisible()
})
