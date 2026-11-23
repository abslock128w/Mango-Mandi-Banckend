// Bulk prices (mango-api/README.md, Bulk orders): what a box costs in a bulk order. The server is the only
// source: the shop shows what GET /v1/bulk/prices answers, and a bulk order's total is worked out again here
// when it is placed (createBulkOrder), whatever the shop sent.
//
// A box's bulk price is the manager's own price for it (products.bulk_price, paise) or, when none is set, its
// shop price less the default bulk discount (the rule bulkDiscountPct, 25 unless changed: a ₹100 box is ₹75),
// rounded to whole rupees. Bulk boxes are 5 kg or 10 kg: the 10 kg bulk box is two of a variety's 5 kg box's
// fruit (the shop's line "<5 kg sku>@10", sent as that sku with packKg 10), so it costs twice the 5 kg box's
// bulk price, as its shop price is twice the 5 kg box's.
import { getConfig } from './config.js'
import { boxKg, findProduct, shopProducts } from './products.js'

export const DEFAULT_BULK_DISCOUNT_PCT = 25

/** The default bulk discount in percent (rules, bulkDiscountPct). */
export const bulkDiscountPct = (rules = getConfig()) => Number(rules.bulkDiscountPct ?? DEFAULT_BULK_DISCOUNT_PCT)

/** Paise rounded to whole rupees (half a rupee goes up). */
export const wholeRupees = (paise) => Math.round(paise / 100) * 100

/** The shop price less `pct` percent, in whole rupees. */
export const discounted = (price, pct) => wholeRupees((price * (100 - pct)) / 100)

/**
 * One box's prices, in paise: { price (the shop's), bulkPrice, custom (a manager set it), savingPct }. `packKg`:
 * a bulk box made of this SKU's fruit (the 10 kg box of a 5 kg SKU), priced by weight from the SKU's own box.
 * Null for an unknown SKU.
 */
export function boxPrices(sku, packKg = null, rules = getConfig()) {
  const p = findProduct(sku)
  if (!p || p.price == null) return null
  const own = boxKg(sku)
  const times = packKg && own ? packKg / own : 1
  const unit = p.bulkPrice != null ? p.bulkPrice : discounted(p.price, bulkDiscountPct(rules))
  const price = Math.round(p.price * times)
  const bulkPrice = Math.round(unit * times)
  return { price, bulkPrice, custom: p.bulkPrice != null, savingPct: price ? Math.round(((price - bulkPrice) / price) * 100) : 0 }
}

/**
 * What GET /v1/bulk/prices answers: every variety on sale that has a 5 kg box, with its 5 kg and 10 kg bulk boxes.
 * Money in paise. `discountPct` is the default discount (a box with its own bulk price may save more or less).
 */
export function bulkPriceList(rules = getConfig()) {
  const items = []
  for (const p of shopProducts()) {
    if (boxKg(p.sku) !== 5) continue
    const five = boxPrices(p.sku, null, rules)
    const ten = boxPrices(p.sku, 10, rules)
    if (!five) continue
    items.push({
      sku: p.sku, variety: p.variety, name: p.name,
      packs: [
        { packKg: 5, price: five.price, bulkPrice: five.bulkPrice, savingPct: five.savingPct },
        { packKg: 10, price: ten.price, bulkPrice: ten.bulkPrice, savingPct: ten.savingPct },
      ],
      custom: five.custom,
    })
  }
  return { discountPct: bulkDiscountPct(rules), items }
}

/**
 * Prices a bulk list (lines as cleanLines stores them: { sku, stage, boxes, kg, packKg? }) at bulk prices.
 * Each line gets unitPrice (bulk) and shopUnitPrice, linePrice and shopLinePrice; the totals are subtotal (the
 * mangoes at bulk prices), shopValue (at shop prices) and saving. Throws on a box with no price.
 */
export function priceBulkLines(lines, rules = getConfig()) {
  const out = lines.map((l) => {
    const pr = boxPrices(l.sku, l.packKg ?? null, rules)
    if (!pr) throw new Error(`no price for ${l.sku}`)
    return { ...l, unitPrice: pr.bulkPrice, shopUnitPrice: pr.price, linePrice: pr.bulkPrice * l.boxes, shopLinePrice: pr.price * l.boxes }
  })
  const subtotal = out.reduce((t, l) => t + l.linePrice, 0)
  const shopValue = out.reduce((t, l) => t + l.shopLinePrice, 0)
  return { lines: out, subtotal, shopValue, saving: shopValue - subtotal }
}
