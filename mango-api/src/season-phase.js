// Where the year is for the shop (rules seasonStartsOn and preorderOpensOn, src/config.js):
//   OPEN      the season has started, or no start date is set: the shop sells as usual.
//   PREORDER  before the season starts, from the day pre-orders open (or any day, when that
//             is not set): the shop's home page is the pre-order shop.
//   BEFORE    before pre-orders open: nothing can be booked yet.
// "today" is the IST business date (clock.js todayIST), as everywhere else.
import { todayIST } from './clock.js'
import { getConfig } from './config.js'

export const SEASON_PHASES = ['BEFORE', 'PREORDER', 'OPEN']

/** The phase on `today` (YYYY-MM-DD) under the rules `cfg`. */
export function seasonPhase(today, cfg) {
  const starts = cfg?.seasonStartsOn ?? null
  const opens = cfg?.preorderOpensOn ?? null
  if (!starts || today >= starts) return 'OPEN'
  if (opens && today < opens) return 'BEFORE'
  return 'PREORDER'
}

/** What the shop is told (GET /v1/catalogue, GET /v1/preorders/weeks). */
export function seasonView(cfg = getConfig(), today = todayIST()) {
  return { phase: seasonPhase(today, cfg), startsOn: cfg.seasonStartsOn ?? null, preorderOpensOn: cfg.preorderOpensOn ?? null }
}
