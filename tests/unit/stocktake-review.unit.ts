import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIST_EVERY_BOX_UP_TO, reviewBody } from '../../src/warehouse/stocktakeReview.ts'

// A stocktake review request: every box listed when there are few, only the
// exceptions to `rest` when there are many (the API caps each list at 2,000
// and a request body at 100 kB).

test('a small review lists every box', () => {
  const body = reviewBody(['a', 'b', 'c'], { a: 'missing', b: 'keep', c: 'missing' }, '  Looked twice ')
  assert.deepEqual(body, { missing: ['a', 'c'], keep: ['b'], note: 'Looked twice' })
})

test('a big review sends the common choice as rest and lists only the others', () => {
  const ids = Array.from({ length: 3000 }, (_, i) => `box-${i}`)
  const choice = Object.fromEntries(ids.map((id, i) => [id, i < 2990 ? 'missing' : 'keep'] as const))
  const body = reviewBody(ids, choice)
  assert.equal(body.rest, 'missing')
  assert.deepEqual(body.missing, [])
  assert.deepEqual(body.keep, ids.slice(2990))
  assert.ok(JSON.stringify(body).length < 100_000)

  const mostlyKept = reviewBody(ids, Object.fromEntries(ids.map((id, i) => [id, i < 5 ? 'missing' : 'keep'] as const)))
  assert.deepEqual([mostlyKept.rest, mostlyKept.missing, mostlyKept.keep], ['keep', ids.slice(0, 5), []])
})

test('the switch to rest happens only above the listing limit', () => {
  const ids = Array.from({ length: LIST_EVERY_BOX_UP_TO }, (_, i) => `b${i}`)
  const all = Object.fromEntries(ids.map((id) => [id, 'missing'] as const))
  assert.equal(reviewBody(ids, all).rest, undefined)
  assert.equal(reviewBody([...ids, 'one-more'], { ...all, 'one-more': 'missing' }).rest, 'missing')
})
