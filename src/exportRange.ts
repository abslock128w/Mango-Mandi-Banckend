// The date range of a CSV export (docs/trust.md). The API checks it again
// (EXPORT_MAX_DAYS in mango-api/src/admin/exports.js); this says why the
// Download button is off before anything is sent.

/** The longest range one export may cover, in days, both ends counted. */
export const EXPORT_MAX_DAYS = 92

const DAY_MS = 86_400_000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Days from `from` to `to`, both counted: 2026-10-01 to 2026-10-01 is 1. */
export const daysCovered = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1

/** Why the range can't be exported, or null when it can. */
export function rangeProblem(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both dates.'
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return 'Enter the dates as days, for example 2026-10-01.'
  if (from > to) return 'The start date is after the end date.'
  if (daysCovered(from, to) > EXPORT_MAX_DAYS) return `One export covers at most ${EXPORT_MAX_DAYS} days.`
  return null
}
