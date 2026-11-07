// Partner Network (docs/partner-network.md): the public enquiry form, documents,
// staff management and product proposals. WhatsApp goes to a stub sender
// through the outbox; nothing reaches Meta. Documents use an in-memory store.
import { adminToken, client, closeAll, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { now, setNow } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { sendDueNotifications } from '../src/notify.js'
import { queueFollowupAlerts } from '../src/partner/alerts.js'
import { cleanFilename, newReference, REFERENCE_RE } from '../src/partner/enquiries.js'
import { applicableSections, CURRENT_VERSION, validateSubmission } from '../src/partner/questionnaire.js'
import { usePhotoStore } from '../src/photos.js'
import { enforceLimitsInTests } from '../src/ratelimit.js'

let srv
let api
let manager
let operator
const FLAGS = ['PARTNER_NETWORK', 'WHATSAPP_PARTNER_UPDATES', 'PARTNER_ALERT_PHONES', 'TURNSTILE_SECRET_KEY']
const saved = Object.fromEntries(FLAGS.map((k) => [k, env[k]]))
const store = new Map()

before(async () => {
  srv = await startServer()
  api = client(srv.base)
  usePhotoStore({
    put: async (path, bytes) => (store.set(path, bytes), path),
    get: async (path) => store.get(path) ?? null,
    del: async (path) => store.delete(path),
    listOld: async () => [],
  })
})
after(async () => {
  usePhotoStore(null)
  await srv.close()
  await closeAll()
})
beforeEach(async () => {
  await resetDb()
  manager = await adminToken(api)
  operator = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
  Object.assign(env, { PARTNER_NETWORK: true, WHATSAPP_PARTNER_UPDATES: false, PARTNER_ALERT_PHONES: [], TURNSTILE_SECRET_KEY: '' })
})
afterEach(() => {
  Object.assign(env, saved)
  enforceLimitsInTests(false)
})

let keySeq = 0
const key = () => `test-key-${Date.now()}-${++keySeq}`
const LONG = 'We run a fruit distribution business across north Karnataka and know the market well.'

/** A complete, valid set of answers for the given categories. */
function answers(categories = ['FARMERS_SUPPLIERS'], over = {}) {
  const a = {
    fullName: 'Ravi Kumar', mobile: '98450 12345', email: 'Ravi@Example.com', city: 'Ratnagiri', state: 'Maharashtra', pincode: '415612', country: 'India',
    preferredContact: 'WHATSAPP', representsBusiness: 'YES', businessName: 'Kumar Orchards', businessType: 'FARMER', yearsOperating: 12,
    categories, primaryCategory: categories[0], whyUs: LONG, valueBrought: LONG, buildTogether: LONG, hasNetwork: true, priorCollab: false, expectations: LONG,
    startWhen: 'MONTH', consent: true,
  }
  if (categories.includes('FARMERS_SUPPLIERS')) {
    Object.assign(a, { fs_products: 'Alphonso mangoes', fs_role: 'PRODUCER', fs_source: 'Own orchards, Ratnagiri', fs_capacity: '5 tonnes a month', fs_consistent: 'SEASONAL', fs_samples: true, fs_packaging: true })
  }
  if (categories.includes('PRODUCT_DEVELOPMENT')) {
    Object.assign(a, { pd_productName: 'Mango pulp', pd_category: 'Processed fruit', pd_stage: 'EXISTING', pd_source: 'Own unit, Ratnagiri', pd_appeal: LONG, pd_cost: 180, pd_price: 320, pd_capacity: '2000 tins', pd_canManage: 'YES', pd_samples: true })
  }
  if (categories.includes('SALES_DISTRIBUTION')) {
    Object.assign(a, { sd_region: 'Hubballi and Dharwad', sd_customerBase: true, sd_hasOutlet: false, sd_channels: ['DIRECT', 'WHOLESALE'], sd_hasLogistics: true, monthlyVolume: '300 boxes', sd_exclusive: 'OPEN' })
  }
  return { ...a, ...over }
}

const submit = (a = answers(), { idem = key(), version = CURRENT_VERSION, extra = {} } = {}) =>
  api.post('/v1/partner-network/enquiries', { questionnaireVersion: version, answers: a, ...extra }, { headers: { 'Idempotency-Key': idem } })

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const upload = (ref, token, bytes, { category = 'BUSINESS_PROFILE', name = 'profile.pdf', type = 'application/pdf' } = {}) =>
  api.raw('POST', `/v1/partner-network/enquiries/${ref}/documents?category=${category}&name=${encodeURIComponent(name)}`, { raw: bytes, headers: { 'Content-Type': type, ...(token ? { 'X-Upload-Token': token } : {}) } })

const enquiryId = async (ref) => (await query('SELECT id FROM partner_enquiries WHERE reference = $1', [ref])).rows[0].id
const A = (p) => `/admin/v1/partner-network${p}`

// ---------------------------------------------------------------- the questionnaire

describe('questionnaire', () => {
  test('the form lists every active category and the steps, with category options filled in', async () => {
    const r = await api.get('/v1/partner-network')
    assert.equal(r.status, 200)
    assert.equal(r.body.version, CURRENT_VERSION)
    assert.equal(r.body.categories.length, 9)
    assert.deepEqual(r.body.steps.map((s) => s.key), ['contact', 'business', 'proposal', 'specifics', 'final'])
    const cats = r.body.steps[2].sections[0].questions.find((q) => q.key === 'categories')
    assert.equal(cats.options.length, 9)
    assert.equal(r.body.uploads.maxFiles, 10)
    assert.deepEqual(r.body.captcha, { siteKeyRequired: false, siteKey: null, action: 'partner' })
    // Every text question carries the limit the check applies, so the shop never guesses it.
    const all = r.body.steps.flatMap((st) => st.sections.flatMap((sec) => sec.questions))
    for (const q of all.filter((x) => ['TEXT', 'TEXTAREA', 'EMAIL'].includes(x.type))) assert.ok(Number.isInteger(q.max) && q.max > 0, q.key)
    const one = await api.get('/v1/partner-network/questionnaires/LOGISTICS')
    assert.deepEqual(one.body.steps.find((s) => s.key === 'specifics').sections.map((s) => s.key), ['logistics'])
    assert.equal((await api.get('/v1/partner-network/questionnaires/NOPE')).status, 404)
  })

  test('a question in two applicable sections is asked once; hidden questions are dropped', () => {
    const s = applicableSections(CURRENT_VERSION, ['SALES_DISTRIBUTION', 'RETAIL_RESELLER'])
    const keys = s.flatMap((x) => x.keys)
    assert.equal(keys.filter((k) => k === 'monthlyVolume').length, 1)
    assert.ok(!keys.includes('fs_products'))
    const r = validateSubmission(CURRENT_VERSION, answers(['FARMERS_SUPPLIERS'], { priorExperience: 'should vanish because priorCollab is false' }), ['FARMERS_SUPPLIERS'])
    assert.ok(!r.errors, JSON.stringify(r.errors))
    assert.equal(r.answers.priorExperience, undefined)
  })

  test('the switch off hides every route', async () => {
    env.PARTNER_NETWORK = false
    assert.equal((await api.get('/v1/partner-network')).status, 404)
    assert.equal((await submit()).status, 404)
    assert.equal((await api.get(A('/overview'), { token: manager })).status, 404)
    assert.equal((await api.get('/v1/policy')).body.features.partnerNetwork, false)
  })
})

// ---------------------------------------------------------------- submitting

describe('submitting an enquiry', () => {
  test('a valid enquiry is saved with its answers, categories and a reference; no OTP needed', async () => {
    const r = await submit(answers(['FARMERS_SUPPLIERS', 'SALES_DISTRIBUTION']))
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.match(r.body.reference, REFERENCE_RE)
    assert.ok(r.body.uploadToken.length >= 20)
    const { rows } = await query('SELECT * FROM partner_enquiries WHERE reference = $1', [r.body.reference])
    const e = rows[0]
    assert.equal(e.status, 'NEW')
    assert.equal(e.priority, 'NORMAL')
    assert.equal(e.mobile_number, '+919845012345')
    assert.equal(e.email, 'ravi@example.com')
    assert.equal(e.primary_category, 'FARMERS_SUPPLIERS')
    assert.ok(e.consent_at)
    const cats = (await query('SELECT category_code, is_primary FROM partner_enquiry_categories WHERE enquiry_id = $1 ORDER BY category_code', [e.id])).rows
    assert.deepEqual(cats, [{ category_code: 'FARMERS_SUPPLIERS', is_primary: true }, { category_code: 'SALES_DISTRIBUTION', is_primary: false }])
    const ans = (await query('SELECT question_key, question_label, display_value FROM partner_enquiry_answers WHERE enquiry_id = $1', [e.id])).rows
    const by = Object.fromEntries(ans.map((x) => [x.question_key, x]))
    assert.equal(by.whyUs.question_label, 'Why do you want to work with MandiMangoes?')
    assert.equal(by.sd_channels.display_value, 'Direct sales, Wholesale')
    assert.equal(by.fs_samples.display_value, 'Yes')
    // Optional questions that were shown are kept, unanswered.
    assert.ok('fs_certifications' in by)
    assert.equal(by.fs_certifications.display_value, null)
    // The public acknowledgement says nothing but that it was received.
    const ack = await api.get(`/v1/partner-network/enquiries/${r.body.reference}`)
    assert.deepEqual(ack.body, { reference: r.body.reference, received: true })
    assert.equal((await api.get('/v1/partner-network/enquiries/MMP-AAAAAAAA')).status, 404)
  })

  test('missing and malformed fields are all reported at once, by question', async () => {
    const r = await submit(answers(['FARMERS_SUPPLIERS'], { fullName: '', email: 'not-an-email', mobile: '12345', pincode: '0123', fs_role: 'BOSS', consent: false }))
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, 'VALIDATION_ERROR')
    for (const k of ['fullName', 'email', 'mobile', 'pincode', 'fs_role', 'consent']) assert.ok(r.body.error.fields[k], `${k} reported`)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM partner_enquiries')).rows[0].n, 0)
  })

  test('a PIN code outside India is not held to the 6-digit format', async () => {
    const r = await submit(answers(['FARMERS_SUPPLIERS'], { country: 'Nepal', state: 'Outside India', pincode: '44600' }))
    assert.equal(r.status, 201, JSON.stringify(r.body))
  })

  test('conditional questions: required only when shown', async () => {
    const r = await submit(answers(['FARMERS_SUPPLIERS'], { priorCollab: true }))
    assert.equal(r.status, 400)
    assert.ok(r.body.error.fields.priorExperience)
    const ok = await submit(answers(['FARMERS_SUPPLIERS'], { priorCollab: true, priorExperience: LONG }))
    assert.equal(ok.status, 201)
    const noBiz = await submit(answers(['FARMERS_SUPPLIERS'], { representsBusiness: 'NO', businessName: undefined, whyUs: `${LONG} Different.` }))
    assert.equal(noBiz.status, 201, JSON.stringify(noBiz.body))
  })

  test('category sections are required only for ticked categories, and the primary must be ticked', async () => {
    const missing = answers(['PRODUCT_DEVELOPMENT'])
    delete missing.pd_productName
    const r = await submit(missing)
    assert.ok(r.body.error.fields.pd_productName)
    const wrongPrimary = await submit(answers(['FARMERS_SUPPLIERS'], { primaryCategory: 'LOGISTICS' }))
    assert.ok(wrongPrimary.body.error.fields.primaryCategory)
    const inactive = await query(`UPDATE partnership_categories SET is_active = FALSE WHERE code = 'LOGISTICS'`)
    assert.equal(inactive.rowCount, 1)
    const r2 = await submit(answers(['LOGISTICS']))
    assert.ok(r2.body.error.fields.categories)
  })

  test('unknown questions, status or ids can not be smuggled in', async () => {
    const r = await submit({ ...answers(), status: 'CONVERTED' })
    assert.equal(r.status, 400)
    assert.ok(r.body.error.fields.status)
    const r2 = await submit(answers(), { extra: { priority: 'URGENT' } })
    assert.equal(r2.status, 400)
  })

  test('large text: over a question\'s limit is a field error; an oversized body is 413', async () => {
    const r = await submit(answers(['FARMERS_SUPPLIERS'], { whyUs: 'x'.repeat(3001) }))
    assert.equal(r.status, 400)
    assert.match(r.body.error.fields.whyUs, /under 3000/)
    const huge = await submit(answers(['FARMERS_SUPPLIERS'], { additionalComments: 'y'.repeat(200_000) }))
    assert.equal(huge.status, 413)
  })

  test('script in an answer is stored as text, not run (the panel escapes it)', async () => {
    const payload = '<script>alert(1)</script> We would like to sell your mangoes across the city.'
    const r = await submit(answers(['FARMERS_SUPPLIERS'], { whyUs: payload }))
    assert.equal(r.status, 201)
    const d = await api.get(A(`/enquiries/${await enquiryId(r.body.reference)}`), { token: manager })
    const whyUs = d.body.sections.flatMap((s) => s.answers).find((x) => x.key === 'whyUs')
    assert.equal(whyUs.value, payload)
  })

  test('the same Idempotency-Key returns the same enquiry; the same answers under a new key are a duplicate', async () => {
    const idem = key()
    const a = await submit(answers(), { idem })
    const b = await submit(answers(), { idem })
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    assert.equal(b.body.reference, a.body.reference)
    assert.notEqual(b.body.uploadToken, a.body.uploadToken)
    const c = await submit(answers())
    assert.equal(c.status, 409)
    assert.equal(c.body.error.code, 'DUPLICATE_ENQUIRY')
    assert.equal(c.body.error.reference, a.body.reference)
    // Two at once with one key: one enquiry.
    const idem2 = key()
    const other = answers(['FARMERS_SUPPLIERS'], { fullName: 'Someone Else' })
    const [x, y] = await Promise.all([submit(other, { idem: idem2 }), submit(other, { idem: idem2 })])
    assert.deepEqual([x.status, y.status].sort(), [200, 201])
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM partner_enquiries')).rows[0].n, 2)
    assert.equal((await submit(answers(), { idem: 'short' })).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED')
  })

  test('an older form version is refused so the shop reloads it', async () => {
    const r = await submit(answers(), { version: '2020-01-v0' })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'QUESTIONNAIRE_CHANGED')
  })

  test('submissions are rate-limited per address', async () => {
    enforceLimitsInTests(true)
    const statuses = []
    for (let i = 0; i < 6; i++) statuses.push((await submit(answers(['FARMERS_SUPPLIERS'], { fullName: `Applicant ${i}` }))).status)
    assert.deepEqual(statuses.slice(0, 5), [201, 201, 201, 201, 201])
    assert.equal(statuses[5], 429)
  })

  test('references are unique and not sequential', () => {
    const seen = new Set(Array.from({ length: 2000 }, newReference))
    assert.equal(seen.size, 2000)
    for (const r of seen) assert.match(r, REFERENCE_RE)
  })

  test('a captcha is required when Turnstile is set up', async () => {
    env.TURNSTILE_SECRET_KEY = 'secret'
    const r = await submit(answers())
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, 'CAPTCHA_REQUIRED')
  })
})

// ---------------------------------------------------------------- documents

describe('documents', () => {
  test('PDFs and images upload with the token; others, oversized, wrong tokens and too many are refused', async () => {
    const r = await submit()
    const { reference: ref, uploadToken: tok } = r.body
    const ok = await upload(ref, tok, PDF, { name: '../../etc/Profile "final".pdf' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.name, 'Profile final.pdf')
    assert.equal((await upload(ref, tok, PNG, { category: 'PRODUCT_PHOTOS', name: 'farm.png', type: 'image/png' })).status, 201)
    // A script named .pdf: refused by its bytes.
    const fake = await upload(ref, tok, Buffer.from('#!/bin/sh\necho hi\n'), { name: 'x.pdf' })
    assert.equal(fake.status, 400)
    assert.equal(fake.body.error.code, 'FILE_INVALID')
    const big = await upload(ref, tok, Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]))
    assert.equal(big.status, 413)
    assert.equal((await upload(ref, 'wrong-token-wrong-token-wrong', PDF)).status, 401)
    assert.equal((await upload(ref, null, PDF)).status, 401)
    assert.equal((await upload('MMP-ZZZZZZZZ', tok, PDF)).status, 401)
    assert.equal((await upload(ref, tok, PDF, { category: 'SECRETS' })).status, 400)
    for (let i = 0; i < 8; i++) assert.equal((await upload(ref, tok, PDF, { name: `doc${i}.pdf` })).status, 201)
    const eleventh = await upload(ref, tok, PDF)
    assert.equal(eleventh.status, 409)
    assert.equal(eleventh.body.error.code, 'TOO_MANY_FILES')
    // Expired: two hours on.
    setNow(new Date(now().getTime() + 2 * 3_600_000 + 1000))
    assert.equal((await upload(ref, tok, PDF)).status, 401)
  })

  test('documents are served only to staff, as attachments', async () => {
    const r = await submit()
    await upload(r.body.reference, r.body.uploadToken, PDF)
    const id = await enquiryId(r.body.reference)
    const d = await api.get(A(`/enquiries/${id}`), { token: manager })
    const doc = d.body.documents[0]
    assert.equal(doc.categoryLabel, 'Business profile')
    const file = await api.raw('GET', A(`/enquiries/${id}/documents/${doc.id}`), { token: operator })
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'application/pdf')
    assert.match(file.headers.get('content-disposition'), /^attachment/)
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff')
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    assert.equal((await api.raw('GET', A(`/enquiries/${id}/documents/${doc.id}`), { token: packer })).status, 403)
    assert.equal((await api.raw('GET', A(`/enquiries/${id}/documents/${doc.id}`), {})).status, 401)
  })
})

// ---------------------------------------------------------------- notifications

describe('messages', () => {
  test('with the switch on: the applicant receipt and the team alerts go through the outbox', async () => {
    Object.assign(env, { WHATSAPP_PARTNER_UPDATES: true, PARTNER_ALERT_PHONES: ['+919900000001'] })
    const r = await submit(answers(['PRODUCT_DEVELOPMENT']))
    const rows = (await query('SELECT kind, phone, partner_params FROM notifications ORDER BY kind, event_id')).rows
    assert.deepEqual(rows.map((x) => x.kind), ['PARTNER_ENQUIRY_RECEIVED', 'PARTNER_TEAM_ALERT', 'PARTNER_TEAM_ALERT'])
    assert.deepEqual(rows[0].partner_params, ['Ravi Kumar', r.body.reference, 'Product Development & Expansion'])
    assert.ok(rows.slice(1).some((x) => x.partner_params[0] === 'New product proposal'))
    const sent = []
    const n = await sendDueNotifications({ sender: async (m) => (sent.push(m), `wamid.${sent.length}`) })
    assert.equal(n, 3)
    assert.equal(sent[0].template, `${env.WHATSAPP_TEMPLATE_PREFIX}partner_enquiry_received`)
    assert.equal(sent[0].params.length, 3)
  })

  test('a failed send never loses the enquiry, and is recorded', async () => {
    Object.assign(env, { WHATSAPP_PARTNER_UPDATES: true })
    const r = await submit()
    assert.equal(r.status, 201)
    await sendDueNotifications({ sender: async () => { throw Object.assign(new Error('Meta is down'), { status: 503 }) } })
    const n = (await query(`SELECT status, last_error, attempts FROM notifications WHERE kind = 'PARTNER_ENQUIRY_RECEIVED'`)).rows[0]
    assert.equal(n.status, 'PENDING')
    assert.equal(n.attempts, 1)
    assert.match(n.last_error, /Meta is down/)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM partner_enquiries')).rows[0].n, 1)
  })

  test('with the switch off nothing is queued', async () => {
    await submit()
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM notifications')).rows[0].n, 0)
  })
})

// ---------------------------------------------------------------- staff

describe('staff', () => {
  let ref
  let id
  beforeEach(async () => {
    const r = await submit(answers(['FARMERS_SUPPLIERS', 'PRODUCT_DEVELOPMENT']))
    ref = r.body.reference
    id = await enquiryId(ref)
  })

  test('list: search by name, phone, email and reference; filters; sort; pagination', async () => {
    await submit(answers(['SALES_DISTRIBUTION'], { fullName: 'Meera Shah', mobile: '9123456780', email: 'meera@shop.in', city: 'Pune', state: 'Maharashtra' }))
    await submit(answers(['SALES_DISTRIBUTION'], { fullName: 'Arun Das', mobile: '9000000001', email: 'arun@x.in', city: 'Kochi', state: 'Kerala', whyUs: `${LONG} Kerala.` }))
    const q = async (s) => (await api.get(A(`/enquiries?${s}`), { token: operator })).body
    assert.equal((await q('q=meera')).total, 1)
    assert.equal((await q('q=91234 56780')).total, 1)
    assert.equal((await q('q=+919123456780')).total, 1)
    assert.equal((await q('q=MEERA@shop.in')).total, 1)
    assert.equal((await q(`q=${ref.toLowerCase()}`)).items[0].reference, ref)
    assert.equal((await q('state=Kerala')).total, 1)
    assert.equal((await q('category=SALES_DISTRIBUTION')).total, 2)
    assert.equal((await q('category=PRODUCT_DEVELOPMENT')).total, 1)
    assert.equal((await q('status=NEW')).total, 3)
    assert.equal((await q('status=NEW,UNDER_REVIEW')).total, 3)
    assert.equal((await api.get(A('/enquiries?status=NEW,BOGUS'), { token: manager })).status, 400)
    assert.equal((await q('assignedTo=none')).total, 3)
    assert.deepEqual((await q('sort=name&dir=asc')).items.map((x) => x.name), ['Arun Das', 'Meera Shah', 'Ravi Kumar'])
    const p = await q('pageSize=10&page=2')
    assert.equal(p.items.length, 0)
    assert.equal(p.total, 3)
    assert.deepEqual((await q('from=2020-01-01&to=2020-01-02')).total, 0)
    assert.ok((await q('')).staff.some((s) => s.role === 'OPERATOR'))
    assert.equal((await api.get(A('/enquiries?sort=evil'), { token: manager })).status, 400)
    assert.equal((await api.get(A("/enquiries?q=' OR 1=1 --"), { token: manager })).body.total, 0)
  })

  test('detail shows every shown question with its answer, documents, notes and links', async () => {
    const d = (await api.get(A(`/enquiries/${id}`), { token: operator })).body
    assert.equal(d.reference, ref)
    assert.deepEqual(d.sections.map((s) => s.key), ['personal', 'business', 'proposal', 'supply', 'product', 'final'])
    const all = d.sections.flatMap((s) => s.answers)
    assert.ok(all.some((x) => x.key === 'pd_relationships' && x.value === null), 'unanswered optional question kept')
    assert.equal(all.find((x) => x.key === 'pd_cost').value, 'Rs 180')
    assert.equal(d.contact.tel, 'tel:+919845012345')
    assert.equal(d.contact.whatsapp, 'https://wa.me/919845012345')
    assert.match(d.contact.mailto, /^mailto:ravi@example\.com\?subject=/)
    assert.deepEqual(d.allowedStatuses, ['UNDER_REVIEW', 'CONTACTED'])
    assert.equal(d.actions.approve, false, 'operators can not approve')
    assert.equal(d.proposal.reference, `${ref}-P`)
    assert.ok(d.staff.some((x) => x.role === 'OPERATOR') && !d.staff.some((x) => x.role === 'PACKER'))
    assert.equal((await api.get(A(`/enquiries/${id}`), { token: manager })).body.actions.approve, true)
  })

  test('notes: added with author and time, visible to staff only', async () => {
    const r = await api.post(A(`/enquiries/${id}/notes`), { note: 'Called applicant; interested in Bengaluru distribution.' }, { token: operator })
    assert.equal(r.status, 201)
    assert.equal(r.body.notes[0].author, 'ops@mandimangoes.test')
    assert.equal((await api.post(A(`/enquiries/${id}/notes`), { note: '' }, { token: operator })).status, 400)
    // Nothing public shows notes.
    const pub = await api.get(`/v1/partner-network/enquiries/${ref}`)
    assert.ok(!JSON.stringify(pub.body).includes('Bengaluru'))
    const packer = await adminToken(api, 'packer@mandimangoes.test', 'packer123')
    assert.equal((await api.get(A(`/enquiries/${id}`), { token: packer })).status, 403)
    const audit = (await query(`SELECT action, detail FROM staff_audit WHERE action = 'NOTE partner enquiry'`)).rows
    assert.equal(audit.length, 1)
    assert.ok(!JSON.stringify(audit[0].detail).includes('Bengaluru'), 'the audit keeps the length, not the note')
  })

  test('status, priority and assignment, each recorded; final statuses only through the actions', async () => {
    const opId = (await query(`SELECT id FROM admin_users WHERE email = 'ops@mandimangoes.test'`)).rows[0].id
    let r = await api.patch(A(`/enquiries/${id}`), { status: 'UNDER_REVIEW', priority: 'HIGH', assignedTo: opId }, { token: operator })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.status, 'UNDER_REVIEW')
    assert.equal(r.body.priority, 'HIGH')
    assert.equal(r.body.assignedTo.email, 'ops@mandimangoes.test')
    assert.equal(r.body.assignedBy.email, 'ops@mandimangoes.test')
    assert.ok(r.body.activity.some((a) => a.type === 'STATUS_CHANGED' && a.summary.includes('New → Under review')))
    assert.ok(r.body.activity.some((a) => a.type === 'ASSIGNED'))
    r = await api.patch(A(`/enquiries/${id}`), { status: 'CONVERTED' }, { token: manager })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'INVALID_TRANSITION')
    assert.equal((await api.patch(A(`/enquiries/${id}`), { reference: 'MMP-HACKED00' }, { token: manager })).status, 400)
    const packerId = (await query(`SELECT id FROM admin_users WHERE email = 'packer@mandimangoes.test'`)).rows[0].id
    assert.equal((await api.patch(A(`/enquiries/${id}`), { assignedTo: packerId }, { token: manager })).status, 400)
    const audit = (await query(`SELECT action FROM staff_audit WHERE target = $1`, [id])).rows.map((x) => x.action)
    assert.ok(audit.includes('UPDATE partner enquiry'))
  })

  test('approve, convert, reject, close and reopen: managers only, with reasons, in order', async () => {
    assert.equal((await api.post(A(`/enquiries/${id}/approve`), {}, { token: operator })).status, 403)
    let r = await api.post(A(`/enquiries/${id}/convert`), { title: 'Mango pulp line' }, { token: manager })
    assert.equal(r.status, 409, 'convert needs NEGOTIATION first')
    r = await api.post(A(`/enquiries/${id}/approve`), { note: 'Strong supplier' }, { token: manager })
    assert.equal(r.body.status, 'NEGOTIATION')
    assert.equal(r.body.decision, 'APPROVED')
    assert.equal((await api.post(A(`/enquiries/${id}/convert`), {}, { token: manager })).status, 400, 'a title is needed')
    r = await api.post(A(`/enquiries/${id}/convert`), { title: 'Mango pulp supply for 2027', notes: 'Trial order in March' }, { token: manager })
    assert.equal(r.body.status, 'CONVERTED')
    assert.equal(r.body.opportunity.title, 'Mango pulp supply for 2027')
    assert.equal((await api.post(A(`/enquiries/${id}/reject`), { reason: 'Too late' }, { token: manager })).status, 409)
    r = await api.post(A(`/enquiries/${id}/close`), { reason: 'Contract signed offline' }, { token: manager })
    assert.equal(r.body.status, 'CLOSED')
    assert.equal((await api.post(A(`/enquiries/${id}/reopen`), { reason: 'x' }, { token: manager })).status, 400, 'a reason of 5 characters or more')
    r = await api.post(A(`/enquiries/${id}/reopen`), { reason: 'Applicant came back' }, { token: manager })
    assert.equal(r.body.status, 'UNDER_REVIEW')
    r = await api.post(A(`/enquiries/${id}/reject`), { reason: 'Prices too high for us' }, { token: manager })
    assert.equal(r.body.status, 'REJECTED')
    const types = r.body.activity.map((a) => a.type)
    for (const t of ['APPROVED', 'CONVERTED', 'CLOSED', 'REOPENED', 'REJECTED']) assert.ok(types.includes(t), t)
    // Converting never touched the shop's catalogue.
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM products WHERE name ILIKE '%pulp%'`)).rows[0].n, 0)
  })

  test('follow-ups: schedule, no twin, edit, complete; past times refused; overview shows due and overdue', async () => {
    const at = new Date(now().getTime() + 86_400_000)
    let r = await api.post(A(`/enquiries/${id}/followups`), { scheduledAt: at.toISOString(), notes: 'Call about samples' }, { token: operator })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const f = r.body.followups[0]
    assert.equal(f.assignedTo.email, 'ops@mandimangoes.test')
    const twin = await api.post(A(`/enquiries/${id}/followups`), { scheduledAt: at.toISOString() }, { token: operator })
    assert.equal(twin.status, 409)
    assert.equal(twin.body.error.code, 'FOLLOWUP_EXISTS')
    assert.equal((await api.post(A(`/enquiries/${id}/followups`), { scheduledAt: new Date(now().getTime() - 3_600_000).toISOString() }, { token: operator })).status, 400)
    let ov = (await api.get(A('/overview'), { token: operator })).body
    assert.equal(ov.followups.upcoming.length, 1)
    setNow(new Date(at.getTime() + 60_000))
    ov = (await api.get(A('/overview'), { token: operator })).body
    assert.equal(ov.followups.overdue.length, 1)
    assert.equal(ov.followups.overdue[0].enquiry.reference, ref)
    r = await api.patch(A(`/enquiries/${id}/followups/${f.id}`), { status: 'DONE' }, { token: operator })
    assert.equal(r.body.followups[0].status, 'DONE')
    assert.ok(r.body.followups[0].completedAt)
    ov = (await api.get(A('/overview'), { token: operator })).body
    assert.equal(ov.followups.overdue.length, 0)
  })

  test('follow-up alerts go once each, to the team numbers', async () => {
    Object.assign(env, { WHATSAPP_PARTNER_UPDATES: true, PARTNER_ALERT_PHONES: ['+919900000001', '+919900000002'] })
    const at = new Date(now().getTime() + 30 * 60_000)
    await api.post(A(`/enquiries/${id}/followups`), { scheduledAt: at.toISOString() }, { token: operator })
    assert.equal(await queueFollowupAlerts(), 2)
    assert.equal(await queueFollowupAlerts(), 0)
    setNow(new Date(at.getTime() + 60_000))
    assert.equal(await queueFollowupAlerts(), 2)
    assert.equal(await queueFollowupAlerts(), 0)
    const words = (await query(`SELECT partner_params FROM notifications WHERE kind = 'PARTNER_TEAM_ALERT' ORDER BY created_at DESC LIMIT 1`)).rows[0].partner_params
    assert.equal(words[0], 'Partner follow-up overdue')
  })

  test('contact attempts and information requests are recorded, never claimed as sent', async () => {
    let r = await api.post(A(`/enquiries/${id}/contact-attempts`), { channel: 'PHONE' }, { token: operator })
    assert.equal(r.status, 201)
    assert.match(r.body.activity[0].summary, /not a record that anything was sent/)
    r = await api.post(A(`/enquiries/${id}/request-info`), { channel: 'EMAIL', message: 'Please send your FSSAI certificate.' }, { token: operator })
    assert.equal(r.body.status, 'CONTACTED')
    assert.equal(r.body.activity.find((a) => a.type === 'INFO_REQUESTED').newValue, 'EMAIL')
  })

  test('CSV export: managers only, and cells that look like formulas are defused', async () => {
    await submit(answers(['SALES_DISTRIBUTION'], { fullName: '=HYPERLINK("x")', mobile: '9123456789', email: 'f@x.in' }))
    assert.equal((await api.raw('GET', A('/enquiries/export.csv'), { token: operator })).status, 403)
    const r = await api.raw('GET', A('/enquiries/export.csv?category=SALES_DISTRIBUTION'), { token: manager })
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /text\/csv/)
    const lines = r.body.trim().split('\r\n')
    assert.equal(lines.length, 2)
    assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`), lines[1])
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM staff_audit WHERE action = 'EXPORT partner enquiries'`)).rows[0].n, 1)
  })

  test('overview numbers come from the records', async () => {
    await api.patch(A(`/enquiries/${id}`), { status: 'CONTACTED' }, { token: operator })
    const ov = (await api.get(A('/overview'), { token: manager })).body
    assert.equal(ov.counts.total, 1)
    assert.equal(ov.counts.CONTACTED, 1)
    assert.equal(ov.counts.pendingReview, 0)
    assert.equal(ov.counts.proposalsAwaiting, 1)
    assert.equal(ov.byCategory.find((c) => c.code === 'PRODUCT_DEVELOPMENT').count, 1)
    assert.deepEqual(ov.byState, [{ state: 'Maharashtra', count: 1 }])
    assert.equal(ov.latest[0].reference, ref)
  })

  test('categories: managers edit names and switch them off; the form follows', async () => {
    assert.equal((await api.patch(A('/categories/OTHER'), { active: false }, { token: operator })).status, 403)
    const r = await api.patch(A('/categories/OTHER'), { active: false, name: 'Something else' }, { token: manager })
    assert.equal(r.status, 200)
    assert.equal((await api.get('/v1/partner-network')).body.categories.length, 8)
    assert.equal((await api.patch(A('/categories/NOPE'), { active: false }, { token: manager })).status, 404)
  })
})

// ---------------------------------------------------------------- product proposals

describe('product proposals', () => {
  test('created from the product section; reviewed, sampled and approved without touching the catalogue', async () => {
    const r = await submit(answers(['PRODUCT_DEVELOPMENT']))
    const list = (await api.get(A('/product-proposals'), { token: operator })).body
    assert.equal(list.total, 1)
    assert.equal((await api.get(A('/product-proposals?status=open'), { token: operator })).body.total, 1)
    assert.equal((await api.get(A('/product-proposals?status=APPROVED,CLOSED'), { token: operator })).body.total, 0)
    const p = list.items[0]
    assert.equal(p.productName, 'Mango pulp')
    assert.equal(p.procurementPrice, 180)
    assert.equal(p.suggestedSellingPrice, 320)
    assert.equal(p.sampleAvailable, true)
    assert.equal(p.applicantLocation, 'Ratnagiri, Maharashtra')
    assert.equal(p.submittedBy.enquiryReference, r.body.reference)
    await upload(r.body.reference, r.body.uploadToken, PNG, { category: 'PRODUCT_PHOTOS', name: 'pulp.png', type: 'image/png' })
    let d = (await api.get(A(`/product-proposals/${p.id}`), { token: operator })).body
    assert.equal(d.documents.length, 1)
    assert.equal(d.commercialAppeal, LONG)
    assert.equal(d.addsToShop, false)
    assert.ok(!d.allowedStatuses.includes('APPROVED'), 'operators can not approve')
    d = (await api.post(A(`/product-proposals/${p.id}/request-sample`), { note: '2 tins to the Pune office' }, { token: operator })).body
    assert.equal(d.status, 'SAMPLE_REQUESTED')
    assert.equal(d.notes[0].note, 'Samples requested: 2 tins to the Pune office')
    d = (await api.post(A(`/product-proposals/${p.id}/notes`), { note: 'Tasted well' }, { token: operator })).body
    assert.equal(d.notes[0].note, 'Tasted well')
    assert.equal((await api.patch(A(`/product-proposals/${p.id}`), { status: 'APPROVED', reason: 'Good margin' }, { token: operator })).status, 403)
    assert.equal((await api.patch(A(`/product-proposals/${p.id}`), { status: 'APPROVED' }, { token: manager })).status, 400)
    const productsBefore = (await query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n
    d = (await api.patch(A(`/product-proposals/${p.id}`), { status: 'APPROVED', reason: 'Good margin and supply' }, { token: manager })).body
    assert.equal(d.status, 'APPROVED')
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n, productsBefore, 'approval adds no product')
    assert.ok(d.activity.some((a) => a.type === 'PROPOSAL_STATUS_CHANGED' && a.summary.includes('→ Approved')))
    // The enquiry's own notes list shows proposal notes too, marked as such.
    const e = (await api.get(A(`/enquiries/${await enquiryId(r.body.reference)}`), { token: manager })).body
    assert.ok(e.notes.some((n) => n.about === 'PROPOSAL'))
  })

  test('no proposal without the product category', async () => {
    await submit(answers(['FARMERS_SUPPLIERS']))
    assert.equal((await api.get(A('/product-proposals'), { token: manager })).body.total, 0)
  })
})

describe('file names', () => {
  test('paths, quotes and control characters are removed', () => {
    assert.equal(cleanFilename('C:\\Users\\a\\..\\report.pdf', 'pdf'), 'report.pdf')
    assert.equal(cleanFilename('a\u0000b<>.pdf', 'pdf'), 'ab.pdf')
    assert.equal(cleanFilename('...', 'pdf'), 'document.pdf')
    assert.equal(cleanFilename('x'.repeat(300) + '.pdf', 'pdf').length, 160)
  })
})
