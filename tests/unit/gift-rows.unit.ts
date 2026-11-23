import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The gifting page's plain helpers (shop/gift-rows.js): a browser script with no imports, run here in a bare context.
type Person = { name: string; phone: string; ask: boolean | null; address: string; pincode: string; sku: string; stage: string; own: boolean }
type Helpers = {
  readGiftDraft: (json: string | null) => null | { box: { sku: string; stage: string } | null; note: string; people: Person[]; sender: string; wantPay: boolean }
  giftDraftJSON: (g: Record<string, unknown>) => string
  giftPhone: (s: string) => string
  giftPhoneWhy: (s: string) => string
  giftWeekSpan: (weeks: (string | null)[], fmt: (d: string) => string) => string
  giftGroupRecipient: (r: Person, weekStart: string, ask: boolean, note: string) => Record<string, unknown>
  giftBarLine: (boxes: number, when: string) => string
}
const code = readFileSync(new URL('../../shop/gift-rows.js', import.meta.url), 'utf8')
const h = vm.runInNewContext(`${code}\n;({ readGiftDraft, giftDraftJSON, giftPhone, giftPhoneWhy, giftWeekSpan, giftGroupRecipient, giftBarLine })`) as Helpers
const fmt = (d: string) => ({ '2027-03-01': '1 Mar', '2027-03-08': '8 Mar' })[d] ?? d

test('a v3 draft reads back as it was saved', () => {
  const recipients = [
    { name: 'Asha', phone: '98765 43210', ask: true, address: '', pincode: '', sku: 'ALP-3', stage: 'SEMI_RIPE', own: false },
    { name: 'Ravi', phone: '9123456780', ask: false, address: '4 Lake View, Indiranagar', pincode: '560038', sku: 'KES-3', stage: 'RAW', own: true },
  ]
  const json = h.giftDraftJSON({ box: { sku: 'ALP-3', stage: 'SEMI_RIPE' }, note: 'Happy summer', recipients, date: null, slotId: null, sender: 'Meera', business: false, bizName: '', gstin: '', wantPay: true })
  const d = h.readGiftDraft(json)
  assert.ok(d)
  assert.deepEqual(JSON.parse(JSON.stringify(d.people)), recipients)
  assert.equal(d.note, 'Happy summer')
  assert.equal(d.sender, 'Meera')
  assert.equal(d.wantPay, true)
})

test('an older draft (v2) keeps typed addresses as "I will enter it", and a person with none is undecided', () => {
  const d = h.readGiftDraft(JSON.stringify({ v: 2, box: { sku: 'MIX-3', stage: 'RAW', qty: 3 }, note: 'Hi', recipients: [
    { name: 'A', phone: '9876543210', address: '1 Road, Area', pincode: '560001', qty: 2, saved: true },
    { name: 'B', phone: '9876543211', address: '', pincode: '' },
  ] }))
  assert.ok(d)
  assert.deepEqual(JSON.parse(JSON.stringify(d.box)), { sku: 'MIX-3', stage: 'RAW' })
  assert.equal(d.people[0].ask, false)
  assert.equal(d.people[1].ask, null)
})

test('an oldest draft (v1) takes the first box for everyone and a shared note, and drops empty people', () => {
  const d = h.readGiftDraft(JSON.stringify({ recipients: [
    { name: 'A', phone: '9876543210', address: '1 Road', pincode: '560001', sku: 'ALP-3', stage: 'SEMI_RIPE', note: 'Enjoy' },
    { name: '', phone: '', address: '', pincode: '', sku: 'ALP-3', note: 'Enjoy' },
    { name: 'C', phone: '9876543212', address: '2 Road', pincode: '560002', sku: 'KES-3', stage: 'RAW', note: 'Enjoy' },
  ] }))
  assert.ok(d)
  assert.equal(d.people.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(d.box)), { sku: 'ALP-3', stage: 'SEMI_RIPE' })
  assert.equal(d.people[1].own, true)
  assert.equal(d.note, 'Enjoy')
})

test('no draft, a broken one, or one with nobody: nothing', () => {
  assert.equal(h.readGiftDraft(null), null)
  assert.equal(h.readGiftDraft('{not json'), null)
  assert.equal(h.readGiftDraft(JSON.stringify({ v: 3, recipients: [] })), null)
})

test('WhatsApp numbers: +91, spaces and a leading 0 are taken off; a short or landline number is refused', () => {
  assert.equal(h.giftPhone('+91 98765 43210'), '9876543210')
  assert.equal(h.giftPhone('09876543210'), '9876543210')
  assert.equal(h.giftPhoneWhy(''), 'Enter their WhatsApp number')
  assert.equal(h.giftPhoneWhy('98765'), 'Enter a 10-digit mobile number')
  assert.equal(h.giftPhoneWhy('2234567890'), 'Enter a 10-digit mobile number')
  assert.equal(h.giftPhoneWhy('+91 98765 43210'), '')
})

test('the week words: one week, a span when people differ, nothing when unknown', () => {
  assert.equal(h.giftWeekSpan(['2027-03-01', '2027-03-01'], fmt), 'week of 1 Mar')
  assert.equal(h.giftWeekSpan(['2027-03-08', null, '2027-03-01'], fmt), 'weeks of 1 Mar – 8 Mar')
  assert.equal(h.giftWeekSpan([], fmt), '')
  assert.equal(h.giftBarLine(2, 'week of 1 Mar'), '2 boxes · Arrives week of 1 Mar')
  assert.equal(h.giftBarLine(1, ''), '1 box')
})

test('a pre-order recipient: one box; the address, or askAddress with no address at all', () => {
  const r: Person = { name: ' Asha ', phone: '+91 98765 43210', ask: true, address: ' 4 Lake View ', pincode: ' 560038 ', sku: 'ALP-3', stage: 'SEMI_RIPE', own: false }
  assert.deepEqual(JSON.parse(JSON.stringify(h.giftGroupRecipient(r, '2027-03-01', true, 'Happy summer'))), {
    sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: '2027-03-01', askAddress: true,
    gift: { recipientName: 'Asha', recipientPhone: '9876543210', message: 'Happy summer' },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(h.giftGroupRecipient(r, '2027-03-01', false, ''))), {
    sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1, weekStart: '2027-03-01', pincode: '560038', address: '4 Lake View',
    gift: { recipientName: 'Asha', recipientPhone: '9876543210' },
  })
})
