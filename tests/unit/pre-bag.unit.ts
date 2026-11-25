import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The shop's pre-order bag helpers (shop/pre-bag.js), without a browser: the file is a plain script whose top level only
// declares (its listeners wait for a document), so it runs in an empty context and its functions are read from there.
type Line = { sku: string; stage: string; qty: number; gift?: boolean }
type Pre = { id: string; group: { id: string; kind: string; oneDelivery?: boolean; people?: number } | null }
type Booked = { status: string; qty: number; sku: string; weekStart?: string | null; createdAt?: string }
const ctx = vm.createContext({})
vm.runInContext(readFileSync(new URL('../../shop/pre-bag.js', import.meta.url), 'utf8'), ctx)
const preBagLines = ctx.preBagLines as (lines: unknown[]) => Line[]
const preBagSame = ctx.preBagSame as (lines: Line[], q: unknown) => boolean
const preBagRows = ctx.preBagRows as (list: Pre[]) => { bag: { id: string } | null; gift?: { id: string }; lines: Pre[] }[]
const preGiftSum = ctx.preGiftSum as (lines: Booked[], kgOf: (p: Booked) => number) => { boxes: number; kg: number; week: string | null; status: string; at: string }
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))

test('the bag sends only your own boxes, one line per box and ripeness, in bag order, 20 boxes a line at most', () => {
  const lines = preBagLines([
    { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weight: 3 },
    { sku: 'KES-3', stage: 'RAW', qty: 1, gift: true },
    { sku: 'KES-3', stage: 'RAW', qty: 1 },
    { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 19 },
    { sku: 'ALP-3', stage: 'RAW', qty: 0 },
    null,
    { stage: 'RAW', qty: 1 },
  ])
  assert.deepEqual(plain(lines), [
    { sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 20 },
    { sku: 'KES-3', stage: 'RAW', qty: 1 },
  ])
  assert.deepEqual(plain(preBagLines([])), [])
  assert.deepEqual(plain(preBagLines(undefined as unknown as unknown[])), [])
})

test('a quote counts only for the very lines it was asked for', () => {
  const lines = [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2 }, { sku: 'KES-3', stage: 'RAW', qty: 1 }]
  const q = { lines: [{ sku: 'ALP-3', stage: 'SEMI_RIPE', qty: 2, weekStart: '2027-03-01' }, { sku: 'KES-3', stage: 'RAW', qty: 1, weekStart: '2027-03-08' }] }
  assert.equal(preBagSame(lines, q), true)
  assert.equal(preBagSame([{ ...lines[0], qty: 3 }, lines[1]], q), false)
  assert.equal(preBagSame([lines[1], lines[0]], q), false)
  assert.equal(preBagSame(lines.slice(0, 1), q), false)
  assert.equal(preBagSame(lines, null), false)
})

test("Your orders shows a pre-order bag's lines together under it, everything else alone, in the API's order", () => {
  const bag = { id: 'pgr_1', kind: 'BAG' }, gift = { id: 'pgr_2', kind: 'GIFT' }
  const rows = preBagRows([
    { id: 'pre_a', group: null },
    { id: 'pre_b', group: bag },
    { id: 'pre_c', group: bag },
    { id: 'pre_d', group: gift },
    { id: 'pre_e', group: bag },
  ])
  assert.deepEqual(plain(rows.map((r) => [r.bag?.id ?? null, r.lines.map((p) => p.id)])), [
    [null, ['pre_a']],
    ['pgr_1', ['pre_b', 'pre_c', 'pre_e']],
    [null, ['pre_d']],
  ])
  assert.deepEqual(plain(preBagRows([])), [])
})

test('a gift for one person is ONE row with all its boxes; a gift for several people stays one row per person', () => {
  const one = { id: 'pgr_g', kind: 'GIFT', oneDelivery: true, people: 1 }, legacy = { id: 'pgr_l', kind: 'GIFT', people: 3 }, single = { id: 'pgr_s', kind: 'GIFT', people: 1 }
  const rows = preBagRows([
    { id: 'pre_a', group: one },
    { id: 'pre_b', group: legacy },
    { id: 'pre_c', group: one },
    { id: 'pre_d', group: legacy },
    { id: 'pre_e', group: single },
    { id: 'pre_f', group: one },
  ])
  assert.deepEqual(plain(rows.map((r) => [r.bag?.id ?? null, r.gift?.id ?? null, r.lines.map((p) => p.id)])), [
    [null, 'pgr_g', ['pre_a', 'pre_c', 'pre_f']],
    [null, null, ['pre_b']],
    [null, null, ['pre_d']],
    [null, 'pgr_s', ['pre_e']],
  ])
})

test("a one-person gift's row: boxes, kg, the latest week, one status, booked when its first box was", () => {
  const kg = (p: Booked) => Number(p.sku.split('-')[1])
  const lines: Booked[] = [
    { status: 'BOOKED', qty: 1, sku: 'MIX-3', weekStart: '2027-03-01', createdAt: '2026-11-25T14:52:16.242Z' },
    { status: 'BOOKED', qty: 2, sku: 'ALP-3', weekStart: '2027-03-08', createdAt: '2026-11-25T14:52:16.269Z' },
    { status: 'BOOKED', qty: 1, sku: 'ALP-5', weekStart: '2027-03-01', createdAt: '2026-11-25T14:52:16.287Z' },
  ]
  assert.deepEqual(plain(preGiftSum(lines, kg)), { boxes: 4, kg: 14, week: '2027-03-08', status: 'BOOKED', at: '2026-11-25T14:52:16.242Z' })
  // A cancelled box is left out of the count; one unpaid line makes the gift unpaid; all cancelled: cancelled, counted as booked.
  assert.deepEqual(plain(preGiftSum([{ ...lines[0], status: 'CANCELLED' }, { ...lines[1], status: 'PAYMENT_PENDING' }], kg)), { boxes: 2, kg: 6, week: '2027-03-08', status: 'PAYMENT_PENDING', at: '2026-11-25T14:52:16.242Z' })
  assert.equal(preGiftSum(lines.map((p) => ({ ...p, status: 'CANCELLED' })), kg).status, 'CANCELLED')
  assert.equal(preGiftSum(lines.map((p) => ({ ...p, status: 'CANCELLED' })), kg).boxes, 4)
  assert.equal(preGiftSum(lines.map((p) => ({ ...p, status: 'CONVERTED' })), kg).status, 'CONVERTED')
})
