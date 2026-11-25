import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The gifting page's plain helpers (shop/gift-rows.js): a browser script with no imports, run here in a bare context.
type Person = { name: string; phone: string; ask: boolean | null; address: string; landmark: string; pincode: string }
type Line = { sku: string; stage: string; qty: number }
type Helpers = {
  readGiftDraft: (json: string | null) => null | { lines: Line[]; person: Person; note: string; sender: string; wantPay: boolean }
  giftDraftJSON: (g: Record<string, unknown>) => string
  giftPhone: (s: string) => string
  giftPhoneWhy: (s: string) => string
  giftWeekSpan: (weeks: (string | null)[], fmt: (d: string) => string) => string
  giftAddLine: (lines: Line[], sku: string, stage: string, delta: number, max?: number) => { lines: Line[]; capped: boolean }
  giftBoxCount: (lines: Line[]) => number
  giftMergeLines: (lines: unknown[], max?: number) => Line[]
  giftTogetherWeek: (lines: Line[], daysOf: (sku: string) => { weekStart: string; remaining: number }[], varietyOf: (sku: string) => string, need: (q: number, sku: string) => number) => string | null
  giftGroupLine: (p: Person, l: Line, weekStart: string, ask: boolean, note: string) => Record<string, unknown>
  giftSeasonRecipient: (p: Person, lines: Line[], note: string) => Record<string, unknown>
  giftBarLine: (boxes: number, kg: number) => string
  giftBoxWords: (b: null | { qty?: number; name?: string; stage?: string }, stageWord: (s: string) => string) => string
  giftResendAt: (l: null | { resendAfter?: number | string | null }, now?: number) => Date | null
}
const code = readFileSync(new URL('../../shop/gift-rows.js', import.meta.url), 'utf8')
const h = vm.runInNewContext(`${code}\n;({ readGiftDraft, giftDraftJSON, giftPhone, giftPhoneWhy, giftWeekSpan, giftAddLine, giftBoxCount, giftMergeLines, giftTogetherWeek, giftGroupLine, giftSeasonRecipient, giftBarLine, giftBoxWords, giftResendAt })`) as Helpers
const fmt = (d: string) => ({ '2027-03-01': '1 Mar', '2027-03-08': '8 Mar' })[d] ?? d
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const RAVI: Person = { name: ' Ravi ', phone: '+91 98765 43210', ask: false, address: ' 4 Lake View, Indiranagar ', landmark: ' near Sai Baba temple ', pincode: ' 560038 ' }

test('a v4 draft (one person, many boxes) reads back as it was saved', () => {
  const lines = [{ sku: 'MIX-3', stage: 'SEMI_RIPE', qty: 1 }, { sku: 'ALP-3', stage: 'RAW', qty: 2 }]
  const person = { name: 'Ravi', phone: '9876543210', ask: false, address: '4 Lake View', landmark: 'near the temple', pincode: '560038' }
  const json = h.giftDraftJSON({ lines, person, note: 'Happy summer', date: null, slotId: null, sender: 'Meera', business: false, bizName: '', gstin: '', wantPay: true })
  const d = h.readGiftDraft(json)
  assert.ok(d)
  assert.deepEqual(plain(d.lines), lines)
  assert.deepEqual(plain(d.person), person)
  assert.equal(d.note, 'Happy summer')
  assert.equal(d.sender, 'Meera')
  assert.equal(d.wantPay, true)
})

test('an older draft for several people (v3, v2, v1) becomes a gift for its first person, with their box', () => {
  const v3 = h.readGiftDraft(JSON.stringify({ v: 3, box: { sku: 'ALP-3', stage: 'SEMI_RIPE' }, note: 'Hi', recipients: [
    { name: '', phone: '', address: '', pincode: '' },
    { name: 'Asha', phone: '9876543210', ask: true, address: '', pincode: '', sku: 'ALP-3', stage: 'SEMI_RIPE', own: false },
    { name: 'Ravi', phone: '9123456780', ask: false, address: '4 Lake View', pincode: '560038', sku: 'KES-3', stage: 'RAW', own: true },
  ] }))
  assert.ok(v3)
  assert.equal(v3.person.name, 'Asha')
  assert.equal(v3.person.ask, true)
  assert.deepEqual(plain(v3.lines), [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 1 }])
  assert.equal(v3.note, 'Hi')
  const v2 = h.readGiftDraft(JSON.stringify({ v: 2, box: { sku: 'MIX-3', stage: 'RAW', qty: 3 }, recipients: [{ name: 'A', phone: '9876543210', address: '1 Road, Area', pincode: '560001' }] }))
  assert.ok(v2)
  assert.equal(v2.person.ask, false)
  assert.deepEqual(plain(v2.lines), [{ sku: 'MIX-3', stage: 'RAW', qty: 1 }])
  const v1 = h.readGiftDraft(JSON.stringify({ recipients: [
    { name: 'A', phone: '9876543210', address: '1 Road', pincode: '560001', sku: 'KES-3', stage: 'RAW', note: 'Enjoy' },
    { name: 'C', phone: '9876543212', address: '2 Road', pincode: '560002', sku: 'ALP-3', note: 'Enjoy' },
  ] }))
  assert.ok(v1)
  assert.deepEqual(plain(v1.lines), [{ sku: 'KES-3', stage: 'RAW', qty: 1 }])
  assert.equal(v1.note, 'Enjoy')
})

test('no draft, a broken one, or one with nothing in it: nothing', () => {
  assert.equal(h.readGiftDraft(null), null)
  assert.equal(h.readGiftDraft('{not json'), null)
  assert.equal(h.readGiftDraft(JSON.stringify({ v: 3, recipients: [] })), null)
  assert.equal(h.readGiftDraft(JSON.stringify({ v: 4, lines: [], person: {} })), null)
})

test('box lines: one line per box and ripeness, a stepper to 0 removes it, and never more than 20 boxes', () => {
  let r = h.giftAddLine([], 'MIX-3', 'SEMI_RIPE', 1)
  r = h.giftAddLine(r.lines, 'ALP-3', 'SEMI_RIPE', 1)
  r = h.giftAddLine(r.lines, 'ALP-3', 'SEMI_RIPE', 1)
  // The same variety in another size or ripeness is its own line.
  r = h.giftAddLine(r.lines, 'ALP-5', 'SEMI_RIPE', 1)
  r = h.giftAddLine(r.lines, 'ALP-3', 'RAW', 1)
  assert.deepEqual(plain(r.lines), [
    { sku: 'MIX-3', stage: 'SEMI_RIPE', qty: 1 }, { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }, { sku: 'ALP-5', stage: 'SEMI_RIPE', qty: 1 }, { sku: 'ALP-3', stage: 'RAW', qty: 1 },
  ])
  assert.equal(h.giftBoxCount(r.lines), 5)
  r = h.giftAddLine(r.lines, 'MIX-3', 'SEMI_RIPE', -1)
  assert.equal(r.lines.some((l) => l.sku === 'MIX-3'), false)
  const full = h.giftAddLine(r.lines, 'KES-3', 'SEMI_RIPE', 20)
  assert.equal(h.giftBoxCount(full.lines), 20)
  assert.equal(full.capped, true)
  assert.equal(h.giftAddLine(full.lines, 'KES-3', 'SEMI_RIPE', 1).capped, true)
  assert.equal(h.giftBoxCount(h.giftMergeLines([{ sku: 'A', qty: 15 }, { sku: 'A', qty: 9 }, { sku: 'B', qty: 3 }])), 20)
})

test('the whole gift arrives together, in the week of the box that is ready last', () => {
  const weeks: Record<string, { weekStart: string; remaining: number }[]> = {
    Alphonso: [{ weekStart: '2027-03-01', remaining: 6 }, { weekStart: '2027-03-08', remaining: 140 }],
    Kesar: [{ weekStart: '2027-03-01', remaining: 140 }, { weekStart: '2027-03-08', remaining: 140 }, { weekStart: '2027-03-15', remaining: 140 }],
    Himsagar: [{ weekStart: '2027-03-08', remaining: 2 }, { weekStart: '2027-03-15', remaining: 140 }],
  }
  const variety = (sku: string) => ({ ALP: 'Alphonso', KES: 'Kesar', HIM: 'Himsagar' })[sku.slice(0, 3)] ?? sku
  const daysOf = (sku: string) => weeks[variety(sku)] ?? []
  const need = (q: number, sku: string) => q * Number(sku.split('-')[1])
  assert.equal(h.giftTogetherWeek([{ sku: 'KES-3', stage: 'RAW', qty: 1 }], daysOf, variety, need), '2027-03-01')
  // Alphonso 3 kg fits the first week alone, 3 kg + 5 kg together do not: the whole gift goes in the second.
  assert.equal(h.giftTogetherWeek([{ sku: 'KES-3', stage: 'RAW', qty: 1 }, { sku: 'ALP-3', stage: 'RAW', qty: 1 }], daysOf, variety, need), '2027-03-01')
  assert.equal(h.giftTogetherWeek([{ sku: 'KES-3', stage: 'RAW', qty: 1 }, { sku: 'ALP-3', stage: 'RAW', qty: 1 }, { sku: 'ALP-5', stage: 'RAW', qty: 1 }], daysOf, variety, need), '2027-03-08')
  // Himsagar only from the third week: everything waits for it.
  assert.equal(h.giftTogetherWeek([{ sku: 'KES-3', stage: 'RAW', qty: 1 }, { sku: 'HIM-3', stage: 'RAW', qty: 1 }], daysOf, variety, need), '2027-03-15')
  assert.equal(h.giftTogetherWeek([{ sku: 'HIM-3', stage: 'RAW', qty: 100 }], daysOf, variety, need), null)
  assert.equal(h.giftTogetherWeek([], daysOf, variety, need), null)
})

test('WhatsApp numbers: +91, spaces and a leading 0 are taken off; a short or landline number is refused', () => {
  assert.equal(h.giftPhone('+91 98765 43210'), '9876543210')
  assert.equal(h.giftPhone('09876543210'), '9876543210')
  assert.equal(h.giftPhoneWhy(''), 'Enter their WhatsApp number')
  assert.equal(h.giftPhoneWhy('98765'), 'Enter a 10-digit mobile number')
  assert.equal(h.giftPhoneWhy('2234567890'), 'Enter a 10-digit mobile number')
  assert.equal(h.giftPhoneWhy('+91 98765 43210'), '')
})

test('the week words: one week, a span, nothing when unknown; the bar line', () => {
  assert.equal(h.giftWeekSpan(['2027-03-01', '2027-03-01'], fmt), 'week of 1 Mar')
  assert.equal(h.giftWeekSpan(['2027-03-08', null, '2027-03-01'], fmt), 'weeks of 1 Mar – 8 Mar')
  assert.equal(h.giftWeekSpan([], fmt), '')
  assert.equal(h.giftBarLine(3, 9), '3 boxes · 9 kg')
  assert.equal(h.giftBarLine(1, 0), '1 box')
})

test('the bodies: each box line of a pre-order with the one week, and the one recipient in season with every line', () => {
  const l = { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }
  assert.deepEqual(plain(h.giftGroupLine(RAVI, l, '2027-03-08', false, 'Happy summer')), {
    sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weekStart: '2027-03-08', pincode: '560038', address: '4 Lake View, Indiranagar', landmark: 'near Sai Baba temple',
    gift: { recipientName: 'Ravi', recipientPhone: '9876543210', message: 'Happy summer' },
  })
  assert.deepEqual(plain(h.giftGroupLine({ ...RAVI, landmark: '' }, l, '2027-03-08', true, '')), {
    sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weekStart: '2027-03-08', askAddress: true, gift: { recipientName: 'Ravi', recipientPhone: '9876543210' },
  })
  assert.deepEqual(plain(h.giftSeasonRecipient({ ...RAVI, landmark: ' ' }, [l, { sku: 'MIX-3', stage: 'RAW', qty: 1 }], '')), {
    name: 'Ravi', phone: '9876543210', address: '4 Lake View, Indiranagar', pincode: '560038',
    lines: [l, { sku: 'MIX-3', stage: 'RAW', qty: 1 }], note: null,
  })
})

test('the recipient sees the box in words, without a price', () => {
  const word = (st: string) => ({ RAW: 'Raw', SEMI_RIPE: 'Semi-ripe' })[st] ?? st
  assert.equal(h.giftBoxWords({ qty: 1, name: 'Alphonso gift box', stage: 'SEMI_RIPE' }, word), 'Alphonso gift box · Semi-ripe')
  assert.equal(h.giftBoxWords({ qty: 2, name: 'Kesar gift box', stage: 'RAW' }, word), '2 × Kesar gift box · Raw')
  assert.equal(h.giftBoxWords(null, word), 'A box of mangoes')
})

test('when a link may go again: a time, seconds from now, or not said', () => {
  const now = Date.parse('2027-02-20T10:00:00Z')
  assert.equal(h.giftResendAt({ resendAfter: 600 }, now)?.toISOString(), '2027-02-20T10:10:00.000Z')
  assert.equal(h.giftResendAt({ resendAfter: '2027-02-20T10:05:00Z' }, now)?.toISOString(), '2027-02-20T10:05:00.000Z')
  assert.equal(h.giftResendAt({ resendAfter: null }, now), null)
  assert.equal(h.giftResendAt({ resendAfter: 'soon' }, now), null)
  assert.equal(h.giftResendAt(null, now), null)
})
