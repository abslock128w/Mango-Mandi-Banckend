import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXPORT_MAX_DAYS, daysCovered, rangeProblem } from '../../src/exportRange.ts'

// The panel's check of a CSV export's dates (docs/trust.md); the API checks the same.

test('both ends count, across months and a leap day', () => {
  assert.equal(daysCovered('2026-10-01', '2026-10-01'), 1)
  assert.equal(daysCovered('2026-10-01', '2026-10-31'), 31)
  assert.equal(daysCovered('2028-02-28', '2028-03-01'), 3)
})

test('at most 92 days, in order, both given', () => {
  assert.equal(EXPORT_MAX_DAYS, 92)
  assert.equal(rangeProblem('2026-10-01', '2026-12-31'), null, '92 days')
  assert.match(rangeProblem('2026-10-01', '2027-01-01') ?? '', /at most 92 days/)
  assert.match(rangeProblem('2026-10-31', '2026-10-01') ?? '', /after the end/)
  assert.match(rangeProblem('', '2026-10-01') ?? '', /both dates/)
  assert.match(rangeProblem('1/10/2026', '2026-10-01') ?? '', /as days/)
})
