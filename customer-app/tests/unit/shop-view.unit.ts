import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_VIEW, applyView, isFiltered, readView, varietiesOf, writeView } from '../../src/shop-view.ts'

// Sort and filter on the shop's home page (SHOP_SORT_FILTER), without a browser.

const BOXES = [
  { sku: 'ALP-3', name: 'Alphonso 3kg Box', variety: 'Alphonso', price: 189900 },
  { sku: 'KES-3', name: 'Kesar 3kg Box', variety: 'Kesar', price: 159900 },
  { sku: 'ALP-5', name: 'Alphonso 5kg Box', variety: 'Alphonso', price: 299900 },
  { sku: 'BAN-3', name: 'Banganapalli 3kg Box', variety: 'Banganapalli', price: 129900 },
]
type Box = (typeof BOXES)[number]
const STOCK: Record<string, { stage: 'RAW' | 'SEMI_RIPE' | 'RIPE'; qty: number }[]> = {
  'ALP-3': [{ stage: 'RAW', qty: 0 }, { stage: 'SEMI_RIPE', qty: 2 }, { stage: 'RIPE', qty: 0 }],
  'KES-3': [{ stage: 'RAW', qty: 0 }, { stage: 'SEMI_RIPE', qty: 0 }, { stage: 'RIPE', qty: 4 }],
  'ALP-5': [{ stage: 'RAW', qty: 0 }, { stage: 'SEMI_RIPE', qty: 0 }, { stage: 'RIPE', qty: 0 }],
  'BAN-3': [{ stage: 'RAW', qty: 1 }, { stage: 'SEMI_RIPE', qty: 0 }, { stage: 'RIPE', qty: 1 }],
}
const RATING: Record<string, number | null> = { Alphonso: 4.6, Kesar: null, Banganapalli: 4.8 }
const opts = { stages: (b: Box) => STOCK[b.sku], rating: (b: Box) => RATING[b.variety] ?? null }
const skus = (view: Partial<typeof DEFAULT_VIEW>, o: Parameters<typeof applyView<Box>>[2] = opts) => applyView(BOXES, { ...DEFAULT_VIEW, ...view }, o).map((b) => b.sku)

test('the address holds the view; unknown values fall back to the default', () => {
  assert.deepEqual(readView(new URLSearchParams('')), DEFAULT_VIEW)
  assert.deepEqual(readView(new URLSearchParams('sort=price-high&variety=Kesar&ripe=RIPE&stock=1&q=kes')), {
    sort: 'price-high', variety: 'Kesar', ripeness: 'RIPE', inStock: true,
  })
  assert.deepEqual(readView(new URLSearchParams('sort=cheapest&ripe=ROTTEN&stock=yes&variety=%20')), DEFAULT_VIEW)
})

test('writing a view keeps the search and leaves defaults out of the address', () => {
  const p = writeView(new URLSearchParams('q=alp&where=1'), { sort: 'name', variety: 'Alphonso', ripeness: null, inStock: true })
  assert.equal(p.toString(), 'q=alp&where=1&sort=name&variety=Alphonso&stock=1')
  assert.equal(writeView(p, DEFAULT_VIEW).toString(), 'q=alp&where=1')
  assert.equal(isFiltered(DEFAULT_VIEW), false)
  assert.equal(isFiltered({ ...DEFAULT_VIEW, sort: 'name' }), false)
  assert.equal(isFiltered({ ...DEFAULT_VIEW, inStock: true }), true)
})

test('sorts by price either way, by name, and by rating with unrated boxes last', () => {
  assert.deepEqual(skus({}), ['ALP-3', 'KES-3', 'ALP-5', 'BAN-3'])
  assert.deepEqual(skus({ sort: 'price-low' }), ['BAN-3', 'KES-3', 'ALP-3', 'ALP-5'])
  assert.deepEqual(skus({ sort: 'price-high' }), ['ALP-5', 'ALP-3', 'KES-3', 'BAN-3'])
  assert.deepEqual(skus({ sort: 'name' }), ['ALP-3', 'ALP-5', 'BAN-3', 'KES-3'])
  assert.deepEqual(skus({ sort: 'rating' }), ['BAN-3', 'ALP-3', 'ALP-5', 'KES-3'])
})

test('filters by variety, by a ripeness in stock and by any stock; before a pincode stock filters do nothing', () => {
  assert.deepEqual(skus({ variety: 'alphonso' }), ['ALP-3', 'ALP-5'])
  assert.deepEqual(skus({ ripeness: 'RIPE' }), ['KES-3', 'BAN-3'])
  assert.deepEqual(skus({ ripeness: 'SEMI_RIPE', sort: 'price-low' }), ['ALP-3'])
  assert.deepEqual(skus({ inStock: true }), ['ALP-3', 'KES-3', 'BAN-3'])
  assert.deepEqual(skus({ inStock: true, ripeness: 'RAW' }), ['BAN-3'])
  assert.deepEqual(skus({ inStock: true, ripeness: 'RAW' }, { rating: opts.rating }), ['ALP-3', 'KES-3', 'ALP-5', 'BAN-3'])
  assert.deepEqual(varietiesOf(BOXES), ['Alphonso', 'Kesar', 'Banganapalli'])
})
