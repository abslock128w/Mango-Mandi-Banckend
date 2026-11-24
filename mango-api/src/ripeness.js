// When a box is ready to eat, and how to keep it. Ripeness is sold by age on
// the delivery date (stage.js), and a box is ripe the day after the oldest age
// that is delivered (maxSellableAge + 1: age 8 under the playbook rules). So the
// days it needs at home depend on how old it is when it lands: a raw box
// delivered at age 2 needs 6 days, a semi-ripe one delivered at age 7 needs 1.
// Where the batch is known (a placed order's allocated stock) that age is used.
// Where it isn't (the catalogue, a quote), the oldest box sold as that stage is
// assumed, so the dates shown are the earliest: never later than the fruit is.
// Nothing is sold ripe any more; RIPE stays here for orders placed before that
// (ready on arrival).
import { addDays } from './clock.js'
import { getConfig } from './config.js'

export const STAGE_WORDS = { RAW: 'raw', SEMI_RIPE: 'semi-ripe', RIPE: 'ripe' }

/** The age (days since pluck) at which a box is ripe. */
const ripeAge = (cfg) => cfg.maxSellableAge + 1

/** Days at home for the oldest box sold as `stage` (at least 1). */
function daysToReady(stage, cfg) {
  const w = cfg.stageProfiles.default.find((p) => p.stage === stage)
  return w ? Math.max(1, ripeAge(cfg) - Math.min(w.maxAge, cfg.maxSellableAge)) : 1
}

/**
 * The first day a box delivered on `date` is ready to eat. `pluckedOn` is its
 * batch's pluck date when known (the oldest batch, for a line filled from several).
 */
export function readyOnFor(stage, date, pluckedOn = null, cfg = getConfig()) {
  if (stage === 'RIPE') return date
  if (!pluckedOn) return addDays(date, daysToReady(stage, cfg))
  const ripe = addDays(pluckedOn, ripeAge(cfg))
  const soonest = addDays(date, 1)
  return ripe > soonest ? ripe : soonest
}

/** The last good day to eat it (kept in the fridge once ripe). */
export const eatByFor = (stage, date, pluckedOn = null, cfg = getConfig()) => addDays(readyOnFor(stage, date, pluckedOn, cfg), 3)

/**
 * SQL for the pluck date of the oldest batch an order item (alias `i`) is filled
 * from, or NULL while it has no stock (a backordered line).
 */
export const OLDEST_PLUCK_SQL = `(SELECT min(b.plucked_on) FROM order_stock s JOIN batches b ON b.id = s.batch_id
   WHERE s.order_id = i.order_id AND s.sku = i.sku AND s.stage = i.stage AND s.state <> 'released')`

/** One storage line for the least ripe box in the order. */
export function storageTip(stages) {
  if (stages.includes('RAW')) return "Keep them at room temperature, out of the sun, and don't refrigerate them until they are ripe: cold stops ripening. A paper bag speeds it up."
  if (stages.includes('SEMI_RIPE')) return 'Leave them on the counter until they smell sweet at the stem (one to four days), then eat them or move them to the fridge.'
  return 'Ready to eat on arrival. Enjoy them within a day or two, or keep them in the fridge for 2 to 3 more days.'
}
