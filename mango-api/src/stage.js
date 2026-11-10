// Ripeness engine (pure functions). A box's stage is never stored on stock:
// it is derived from the batch's age on the DELIVERY date, shifted by the
// latest QC reading, so the same box can sell as raw on one date and
// semi-ripe on another. See the playbook, section 2.
import { diffDays, istParts } from './clock.js'

/**
 * Every ripeness a QC reading or a stored record may name, least ripe first.
 * RIPE is still a QC reading (a fast ripener) and is still on older orders,
 * carts and bookings, but nothing is sold as RIPE any more: see SALE_STAGES.
 */
export const STAGES = ['RAW', 'SEMI_RIPE', 'RIPE']

/** The stages a box is sold as (what a customer or staff member may choose to buy). */
export const SALE_STAGES = ['RAW', 'SEMI_RIPE']

/** The stage an older record's ripeness is sold as now: RIPE became SEMI_RIPE. */
export const saleStage = (stage) => (stage === 'RIPE' ? 'SEMI_RIPE' : stage)

/**
 * Whether stock promised as `promised` still keeps that promise when the batch
 * sells as `now` on the delivery date. Boxes sold as RIPE before RIPE stopped
 * being sold are honoured by a batch that is SEMI_RIPE on that date.
 */
export const keepsPromise = (promised, now) => promised === now || (promised === 'RIPE' && now === 'SEMI_RIPE')

const profileFor = (config, variety) => config.stageProfiles[variety] ?? config.stageProfiles.default

/** Stage index a profile predicts at an age: -1 before the first window, STAGES.length after the last. */
function predictedIndex(profile, age) {
  const hit = profile.find((p) => age >= p.minAge && age <= p.maxAge)
  if (hit) return STAGES.indexOf(hit.stage)
  if (age < profile[0].minAge) return -1
  if (age > profile[profile.length - 1].maxAge) return STAGES.length
  // A gap between windows: use the window before it.
  const before = profile.filter((p) => p.maxAge < age).at(-1)
  return STAGES.indexOf(before.stage)
}

/**
 * Days the latest QC reading moves the batch along its profile, clamped to
 * ±maxQcShift. A batch QC'd ripe when the profile expected semi-ripe is a
 * fast ripener: +1 day.
 */
export function qcShift(config, variety, pluckedOn, qc) {
  if (!qc) return 0
  const profile = profileFor(config, variety)
  const ageAtQc = diffDays(istParts(qc.loggedAt).date, pluckedOn)
  // Fruit is raw from the day it is plucked, even before it may be sold.
  const expected = Math.max(0, predictedIndex(profile, ageAtQc))
  const diff = STAGES.indexOf(qc.ripenessRating) - expected
  return Math.max(-config.maxQcShift, Math.min(config.maxQcShift, diff))
}

/**
 * The stage a batch sells as on a delivery date, or null if it can't be sold
 * then. `qc` is the latest reading ({ ripenessRating, loggedAt }) or null.
 */
export function stageFor(config, { variety, pluckedOn }, deliveryDate, qc) {
  const age = diffDays(deliveryDate, pluckedOn)
  if (age > config.maxSellableAge) return null // hard cap, checked on the delivery date
  const profile = profileFor(config, variety)
  const idx = predictedIndex(profile, age + qcShift(config, variety, pluckedOn, qc))
  if (idx < 0) return null
  // Still inside the cap but past the last window (a fast ripener): the profile's
  // last stage, so a QC shift never sells a stage the rules don't sell.
  return idx >= STAGES.length ? profile.at(-1).stage : STAGES[idx]
}
