import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The shop's pre-order bag helpers (shop/pre-bag.js), without a browser: the file is a plain script whose top level only
// declares (its listeners wait for a document), so it runs in an empty context and its functions are read from there.
type Line = { sku: string; stage: string; qty: number; gift?: boolean }
type Pre = { id: string; group: { id: string; kind: string } | null }
const ctx = vm.createContext({})
vm.runInContext(readFileSync(new URL('../../shop/pre-bag.js', import.meta.url), 'utf8'), ctx)
const preBagLines = ctx.preBagLines as (lines: unknown[]) => Line[]
const preBagSame = ctx.preBagSame as (lines: Line[], q: unknown) => boolean
const preBagRows = ctx.preBagRows as (list: Pre[]) => { bag: { id: string } | null; lines: Pre[] }[]
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
