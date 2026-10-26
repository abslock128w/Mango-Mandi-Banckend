// The body of a stocktake review: what to do with each box the count did not
// find. Kept apart from StocktakeDetail.tsx so the rule runs in unit tests
// (tests/unit/stocktake-review.unit.ts).

export type ReviewChoice = 'missing' | 'keep'

export interface ReviewBody {
  missing: string[]
  keep: string[]
  /** Decides every box not listed (the API keeps a box that can only be kept). */
  rest?: ReviewChoice
  note?: string
}

/** Up to this many boxes are listed one by one; a bigger review lists only the exceptions to `rest`. */
export const LIST_EVERY_BOX_UP_TO = 500

/**
 * Builds the review request. Small reviews list every box. Big ones (a count
 * of a busy shelf can leave thousands of boxes) send the more common choice
 * as `rest` and list only the boxes decided the other way, so the request
 * stays small and within the API's limits.
 */
export function reviewBody(boxIds: string[], choice: Record<string, ReviewChoice>, note = ''): ReviewBody {
  const missing = boxIds.filter((id) => choice[id] === 'missing')
  const keep = boxIds.filter((id) => choice[id] === 'keep')
  const extra = note.trim() ? { note: note.trim() } : {}
  if (boxIds.length <= LIST_EVERY_BOX_UP_TO) return { missing, keep, ...extra }
  return missing.length >= keep.length ? { missing: [], keep, rest: 'missing', ...extra } : { missing, keep: [], rest: 'keep', ...extra }
}
