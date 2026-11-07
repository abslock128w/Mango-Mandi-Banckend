import AxeBuilder from '@axe-core/playwright'
import type { Page, Request, Route } from '@playwright/test'
import { expect, test } from '../../tests/fixtures'
import { partnerNetwork } from './partner-fixture.ts'

// Partner With Us (docs/partner-network.md). The form's behaviour runs against a mocked API built
// from the API's own questionnaire (partner-fixture.ts), so every answer the API can give is
// covered: field errors, a duplicate, a switched-off feature, a failed upload. The last test sends
// a real enquiry with a document to the real API, when it is running with PARTNER_NETWORK on.

const API = (process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

const POLICY = (partner: boolean) => ({
  holdMinutes: 10,
  cutoffTime: '18:00 IST',
  maxDaysAhead: 6,
  claimWindowHours: 24,
  bills: false,
  features: { installApp: false, push: false, tracking: false, favourites: false, sortFilter: false, referrals: false, funnel: false, multiGift: false, languages: false, partnerNetwork: partner },
})

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface Mock {
  on?: boolean
  submit?: (req: Request) => { status: number; body: unknown }
  upload?: (req: Request, url: URL) => { status: number; body: unknown }
}

/** Answers every API call: the policy, the questionnaire, a submission and uploads; anything else is a 404. */
async function mockApi(page: Page, mock: Mock = {}) {
  const network = await partnerNetwork()
  const on = mock.on ?? true
  const sent: { body: Record<string, unknown>; headers: Record<string, string> }[] = []
  const uploads: { url: URL; headers: Record<string, string>; size: number }[] = []
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.pathname === '/v1/policy') return json(route, 200, POLICY(on))
    if (url.pathname === '/v1/partner-network' && req.method() === 'GET') return on ? json(route, 200, network) : json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } })
    if (url.pathname === '/v1/partner-network/enquiries' && req.method() === 'POST') {
      sent.push({ body: req.postDataJSON(), headers: await req.allHeaders() })
      const r = mock.submit?.(req) ?? { status: 201, body: { reference: 'MMP-7K2QXD9T', submittedAt: new Date().toISOString(), uploadToken: 'tok-123', uploadExpiresAt: new Date(Date.now() + 7200_000).toISOString() } }
      return json(route, r.status, r.body)
    }
    if (/^\/v1\/partner-network\/enquiries\/[^/]+\/documents$/.test(url.pathname) && req.method() === 'POST') {
      uploads.push({ url, headers: await req.allHeaders(), size: req.postDataBuffer()?.length ?? 0 })
      const r = mock.upload?.(req, url) ?? { status: 201, body: { id: `doc-${uploads.length}`, name: url.searchParams.get('name'), category: url.searchParams.get('category'), size: 10 } }
      return json(route, r.status, r.body)
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } })
  })
  return { sent, uploads, network }
}

const group = (page: Page, name: string | RegExp) => page.getByRole('group', { name })
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click()
const stepHeading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true })

async function fillAboutYou(page: Page) {
  await page.getByLabel('Full name').fill('Asha Rao')
  await page.getByLabel('Mobile number').fill('98450 12345')
  await page.getByLabel('Email address').fill('asha@example.com')
  await page.getByLabel('City').fill('Mysuru')
  await page.getByLabel('State').selectOption('Karnataka')
  await page.getByLabel('PIN code').fill('570001')
  await group(page, 'How should we contact you?').getByLabel('WhatsApp').check()
}
async function fillBusiness(page: Page) {
  await group(page, 'Are you representing an existing business?').getByLabel('Yes').check()
  await page.getByLabel('Business or organisation name').fill('Rao Cold Chain')
  await page.getByLabel('What type of organisation are you representing?').selectOption('PROPRIETORSHIP')
}
const long = (s: string) => `${s} We have worked in this trade for many years.`
async function fillProposal(page: Page, categories: string[] = []) {
  for (const c of categories) await page.getByRole('checkbox', { name: c }).check()
  await page.getByLabel('Why do you want to work with MandiMangoes?').fill(long('Your mangoes travel well.'))
  await page.getByLabel('What can you bring to the table?').fill(long('Refrigerated vans across Karnataka.'))
  await page.getByLabel('What would you like to build together?').fill(long('Faster deliveries to Mysuru.'))
  await group(page, /established customer base/).getByLabel('Yes').check()
  await group(page, /previously collaborated/).getByLabel('No').check()
  await page.getByLabel('What are your expectations from MandiMangoes?').fill(long('A steady monthly contract.'))
}
async function fillLogistics(page: Page) {
  await page.getByRole('checkbox', { name: 'Cold chain' }).check()
  await page.getByLabel('Which cities and states do you cover?').fill('Karnataka')
  await group(page, 'Do you own or operate your own fleet?').getByLabel('Own fleet').check()
  await page.getByLabel('What is your approximate operational capacity?').fill('200 deliveries a day')
  await group(page, /warehouses or storage/).getByLabel('No').check()
  await group(page, /service-level commitments/).getByLabel('Yes').check()
}
async function fillFinal(page: Page) {
  await group(page, 'When would you like to start?').getByLabel('Within a month').check()
  await page.getByRole('checkbox', { name: /I agree that MandiMangoes may contact me/ }).check()
}

/** The whole form for a logistics partner, ending on the last step. */
async function toFinalStep(page: Page) {
  await page.goto('/partner/apply?category=LOGISTICS')
  await fillAboutYou(page)
  await next(page)
  await fillBusiness(page)
  await next(page)
  await fillProposal(page)
  await next(page)
  await fillLogistics(page)
  await next(page)
  await expect(stepHeading(page, 'Final details')).toBeVisible()
  await fillFinal(page)
}

test('the landing page shows the categories, and a category starts the form with it chosen', async ({ page }) => {
  await mockApi(page)
  await page.goto('/partner')
  await expect(page.getByRole('heading', { level: 1, name: "Let's Grow Together." })).toBeVisible()
  await expect(page.getByText('MandiMangoes is open to opportunities throughout India.')).toBeVisible()
  const list = page.locator('.partner-list > li')
  await expect(list).toHaveCount(9)
  await expect(page.getByRole('heading', { level: 3, name: 'Farmers & Suppliers' })).toBeVisible()
  await expect(page.getByText('Transport, warehousing, delivery and fulfilment partners.')).toBeVisible()
  // Reachable from the footer (and never a bottom tab).
  await expect(page.locator('footer').getByRole('link', { name: 'Partner With Us' })).toBeVisible()
  await expect(page.locator('.tabbar').getByRole('link', { name: 'Partner With Us' })).toHaveCount(0)
  await noA11yViolations(page)
  expect(await noSidewaysScroll(page)).toBe(true)

  // The first button moves to the categories.
  await page.getByRole('link', { name: 'Explore Partnership Opportunities' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Ways to work with us' })).toBeFocused()
  await expect(page.getByRole('link', { name: 'Submit a Business Enquiry' }).first()).toHaveAttribute('href', '/partner/apply')

  await page.getByRole('link', { name: 'Start an enquiry: Logistics & Operations' }).click()
  await expect(page).toHaveURL(/\/partner\/apply\?category=LOGISTICS$/)
  await expect(page.getByText('Step 1 of 5')).toBeVisible()
  await fillAboutYou(page)
  await next(page)
  await fillBusiness(page)
  await next(page)
  await expect(stepHeading(page, 'Your proposal')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Logistics & Operations' })).toBeChecked()
  // With one category ticked, it is the main interest too, and the only one offered.
  const main = group(page, /Which one matters most/)
  await expect(main.getByRole('radio')).toHaveCount(1)
  await expect(main.getByRole('radio', { name: 'Logistics & Operations' })).toBeChecked()
})

test('Next checks only this step, and the problems are listed and focused', async ({ page }) => {
  await mockApi(page)
  await page.goto('/partner/apply')
  await expect(page.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(5)
  await expect(page.locator('[aria-current="step"]')).toContainText('About you')
  await next(page)
  const summary = page.locator('.partner-summary')
  await expect(summary).toBeFocused()
  await expect(summary).toContainText('7 answers on this step need a change')
  await expect(page.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Enter a 10-digit Indian mobile number')).toHaveCount(0)
  await noA11yViolations(page)

  await page.getByLabel('Mobile number').fill('12345')
  await page.getByLabel('PIN code').fill('1234')
  await next(page)
  await expect(page.locator('#q-mobile-error')).toHaveText('Enter a 10-digit Indian mobile number')
  await expect(page.locator('#q-pincode-error')).toHaveText('Enter a 6-digit PIN code')
  // A summary link takes focus to its question.
  await summary.getByRole('link', { name: 'Full name' }).click()
  await expect(page.getByLabel('Full name')).toBeFocused()
  // Outside India the PIN code pattern does not apply.
  await fillAboutYou(page)
  await page.getByLabel('PIN code').fill('SW1A 1AA')
  await page.getByLabel('Country').fill('United Kingdom')
  await page.getByLabel('State').selectOption('Outside India')
  await next(page)
  await expect(stepHeading(page, 'Your business')).toBeVisible()
  await expect(stepHeading(page, 'Your business')).toBeFocused()
  expect(await noSidewaysScroll(page)).toBe(true)
})

test('questions appear with the answers that need them, and Back keeps every answer', async ({ page }) => {
  await mockApi(page)
  await page.goto('/partner/apply')
  await fillAboutYou(page)
  await next(page)

  const business = page.getByLabel('Business or organisation name')
  await group(page, 'Are you representing an existing business?').getByLabel('No').check()
  await expect(business).toHaveCount(0)
  await group(page, 'Are you representing an existing business?').getByLabel('Yes').check()
  await expect(business).toBeVisible()
  await fillBusiness(page)
  await next(page)

  await expect(page.getByLabel('Tell us about that experience')).toHaveCount(0)
  await group(page, /previously collaborated/).getByLabel('Yes').check()
  await expect(page.getByLabel('Tell us about that experience')).toBeVisible()
  await fillProposal(page, ['Product Development & Expansion'])
  await expect(page.getByLabel('Tell us about that experience')).toHaveCount(0)
  await group(page, /previously collaborated/).getByLabel('Yes').check()
  await next(page)
  await expect(page.locator('#q-priorExperience-error')).toHaveText('This is needed')
  await page.getByLabel('Tell us about that experience').fill(long('We supplied a juice brand in Mysuru.'))
  await next(page)
  // The product section follows the ticked category.
  await expect(stepHeading(page, 'The details')).toBeVisible()
  await expect(page.getByLabel('What product would you like to introduce?')).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Product development and expansion' })).toBeVisible()
  await expect(page.getByLabel('Which cities and states do you cover?')).toHaveCount(0)

  // Back, twice: every answer is still there.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByLabel('Tell us about that experience')).toHaveValue(/juice brand/)
  await expect(page.getByRole('checkbox', { name: 'Product Development & Expansion' })).toBeChecked()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(business).toHaveValue('Rao Cold Chain')
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByLabel('Full name')).toHaveValue('Asha Rao')
  await expect(group(page, 'How should we contact you?').getByLabel('WhatsApp')).toBeChecked()

  // A reload keeps them too (the draft in sessionStorage).
  await page.reload()
  await expect(page.getByLabel('Full name')).toHaveValue('Asha Rao')
})

test('a submission shows the reference and uploads the files; a failed upload can be tried again', async ({ page }) => {
  let failFirst = true
  const api = await mockApi(page, {
    upload: (_req, url) => {
      if (url.searchParams.get('name') === 'catalogue.pdf' && failFirst) {
        failFirst = false
        return { status: 400, body: { error: { code: 'FILE_INVALID', message: 'That file could not be read. Please try again.' } } }
      }
      return { status: 201, body: { id: 'doc-1', name: url.searchParams.get('name'), category: url.searchParams.get('category'), size: 10 } }
    },
  })
  await toFinalStep(page)
  await noA11yViolations(page)
  const picker = page.getByLabel('Add a file')
  await picker.setInputFiles([
    { name: 'profile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 profile') },
    { name: 'catalogue.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 catalogue') },
  ])
  await page.getByLabel('What is profile.pdf?').selectOption('BUSINESS_PROFILE')
  await page.getByLabel('What is catalogue.pdf?').selectOption('PRODUCT_CATALOGUE')
  await page.getByRole('button', { name: 'Submit enquiry' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Enquiry received' })).toBeFocused()
  await expect(page.getByText('Thank you for your interest in MandiMangoes. Your business enquiry has been successfully submitted.')).toBeVisible()
  await expect(page.locator('.partner-reference-number')).toHaveText('MMP-7K2QXD9T')
  // It never claims a message was sent.
  await expect(page.locator('.partner-done').getByText(/WhatsApp|email/i)).toHaveCount(0)

  // What was sent: the shown answers only, numbers and yes/no as such, a key, no files.
  expect(api.sent).toHaveLength(1)
  const { body, headers } = api.sent[0]
  expect(headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,100}$/)
  expect(body.questionnaireVersion).toBe(api.network.version)
  const answers = body.answers as Record<string, unknown>
  expect(answers.categories).toEqual(['LOGISTICS'])
  expect(answers.primaryCategory).toBe('LOGISTICS')
  expect(answers.hasNetwork).toBe(true)
  expect(answers.consent).toBe(true)
  expect(answers.country).toBe('India')
  expect(answers).not.toHaveProperty('documents')
  expect(answers).not.toHaveProperty('priorExperience')

  // The files go after, each with the upload token and its kind; one fails and is tried again.
  const row = page.locator('.partner-uploads li', { hasText: 'catalogue.pdf' })
  await expect(row).toContainText('Not uploaded: That file could not be read. Please try again.')
  await expect(page.getByText('Your enquiry is saved. 1 file could not be uploaded')).toBeVisible()
  await expect(page.locator('.partner-uploads li', { hasText: 'profile.pdf' })).toContainText('Uploaded')
  await noA11yViolations(page)
  await row.getByRole('button', { name: 'Try again catalogue.pdf' }).click()
  await expect(row).toContainText('Uploaded')
  expect(api.uploads.map((u) => [u.url.pathname, u.url.searchParams.get('category'), u.headers['x-upload-token'], u.headers['content-type']])).toEqual([
    ['/v1/partner-network/enquiries/MMP-7K2QXD9T/documents', 'BUSINESS_PROFILE', 'tok-123', 'application/pdf'],
    ['/v1/partner-network/enquiries/MMP-7K2QXD9T/documents', 'PRODUCT_CATALOGUE', 'tok-123', 'application/pdf'],
    ['/v1/partner-network/enquiries/MMP-7K2QXD9T/documents', 'PRODUCT_CATALOGUE', 'tok-123', 'application/pdf'],
  ])
  // The draft is gone: a new enquiry starts empty.
  await page.goto('/partner/apply')
  await expect(page.getByLabel('Full name')).toHaveValue('')
})

test('field errors from the API take the form back to their step', async ({ page }) => {
  let calls = 0
  const api = await mockApi(page, {
    submit: () => {
      calls++
      return calls === 1
        ? { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Check the answers', fields: { email: 'Enter a valid email address', lg_coverage: 'Keep it under 200 characters' } } } }
        : { status: 409, body: { error: { code: 'DUPLICATE_ENQUIRY', message: 'We already have this enquiry', reference: 'MMP-ABCDEFGH' } } }
    },
  })
  await toFinalStep(page)
  await page.getByRole('button', { name: 'Submit enquiry' }).click()
  await expect(stepHeading(page, 'About you')).toBeVisible()
  await expect(page.getByText('Some answers need a change. We have taken you to the first one.')).toBeVisible()
  await expect(page.locator('#q-email-error')).toHaveText('Enter a valid email address')
  await expect(page.locator('.partner-summary')).toBeFocused()
  await page.getByLabel('Email address').fill('asha.rao@example.com')
  await expect(page.locator('#q-email-error')).toHaveCount(0)
  for (let i = 0; i < 4; i++) await next(page)
  await expect(stepHeading(page, 'Final details')).toBeVisible()
  await page.getByRole('button', { name: 'Submit enquiry' }).click()
  // A duplicate names the earlier reference.
  await expect(page.getByText('We already have this enquiry')).toBeVisible()
  await expect(page.getByText(/under reference MMP-ABCDEFGH/)).toBeVisible()
  // A fixed answer is a new submission, with a new key.
  expect(api.sent[1].headers['idempotency-key']).not.toBe(api.sent[0].headers['idempotency-key'])
  expect((api.sent[1].body.answers as Record<string, unknown>).email).toBe('asha.rao@example.com')
})

test('a file that is too large or of the wrong kind is refused before anything is sent', async ({ page }) => {
  const api = await mockApi(page)
  await toFinalStep(page)
  await page.getByLabel('Add a file').setInputFiles([
    { name: 'brochure.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) },
    { name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('x') },
  ])
  await expect(page.getByText('brochure.pdf is larger than 5 MB. Choose a smaller file.')).toBeVisible()
  await expect(page.getByText('notes.docx is not a PDF, JPEG, PNG or WebP file.')).toBeVisible()
  await expect(page.locator('.partner-file-list li')).toHaveCount(0)
  expect(api.uploads).toHaveLength(0)
  expect(api.sent).toHaveLength(0)
})

test('while the switch is off the links are hidden and the pages say it is not open', async ({ page }) => {
  await mockApi(page, { on: false })
  await page.goto('/partner')
  await expect(page.getByRole('heading', { level: 1, name: 'Partner With Us is not open right now' })).toBeVisible()
  await expect(page.locator('footer')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Partner With Us' })).toHaveCount(0)
  await page.goto('/partner/apply')
  await expect(page.getByRole('heading', { level: 1, name: 'Partner With Us is not open right now' })).toBeVisible()
})

test('a real enquiry with a document, against the API', async ({ page, request }) => {
  const live = await request.get(`${API}/v1/partner-network`).then((r) => r.status()).catch(() => 0)
  if (process.env.CI) expect(live, 'GET /v1/partner-network answers').toBe(200)
  test.skip(live !== 200, `the API at ${API} does not serve /v1/partner-network with PARTNER_NETWORK on`)
  await toFinalStep(page)
  // Each project is its own applicant, so the API's duplicate check does not join them.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByLabel('Email address').fill(`asha.${Date.now()}@example.com`)
  for (let i = 0; i < 4; i++) await next(page)
  await page.getByLabel('Add a file').setInputFiles({ name: 'profile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%âã\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') })
  await page.getByRole('button', { name: 'Submit enquiry' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Enquiry received' })).toBeVisible()
  const reference = (await page.locator('.partner-reference-number').textContent()) ?? ''
  expect(reference).toMatch(/^MMP-[2-9A-HJKMNP-Z]{8}$/)
  await expect(page.locator('.partner-uploads li', { hasText: 'profile.pdf' })).toContainText('Uploaded')
  const known = await request.get(`${API}/v1/partner-network/enquiries/${reference}`)
  expect(known.status()).toBe(200)
})
