import './setup-env.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES, rulesSchema, storedRulesSchema } from '../src/config.js'
import { keepsPromise, SALE_STAGES, saleStage, stageFor } from '../src/stage.js'

const batch = { variety: 'Alphonso', pluckedOn: '2026-10-01' }
const on = (age) => `2026-10-${String(1 + age).padStart(2, '0')}`
const qcAt = (age, ripenessRating) => ({ ripenessRating, loggedAt: `${on(age)}T03:00:00Z` })

// The owner's rule: the day of pluck is age 0, at the warehouse at 1, raw 1–3, semi-ripe 4–7, spoilt from 8.
test('default windows: raw 1-3, semi-ripe 4-7, nothing at 0 or from 8, never ripe', () => {
  const got = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((a) => stageFor(DEFAULT_RULES, batch, on(a), null))
  assert.deepEqual(got, [null, 'RAW', 'RAW', 'RAW', 'SEMI_RIPE', 'SEMI_RIPE', 'SEMI_RIPE', 'SEMI_RIPE', null, null])
  assert.equal(DEFAULT_RULES.transitDays, 1)
  assert.equal(DEFAULT_RULES.maxSellableAge, 7)
  assert.equal(DEFAULT_RULES.retireAge, 8)
})

test('a fast ripener (QC ripe at age 5) shifts one day ahead, but is never sold ripe', () => {
  const qc = qcAt(5, 'RIPE')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(5), qc), 'SEMI_RIPE')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(3), qc), 'SEMI_RIPE', 'age 3 + 1 is semi-ripe')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(2), qc), 'RAW')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(7), qc), 'SEMI_RIPE', 'past the last window, inside the 7-day cap: the last stage sold')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(8), qc), null, 'the cap never moves')
})

test('QC ripe at age 7: still semi-ripe on day 7, and nothing on day 8', () => {
  const qc = qcAt(7, 'RIPE')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(7), qc), 'SEMI_RIPE')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(8), qc), null)
})

test('a slow ripener (QC raw at age 4) shifts one day back', () => {
  const qc = qcAt(4, 'RAW')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(4), qc), 'RAW')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(1), qc), null, 'age 1 - 1 is the day of pluck')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(2), qc), 'RAW')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(5), qc), 'SEMI_RIPE')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(7), qc), 'SEMI_RIPE')
})

test('QC shift is clamped to one day', () => {
  const qc = qcAt(1, 'RIPE') // expected raw, two stages ahead
  assert.equal(stageFor(DEFAULT_RULES, batch, on(1), qc), 'RAW')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(3), qc), 'SEMI_RIPE')
})

test('raw on the day of pluck is on schedule; semi-ripe at 0 is a fast ripener', () => {
  assert.equal(stageFor(DEFAULT_RULES, batch, on(0), qcAt(0, 'RAW')), null)
  assert.equal(stageFor(DEFAULT_RULES, batch, on(1), qcAt(0, 'RAW')), 'RAW')
  assert.equal(stageFor(DEFAULT_RULES, batch, on(0), qcAt(0, 'SEMI_RIPE')), 'RAW')
})

const OLD_PROFILE = [
  { stage: 'RAW', minAge: 3, maxAge: 3 },
  { stage: 'SEMI_RIPE', minAge: 4, maxAge: 5 },
  { stage: 'RIPE', minAge: 6, maxAge: 7 },
]

test('a manager may save only raw and semi-ripe windows; an older version with a ripe window still loads', () => {
  assert.deepEqual(SALE_STAGES, ['RAW', 'SEMI_RIPE'])
  assert.equal(rulesSchema.safeParse(DEFAULT_RULES).success, true)
  const old = { ...DEFAULT_RULES, transitDays: 2, stageProfiles: { default: OLD_PROFILE } }
  const r = rulesSchema.safeParse(old)
  assert.equal(r.success, false)
  assert.match(r.error.issues[0].message, /RAW or SEMI_RIPE/)
  assert.deepEqual(r.error.issues[0].path, ['stageProfiles', 'default', 2, 'stage'])
  // A variety's own profile is held to the same rule.
  assert.equal(rulesSchema.safeParse({ ...DEFAULT_RULES, stageProfiles: { ...DEFAULT_RULES.stageProfiles, Kesar: [{ stage: 'RIPE', minAge: 5, maxAge: 7 }] } }).success, false)
  assert.equal(storedRulesSchema.safeParse(old).success, true)
  // Read back, the old rules still sell as they did (until migration 063 adds the new version).
  assert.equal(stageFor({ ...DEFAULT_RULES, stageProfiles: { default: OLD_PROFILE } }, batch, on(6), null), 'RIPE')
})

test('boxes promised ripe are honoured by a batch that is semi-ripe on the day, and new sales of ripe are semi-ripe', () => {
  assert.equal(keepsPromise('RIPE', 'SEMI_RIPE'), true)
  assert.equal(keepsPromise('RIPE', 'RIPE'), true)
  assert.equal(keepsPromise('RIPE', 'RAW'), false)
  assert.equal(keepsPromise('SEMI_RIPE', 'SEMI_RIPE'), true)
  assert.equal(keepsPromise('SEMI_RIPE', 'RAW'), false)
  assert.equal(keepsPromise('RAW', 'SEMI_RIPE'), false)
  assert.equal(saleStage('RIPE'), 'SEMI_RIPE')
  assert.equal(saleStage('RAW'), 'RAW')
})
