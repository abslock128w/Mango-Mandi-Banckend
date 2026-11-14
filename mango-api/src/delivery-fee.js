// The delivery charge on a regular order (rules: config.js `deliveryFee`, off until a manager turns it on).
//
// How far: a straight line (nearest.js `km`) from the nearest warehouse to the customer. The customer is
// where they dropped the pin on the shop's map, as long as that pin is plausible for the pincode they are
// ordering to (within PIN_NEAR_KM of its centre: a pin dropped next to the warehouse can't buy a cheaper
// delivery to somewhere else). Without a pin, they are at their pincode's centre; without that either,
// the rules' `unknownKm` is assumed.
//
// How much: the first band the distance fits in. An order worth `freeAbove` or more (boxes less the promo)
// pays the band's `fee`, a smaller one its `feeSmall`. Past the last band the order is refused, or pays
// the last band's charge (`beyond`). Money in the rules is rupees; everything this module returns is paise.
//
// The charge is not a column: an order's total is its goods less the promo plus the charge, and the bill
// reads it back the same way (bills.js).
import { getConfig } from './config.js'
import { HttpError } from './errors.js'
import { km } from './nearest.js'

/** A pin further than this from its pincode's centre is not believed. */
export const PIN_NEAR_KM = 8

export const feeRules = () => getConfig().deliveryFee

const paise = (rupees) => Math.round(rupees * 100)
const oneDecimal = (n) => Math.round(n * 10) / 10

/** Where distances are measured from: the rules' own list, else the warehouses that have a position. */
export async function origins(c, rules = feeRules()) {
  if (rules.origins.length) return rules.origins.map((o) => ({ name: o.name, lat: o.lat, lng: o.lng }))
  const { rows } = await c.query('SELECT name, lat, lng FROM warehouses WHERE active AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY id')
  return rows.map((r) => ({ name: r.name, lat: Number(r.lat), lng: Number(r.lng) }))
}

/** The customer's position and how it is known ('pin' or 'pincode'), or null when it isn't. */
export async function locate(c, pincode, location) {
  const { rows } = await c.query('SELECT lat, lng FROM pincodes WHERE pincode = $1', [pincode])
  const centre = rows[0]?.lat != null && rows[0]?.lng != null ? { lat: Number(rows[0].lat), lng: Number(rows[0].lng) } : null
  if (location && (!centre || km(location, centre) <= PIN_NEAR_KM)) return { lat: location.lat, lng: location.lng, basis: 'pin' }
  if (centre) return { ...centre, basis: 'pincode' }
  return null
}

/** The band a distance falls in and what an order of `goods` paise pays there. Pure: the rules decide everything. */
export function chargeFor(distanceKm, goods, rules = feeRules()) {
  const last = rules.bands[rules.bands.length - 1]
  const band = rules.bands.find((b) => distanceKm <= b.uptoKm) ?? null
  const tooFar = !band && rules.beyond === 'refuse'
  const at = band ?? last
  const feeAtOrAbove = paise(at.fee), feeBelow = paise(at.feeSmall)
  return { tooFar, maxKm: last.uptoKm, uptoKm: at.uptoKm, feeAtOrAbove, feeBelow, fee: tooFar ? 0 : goods >= paise(rules.freeAbove) ? feeAtOrAbove : feeBelow }
}

/**
 * What delivery costs for an order of `goods` paise to this pincode (and pin, when the shop has one).
 * `{ enabled: false, fee: 0 }` while the charge is off, so every caller can add `fee` without asking.
 */
export async function deliveryFor(c, { pincode, location = null, goods = 0 }) {
  const rules = feeRules()
  if (!rules.enabled) return { enabled: false, fee: 0 }
  const [from, at] = [await origins(c, rules), await locate(c, pincode, location)]
  const known = Boolean(from.length && at)
  const distance = known ? Math.min(...from.map((o) => km(o, at))) : rules.unknownKm
  // A distance nobody measured never refuses an order: it pays the assumed distance's band, or the last one.
  const charge = chargeFor(distance, goods, known ? rules : { ...rules, beyond: 'charge' })
  return {
    enabled: true,
    fee: charge.fee,
    distanceKm: oneDecimal(distance),
    basis: known ? at.basis : 'unknown',
    freeAbove: paise(rules.freeAbove),
    feeAtOrAbove: charge.feeAtOrAbove,
    feeBelow: charge.feeBelow,
    tooFar: charge.tooFar,
    maxKm: charge.maxKm,
    ...(known && at.basis === 'pin' ? { lat: at.lat, lng: at.lng } : {}),
  }
}

/** Refuses an order whose address is past the last band (when the rules say to refuse). */
export function assertInRange(d) {
  if (d.enabled && d.tooFar) {
    throw new HttpError(422, 'TOO_FAR', `This address is about ${d.distanceKm} km from our nearest warehouse. We deliver up to ${d.maxKm} km.`, {
      distanceKm: d.distanceKm,
      maxKm: d.maxKm,
    })
  }
}

/** What the shop's pages quote: whether delivery is charged, and the table when it is. */
export function feePolicy() {
  const r = feeRules()
  if (!r.enabled) return { enabled: false }
  return {
    enabled: true,
    freeAbove: paise(r.freeAbove),
    bands: r.bands.map((b) => ({ uptoKm: b.uptoKm, fee: paise(b.fee), feeSmall: paise(b.feeSmall) })),
    beyond: r.beyond,
  }
}

/** The charge an order row carries: whatever its total is above its goods less the promo. */
export const feeOf = (o) => Math.max(0, (o.total ?? 0) - ((o.subtotal ?? 0) - (o.discount ?? 0)))
