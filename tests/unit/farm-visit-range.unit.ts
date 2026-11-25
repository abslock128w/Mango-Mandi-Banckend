import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// The farm visit's range calendar rules (shop/bulk.js fvRangePick, fvDayState, fvMonthWeeks, fvCalMove; CR2-01): bulk.js is
// a browser script, so it runs here in a bare context with the few page globals its top level touches stubbed out.
type Visit = { from: string; to: string; pick: 'from' | 'to' }
type Lim = { earliest: string; last: string }
const noop = () => {}
const ctx = vm.createContext({
  PAGES: [], adder: {}, window: { addEventListener: noop }, document: { addEventListener: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
})
vm.runInContext(readFileSync(new URL('../../shop/bulk.js', import.meta.url), 'utf8'), ctx)
const fvRangePick = ctx.fvRangePick as (v: Visit, day: string, lim: Lim) => Visit
const fvDayState = ctx.fvDayState as (day: string, v: Visit, lim: Lim) => { off: boolean; from: boolean; to: boolean }
const fvMonthWeeks = ctx.fvMonthWeeks as (month: string) => (string | null)[][]
const fvCalMove = ctx.fvCalMove as (day: string, key: string) => string | null
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const LIM: Lim = { earliest: '2026-11-25', last: '' }
const NONE: Visit = { from: '', to: '', pick: 'from' }

test('the first tap is Day 1 and fills Day 2 with the next day', () => {
  assert.deepEqual(plain(fvRangePick(NONE, '2026-11-26', LIM)), { from: '2026-11-26', to: '2026-11-27', pick: 'to' })
  // Across a month's end.
  assert.deepEqual(plain(fvRangePick(NONE, '2026-11-30', LIM)), { from: '2026-11-30', to: '2026-12-01', pick: 'to' })
  // The season's last day: Day 2 is Day 1 (a 1-day visit).
  assert.deepEqual(plain(fvRangePick(NONE, '2027-05-31', { earliest: LIM.earliest, last: '2027-05-31' })), { from: '2027-05-31', to: '2027-05-31', pick: 'to' })
})

test('a tap on Day 1 again, or on Day 2 itself, makes a 1-day visit; the day after Day 1 makes it 2 days again', () => {
  const two = fvRangePick(NONE, '2026-11-26', LIM)
  const oneA = fvRangePick(two, '2026-11-26', LIM)
  assert.deepEqual(plain(oneA), { from: '2026-11-26', to: '2026-11-26', pick: 'to' })
  assert.deepEqual(plain(fvRangePick(two, '2026-11-27', LIM)), { from: '2026-11-26', to: '2026-11-26', pick: 'to' })
  assert.deepEqual(plain(fvRangePick(oneA, '2026-11-27', LIM)), { from: '2026-11-26', to: '2026-11-27', pick: 'to' })
  assert.deepEqual(plain(fvRangePick(oneA, '2026-11-26', LIM)), plain(oneA))
})

test('no Day 2 later than Day 1 + 1, no day before the earliest or after the season; a day before Day 1 starts again', () => {
  const two = fvRangePick(NONE, '2026-11-26', LIM)
  assert.equal(fvRangePick(two, '2026-11-28', LIM), two)
  assert.equal(fvDayState('2026-11-28', two, LIM).off, true)
  assert.equal(fvDayState('2026-11-27', two, LIM).off, false)
  assert.equal(fvDayState('2026-11-24', NONE, LIM).off, true)
  assert.equal(fvRangePick(NONE, '2026-11-24', LIM), NONE)
  assert.equal(fvDayState('2027-06-01', NONE, { earliest: LIM.earliest, last: '2027-05-31' }).off, true)
  assert.deepEqual(plain(fvRangePick({ from: '2026-12-03', to: '2026-12-04', pick: 'to' }, '2026-12-01', LIM)), { from: '2026-12-01', to: '2026-12-02', pick: 'to' })
  // Picking Day 1 again (the Day 1 box): any day from the earliest can be the new Day 1.
  assert.equal(fvDayState('2026-12-20', { ...two, pick: 'from' }, LIM).off, false)
  assert.deepEqual(plain(fvRangePick({ ...two, pick: 'from' }, '2026-12-20', LIM)), { from: '2026-12-20', to: '2026-12-21', pick: 'to' })
})

test('Day 1 and Day 2 are marked; a 1-day visit marks only Day 1', () => {
  const two: Visit = { from: '2026-11-26', to: '2026-11-27', pick: 'to' }
  assert.deepEqual(plain(fvDayState('2026-11-26', two, LIM)), { off: false, from: true, to: false })
  assert.deepEqual(plain(fvDayState('2026-11-27', two, LIM)), { off: false, from: false, to: true })
  assert.deepEqual(plain(fvDayState('2026-11-26', { ...two, to: '2026-11-26' }, LIM)), { off: false, from: true, to: false })
})

test('the month grid runs Monday to Sunday', () => {
  const nov = fvMonthWeeks('2026-11')
  assert.equal(nov.length, 6)
  assert.deepEqual(plain(nov[0]), [null, null, null, null, null, null, '2026-11-01'])
  assert.deepEqual(plain(nov[5]), ['2026-11-30', null, null, null, null, null, null])
  const feb = fvMonthWeeks('2027-02')
  assert.deepEqual(plain(feb[0][0]), '2027-02-01')
  assert.equal(feb.flat().filter(Boolean).length, 28)
  assert.equal(fvMonthWeeks('2028-02').flat().filter(Boolean).length, 29)
})

test('the keys move a day, a week, to the week ends and a month', () => {
  assert.equal(fvCalMove('2026-11-26', 'ArrowRight'), '2026-11-27')
  assert.equal(fvCalMove('2026-11-30', 'ArrowRight'), '2026-12-01')
  assert.equal(fvCalMove('2026-11-26', 'ArrowUp'), '2026-11-19')
  assert.equal(fvCalMove('2026-11-26', 'ArrowDown'), '2026-12-03')
  assert.equal(fvCalMove('2026-11-26', 'Home'), '2026-11-23')
  assert.equal(fvCalMove('2026-11-26', 'End'), '2026-11-29')
  assert.equal(fvCalMove('2026-12-31', 'PageDown'), '2027-01-31')
  assert.equal(fvCalMove('2027-01-31', 'PageDown'), '2027-02-28')
  assert.equal(fvCalMove('2026-12-15', 'PageUp'), '2026-11-15')
  assert.equal(fvCalMove('2026-11-26', 'Tab'), null)
})
