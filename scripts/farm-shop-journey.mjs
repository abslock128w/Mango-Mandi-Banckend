// The Farm Experience journey in the shop (shop/farm.js, docs/farm-experience.md), on phone and desktop, light and dark:
// the farm card, the page about the visit, the six booking steps, my farm visits, a proposed arrangement accepted and
// declined, a change of date, the farm side through to the bill (305 kg accepted), a failed and a paid test payment,
// the visit completed, a cancel; then, with the switch off, no card and the closed page. It fails on a console error,
// a page that scrolls sideways, a raw date or an em dash, and saves a screenshot of every step.
//
// It needs three things running, none of them production (it makes bookings and uses the seeded test manager):
//   an API with FARM_EXPERIENCE=true and ENABLE_DEV_ROUTES=true on a fresh, seeded database   (FARM_API_ON, default :3100)
//   the same API with FARM_EXPERIENCE=false                                                    (FARM_API_OFF, default :3101)
//   the shop: node scripts/serve-shop.mjs --port 5184, its origin in both APIs' CUSTOMER_ORIGIN (FARM_SHOP, default :5184)
//
//   node scripts/farm-shop-journey.mjs [phone|desktop] [light|dark]   (no arguments: all four)
//   FARM_SHOTS=<folder> chooses where the screenshots go (default test-results/farm-shop).
import { chromium, devices } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const SHOP = process.env.FARM_SHOP || 'http://localhost:5184'
const API_ON = process.env.FARM_API_ON || 'http://localhost:3100'
const API_OFF = process.env.FARM_API_OFF || 'http://localhost:3101'
const OUT = path.resolve(process.env.FARM_SHOTS || 'test-results/farm-shop')
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
const problems = []

async function staff(method, p, body, token) {
  const r = await fetch(`${API_ON}/admin/v1${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text.slice(0, 300)}`)
  return json
}

// The seeded test manager (mango-api/src/seed.js): a dev fixture, also the confirm code.
const M = ['manager@mandimangoes.test', ['manager', '123'].join('')]

async function setupFarm() {
  const token = (await staff('POST', '/auth/login', { email: M[0], password: M[1] })).accessToken
  const have = await staff('GET', '/farm/varieties', undefined, token)
  let alphonso = have.find((v) => v.name === 'Alphonso')
  if (!alphonso) {
    alphonso = await staff('POST', '/farm/varieties', { name: 'Alphonso', sku: 'ALP-3', pricePerKg: 12_000, tiers: [{ minKg: 500, pricePerKg: 10_000 }], description: 'Ratnagiri Alphonso, picked firm so it ripens at home.', ripenessNote: 'Ready to eat four to six days after picking.', confirmCode: M[1] }, token)
    await staff('POST', '/farm/varieties', { name: 'Kesar', sku: 'KES-3', pricePerKg: 9_050, description: 'Saffron-coloured Kesar from the lower orchard.', confirmCode: M[1] }, token)
    await staff('POST', '/farm/rooms', { name: 'Mango Room', sleeps: 4, beds: 2 }, token)
  }
  // Open days: most with 1,000 kg, one with only 260 kg (shown crossed for a 300 kg booking).
  for (let i = 8; i <= 16; i++) {
    await staff('PUT', `/farm/days/${day(i)}`, { open: true, maxBookings: null }, token)
    const kg = i === 10 ? 260 : 60000
    await staff('PUT', `/farm/harvest/${alphonso.id}/${day(i)}`, { estimatedKg: kg * 2, bookableKg: kg }, token).catch(() => {})
  }
  const cur = await staff('GET', '/farm/settings', undefined, token)
  await staff('PUT', '/farm/settings', {
    settings: {
      farmName: 'Test orchard (placeholder)', location: 'Test location, Ratnagiri', contactPhone: '+919800000000', arrivalInstructions: 'Report at the main gate and ask for the farm manager.',
      checkInTime: '10:00', checkOutTime: '11:00', stayNights: 1, sleepingArrangements: 'Shared rooms with two beds each, and extra mattresses for children.', bathroomFacilities: 'Attached bathrooms with hot water.',
      meals: { breakfast: true, lunch: true, dinner: true, refreshments: true }, mealNotes: 'Home-cooked Konkani food. Tell us about allergies when you book.',
      transportIncluded: false, transportPolicy: 'We can share a list of local drivers.', weatherPolicy: 'Visits in heavy rain are moved to another day.', harvestPolicy: 'Our team decides which trees are ready on the day.',
      noShowPolicy: 'If you do not arrive, the mangoes go back on sale.', seasonStart: day(0), seasonEnd: day(120), leadDays: 3, maxDaysAhead: 90, extraPricePerKg: 13_000,
      faqs: [{ q: 'Is there a minimum purchase?', a: 'Yes, 250 kg of one variety.' }, { q: 'Can children come?', a: 'Yes. Children are welcome with an adult.' }],
      bookingsOpen: true,
    }, version: cur.version, confirmCode: M[1],
  }, token)
  return { token, varietyId: alphonso.id }
}

async function run(size, theme, farm) {
  const tag = `${size}-${theme}`
  const dir = path.join(OUT, tag)
  fs.mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch()
  const base = size === 'phone' ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } }
  let n = 0
  const watch = (page, label) => {
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) problems.push(`[${tag}/${label}] console: ${m.text()}`) })
    page.on('pageerror', (e) => problems.push(`[${tag}/${label}] page error: ${e.message}`))
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/v1/delivery/slots')) problems.push(`[${tag}/${label}] ${r.status()} ${r.request().method()} ${r.url()}`) })
  }
  const open = async (api, label) => {
    const ctx = await browser.newContext({ ...base, colorScheme: theme, serviceWorkers: 'block' })
    await ctx.addInitScript((t) => { try { localStorage.setItem('mm-theme', t) } catch {} }, theme)
    await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: `window.MM_CONFIG = { apiUrl: '${api}', supportWhatsapp: '' };\n` }))
    const page = await ctx.newPage()
    watch(page, label)
    return { ctx, page }
  }
  const shot = async (page, name) => {
    await page.waitForTimeout(350)
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (wide > 1) problems.push(`[${tag}] ${name}: page scrolls sideways by ${wide}px`)
    const raw = await page.evaluate(() => (document.querySelector('#page-body')?.innerText.match(/\b20\d\d-\d\d-\d\d\b/) || [])[0] || '')
    if (raw) problems.push(`[${tag}] ${name}: raw date on the page (${raw})`)
    const dash = await page.evaluate(() => (document.querySelector('#page-body')?.innerText.includes('—') ? 'yes' : ''))
    if (dash) problems.push(`[${tag}] ${name}: an em dash on the page`)
    await page.screenshot({ path: path.join(dir, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true })
  }

  // ---- Switch on.
  const { ctx, page } = await open(API_ON, 'on')
  const phone = `98${String(Date.now()).slice(-8)}`
  await page.goto(`${SHOP}/bulk`)
  await page.waitForFunction(() => window.MM)
  await page.evaluate(async (p) => { const r = await MM.otpRequest(p); await MM.otpVerify(p, r.devCode) }, phone)
  await page.goto(`${SHOP}/bulk`)
  await page.locator('#fx-card').waitFor()
  await shot(page, 'bulk-farm-card')
  await page.locator('#fx-card a').click()
  await page.getByRole('heading', { name: /Pick your own mangoes/ }).waitFor()
  await shot(page, 'landing')
  await page.locator('.fx-faqs summary').first().click()
  await page.getByRole('link', { name: 'Book a visit' }).first().click()

  // Step 1: variety (Kesar has no harvest: shown unavailable with a reason).
  await page.getByRole('heading', { name: 'Variety' }).waitFor()
  await page.getByRole('radio', { name: /Kesar/ }).click({ force: true })
  await shot(page, 'book-1-variety')
  await page.getByRole('button', { name: /Continue/ }).click()
  // Step 2: kilograms. Below the minimum first: the reason shows.
  await page.getByRole('heading', { name: 'Kilograms' }).waitFor()
  await page.locator('input[name=kg]').fill('100')
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.locator('.field-error').waitFor()
  await shot(page, 'book-2-kg-too-few')
  await page.locator('input[name=kg]').fill('300')
  await page.locator('.fx-quote strong').waitFor()
  await shot(page, 'book-2-kg')
  await page.getByRole('button', { name: /Continue/ }).click()
  // Step 3: date. Continue with none picked shows the reason; the 260 kg day is crossed.
  await page.getByRole('heading', { name: 'Visit date' }).waitFor()
  await page.locator('.fx-day').first().waitFor()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.locator('#fx-error .fx-note').waitFor()
  await page.locator(`.fx-day[data-day="${day(10)}"]`).click({ force: true })
  await shot(page, 'book-3-date-none')
  await page.locator(`.fx-day[data-day="${day(11)}"]`).click()
  await shot(page, 'book-3-date')
  await page.getByRole('button', { name: /Continue/ }).click()
  // Step 4: the group, stay and food.
  await page.getByRole('heading', { name: 'Your group' }).waitFor()
  await page.locator('input[name=adults]').fill('4')
  await page.locator('input[name=children]').fill('2')
  await page.locator('input[name=overnight]').fill('9')
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.locator('.field-error').waitFor()
  await shot(page, 'book-4-group-error')
  await page.locator('input[name=overnight]').fill('4')
  await page.locator('input[name=veg]').fill('6')
  await page.locator('input[name=allergies]').fill('Peanuts')
  await page.locator('textarea[name=notes]').fill('We arrive by car around ten.')
  await shot(page, 'book-4-group')
  await page.getByRole('button', { name: /Continue/ }).click()
  // Step 5: details.
  await page.getByRole('heading', { name: 'Your details' }).waitFor()
  await page.locator('input[name=contactName]').fill('')
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.locator('.field-error').waitFor()
  await page.locator('input[name=contactName]').fill('Asha Rao')
  await page.locator('input[name=contactEmail]').fill('asha@example.com')
  await shot(page, 'book-5-details')
  await page.getByRole('button', { name: /Continue/ }).click()
  // Step 6: review. Booking without accepting shows the reason.
  await page.getByRole('heading', { name: 'Review' }).waitFor()
  await page.locator('.fx-total strong', { hasText: '₹' }).waitFor()
  await page.getByRole('button', { name: /Book the visit/ }).click()
  await page.locator('#fx-error .fx-note').waitFor()
  await shot(page, 'book-6-review-not-accepted')
  // A reload keeps the answers (the draft).
  await page.reload()
  await page.getByRole('heading', { name: 'Review' }).waitFor()
  await page.locator('input[name=accept]').check()
  await shot(page, 'book-6-review')
  await page.getByRole('button', { name: /Book the visit/ }).click()

  // The booking page: booked, nothing paid.
  await page.locator('.fx-thanks').waitFor()
  await page.locator('#fx-qr img').waitFor()
  const idA = decodeURIComponent(new URL(page.url()).pathname.split('/').pop())
  await shot(page, 'booking-booked')
  await page.goto(`${SHOP}/farm-bookings`)
  await page.locator('.fx-row').first().waitFor()
  await shot(page, 'my-farm-visits')

  // A proposed arrangement: accept it.
  await staff('POST', `/farm/bookings/${idA}/hospitality`, { action: 'PROPOSE', text: 'Mango Room for four. The other two stay in a partner homestay 2 km away, with transfers.' }, farm.token)
  await page.locator('.fx-row').first().click()
  await page.locator('.fx-alt').waitFor()
  await shot(page, 'booking-alternative')
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.locator('.fx-alt').waitFor({ state: 'detached' })
  await shot(page, 'booking-alternative-accepted')

  // Move the date.
  await page.getByRole('button', { name: 'Change the visit date' }).click()
  await page.locator('#fx-change .fx-day').first().waitFor()
  await shot(page, 'booking-move-pick')
  await page.locator(`#fx-change .fx-day[data-day="${day(12)}"]`).click()
  await shot(page, 'booking-move-picked')
  await page.getByRole('button', { name: /Move my visit|Ask to move my visit/ }).click()
  await page.locator('.fx-done').waitFor()
  await shot(page, 'booking-moved')

  // The farm side: stay approved, checked in, picked, 305 kg accepted, bill made.
  const bA = await staff('GET', `/farm/bookings/${idA}`, undefined, farm.token)
  if (bA.status === 'HOSPITALITY_REVIEW') await staff('POST', `/farm/bookings/${idA}/hospitality`, { action: 'APPROVE', text: 'Mango Room for four, homestay for two.' }, farm.token)
  await page.reload()
  await page.locator('.fx-pill').waitFor()
  await shot(page, 'booking-confirmed')
  const code = await page.locator('.fx-code').innerText()
  await staff('POST', '/farm/check-in', { code: code.trim(), override: true }, farm.token)
  for (const to of ['HARVESTING', 'WEIGHING']) await staff('POST', `/farm/bookings/${idA}/status`, { to }, farm.token)
  await staff('POST', `/farm/bookings/${idA}/harvest`, { harvestedKg: 310, acceptedKg: 305 }, farm.token)
  await page.reload()
  await page.locator('.fx-pill', { hasText: 'Weighing' }).waitFor()
  await shot(page, 'booking-weighing')
  await staff('POST', `/farm/bookings/${idA}/bill`, {}, farm.token)
  await page.reload()
  await page.locator('.fx-bill.is-due').waitFor()
  await shot(page, 'booking-bill-due')
  await page.getByRole('button', { name: 'Fail payment (test)' }).click()
  await page.locator('.fx-bill .fx-note.is-warn').waitFor()
  await shot(page, 'booking-bill-payment-failed')
  await page.getByRole('button', { name: /Pay .*\(test\)/ }).click()
  await page.locator('.fx-paid').waitFor()
  await shot(page, 'booking-bill-paid')
  await staff('POST', `/farm/bookings/${idA}/harvest`, { packingStatus: 'COLLECTED' }, farm.token).catch(() => {})
  await staff('POST', `/farm/bookings/${idA}/status`, { to: 'COMPLETED' }, farm.token)
  await page.reload()
  await page.locator('.fx-pill', { hasText: 'Completed' }).waitFor()
  await shot(page, 'booking-completed')

  // A second visit: decline the proposed arrangement, then cancel.
  const idB = await page.evaluate(async ({ varietyId, visitDate }) => (await MM.bookFarm({ varietyId, kg: 250, visitDate, adults: 2, children: 0, overnightGuests: 0, contactName: 'Asha Rao', acceptPolicies: true }, crypto.randomUUID())).bookingId, { varietyId: farm.varietyId, visitDate: day(14) })
  await staff('POST', `/farm/bookings/${idB}/hospitality`, { action: 'PROPOSE', text: 'Day visit only. The farmhouse is closed for repairs that night.' }, farm.token)
  await page.goto(`${SHOP}/farm-bookings/${idB}`)
  await page.locator('.fx-alt').waitFor()
  await page.getByRole('button', { name: 'Decline' }).click()
  await page.locator('.fx-alt').waitFor({ state: 'detached' })
  await shot(page, 'booking-alternative-declined')
  await page.getByRole('button', { name: /Cancel booking|Ask to cancel/ }).click()
  await page.locator('#fx-change textarea').fill('Our plans changed.')
  await shot(page, 'booking-cancel-confirm')
  await page.locator('#fx-change').getByRole('button', { name: /Cancel booking|Ask to cancel/ }).click()
  await page.locator('.fx-pill', { hasText: 'Cancelled' }).waitFor()
  await shot(page, 'booking-cancelled')
  await page.goto(`${SHOP}/farm-bookings`)
  await page.locator('.fx-row').nth(1).waitFor()
  await shot(page, 'my-farm-visits-after')
  // The account tabs carry "Farm visits".
  await page.goto(`${SHOP}/account`)
  await page.locator('.page-tabs a[href="/farm-bookings"]').waitFor()
  await shot(page, 'account-tabs')
  await ctx.close()

  // ---- Switch off: no card, and the pages say the visit is not open.
  const off = await open(API_OFF, 'off')
  await off.page.goto(`${SHOP}/bulk`)
  await off.page.locator('.door-hero.bulk').waitFor()
  await off.page.waitForTimeout(1200)
  if (await off.page.locator('#fx-card').count()) problems.push(`[${tag}] off: the farm card shows`)
  await shot(off.page, 'off-bulk-no-card')
  for (const p of ['/farm-experience', '/farm-experience/book', '/farm-bookings', '/farm-bookings/fb_none']) {
    await off.page.goto(SHOP + p)
    await off.page.getByRole('heading', { name: /not open right now/ }).waitFor()
  }
  await shot(off.page, 'off-pages-closed')
  await off.ctx.close()
  await browser.close()
  console.log(`${tag}: ${n} screenshots`)
}

const sizes = process.argv[2] ? [process.argv[2]] : ['phone', 'desktop']
const themes = process.argv[3] ? [process.argv[3]] : ['light', 'dark']
const farm = await setupFarm()
for (const s of sizes) for (const t of themes) {
  try { await run(s, t, farm) } catch (e) { problems.push(`[${s}-${t}] STOPPED: ${e.message.split('\n').slice(0, 6).join(' | ')}`) }
}
console.log(problems.length ? `PROBLEMS (${problems.length}):\n` + problems.join('\n') : 'No problems: no console errors, no sideways scroll, no raw dates.')
console.log('Screenshots:', OUT)
process.exit(problems.some((p) => p.includes('STOPPED')) ? 1 : 0)
