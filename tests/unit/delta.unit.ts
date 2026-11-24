import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deltaOf, fullWeeks, lastTwoFullWeeks } from '../../src/delta.ts'

// The KPI cards' week-on-week change (Analytics, Today): which weeks are compared and what the chip says.

test('more than the week before is up, less is down, by (now − before) / before', () => {
  assert.deepEqual(deltaOf(150, 100), { text: '+50%', dir: 'up', tone: 'good', spoken: 'up 50% on the week before' })
  assert.deepEqual(deltaOf(84, 168), { text: '−50%', dir: 'down', tone: 'bad', spoken: 'down 50% on the week before' })
  // Fewer claims is good news, though the number went down.
  assert.deepEqual([deltaOf(2, 4, { higherIsBetter: false })?.dir, deltaOf(2, 4, { higherIsBetter: false })?.tone], ['down', 'good'])
  assert.equal(deltaOf(100, 100)?.dir, 'flat')
  assert.equal(deltaOf(0.12, 0.1, { rate: true })?.text, '+2.0 pts')
})

test('nothing the week before and something now is "New", never a percentage; nothing either week is no change', () => {
  assert.deepEqual(deltaOf(15_526_600, 0, { against: 'the week of 16 Nov' }), { text: 'New', dir: 'up', tone: 'good', spoken: 'new: none in the week of 16 Nov' })
  assert.equal(deltaOf(3, 0, { higherIsBetter: false })?.tone, 'bad')
  assert.equal(deltaOf(0, 0)?.text, '±0%')
  assert.equal(deltaOf(null, 5), null)
})

test('the week still filling up is left out: on Wednesday 25 Nov the weeks compared are 16 Nov and 9 Nov', () => {
  // The default range: eight weeks to this week's Sunday. 84 boxes sold in the week of 16 Nov, none yet this week.
  const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].map((weekStart, i) => ({
    weekStart, boxes: [0, 0, 0, 0, 0, 40, 84, 0][i],
  }))
  assert.deepEqual(fullWeeks(weeks, '2026-11-25').map((w) => w.weekStart).slice(-2), ['2026-11-09', '2026-11-16'])
  const pair = lastTwoFullWeeks(weeks, '2026-11-25')!
  assert.deepEqual([pair.last.weekStart, pair.prev.weekStart], ['2026-11-16', '2026-11-09'])
  assert.equal(deltaOf(pair.last.boxes, pair.prev.boxes)?.text, '+110%')
  // On Monday 30 Nov the week of 23 Nov has ended and is compared.
  assert.equal(lastTwoFullWeeks(weeks, '2026-11-30')!.last.weekStart, '2026-11-23')
  // Sunday 29 Nov: still the week of 23 Nov, not yet full.
  assert.equal(lastTwoFullWeeks(weeks, '2026-11-29')!.last.weekStart, '2026-11-16')
  // A range with one full week has nothing to compare.
  assert.equal(lastTwoFullWeeks(weeks.slice(-2), '2026-11-25'), null)
})
