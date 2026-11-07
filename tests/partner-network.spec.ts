import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, navLinkAnyState, openNavTo, screenLoaded, test } from './fixtures'
import { mockApi, type Role } from './mock-api'

// The panel's Partner Network section (docs/partner-network.md, "Staff API"). The API is
// mocked here with the contract's shapes; the server side has its own tests.

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const STAFF = [
  { id: 'adm1', email: 'manager@mandimangoes.test', role: 'MANAGER' },
  { id: 'adm2', email: 'ops@mandimangoes.test', role: 'OPERATOR' },
]

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'enq_1', reference: 'MMP-7K2QXD9T', name: 'Ravi Patil', businessName: 'Patil Agro Traders',
    primaryCategory: { code: 'FARMERS_SUPPLIERS', name: 'Farmers & Suppliers' },
    categories: [{ code: 'FARMERS_SUPPLIERS', name: 'Farmers & Suppliers' }, { code: 'PRODUCT_DEVELOPMENT', name: 'Product Development' }],
    city: 'Ratnagiri', state: 'Maharashtra', mobile: '+91 98765 43210', email: 'ravi@patilagro.example', submittedAt: '2026-11-05T06:30:00Z',
    status: 'NEW', priority: 'HIGH', assignedTo: null, ...over,
  }
}
const ROW2 = row({ id: 'enq_2', reference: 'MMP-3HV8WQ2N', name: 'Meera Nair', businessName: null, primaryCategory: { code: 'CORPORATE', name: 'Corporate & Institutional' }, categories: [{ code: 'CORPORATE', name: 'Corporate & Institutional' }], city: 'Kochi', state: 'Kerala', email: 'meera@example.com', status: 'CONTACTED', priority: 'NORMAL', assignedTo: { id: 'adm2', email: 'ops@mandimangoes.test' } })

function followup(over: Record<string, unknown> = {}) {
  return { id: 'fu_1', enquiry: { id: 'enq_1', reference: 'MMP-7K2QXD9T', name: 'Ravi Patil' }, scheduledAt: '2026-11-06T05:30:00Z', assignedTo: { id: 'adm2', email: 'ops@mandimangoes.test' }, notes: 'Ask for the price list', status: 'PENDING', completedAt: null, overdue: true, ...over }
}

const PROPOSAL_ROW = {
  id: 'pp_1', reference: 'MMP-P-4KD2', productName: 'Ratnagiri mango pulp', productCategory: 'Processed fruit',
  submittedBy: { name: 'Ravi Patil', enquiryId: 'enq_1', enquiryReference: 'MMP-7K2QXD9T' }, applicantLocation: 'Ratnagiri, Maharashtra', sourceLocation: 'Devgad',
  procurementPrice: 180, suggestedSellingPrice: 260, monthlySupplyCapacity: '2,000 cans', sampleAvailable: 'Yes', submittedAt: '2026-11-05T06:30:00Z', status: 'SUBMITTED',
}

const SECTIONS = [
  { key: 'personal', title: 'Personal information', answers: [
    { key: 'fullName', label: 'Full name', type: 'TEXT', value: 'Ravi Patil' },
    { key: 'mobile', label: 'Mobile number', type: 'PHONE', value: '+91 98765 43210' },
    { key: 'preferredContact', label: 'How should we contact you?', type: 'RADIO', value: 'WhatsApp' },
  ] },
  { key: 'business', title: 'Business information', answers: [
    { key: 'representsBusiness', label: 'Are you representing an existing business?', type: 'RADIO', value: 'Yes' },
    { key: 'website', label: 'Website', type: 'TEXT', value: null },
  ] },
  { key: 'proposal', title: 'Partnership proposal', answers: [
    { key: 'whyUs', label: 'Why do you want to work with MandiMangoes?', type: 'TEXTAREA', value: 'We grow Alphonso on 40 acres and want a steady buyer.' },
    { key: 'hasNetwork', label: 'Do you have an existing network?', type: 'BOOLEAN', value: 'No' },
  ] },
  { key: 'supply', title: 'Farmers and suppliers', answers: [
    { key: 'fs_capacity', label: 'How much can you supply each month?', type: 'TEXT', value: '6 tonnes' },
    { key: 'fs_certifications', label: 'Certifications', type: 'MULTI_SELECT', value: null },
  ] },
  { key: 'product', title: 'Product development and expansion', answers: [
    { key: 'pd_productName', label: 'Product name', type: 'TEXT', value: 'Ratnagiri mango pulp' },
  ] },
  { key: 'final', title: 'Final details', answers: [
    { key: 'startWhen', label: 'When would you like to start?', type: 'SELECT', value: 'Within a month' },
    { key: 'additionalComments', label: 'Anything else?', type: 'TEXTAREA', value: null },
  ] },
]
const ALL_ANSWERS = SECTIONS.flatMap((s) => s.answers)

function pnState(role: Role) {
  const manager = role === 'MANAGER'
  return {
    rows: [row(), ROW2],
    detail: {
      ...row(), pincode: '415612', country: 'India', preferredContact: 'WHATSAPP', callbackTime: 'Mornings', startTimeline: 'Within a month', decision: null,
      assignedAt: null, assignedBy: null, questionnaireVersion: '2026-11-v1', consent: { text: 'I agree that MandiMangoes may contact me about this enquiry.', at: '2026-11-05T06:30:00Z' },
      sections: SECTIONS,
      documents: [
        { id: 'doc_1', name: 'price-list.pdf', category: 'QUOTATION', categoryLabel: 'Quotation', mime: 'application/pdf', size: 245760, uploadedAt: '2026-11-05T06:35:00Z' },
        { id: 'doc_2', name: 'orchard.jpg', category: 'PRODUCT_PHOTOS', categoryLabel: 'Product photographs', mime: 'image/jpeg', size: 1048576, uploadedAt: '2026-11-05T06:36:00Z' },
      ],
      notes: [{ id: 'n_1', note: 'Grows Alphonso and Kesar.', author: 'ops@mandimangoes.test', createdAt: '2026-11-05T08:00:00Z', about: 'ENQUIRY' }],
      followups: [followup()],
      activity: [{ id: 'a_1', type: 'SUBMITTED', summary: 'Enquiry submitted', oldValue: null, newValue: null, actor: null, at: '2026-11-05T06:30:00Z' }],
      proposal: { id: 'pp_1', reference: 'MMP-P-4KD2', status: 'SUBMITTED' },
      opportunity: null,
      allowedStatuses: ['UNDER_REVIEW', 'CONTACTED'],
      actions: { approve: manager, reject: manager, close: manager, reopen: false, convert: manager, assign: true, export: manager },
      contact: { tel: 'tel:+919876543210', whatsapp: 'https://wa.me/919876543210', mailto: 'mailto:ravi@patilagro.example' },
    } as Record<string, unknown>,
    proposal: {
      ...PROPOSAL_ROW, description: 'Pulp from Ratnagiri Alphonso, no added sugar.', productStage: 'Selling locally', supplierType: 'Farmer-processor', qualityCertifications: 'FSSAI',
      commercialAppeal: 'Year-round mango flavour.', canManage: 'Yes', relationships: 'Supplies two local sweet shops.',
      documents: [{ id: 'doc_2', name: 'orchard.jpg', category: 'PRODUCT_PHOTOS', categoryLabel: 'Product photographs', mime: 'image/jpeg', size: 1048576, uploadedAt: '2026-11-05T06:36:00Z' }],
      notes: [] as unknown[], activity: [{ id: 'pa_1', type: 'SUBMITTED', summary: 'Proposal submitted', oldValue: null, newValue: null, actor: null, at: '2026-11-05T06:30:00Z' }],
      allowedStatuses: ['UNDER_EVALUATION', 'SAMPLE_REQUESTED', 'QUALITY_REVIEW', 'COMMERCIAL_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'],
      contact: { tel: 'tel:+919876543210', whatsapp: 'https://wa.me/919876543210', mailto: 'mailto:ravi@patilagro.example' },
      enquiry: { id: 'enq_1', reference: 'MMP-7K2QXD9T', status: 'NEW' },
    } as Record<string, unknown>,
    categories: [
      { code: 'FARMERS_SUPPLIERS', name: 'Farmers & Suppliers', description: 'Growers and suppliers of mangoes and produce.', active: true, displayOrder: 2, enquiries: 14 },
      { code: 'CORPORATE', name: 'Corporate & Institutional', description: 'Bulk orders for companies and institutions.', active: true, displayOrder: 5, enquiries: 6 },
    ],
    /** The next follow-up POST answers 409 FOLLOWUP_EXISTS. */
    conflictNext: false,
  }
}

async function pnMock(page: Page, role: Role) {
  const s = pnState(role)
  const calls: { method: string; path: string; search: URLSearchParams; body: unknown }[] = []
  const detail = () => s.detail
  await page.route('**/admin/v1/partner-network/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/admin\/v1\/partner-network/, '')
    const method = req.method()
    const body = req.postData() ? req.postDataJSON() : undefined
    calls.push({ method, path, search: url.searchParams, body })
    if (path === '/overview') {
      return json(route, 200, {
        counts: { total: 42, NEW: 7, UNDER_REVIEW: 5, CONTACTED: 9, NEGOTIATION: 4, CONVERTED: 3, REJECTED: 6, CLOSED: 8, pendingReview: 12, proposalsAwaiting: 2 },
        latest: s.rows,
        byCategory: [{ code: 'FARMERS_SUPPLIERS', name: 'Farmers & Suppliers', count: 14 }, { code: 'CORPORATE', name: 'Corporate & Institutional', count: 6 }],
        byState: [{ state: 'Maharashtra', count: 18 }, { state: 'Kerala', count: 4 }],
        followups: { overdue: [followup()], upcoming: [followup({ id: 'fu_2', scheduledAt: '2026-11-09T05:30:00Z', overdue: false, notes: null })] },
        recentlyConverted: [row({ id: 'enq_9', reference: 'MMP-9ZZ', name: 'Kiran Foods', status: 'CONVERTED' })],
        proposalsNeedingAttention: [PROPOSAL_ROW],
      })
    }
    if (path === '/enquiries/export.csv') return route.fulfill({ status: 200, contentType: 'text/csv', body: 'reference,name\nMMP-7K2QXD9T,Ravi Patil\n' })
    if (path === '/enquiries') {
      const q = url.searchParams.get('q')
      const items = q === 'nobody' ? [] : s.rows
      return json(route, 200, { items, total: q === 'nobody' ? 0 : 120, page: Number(url.searchParams.get('page') ?? 1), pageSize: Number(url.searchParams.get('pageSize') ?? 25), staff: STAFF, states: ['Kerala', 'Maharashtra'] })
    }
    const doc = /^\/enquiries\/enq_1\/documents\/(doc_\d)$/.exec(path)
    if (doc) {
      if (doc[1] === 'doc_2') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n' })
    }
    if (path === '/enquiries/enq_1' && method === 'GET') return json(route, 200, detail())
    if (path === '/enquiries/enq_1' && method === 'PATCH') {
      const b = body as Record<string, unknown>
      if ('assignedTo' in b) s.detail.assignedTo = STAFF.find((x) => x.id === b.assignedTo) ?? null
      if (b.status) s.detail.status = b.status
      if (b.priority) s.detail.priority = b.priority
      return json(route, 200, detail())
    }
    if (path === '/enquiries/enq_1/notes') {
      ;(s.detail.notes as unknown[]).push({ id: 'n_2', note: (body as { note: string }).note, author: 'manager@mandimangoes.test', createdAt: '2026-11-07T08:00:00Z', about: 'ENQUIRY' })
      return json(route, 201, { id: 'n_2' })
    }
    if (path === '/enquiries/enq_1/followups' && method === 'POST') {
      await new Promise((r) => setTimeout(r, 300))
      if (s.conflictNext) {
        s.conflictNext = false
        return json(route, 409, { error: { code: 'FOLLOWUP_EXISTS', message: 'A follow-up already exists at that time', requestId: 'req_fu' } })
      }
      const b = body as { scheduledAt: string; assignedTo?: string; notes?: string }
      ;(s.detail.followups as unknown[]).push(followup({ id: 'fu_3', scheduledAt: b.scheduledAt, overdue: false, notes: b.notes ?? null, assignedTo: STAFF.find((x) => x.id === b.assignedTo) ?? null }))
      return json(route, 201, { id: 'fu_3' })
    }
    const fu = /^\/enquiries\/enq_1\/followups\/(fu_\d)$/.exec(path)
    if (fu) {
      s.detail.followups = (s.detail.followups as ReturnType<typeof followup>[]).map((f) => (f.id === fu[1] ? { ...f, ...(body as object), overdue: false, completedAt: (body as { status?: string }).status === 'DONE' ? '2026-11-07T09:00:00Z' : null } : f))
      return json(route, 200, {})
    }
    if (path === '/enquiries/enq_1/contact-attempts' || path === '/enquiries/enq_1/request-info') return json(route, 201, { ok: true })
    const act = /^\/enquiries\/enq_1\/(approve|reject|close|reopen|convert)$/.exec(path)
    if (act) {
      if (role !== 'MANAGER') return json(route, 403, { error: { code: 'FORBIDDEN', message: 'Requires manager role', requestId: 'req_f' } })
      s.detail.status = { approve: 'NEGOTIATION', reject: 'REJECTED', close: 'CLOSED', reopen: 'UNDER_REVIEW', convert: 'CONVERTED' }[act[1]]
      if (act[1] === 'convert') s.detail.opportunity = { title: (body as { title: string }).title, notes: null, createdAt: '2026-11-07T09:00:00Z', createdBy: 'manager@mandimangoes.test' }
      s.detail.actions = { approve: false, reject: false, close: act[1] !== 'close', reopen: act[1] === 'reject', convert: false, assign: true, export: true }
      s.detail.allowedStatuses = []
      return json(route, 200, detail())
    }
    if (path === '/product-proposals') return json(route, 200, { items: [PROPOSAL_ROW], total: 1, page: 1, pageSize: Number(url.searchParams.get('pageSize') ?? 25) })
    if (path === '/product-proposals/pp_1' && method === 'GET') return json(route, 200, s.proposal)
    if (path === '/product-proposals/pp_1' && method === 'PATCH') {
      s.proposal.status = (body as { status: string }).status
      return json(route, 200, s.proposal)
    }
    if (path === '/product-proposals/pp_1/notes') {
      ;(s.proposal.notes as unknown[]).push({ id: 'pn_1', note: (body as { note: string }).note, author: 'manager@mandimangoes.test', createdAt: '2026-11-07T08:00:00Z', about: 'PROPOSAL' })
      return json(route, 201, { id: 'pn_1' })
    }
    if (path === '/product-proposals/pp_1/request-sample') {
      s.proposal.status = 'SAMPLE_REQUESTED'
      return json(route, 200, s.proposal)
    }
    if (path === '/categories') return json(route, 200, s.categories)
    const cat = /^\/categories\/([A-Z_]+)$/.exec(path)
    if (cat && method === 'PATCH') {
      if (role !== 'MANAGER') return json(route, 403, { error: { code: 'FORBIDDEN', message: 'Requires manager role', requestId: 'req_f' } })
      s.categories = s.categories.map((c) => (c.code === cat[1] ? { ...c, ...(body as object) } : c))
      return json(route, 200, s.categories.find((c) => c.code === cat[1]))
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req_pn' } })
  })
  return { s, calls }
}

async function signedIn(page: Page, role: Role = 'MANAGER') {
  await mockApi(page, { signedIn: true, role })
  return pnMock(page, role)
}

/** Keeps tel:, mailto: and wa.me links on the page and notes which ones were opened. */
async function catchOutsideLinks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] }
    w.__opened = []
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a')
        if (a && /^(tel:|mailto:|https:\/\/wa\.me\/)/.test(a.href)) {
          e.preventDefault()
          w.__opened.push(a.href)
        }
      },
      true,
    )
  })
}
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)

const scan = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const lastList = (calls: { method: string; path: string; search: URLSearchParams }[]) => calls.filter((c) => c.path === '/enquiries').at(-1)?.search

test('managers and operators get the Partner Network group; packers and riders do not', async ({ page }) => {
  for (const role of ['MANAGER', 'OPERATOR'] as const) {
    await signedIn(page, role)
    await page.goto('/today')
    await (await openNavTo(page, 'Partner overview')).click()
    await expect(page).toHaveURL(/\/partner-network$/)
    await expect(page.getByRole('heading', { name: 'Partner Network', level: 1 })).toBeVisible()
    await expect(navLinkAnyState(page, 'Enquiries')).toHaveCount(1)
    await expect(navLinkAnyState(page, 'Product proposals')).toHaveCount(1)
    await expect(navLinkAnyState(page, 'Partner categories')).toHaveCount(1)
  }
  for (const role of ['PACKER', 'RIDER'] as const) {
    await signedIn(page, role)
    await page.goto('/partner-network/enquiries')
    await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
    await screenLoaded(page)
    await expect(navLinkAnyState(page, 'Partner overview')).toHaveCount(0)
    await expect(navLinkAnyState(page, 'Enquiries')).toHaveCount(0)
  }
})

test('the overview shows the API counts and links each item to its page', async ({ page }) => {
  await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network')
  const counts = page.getByRole('list', { name: 'Enquiry counts' })
  for (const [label, n] of [['Total enquiries', 42], ['New', 7], ['Pending review', 12], ['Contacted', 9], ['In negotiation', 4], ['Converted', 3], ['Rejected', 6], ['Proposals awaiting a decision', 2]] as const) {
    await expect(counts.getByRole('listitem').filter({ hasText: label }).first()).toContainText(String(n))
  }
  await expect(page.getByRole('link', { name: /Ravi Patil/ }).first()).toHaveAttribute('href', '/partner-network/enquiries/enq_1')
  await expect(page.getByRole('link', { name: 'Farmers & Suppliers' })).toHaveAttribute('href', '/partner-network/enquiries?category=FARMERS_SUPPLIERS')
  await expect(page.getByRole('link', { name: 'Maharashtra' })).toHaveAttribute('href', '/partner-network/enquiries?state=Maharashtra')
  const followups = page.locator('section', { has: page.getByRole('heading', { name: 'Follow-ups' }) })
  await expect(followups.getByText('Overdue', { exact: true }).last()).toBeVisible()
  await expect(followups.locator('.pn-overdue')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Kiran Foods' })).toHaveAttribute('href', '/partner-network/enquiries/enq_9')
  await expect(page.getByRole('link', { name: 'Ratnagiri mango pulp' })).toHaveAttribute('href', '/partner-network/proposals/pp_1')
  await scan(page)
})

test('the enquiries list sends search, filters, sort and page to the API and keeps them in the address', async ({ page }, info) => {
  const pn = await signedIn(page, 'MANAGER')
  await page.goto('/partner-network/enquiries')
  await expect(page.getByRole('cell', { name: 'Meera Nair', exact: true })).toBeVisible()
  expect(Object.fromEntries(lastList(pn.calls)!)).toEqual({ sort: 'submitted', dir: 'desc', page: '1', pageSize: '25' })
  await expect(page.getByText('ravi@patilagro.example')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Product Development' })).toBeVisible()
  await scan(page)

  await page.getByLabel('Search by name, phone, email or reference').fill('ravi')
  await expect.poll(() => lastList(pn.calls)?.get('q')).toBe('ravi')
  await page.getByLabel('Status').selectOption('NEW')
  await expect.poll(() => lastList(pn.calls)?.get('status')).toBe('NEW')
  await page.getByLabel('Category').selectOption('FARMERS_SUPPLIERS')
  await expect.poll(() => lastList(pn.calls)?.get('category')).toBe('FARMERS_SUPPLIERS')
  await page.getByLabel('State').selectOption('Maharashtra')
  await page.getByLabel('Assigned to').selectOption('me')
  await page.getByLabel('Priority').selectOption('HIGH')
  await page.getByLabel('Submitted from').fill('2026-11-01')
  await page.getByLabel('Submitted to').fill('2026-11-06')
  await expect
    .poll(() => Object.fromEntries(lastList(pn.calls) ?? []))
    .toEqual({ q: 'ravi', status: 'NEW', category: 'FARMERS_SUPPLIERS', state: 'Maharashtra', assignedTo: 'me', priority: 'HIGH', from: '2026-11-01', to: '2026-11-06', sort: 'submitted', dir: 'desc', page: '1', pageSize: '25' })
  await expect(page).toHaveURL(/q=ravi/)
  await expect(page).toHaveURL(/assignedTo=me/)

  if (info.project.name === 'desktop') {
    const applicant = page.getByRole('columnheader', { name: 'Applicant' })
    await expect(applicant).toHaveAttribute('aria-sort', 'none')
    await expect(page.getByRole('columnheader', { name: 'Submitted', exact: true })).toHaveAttribute('aria-sort', 'descending')
    await applicant.getByRole('button').click()
    await expect.poll(() => `${lastList(pn.calls)?.get('sort')}:${lastList(pn.calls)?.get('dir')}`).toBe('name:asc')
    await expect(applicant).toHaveAttribute('aria-sort', 'ascending')
    await applicant.getByRole('button').click()
    await expect.poll(() => lastList(pn.calls)?.get('dir')).toBe('desc')
    await expect(applicant).toHaveAttribute('aria-sort', 'descending')
  } else {
    await page.getByLabel('Sort by').selectOption('name:asc')
    await expect.poll(() => `${lastList(pn.calls)?.get('sort')}:${lastList(pn.calls)?.get('dir')}`).toBe('name:asc')
  }

  await page.getByLabel('Rows per page').selectOption('50')
  await expect.poll(() => lastList(pn.calls)?.get('pageSize')).toBe('50')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect.poll(() => lastList(pn.calls)?.get('page')).toBe('2')
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByText('120 enquiries · page 2 of 3')).toBeVisible()

  // Reloading keeps every filter.
  await page.reload()
  await expect(page.getByLabel('Status')).toHaveValue('NEW')
  await expect(page.getByLabel('Search by name, phone, email or reference')).toHaveValue('ravi')

  // A manager's CSV uses the same filters, without the page.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/^mandimangoes-partner-enquiries-\d{4}-\d{2}-\d{2}\.csv$/)
  const exp = pn.calls.find((c) => c.path === '/enquiries/export.csv')!.search
  expect(exp.get('status')).toBe('NEW')
  expect(exp.get('q')).toBe('ravi')
  expect(exp.get('page')).toBeNull()

  await page.getByRole('button', { name: 'Clear all filters' }).click()
  await page.getByLabel('Search by name, phone, email or reference').fill('nobody')
  await expect(page.getByText('No enquiries match these filters.')).toBeVisible()
})

test('operators have no CSV export', async ({ page }) => {
  await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network/enquiries')
  await expect(page.getByRole('cell', { name: 'Meera Nair', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0)
})

test('an enquiry shows every answer, its documents, notes and history', async ({ page }) => {
  const pn = await signedIn(page, 'MANAGER')
  await page.goto('/partner-network/enquiries/enq_1')
  await expect(page.getByRole('heading', { name: 'Ravi Patil', level: 1 })).toBeVisible()
  await expect(page.getByText('MMP-7K2QXD9T').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open product proposal MMP-P-4KD2' })).toHaveAttribute('href', '/partner-network/proposals/pp_1')
  await scan(page)

  const panel = page.getByRole('tabpanel')
  const seen = new Set<string>()
  for (const tab of ['Overview', 'Personal information', 'Business information', 'Partnership proposal', 'Category-specific answers']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    for (const a of ALL_ANSWERS) {
      const term = panel.getByRole('term').filter({ hasText: a.label })
      if ((await term.count()) === 0) continue
      seen.add(a.key)
      const value = term.locator('xpath=following-sibling::dd[1]')
      await expect(value).toHaveText(a.value ?? 'Not answered')
    }
  }
  expect([...seen].sort()).toEqual(ALL_ANSWERS.map((a) => a.key).sort())
  await page.getByRole('tab', { name: 'Category-specific answers' }).click()
  await expect(panel.getByRole('heading', { name: 'Farmers and suppliers' })).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Product development and expansion' })).toBeVisible()
  await expect(page.getByText('{')).toHaveCount(0)
  await scan(page)

  await page.getByRole('tab', { name: /Supporting documents/ }).click()
  await expect(panel.locator('.pn-doc-name', { hasText: 'price-list.pdf' })).toBeVisible()
  await expect(panel.getByText('Quotation · 240 KB')).toBeVisible()
  await expect(panel.getByText('Product photographs · 1.0 MB')).toBeVisible()
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Download price-list.pdf' }).click()
  expect((await download).suggestedFilename()).toBe('price-list.pdf')
  await panel.getByRole('button', { name: 'Preview orchard.jpg' }).click()
  await expect(panel.getByRole('img', { name: 'orchard.jpg' })).toBeVisible()
  expect(pn.calls.some((c) => c.path === '/enquiries/enq_1/documents/doc_2' && c.search.get('inline') === '1')).toBe(true)

  await page.getByRole('tab', { name: /Internal notes/ }).click()
  await expect(panel.getByText('Grows Alphonso and Kesar.')).toBeVisible()
  await panel.getByLabel('Add an internal note').fill('Called back, wants a sample box first.')
  await panel.getByRole('button', { name: 'Add note' }).click()
  await expect(panel.getByText('Called back, wants a sample box first.')).toBeVisible()
  expect(pn.calls.find((c) => c.path === '/enquiries/enq_1/notes')?.body).toEqual({ note: 'Called back, wants a sample box first.' })

  await page.getByRole('tab', { name: 'Activity history' }).click()
  await expect(panel.getByText('Enquiry submitted')).toBeVisible()
})

test('follow-ups: one request per click, a clash at the same moment, then mark done', async ({ page }) => {
  const pn = await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network/enquiries/enq_1?tab=followups')
  const panel = page.getByRole('tabpanel')
  const existing = panel.getByRole('list', { name: 'Follow-ups' }).getByRole('listitem').first()
  await expect(existing).toContainText('Overdue')
  await expect(existing).toContainText('Ask for the price list')

  pn.s.conflictNext = true
  await panel.getByLabel('Notes (optional)').fill('Confirm the sample date')
  await panel.getByRole('button', { name: 'Schedule follow-up' }).dblclick()
  await expect(panel.getByRole('alert')).toContainText('A follow-up is already scheduled for that moment')
  expect(pn.calls.filter((c) => c.method === 'POST' && c.path === '/enquiries/enq_1/followups')).toHaveLength(1)

  await panel.getByLabel('Time (IST)').fill('15:30')
  await panel.getByRole('button', { name: 'Schedule follow-up' }).click()
  await expect(panel.getByText('Confirm the sample date')).toBeVisible()
  const posts = pn.calls.filter((c) => c.method === 'POST' && c.path === '/enquiries/enq_1/followups')
  expect(posts).toHaveLength(2)
  const sent = posts[1].body as { scheduledAt: string; assignedTo?: string; notes: string }
  expect(sent.notes).toBe('Confirm the sample date')
  expect(sent.assignedTo).toBe('adm2') // the operator signed in, chosen by default
  expect(sent.scheduledAt).toMatch(/T10:00:00\.000Z$/) // 15:30 IST

  await existing.getByRole('button', { name: /Mark done/ }).click()
  await expect.poll(() => pn.calls.find((c) => c.method === 'PATCH' && c.path === '/enquiries/enq_1/followups/fu_1')?.body).toEqual({ status: 'DONE' })
  await expect(panel.getByRole('list', { name: 'Follow-ups' }).getByText('Done', { exact: true })).toBeVisible()
})

test('status, priority and assignment; the status list is only what the API allows', async ({ page }) => {
  const pn = await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network/enquiries/enq_1')
  const status = page.getByLabel('Change status')
  await expect(status.locator('option')).toHaveText(['New (now)', 'Under review', 'Contacted'])
  // Operators see no decisions, and are told why.
  for (const name of ['Approve', 'Reject', 'Close', 'Convert']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(page.getByText('Approve, reject, close, reopen and convert: requires manager role.')).toBeVisible()

  await status.selectOption('UNDER_REVIEW')
  await page.getByRole('button', { name: 'Change status' }).click()
  await expect.poll(() => pn.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'UNDER_REVIEW' })
  await expect(page.locator('.topbar').getByText('Under review')).toBeVisible()

  await page.getByLabel('Priority', { exact: true }).selectOption('URGENT')
  await page.getByRole('button', { name: 'Set priority' }).click()
  await expect.poll(() => pn.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ priority: 'URGENT' })

  await page.getByLabel('Assigned to').selectOption('adm2')
  await page.getByRole('button', { name: 'Assign' }).click()
  await expect.poll(() => pn.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ assignedTo: 'adm2' })
})

test('a manager must give a reason to reject and a title to convert', async ({ page }) => {
  const pn = await signedIn(page, 'MANAGER')
  await page.goto('/partner-network/enquiries/enq_1')
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reject MMP-7K2QXD9T?' })
  const confirm = dialog.getByRole('button', { name: 'Reject' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Reason').fill('no')
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByText('At least 5 characters.')).toBeVisible()
  await scan(page)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(pn.calls.some((c) => c.path.endsWith('/reject'))).toBe(false)

  await page.getByRole('button', { name: 'Convert', exact: true }).click()
  const convert = page.getByRole('dialog', { name: 'Convert MMP-7K2QXD9T?' })
  await expect(convert.getByRole('button', { name: 'Convert' })).toBeDisabled()
  await convert.getByLabel('Opportunity title').fill('Pulp supply trial, 200 cans a month')
  await convert.getByRole('button', { name: 'Convert' }).click()
  await expect(page.getByRole('heading', { name: 'Business opportunity' })).toBeVisible()
  expect(pn.calls.find((c) => c.path === '/enquiries/enq_1/convert')?.body).toEqual({ title: 'Pulp supply trial, 200 cans a month' })

  // Converted: closing is still open, with a reason.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const close = page.getByRole('dialog', { name: 'Close MMP-7K2QXD9T?' })
  await close.getByLabel('Reason').fill('Trial finished, nothing further')
  await close.getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => pn.calls.find((c) => c.path === '/enquiries/enq_1/close')?.body).toEqual({ reason: 'Trial finished, nothing further' })
})

test('call, WhatsApp and email open on the device and are recorded; request more information opens WhatsApp', async ({ page }) => {
  await catchOutsideLinks(page)
  const pn = await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network/enquiries/enq_1')
  const call = page.getByRole('link', { name: /^Call/ })
  const wa = page.getByRole('link', { name: /^WhatsApp/ })
  const mail = page.getByRole('link', { name: /^Email/ })
  await expect(call).toHaveAttribute('href', 'tel:+919876543210')
  await expect(wa).toHaveAttribute('href', 'https://wa.me/919876543210')
  await expect(mail).toHaveAttribute('href', 'mailto:ravi@patilagro.example')
  await call.click()
  await wa.click()
  await mail.click()
  await expect
    .poll(() => pn.calls.filter((c) => c.path === '/enquiries/enq_1/contact-attempts').map((c) => (c.body as { channel: string }).channel))
    .toEqual(['PHONE', 'WHATSAPP', 'EMAIL'])
  await expect(page.getByText(/message (was )?sent|sent to the applicant/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Request more information' }).click()
  const dialog = page.getByRole('dialog', { name: 'Request more information' })
  await expect(dialog.getByLabel('WhatsApp')).toBeChecked() // the applicant prefers WhatsApp
  await dialog.getByLabel('Message').fill('Hello Ravi, could you share your FSSAI licence?')
  await dialog.getByRole('button', { name: 'Record and open WhatsApp' }).click()
  await expect(page.getByRole('dialog', { name: 'Request recorded' }).getByText('Opened in WhatsApp — send it from there.')).toBeVisible()
  expect(pn.calls.find((c) => c.path === '/enquiries/enq_1/request-info')?.body).toEqual({ channel: 'WHATSAPP', message: 'Hello Ravi, could you share your FSSAI licence?' })
  expect((await opened(page)).at(-1)).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hello Ravi, could you share your FSSAI licence?')}`)
})

test('product proposals: list, detail, approval needs a manager and a reason and never adds to the shop', async ({ page }) => {
  const pn = await signedIn(page, 'MANAGER')
  await page.goto('/partner-network/proposals')
  await expect(page.getByRole('cell', { name: 'Ratnagiri mango pulp', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '₹180' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '2,000 cans' })).toBeVisible()
  await scan(page)
  const chip = page.getByRole('button', { name: 'Quality review' })
  if (await chip.isVisible()) await chip.click()
  else await page.getByLabel('Status', { exact: true }).selectOption('QUALITY_REVIEW')
  await expect.poll(() => pn.calls.filter((c) => c.path === '/product-proposals').at(-1)?.search.get('status')).toBe('QUALITY_REVIEW')
  await page.getByLabel('Search by product, applicant or reference').fill('pulp')
  await expect.poll(() => pn.calls.filter((c) => c.path === '/product-proposals').at(-1)?.search.get('q')).toBe('pulp')
  await expect(page).toHaveURL(/status=QUALITY_REVIEW/)

  await page.goto('/partner-network/proposals/pp_1')
  await expect(page.getByRole('heading', { name: 'Ratnagiri mango pulp', level: 1 })).toBeVisible()
  await expect(page.getByText('Approving a proposal does not add a product to the shop.')).toBeVisible()
  await expect(page.getByRole('link', { name: /enquiry MMP-7K2QXD9T/ })).toHaveAttribute('href', '/partner-network/enquiries/enq_1')
  await expect(page.getByRole('img', { name: 'orchard.jpg' })).toBeVisible()
  await scan(page)

  await page.getByLabel('Add a note about this proposal').fill('Taste test next week')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Taste test next week')).toBeVisible()

  await page.getByLabel('Change status').selectOption('APPROVED')
  await page.getByRole('button', { name: 'Change status' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Approved for further consideration. Adding it to the shop is a separate step on the Products page.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Approve' })).toBeDisabled()
  await dialog.getByLabel('Reason').fill('Good margin and steady supply')
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(() => pn.calls.find((c) => c.method === 'PATCH' && c.path === '/product-proposals/pp_1')?.body).toEqual({ status: 'APPROVED', reason: 'Good margin and steady supply' })
  await expect(page.getByRole('note')).toHaveText('Approved for further consideration. Adding it to the shop is a separate step on the Products page.')
})

test('operators move a proposal along but cannot approve it; samples are requested, not sent', async ({ page }) => {
  const pn = await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network/proposals/pp_1')
  await expect(page.getByLabel('Change status').locator('option')).toHaveText(['Submitted (now)', 'Under evaluation', 'Sample requested', 'Quality review', 'Commercial review'])
  await page.getByRole('button', { name: 'Request samples' }).click()
  const dialog = page.getByRole('dialog', { name: 'Request samples?' })
  await expect(dialog.getByText('This does not contact the applicant')).toBeVisible()
  await dialog.getByRole('button', { name: 'Record sample request' }).click()
  await expect.poll(() => pn.calls.some((c) => c.path === '/product-proposals/pp_1/request-sample')).toBe(true)
})

test('categories: managers edit, operators only read', async ({ page }) => {
  const pn = await signedIn(page, 'MANAGER')
  await page.goto('/partner-network/categories')
  await expect(page.getByRole('cell', { name: 'Farmers & Suppliers FARMERS_SUPPLIERS' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Corporate & Institutional' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Corporate & Institutional' })
  await dialog.getByLabel('Name').fill('Corporate buyers')
  await dialog.getByLabel('Display order').fill('1')
  await dialog.getByLabel('Show on the Partner With Us form').uncheck()
  await dialog.getByRole('button', { name: 'Save category' }).click()
  await expect.poll(() => pn.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Corporate buyers', active: false, displayOrder: 1 })
  await expect(page.getByRole('cell', { name: 'Corporate buyers CORPORATE' })).toBeVisible()
  await expect(page.getByText('Hidden', { exact: true })).toBeVisible()

  await signedIn(page, 'OPERATOR')
  await page.goto('/partner-network/categories')
  await expect(page.getByRole('cell', { name: 'Farmers & Suppliers FARMERS_SUPPLIERS' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  await expect(page.getByText('Editing categories: requires manager role.')).toBeVisible()
})

test('while Partner Network is switched off the pages say so', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  await page.goto('/partner-network')
  await expect(page.getByText('Partner Network is switched off (PARTNER_NETWORK)')).toBeVisible()
})

// Screenshots for review: PN_SCREENSHOTS=/mnt/project-files/partner-network/panel npx playwright test partner-network --project=desktop
test('screenshots of the Partner Network pages', async ({ browser }, info) => {
  const dir = process.env.PN_SCREENSHOTS
  test.skip(!dir || info.project.name !== 'desktop', 'Set PN_SCREENSHOTS to a folder; desktop project only')
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600 })
    const page = await context.newPage()
    await signedIn(page, 'MANAGER')
    const shots: [string, string, () => Promise<void>][] =
      width === 1280
        ? [
            ['overview', '/partner-network', () => expect(page.getByText('Proposals awaiting a decision')).toBeVisible()],
            ['enquiries', '/partner-network/enquiries', () => expect(page.getByRole('cell', { name: 'Meera Nair', exact: true })).toBeVisible()],
            ['enquiry-detail', '/partner-network/enquiries/enq_1', () => expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible()],
            ['proposal-detail', '/partner-network/proposals/pp_1', () => expect(page.getByRole('img', { name: 'orchard.jpg' })).toBeVisible()],
          ]
        : [['enquiries', '/partner-network/enquiries', () => expect(page.getByRole('cell', { name: 'Meera Nair', exact: true })).toBeVisible()]]
    for (const [name, path, ready] of shots) {
      await page.goto(path)
      await ready()
      await screenLoaded(page)
      await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true })
    }
    await context.close()
  }
})
