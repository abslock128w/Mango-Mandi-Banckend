// The delivery charge on a regular order (rules: config.js `deliveryFee`, off until a manager turns it on).
//
// How far: a straight line (nearest.js `km`) from the nearest warehouse. The pincode's centre sets the
// floor: the distance is never taken as less than the centre's distance minus PIN_TOLERANCE_KM. The pin the
// customer dropped on the shop's map can raise it (a far corner of a big pincode pays for the far corner),
// but lower it only by that tolerance, so a pin dropped next to the warehouse can't buy a cheaper (or an
// in-range) delivery to somewhere else. Without a pin the centre is used. A pincode with no centre has no
// floor, so its pin is not believed on its own: the rules' `unknownKm` is assumed (staff set the centre on
// the Pincodes page, which warns about pincodes without one).
//
// How much (the owner's table, 18 Nov): the first band the distance fits in, and the order's WEIGHT picks the
// column. An order whose boxes weigh `freeFromKg` or more (5 kg: inclusive) pays the band's `fee`, a lighter
// one its `feeSmall`. What the order is worth decides nothing (`freeAbove` is kept in stored rules, unused).
// Free delivery is only for those heavier orders at or within `freeWithinKm` (2 km): there they pay 0 whatever
// the band says; past it they pay the band's `fee`, and a manager can't save a band reaching past it with a
// charge of 0 (config.js), so nothing is free past `freeWithinKm`. `freeFromKg` 0: no weight line, every order
// pays `feeSmall` and none is free. Past the last band the order is refused, whatever it weighs, or pays the
// last band's charge (`beyond`). Money in the rules is rupees; everything this module returns is paise.
//
// The charge is not a column: an order's total is its goods less the promo plus the charge, and the bill
// reads it back the same way (bills.js).
import { getConfig } from './config.js'
import { HttpError } from './errors.js'
import { km } from './nearest.js'
import { boxKg } from './products.js'

/**
 * How much closer than its pincode's centre a pin may put the customer, in km. A pincode is a few km
 * across, so a real pin on the warehouse side of the centre still counts, by up to this much; the
 * warehouse's own doorstep does not. Change it here only.
 */
export const PIN_TOLERANCE_KM = 1.5

export const feeRules = () => getConfig().deliveryFee

const paise = (rupees) => Math.round(rupees * 100)
const oneDecimal = (n) => Math.round(n * 10) / 10

/** What an order's lines weigh in kg: boxes × each box's size. */
export const weightKg = (lines) => Math.round(lines.reduce((t, l) => t + boxKg(l.sku) * l.qty, 0) * 100) / 100

/**
 * Whether an order of `kg` is on the heavy side of the weight line: it pays the band's `fee`, and nothing
 * at or within `freeWithinKm`. Inclusive: "5 kg and above" is 5 kg or more (one 5 kg box qualifies). To make
 * it "more than", change `>=` to `>` here and nowhere else. `freeFromKg` 0: no order is.
 */
export const heavyByWeight = (kg, rules = feeRules()) => rules.freeFromKg > 0 && kg >= rules.freeFromKg

/** Where distances are measured from: the rules' own list, else the warehouses that have a position. */
export async function origins(c, rules = feeRules()) {
  if (rules.origins.length) return rules.origins.map((o) => ({ name: o.name, lat: o.lat, lng: o.lng }))
  const { rows } = await c.query('SELECT name, lat, lng FROM warehouses WHERE active AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY id')
  return rows.map((r) => ({ name: r.name, lat: Number(r.lat), lng: Number(r.lng) }))
}

/** The pincode's centre, or null when staff have not set one. */
export async function pincodeCentre(c, pincode) {
  const { rows } = await c.query('SELECT lat, lng FROM pincodes WHERE pincode = $1', [pincode])
  return rows[0]?.lat != null && rows[0]?.lng != null ? { lat: Number(rows[0].lat), lng: Number(rows[0].lng) } : null
}

const nearestKm = (from, at) => Math.min(...from.map((o) => km(o, at)))

/**
 * How far the customer is from the nearest of `from`, and how that is known: 'pin' (their pin, at or
 * above the floor), 'pincode' (the centre's distance, less the tolerance when a pin was closer), or
 * null when it can't be known (no warehouse position, or no centre for the pincode).
 */
export async function locate(c, pincode, location, from) {
  const centre = await pincodeCentre(c, pincode)
  if (!from.length || !centre) return null
  const floor = nearestKm(from, centre)
  if (!location) return { distance: floor, basis: 'pincode' }
  const pin = nearestKm(from, location)
  if (pin >= floor - PIN_TOLERANCE_KM) return { distance: pin, basis: 'pin', lat: location.lat, lng: location.lng }
  return { distance: Math.max(0, floor - PIN_TOLERANCE_KM), basis: 'pincode' }
}

/**
 * The band a distance falls in and what an order weighing `kg` pays there. `goods` (paise) stays in the
 * signature for the callers but decides nothing any more. `feeAtOrAbove` is what an order at or above the
 * weight line pays at this distance (0 at or within `freeWithinKm`), `feeBelow` what a lighter one pays.
 * Pure: the rules decide everything.
 */
export function chargeFor(distanceKm, goods, rules = feeRules(), kg = 0) {
  const last = rules.bands[rules.bands.length - 1]
  const band = rules.bands.find((b) => distanceKm <= b.uptoKm) ?? null
  const tooFar = !band && rules.beyond === 'refuse'
  const at = band ?? last
  // Past the last band with `beyond: 'perKm'`: the last band's charge plus the per-km amount for every km past it,
  // a part km counted as a whole one (12.4 km with a 12 km last band is 1 km past).
  const per = !band && rules.beyond === 'perKm' ? rules.perKmBeyond ?? { fee: 15, feeSmall: 20 } : null
  const extraKm = per ? Math.max(0, Math.ceil(Math.round((distanceKm - last.uptoKm) * 1000) / 1000)) : 0
  const feeAtOrAbove = distanceKm <= rules.freeWithinKm ? 0 : paise(at.fee + (per ? per.fee * extraKm : 0))
  const feeBelow = paise(at.feeSmall + (per ? per.feeSmall * extraKm : 0))
  const fee = tooFar ? 0 : heavyByWeight(kg, rules) ? feeAtOrAbove : feeBelow
  return { tooFar, maxKm: last.uptoKm, uptoKm: at.uptoKm, feeAtOrAbove, feeBelow, fee, extraKm }
}

/**
 * What delivery costs for an order of `goods` paise weighing `kg` to this pincode (and pin, when the shop has one).
 * `{ enabled: false, fee: 0 }` while the charge is off, so every caller can add `fee` without asking.
 */
export async function deliveryFor(c, { pincode, location = null, goods = 0, kg = 0 }) {
  const rules = feeRules()
  if (!rules.enabled) return { enabled: false, fee: 0 }
  const at = await locate(c, pincode, location, await origins(c, rules))
  const known = Boolean(at)
  const distance = known ? at.distance : rules.unknownKm
  // A distance nobody measured never refuses an order: it pays the assumed distance's band, or the last one.
  const charge = chargeFor(distance, goods, known ? rules : { ...rules, beyond: 'charge' }, kg)
  return {
    enabled: true,
    fee: charge.fee,
    distanceKm: oneDecimal(distance),
    basis: known ? at.basis : 'unknown',
    freeAbove: paise(rules.freeAbove), // decides nothing; kept for the shop until its wording changes
    freeFromKg: rules.freeFromKg,
    freeWithinKm: rules.freeWithinKm,
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
    freeAbove: paise(r.freeAbove), // decides nothing; kept for the shop until its wording changes
    freeFromKg: r.freeFromKg,
    freeWithinKm: r.freeWithinKm,
    bands: r.bands.map((b) => ({ uptoKm: b.uptoKm, fee: paise(b.fee), feeSmall: paise(b.feeSmall) })),
    beyond: r.beyond,
    perKmBeyond: r.beyond === 'perKm' ? { fee: paise((r.perKmBeyond ?? { fee: 15 }).fee), feeSmall: paise((r.perKmBeyond ?? { feeSmall: 20 }).feeSmall) } : null,
  }
}

/** The charge an order row carries: whatever its total is above its goods less the promo. */
export const feeOf = (o) => Math.max(0, (o.total ?? 0) - ((o.subtotal ?? 0) - (o.discount ?? 0)))
