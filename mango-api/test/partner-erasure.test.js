// Partner Network: an application's details are deleted once it has ended
// (src/partner/erase.js, docs/partner-network.md "How long applications are
// kept"). The shop's Grow with us form promises it, with PARTNER_RETENTION_DAYS
// as the number, so these check the promise: only ended applications, only
// after the grace period, everything but the contact details of a converted
// partner, stored files too, the manager's button, and the applicant's own
// account deletion.
import { adminToken, client, closeAll, customerToken, resetDb, startServer } from './helpers.js'
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { now } from '../src/clock.js'
import { query } from '../src/db.js'
import { env } from '../src/env.js'
import { main as eraseCustomerMain } from '../ops/erase-customer.js'
import { ERASE_EARLY_MS, eraseEndedApplications } from '../src/partner/erase.js'
import { CURRENT_VERSION } from '../src/partner/questionnaire.js'
import { runMaintenance } from '../src/maintenance.js'
import { usePhotoStore } from '../src/photos.js'

let srv
let api
let manager
let operator
const saved = { PARTNER_NETWORK: env.PARTNER_NETWORK, PARTNER_RETENTION_DAYS: env.PARTNER_RETENTION_DAYS, WHATSAPP_PARTNER_UPDATES: env.WHATSAPP_PARTNER_UPDATES, TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY }
const store = new Map()
const DAY = 86_400_000

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
  store.clear()
  manager = await adminToken(api)
  operator = await adminToken(api, 'ops@mandimangoes.test', 'operator123')
  Object.assign(env, { PARTNER_NETWORK: true, PARTNER_RETENTION_DAYS: 30, WHATSAPP_PARTNER_UPDATES: false, TURNSTILE_SECRET_KEY: '' })
})
afterEach(() => Object.assign(env, saved))

let seq = 0
const LONG = 'We run a fruit distribution business across north Karnataka and know the market well.'
function answers(n, categories = ['FARMERS_SUPPLIERS', 'PRODUCT_DEVELOPMENT']) {
  const a = {
    fullName: `Ravi Kumar ${n}`, mobile: `98450 1${String(n).padStart(4, '0')}`, email: `ravi${n}@example.com`, city: 'Ratnagiri', state: 'Maharashtra', pincode: '415612', country: 'India',
    preferredContact: 'WHATSAPP', representsBusiness: 'YES', businessName: `Kumar Orchards ${n}`, businessType: 'FARMER', yearsOperating: 12, website: 'kumarorchards.in',
    businessAddress: '12 Mango Lane, Ratnagiri', categories, primaryCategory: categories[0], whyUs: LONG, valueBrought: LONG, buildTogether: LONG, hasNetwork: true,
    priorCollab: false, expectations: LONG, startWhen: 'MONTH', additionalComments: 'Call after 5 please', consent: true,
    fs_products: 'Alphonso mangoes', fs_role: 'PRODUCER', fs_source: 'Own orchards, Ratnagiri', fs_capacity: '5 tonnes a month', fs_consistent: 'SEASONAL', fs_samples: true, fs_packaging: true,
  }
  if (categories.includes('PRODUCT_DEVELOPMENT')) {
    Object.assign(a, { pd_productName: 'Mango pulp', pd_category: 'Processed fruit', pd_stage: 'EXISTING', pd_source: 'Own unit, Ratnagiri', pd_appeal: LONG, pd_cost: 180, pd_price: 320, pd_capacity: '2000 tins', pd_canManage: 'YES', pd_samples: true })
  }
  return a
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
const A = (p) => `/admin/v1/partner-network${p}`

/** Sends an application with a document, a note and a follow-up; returns its id and reference. */
async function apply() {
  const n = ++seq
  const r = await api.post('/v1/partner-network/enquiries', { questionnaireVersion: CURRENT_VERSION, answers: answers(n) }, { headers: { 'Idempotency-Key': `erase-key-${Date.now()}-${n}` } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const up = await api.raw('POST', `/v1/partner-network/enquiries/${r.body.reference}/documents?category=BUSINESS_PROFILE&name=ravi-profile.pdf`, {
    raw: PDF, headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': r.body.uploadToken },
  })
  assert.equal(up.status, 201, JSON.stringify(up.body))
  const id = (await query('SELECT id FROM partner_enquiries WHERE reference = $1', [r.body.reference])).rows[0].id
  assert.equal((await api.post(A(`/enquiries/${id}/notes`), { note: 'Spoke to Ravi, wife runs the packhouse' }, { token: manager })).status, 201)
  assert.equal((await api.post(A(`/enquiries/${id}/followups`), { scheduledAt: new Date(now().getTime() + DAY).toISOString(), notes: 'Ring Ravi' }, { token: manager })).status, 201)
  return { id, reference: r.body.reference, mobile: `+9198450${String(1_0000 + n).slice(-5)}` }
}

/** Moves an application to an ended status through the panel, then dates the move `daysAgo` back. */
async function end(id, how, daysAgo) {
  if (how === 'CONVERTED') {
    assert.equal((await api.post(A(`/enquiries/${id}/approve`), {}, { token: manager })).status, 200)
    assert.equal((await api.post(A(`/enquiries/${id}/convert`), { title: 'Pulp supply with Ravi', notes: 'Ravi wants 40 days credit' }, { token: manager })).status, 200)
  } else {
    const r = await api.post(A(`/enquiries/${id}/${how === 'REJECTED' ? 'reject' : 'close'}`), { reason: 'Ravi is too far from us' }, { token: manager })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  }
  await query('UPDATE partner_enquiries SET status_changed_at = $2 WHERE id = $1', [id, new Date(now().getTime() - daysAgo * DAY)])
}

const row = async (id) => (await query('SELECT * FROM partner_enquiries WHERE id = $1', [id])).rows[0]
const count = async (table, id) => (await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE enquiry_id = $1`, [id])).rows[0].n

/** Everything the application said is gone; what is needed for counts and audit stays. */
async function assertFullyErased(id, reference) {
  const e = await row(id)
  for (const k of ['applicant_name', 'mobile_number', 'email', 'city', 'pincode', 'business_name', 'business_address', 'website', 'gstin', 'additional_comments', 'content_hash', 'upload_token_hash']) {
    assert.equal(e[k], null, k)
  }
  assert.ok(e.erased_at, 'erased_at')
  assert.equal(e.reference, reference)
  assert.ok(e.submitted_at && e.status_changed_at)
  assert.equal(e.primary_category, 'FARMERS_SUPPLIERS')
  assert.equal(await count('partner_enquiry_categories', id), 2, 'categories stay for the counts')
  for (const t of ['partner_enquiry_answers', 'partner_enquiry_documents', 'partner_enquiry_notes', 'partner_enquiry_followups', 'partner_opportunities']) assert.equal(await count(t, id), 0, t)
  const p = (await query('SELECT * FROM partner_product_proposals WHERE enquiry_id = $1', [id])).rows[0]
  for (const k of ['product_name', 'product_category', 'description', 'source_location', 'procurement_price', 'suggested_selling_price', 'monthly_supply_capacity']) assert.equal(p[k], null, `proposal ${k}`)
  const written = await query(
    `SELECT 1 FROM partner_enquiry_activities WHERE enquiry_id = $1 AND (metadata ?| $2::text[] OR (activity_type = 'DOCUMENT_ADDED' AND new_value IS NOT NULL))`,
    [id, ['reason', 'title', 'note', 'message']],
  )
  assert.equal(written.rowCount, 0, 'the history keeps no file names, reasons or notes')
  assert.equal((await query(`SELECT 1 FROM staff_audit WHERE target = $1 AND detail ?| $2::text[]`, [id, ['reason', 'title']])).rowCount, 0, 'audit reasons gone')
}

describe('the deletion rule', () => {
  test('only ended applications past the grace period lose their details; open and recent ones are untouched', async () => {
    const open = await apply()
    const rejected = await apply()
    const recent = await apply()
    const converted = await apply()
    await query('UPDATE partner_enquiries SET submitted_at = $2, status_changed_at = $2 WHERE id = $1', [open.id, new Date(now().getTime() - 400 * DAY)])
    await end(rejected.id, 'REJECTED', 31)
    await end(recent.id, 'CLOSED', 29)
    await end(converted.id, 'CONVERTED', 31)
    assert.equal(store.size, 4, 'four stored documents')

    assert.equal(await eraseEndedApplications(), 2)

    // Open (however old) and recently closed: nothing touched.
    for (const a of [open, recent]) {
      const e = await row(a.id)
      assert.equal(e.erased_at, null)
      assert.match(e.applicant_name, /^Ravi Kumar/)
      assert.ok((await count('partner_enquiry_answers', a.id)) > 10)
      assert.equal(await count('partner_enquiry_documents', a.id), 1)
      assert.equal(await count('partner_enquiry_notes', a.id), 1)
    }
    await assertFullyErased(rejected.id, rejected.reference)

    // Converted: a partner now, so the contact details stay; the application material goes.
    const c = await row(converted.id)
    assert.ok(c.erased_at)
    assert.equal(c.applicant_name, 'Ravi Kumar 4')
    assert.equal(c.mobile_number, converted.mobile)
    assert.equal(c.email, 'ravi4@example.com')
    assert.equal(c.business_name, 'Kumar Orchards 4')
    assert.equal(c.additional_comments, null)
    for (const t of ['partner_enquiry_answers', 'partner_enquiry_documents', 'partner_enquiry_notes', 'partner_enquiry_followups']) assert.equal(await count(t, converted.id), 0, t)
    assert.equal(await count('partner_opportunities', converted.id), 1, 'the partnership record stays')

    // The stored files of the erased ones are gone; the others' are still there.
    assert.equal(store.size, 2)
    for (const a of [rejected, converted]) assert.ok(![...store.keys()].some((k) => k.includes(a.id)), `${a.reference} file removed`)

    // Idempotent: a second run finds nothing, and changes nothing.
    const before = (await row(rejected.id)).erased_at
    assert.equal(await eraseEndedApplications(), 0)
    assert.deepEqual((await row(rejected.id)).erased_at, before)
    assert.equal((await query(`SELECT COUNT(*)::int AS n FROM partner_enquiry_activities WHERE enquiry_id = $1 AND activity_type = 'DETAILS_ERASED'`, [rejected.id])).rows[0].n, 1)
  })

  test('the grace period comes from PARTNER_RETENTION_DAYS, and nothing waits past it', async () => {
    const a = await apply()
    await end(a.id, 'REJECTED', 0)
    env.PARTNER_RETENTION_DAYS = 7
    await query('UPDATE partner_enquiries SET status_changed_at = $2 WHERE id = $1', [a.id, new Date(now().getTime() - 6 * DAY)])
    assert.equal(await eraseEndedApplications(), 0, 'six days: kept')
    // Within the last hour before the deadline the hourly run takes it, so it is never late.
    await query('UPDATE partner_enquiries SET status_changed_at = $2 WHERE id = $1', [a.id, new Date(now().getTime() - 7 * DAY + ERASE_EARLY_MS / 2)])
    assert.equal(await eraseEndedApplications(), 1)
    await assertFullyErased(a.id, a.reference)
  })

  test('a converted partner closed later loses the contact details too, after the grace period', async () => {
    const a = await apply()
    await end(a.id, 'CONVERTED', 40)
    assert.equal(await eraseEndedApplications(), 1)
    const r = await api.post(A(`/enquiries/${a.id}/close`), { reason: 'Partnership ended' }, { token: manager })
    assert.equal(r.status, 200, 'a kept partner may still be closed')
    assert.equal(await eraseEndedApplications(), 0, 'just closed: the clock starts again')
    await query('UPDATE partner_enquiries SET status_changed_at = $2 WHERE id = $1', [a.id, new Date(now().getTime() - 31 * DAY)])
    assert.equal(await eraseEndedApplications(), 1)
    await assertFullyErased(a.id, a.reference)
  })

  test('the maintenance run does it', async () => {
    const a = await apply()
    await end(a.id, 'CLOSED', 45)
    const out = await runMaintenance({ forceAll: true })
    assert.equal(out?.partnerApplicationsErased, 1, JSON.stringify(out))
    await assertFullyErased(a.id, a.reference)
  })

  test('the public form says how many days, and links the page that explains it', async () => {
    env.PARTNER_RETENTION_DAYS = 45
    const r = await api.get('/v1/partner-network')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.retention, { days: 45, partnersKeepContact: true })
    assert.equal(r.body.consent.privacyPath, '/partner/privacy')
    assert.doesNotMatch(r.body.consent.text, /store these details/)
  })
})

describe('in the panel', () => {
  test('a manager deletes an ended application now; operators cannot; open ones are refused; it is audited', async () => {
    const a = await apply()
    assert.equal((await api.post(A(`/enquiries/${a.id}/erase`), {}, { token: manager })).status, 409, 'still open')
    await end(a.id, 'REJECTED', 1)
    let d = await api.get(A(`/enquiries/${a.id}`), { token: manager })
    assert.equal(d.body.actions.erase, true)
    assert.ok(d.body.retention.eraseDueAt, 'the panel says when it will go')
    assert.equal((await api.get(A(`/enquiries/${a.id}`), { token: operator })).body.actions.erase, false)
    assert.equal((await api.post(A(`/enquiries/${a.id}/erase`), {}, { token: operator })).status, 403)
    assert.equal((await api.post(A(`/enquiries/${a.id}/erase`), { why: 'x' }, { token: manager })).status, 400)

    d = await api.post(A(`/enquiries/${a.id}/erase`), {}, { token: manager })
    assert.equal(d.status, 200, JSON.stringify(d.body))
    assert.ok(d.body.erasedAt)
    assert.equal(d.body.contactKept, false)
    assert.equal(d.body.name, null)
    assert.equal(d.body.contact, null)
    assert.deepEqual(d.body.sections, [])
    assert.deepEqual(d.body.documents, [])
    assert.equal(d.body.actions.erase, false)
    assert.equal(d.body.actions.reopen, false, 'an erased application is not reopened empty')
    assert.equal(d.body.retention.eraseDueAt, null)
    assert.ok(d.body.activity.some((x) => x.type === 'DETAILS_ERASED' && /by a manager/.test(x.summary)))
    await assertFullyErased(a.id, a.reference)
    assert.equal(store.size, 0, 'the stored file is gone')

    const audit = (await query(`SELECT * FROM staff_audit WHERE action = 'ERASE partner enquiry' AND target = $1`, [a.id])).rows
    assert.equal(audit.length, 1)
    assert.deepEqual(audit[0].detail, { status: 'REJECTED', keptContact: false, documents: 1 })
    assert.equal(audit[0].email, 'manager@mandimangoes.test')

    // Again: nothing left to delete. And nothing new can be added to it.
    assert.equal((await api.post(A(`/enquiries/${a.id}/erase`), {}, { token: manager })).status, 409)
    assert.equal((await api.post(A(`/enquiries/${a.id}/notes`), { note: 'hello' }, { token: manager })).status, 409)
    assert.equal((await api.post(A(`/enquiries/${a.id}/reopen`), { reason: 'Came back to us' }, { token: manager })).status, 409)
    assert.equal((await api.patch(A(`/enquiries/${a.id}`), { priority: 'HIGH' }, { token: operator })).status, 409)
  })

  test('a converted application deleted now keeps the contact details; lists, overview, proposals and export cope with erased rows', async () => {
    const a = await apply()
    const b = await apply()
    await end(a.id, 'CONVERTED', 1)
    await end(b.id, 'CLOSED', 1)
    let d = await api.post(A(`/enquiries/${a.id}/erase`), {}, { token: manager })
    assert.equal(d.status, 200)
    assert.equal(d.body.contactKept, true)
    assert.equal(d.body.mobile, a.mobile)
    assert.ok(d.body.contact.tel)
    assert.deepEqual(d.body.sections, [])
    assert.equal(d.body.actions.close, true)
    d = await api.post(A(`/enquiries/${b.id}/erase`), {}, { token: manager })
    assert.equal(d.status, 200)

    const list = await api.get(A('/enquiries'), { token: operator })
    assert.equal(list.status, 200)
    const erased = list.body.items.find((x) => x.id === b.id)
    assert.ok(erased.erasedAt)
    assert.equal(erased.name, null)
    assert.equal((await api.get(A('/enquiries?sort=name&dir=asc'), { token: operator })).status, 200)
    assert.equal((await api.get(A('/enquiries?q=Ravi'), { token: operator })).body.items.some((x) => x.id === b.id), false, 'not found by the deleted name')
    assert.equal((await api.get(A('/overview'), { token: operator })).status, 200)

    const props = await api.get(A('/product-proposals'), { token: operator })
    assert.equal(props.status, 200)
    const p = props.body.items.find((x) => x.submittedBy.enquiryId === b.id)
    assert.equal(p.productName, null)
    assert.ok(p.erasedAt)
    const pd = await api.get(A(`/product-proposals/${p.id}`), { token: manager })
    assert.equal(pd.status, 200)
    assert.deepEqual(pd.body.allowedStatuses, [])
    assert.equal((await api.patch(A(`/product-proposals/${p.id}`), { status: 'UNDER_EVALUATION' }, { token: manager })).status, 409)

    const csv = await api.raw('GET', A('/enquiries/export.csv'), { token: manager })
    assert.equal(csv.status, 200)
    const text = csv.body
    const line = text.split('\r\n').find((l) => l.startsWith(b.reference))
    assert.match(line, /\(details deleted /)
    assert.doesNotMatch(line, /Ravi|@example|\+91/)
  })
})

describe('the applicant asks for deletion', () => {
  test('deleting the shop account erases applications sent from its number, open ones too', async () => {
    const a = await apply()
    const other = await apply()
    const cust = await customerToken(api, a.mobile.slice(3))
    const r = await api.del('/v1/me', { token: cust.accessToken })
    assert.equal(r.status, 204, JSON.stringify(r.body))
    const e = await row(a.id)
    assert.equal(e.status, 'CLOSED', 'an open application is closed, not left empty')
    await assertFullyErased(a.id, a.reference)
    assert.equal((await row(other.id)).erased_at, null, 'another applicant is untouched')
    assert.equal(store.size, 1)
  })

  test('ops/erase-customer.js erases applications by number even with no shop account', async () => {
    const a = await apply()
    const logs = []
    const realLog = console.log
    console.log = (...x) => logs.push(x.join(' '))
    try {
      await eraseCustomerMain(['--phone', a.mobile.slice(3)])
      assert.equal((await row(a.id)).erased_at, null, 'not without --yes')
      await eraseCustomerMain(['--phone', a.mobile.slice(3), '--yes'])
    } finally {
      console.log = realLog
    }
    assert.match(logs.join('\n'), new RegExp(`Deleted 1 partner application\\(s\\): ${a.reference}`))
    await assertFullyErased(a.id, a.reference)
  })
})
