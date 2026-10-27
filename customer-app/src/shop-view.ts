// Sort and filter on the home page (SHOP_SORT_FILTER, docs/app-feel.md). The choice lives in the
// address (?sort=, ?variety=, ?ripe=, ?stock=1) beside the search (?q=), so Back, a shared link and
// a reload all show the same list. No browser or React here, so it is unit tested on its own
// (customer-app/tests/unit/shop-view.unit.ts).
import type { Stage } from './api'
import { t, type Key } from './i18n-core.ts'

export type SortKey = 'featured' | 'price-low' | 'price-high' | 'rating' | 'name'

const sort = (key: SortKey, label: Key) => ({
  key,
  /** In the shop's language. */
  get label() {
    return t(label)
  },
})
export const SORTS: { key: SortKey; label: string }[] = [
  sort('featured', 'sort.featured'),
  sort('price-low', 'sort.priceLow'),
  sort('price-high', 'sort.priceHigh'),
  sort('rating', 'sort.rating'),
  sort('name', 'sort.name'),
]

const STAGES: Stage[] = ['RAW', 'SEMI_RIPE', 'RIPE']

export interface ShopView {
  sort: SortKey
  /** One variety, or every variety. */
  variety: string | null
  /** Only boxes with this ripeness in stock for the day shown. */
  ripeness: Stage | null
  /** Only boxes with some ripeness in stock for the day shown. */
  inStock: boolean
}

export const DEFAULT_VIEW: ShopView = { sort: 'featured', variety: null, ripeness: null, inStock: false }

/** The view in the address. Anything unknown (an old or edited link) falls back to the default. */
export function readView(params: URLSearchParams): ShopView {
  const sort = params.get('sort')
  const ripe = params.get('ripe')
  const variety = (params.get('variety') ?? '').trim().slice(0, 60)
  return {
    sort: SORTS.some((s) => s.key === sort) ? (sort as SortKey) : 'featured',
    variety: variety || null,
    ripeness: STAGES.includes(ripe as Stage) ? (ripe as Stage) : null,
    inStock: params.get('stock') === '1',
  }
}

/** The address for a view: the other parameters (?q=, ?where=) stay; defaults are left out. */
export function writeView(params: URLSearchParams, view: ShopView): URLSearchParams {
  const next = new URLSearchParams(params)
  const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key))
  set('sort', view.sort === 'featured' ? null : view.sort)
  set('variety', view.variety)
  set('ripe', view.ripeness)
  set('stock', view.inStock ? '1' : null)
  return next
}

/** True when a filter (not the sort) narrows the list. */
export const isFiltered = (view: ShopView) => Boolean(view.variety || view.ripeness || view.inStock)

export interface Viewable {
  sku: string
  name: string
  variety: string
  price: number
}

/**
 * The boxes to show, in order. `stages` gives a box's stock per ripeness for the day shown (left
 * out before a pincode, when stock is unknown and the stock filters do nothing); `rating` its
 * variety's average stars, null when it has no reviews (those go last, by name).
 */
export function applyView<T extends Viewable>(
  items: T[],
  view: ShopView,
  { stages, rating }: { stages?: (item: T) => { stage: Stage; qty: number }[]; rating: (item: T) => number | null },
): T[] {
  const inStock = (item: T, stage?: Stage) => (stages ? stages(item).some((s) => s.qty > 0 && (!stage || s.stage === stage)) : true)
  const kept = items.filter(
    (item) =>
      (!view.variety || item.variety.toLowerCase() === view.variety.toLowerCase()) &&
      (!view.ripeness || inStock(item, view.ripeness)) &&
      (!view.inStock || inStock(item)),
  )
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'en-IN') || a.sku.localeCompare(b.sku)
  // Array.prototype.sort is stable, so "our order" and ties keep the shop's own order.
  switch (view.sort) {
    case 'price-low':
      return [...kept].sort((a, b) => a.price - b.price)
    case 'price-high':
      return [...kept].sort((a, b) => b.price - a.price)
    case 'name':
      return [...kept].sort(byName)
    case 'rating':
      return [...kept].sort((a, b) => {
        const ra = rating(a)
        const rb = rating(b)
        if (ra == null || rb == null) return ra == null && rb == null ? byName(a, b) : ra == null ? 1 : -1
        return rb - ra || byName(a, b)
      })
    default:
      return kept
  }
}

/** The varieties on sale, for the variety filter, in the shop's order. */
export function varietiesOf(items: Viewable[]): string[] {
  return [...new Set(items.map((i) => i.variety).filter(Boolean))]
}
