// Bulk enquiries (mango-api/README.md, Bulk enquiries): the shop's form for orders above 100 kg.
//
// An enquiry is saved with who sent it and what they asked for (their bulk list, or a
// quantity in kg). Staff price it on the panel: one line per requested box with a unit
// price, extra costs (special packaging, transport) and a note. The quote is sent on
// WhatsApp (BULK_QUOTE) and shown on the shop's Account page, where the customer
// accepts or declines it. Money is in paise throughout; totals are worked out here,
// never taken from the panel.
//
// A signed-in sender's enquiry carries their customer id; an anonymous one is found
// by its phone number once someone signs in with that number.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { now, todayIST } from './clock.js'
import { env } from './env.js'
import { conflict, HttpError, notFound } from './errors.js'
import { notify as notifyEvent } from './events.js'
import { newId } from './ids.js'
import { logger } from './logger.js'
import { formatOrderNumber, normaliseOrderNumber, nextOrderNumber } from './order-number.js'
import { boxKg, findProduct, productName, shopProducts } from './products.js'
import { enqueueLinkPush } from './push.js'
import { hit } from './ratelimit.js'
import { SALE_STAGES, STAGES } from './stage.js'
import { boxPrices } from './bulk-price.js'
import { bulkOrderView } from './bulk-orders.js'

/** Enquiries: NEW, QUOTED, ACCEPTED, DECLINED, CLOSED. Paid bulk orders (bulk-orders.js, migration 084): the rest. */
export const ENQUIRY_STATUSES = ['NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED']
export const ORDER_STATUSES = ['PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']
/** A farm visit enquiry (kind FARM_VISIT, migration 087): NEW → CONTACTED → VISIT_PLANNED → VISITED, or CLOSED with a reason. */
export const FARM_VISIT_STATUSES = ['NEW', 'CONTACTED', 'VISIT_PLANNED', 'VISITED', 'CLOSED']
export const BULK_STATUSES = [...ENQUIRY_STATUSES, ...ORDER_STATUSES, 'CONTACTED', 'VISIT_PLANNED', 'VISITED']
/**
 * An enquiry asks for a price (nothing is paid; staff quote, the customer accepts or declines). An order is placed
 * and paid at once at bulk prices (bulk-orders.js); direct orders placed before payment came in were unpaid.
 */
export const BULK_KINDS = ['ENQUIRY', 'ORDER', 'FARM_VISIT']
/** The smallest farm visit enquiry, in kg (the farm visit's own minimum; the 250 kg enquiry rule does not apply). */
export const FARM_VISIT_MIN_KG = 100
/** The smallest bulk order, in kg. */
export const BULK_MIN_KG = 100
/** The smallest enquiry, in kg (the owner: enquiries are for negotiating big orders). The shop has the same number. */
export const BULK_ENQUIRY_MIN_KG = 250
/** A plain enquiry under BULK_ENQUIRY_MIN_KG is refused with this (BULK_ENQUIRY_TOO_SMALL). */
export const BULK_ENQUIRY_MIN_MESSAGE = `Enquiries are for ${BULK_ENQUIRY_MIN_KG} kg and above. From ${BULK_MIN_KG} kg you can order and pay directly.`
/** The public form no longer places orders: a bulk order is placed signed in and paid at once (BULK_ORDER_PAY_ONLINE). */
export const BULK_ORDER_PAY_MESSAGE = 'Bulk orders are paid online when you place them now. Refresh the page, sign in and place your order again.'
/** A bulk order is packed in boxes of these sizes only. */
export const BULK_PACKS_KG = [5, 10]
/** Delivery on a bulk order, as a share of the mangoes' value. */
export const BULK_DELIVERY_PCT = 10

const STAGE_WORDS = { RAW: 'Raw', SEMI_RIPE: 'Semi-ripe', RIPE: 'Ripe' }

/** Indian mobile numbers, normalised to +91XXXXXXXXXX (as the login code form does, customer.js). */
export const bulkPhone = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a 10-digit Indian mobile number')
  .transform((s) => `+91${s}`)

const text = (max, label) => z.string().trim().max(max, `Keep ${label} under ${max} characters`)
const optionalText = (max, label) =>
  text(max, label)
    .optional()
    .nullable()
    .transform((v) => v || null)

export const enquiryBody = z
  .object({
    name: text(100, 'the name').min(1, 'Enter your name'),
    business: optionalText(120, 'the business name'),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .transform((v) => v || null)
      .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email, or leave it empty'),
    phone: bulkPhone,
    city: text(100, 'the city').min(1, 'Enter the delivery city'),
    notes: optionalText(1000, 'the note'),
    lines: z
      .array(
        z.object({
          sku: z.string().trim().min(1).max(64),
          stage: z.enum(SALE_STAGES),
          boxes: z.coerce.number().int().min(1).max(5000),
          // Sent by the shop for the record; worked out again here from the box size.
          kg: z.coerce.number().min(0).max(100_000).optional(),
          // A bulk box of this many kg of the SKU's fruit (5 or 10), when it is not the SKU's own box size.
          packKg: z.coerce.number().refine((n) => BULK_PACKS_KG.includes(n), 'Bulk boxes are 5 kg or 10 kg').optional(),
        }),
      )
      .max(50, 'Up to 50 lines in one enquiry')
      .optional()
      .default([]),
    quantityKg: z.coerce.number().int().min(1).max(100_000).optional(),
    ripeness: optionalText(40, 'the ripeness'),
    kind: z.enum(BULK_KINDS).optional().default('ENQUIRY'),
  })
  .strict()

/** The lines as stored: known boxes only, kg from the box size. */
export function cleanLines(lines) {
  const out = []
  for (const l of lines) {
    const p = findProduct(l.sku)
    if (!p) throw new HttpError(400, 'VALIDATION_ERROR', `We don't sell ${l.sku}. Refresh the page and build the list again.`)
    // A bulk box (packKg) is made of a 5 kg box's fruit (the shop's 10 kg line is "<5 kg sku>@10").
    if (l.packKg && boxKg(l.sku) !== 5) {
      throw new HttpError(400, 'BULK_BOX_SIZE', `A ${l.packKg} kg bulk box is made from a 5 kg box; ${productName(l.sku)} is not one. Refresh the page and build the list again.`)
    }
    const each = l.packKg ?? boxKg(l.sku)
    out.push({ sku: l.sku, stage: l.stage, boxes: l.boxes, kg: Math.round(each * l.boxes * 100) / 100, ...(l.packKg ? { packKg: l.packKg } : {}) })
  }
  return out
}

/** "Alphonso 5kg Box · Ripe", or "Alphonso · 10 kg box · Ripe" for a bulk box that is not the SKU's own size. */
const lineLabel = (l) => `${l.packKg ? `${findProduct(l.sku)?.variety ?? productName(l.sku)} · ${l.packKg} kg box` : productName(l.sku)} · ${STAGE_WORDS[l.stage] ?? l.stage}`
const boxes = (lines) => (lines ?? []).reduce((n, l) => n + (Number(l.boxes) || 0), 0)
/** "120 kg (40 boxes)", "150 kg" */
export const quantityWords = (e) => {
  const b = boxes(e.lines)
  return `${e.quantity_kg} kg${b ? ` (${b} ${b === 1 ? 'box' : 'boxes'})` : ''}`
}

export const shopUrl = () => env.CUSTOMER_ORIGIN.split(',')[0]?.trim().replace(/\/$/, '') || 'https://mandimangoes.in'
/** Where the customer reads the quote: the shop's Account page, opened at this enquiry. */
export const quoteLink = (id) => `${shopUrl()}/account?enquiry=${encodeURIComponent(id)}`
export const rupeeWords = (paise) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
/** One line, at most n characters: template variables may not hold line breaks. */
export const oneLine = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export async function addEvent(c, enquiryId, type, actor, detail = null) {
  await c.query(
    'INSERT INTO bulk_enquiry_events (id, enquiry_id, type, actor_type, actor_id, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [newId('bev'), enquiryId, type, actor.type, actor.id ?? null, detail ? JSON.stringify(detail) : null, now()],
  )
}

export async function addMessage(c, { enquiryId, kind, eventId, phone, params }) {
  if (!env.WHATSAPP_BULK_UPDATES) return
  const at = now()
  await c.query(
    `INSERT INTO notifications (id, bulk_enquiry_id, event_id, kind, phone, bulk_params, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (event_id, kind) DO NOTHING`,
    [newId('ntf'), enquiryId, eventId, kind, phone, JSON.stringify(params), at],
  )
}

/**
 * AUTH-01: the most "we got your enquiry" WhatsApp messages (bulk and farm visit together) the whole shop
 * sends in a day (IST), on top of Turnstile and the per-number BULK_ENQUIRY_DAILY_LIMIT. Real enquiries
 * are a handful a day, so 200 only bites when someone is using the forms to message strangers; past it
 * the enquiry is still saved (staff see it on the panel) but no message is queued. A module constant:
 * no setting needed until the shop really gets that many.
 */
export const ENQUIRY_MESSAGES_PER_DAY = 200
/** The rate_limits row that counts them (ratelimit.js hit), one per IST day. */
export const enquiryMessageKey = (day = todayIST()) => `enquiry-msg:day:${day}`

/** addMessage for the "received" messages, within ENQUIRY_MESSAGES_PER_DAY. */
async function addReceivedMessage(c, msg) {
  if (!env.WHATSAPP_BULK_UPDATES) return
  const { hits } = await hit(enquiryMessageKey(), 86_400_000)
  if (hits > ENQUIRY_MESSAGES_PER_DAY) {
    logger.warn({ enquiryId: msg.enquiryId, kind: msg.kind, limit: ENQUIRY_MESSAGES_PER_DAY }, 'enquiry received message skipped: the shop-wide daily cap is reached')
    return
  }
  await addMessage(c, msg)
}

/** The same request, whatever the key order (as customer.js requestHash): a retry must send what the first try sent. */
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v)
export const requestHash = (body) => createHash('sha256').update(JSON.stringify(stable(body))).digest('hex')

/**
 * The enquiry an earlier request with this (scoped) key made, or null. The same key with a
 * different body is refused (422), as for orders and pre-orders, never answered with the first enquiry.
 */
async function replayEnquiry(c, key, hash) {
  const { rows } = await c.query(
    `SELECT k.request_hash, e.id, e.number, e.status, e.kind FROM idempotency_keys k JOIN bulk_enquiries e ON e.id = k.order_id WHERE k.key = $1`,
    [key],
  )
  const r = rows[0]
  if (!r) {
    // The key's record is cleared after 7 days (maintenance.js); the enquiry still carries the key.
    const { rows: old } = await c.query('SELECT id, number, status, kind FROM bulk_enquiries WHERE idempotency_key = $1', [key])
    return old.length ? { status: 200, body: { id: old[0].id, number: old[0].number, status: old[0].status, kind: old[0].kind ?? 'ENQUIRY' } } : null
  }
  if (r.request_hash !== hash) {
    throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This request does not match the one first sent with this Idempotency-Key. Use a new key for a new enquiry.')
  }
  return { status: 200, body: { id: r.id, number: r.number, status: r.status, kind: r.kind ?? 'ENQUIRY' } }
}

/**
 * Saves an enquiry from the shop (and queues "we got your enquiry"). A repeated
 * Idempotency-Key with the same body answers the first enquiry again (status 200)
 * instead of a second one. The key counts only for the same sender (account, or
 * phone when signed out), so nobody can replay someone else's enquiry with it; the
 * request's hash is stored with it (idempotency_keys), and the same key with a
 * different body is refused. More than BULK_ENQUIRY_DAILY_LIMIT from one number in
 * 24 hours is refused; only enquiries that were accepted count towards it.
 */
export async function createEnquiry(c, b, { customerId = null, idempotencyKey = null } = {}) {
  const key = idempotencyKey ? `bulk:${customerId ?? 'anon'}:${b.phone}:${idempotencyKey}` : null
  const hash = key ? requestHash(b) : null
  if (key) {
    const replay = await replayEnquiry(c, key, hash)
    if (replay) return replay
  }
  // Orders are placed signed in and paid (bulk-orders.js createBulkOrder); this makes enquiries only.
  if (b.kind === 'ORDER') throw new HttpError(400, 'BULK_ORDER_PAY_ONLINE', BULK_ORDER_PAY_MESSAGE)
  const lines = cleanLines(b.lines ?? [])
  const kg = lines.length ? Math.round(lines.reduce((t, l) => t + l.kg, 0)) : b.quantityKg
  if (!kg) throw new HttpError(400, 'VALIDATION_ERROR', 'Tell us how many kg you need.')
  if (kg < BULK_ENQUIRY_MIN_KG) throw new HttpError(400, 'BULK_ENQUIRY_TOO_SMALL', BULK_ENQUIRY_MIN_MESSAGE, { minKg: BULK_ENQUIRY_MIN_KG, orderMinKg: BULK_MIN_KG })
  const order = false
  if (b.kind === 'FARM_VISIT') throw new HttpError(400, 'VALIDATION_ERROR', 'Send a farm visit enquiry from the Farm visit tab.')
  const at = now()
  const { rows: recent } = await c.query(`SELECT count(*)::int AS n FROM bulk_enquiries WHERE phone = $1 AND created_at > $2`, [b.phone, new Date(at.getTime() - 86_400_000)])
  if (recent[0].n >= env.BULK_ENQUIRY_DAILY_LIMIT) {
    throw new HttpError(429, 'BULK_LIMIT', 'You have sent several enquiries today. We will be in touch about them; message us on WhatsApp if anything changed.')
  }
  const id = newId('benq')
  if (key) {
    // Two tries at once with the same key: the second waits here for the first, then answers its enquiry.
    const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, id, at, hash])
    if (!ins.rowCount) {
      const first = await replayEnquiry(c, key, hash)
      if (first) return first
      throw conflict('This enquiry is still being sent. Try again in a moment.', 'IDEMPOTENCY_IN_PROGRESS')
    }
  }
  // B743406080 (order-number.js); older enquiries keep their BLK-0007.
  const number = await nextOrderNumber(c, 'B')
  await c.query(
    `INSERT INTO bulk_enquiries (id, number, customer_id, name, business, email, phone, city, notes, lines, quantity_kg, ripeness, idempotency_key, created_at, updated_at, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15)`,
    [id, number, customerId, b.name, b.business, b.email, b.phone, b.city, b.notes, JSON.stringify(lines), kg, b.ripeness, key, at, order ? 'ORDER' : 'ENQUIRY'],
  )
  await addEvent(c, id, 'RECEIVED', customerId ? { type: 'customer', id: customerId } : { type: 'system' }, { kg, boxes: boxes(lines), ...(order ? { kind: 'ORDER' } : {}) })
  await addReceivedMessage(c, { enquiryId: id, kind: 'BULK_ENQUIRY_RECEIVED', eventId: `${id}:received`, phone: b.phone, params: [oneLine(b.name, 60) || 'there', formatOrderNumber(number), quantityWords({ quantity_kg: kg, lines })] })
  await notifyEvent(c, 'bulk.enquiry', { id, number, status: 'NEW', change: 'created' })
  return { status: 201, body: { id, number, status: 'NEW', kind: order ? 'ORDER' : 'ENQUIRY' } }
}

// ---------------------------------------------------------------- quotes

const money = z.coerce.number().int('Amounts are whole paise').min(0, 'Amounts can’t be negative').max(1_000_000_000)
export const quoteBody = z
  .object({
    lines: z
      .array(
        z.object({
          label: z.string().trim().min(1, 'Name each line').max(120),
          sku: z.string().trim().max(64).optional().nullable(),
          stage: z.enum(STAGES).optional().nullable(),
          qty: z.coerce.number().int('Quantities are whole numbers').min(1, 'Each line needs a quantity').max(100_000),
          unitPrice: money,
        }),
      )
      .min(1, 'Add at least one line to the quote')
      .max(50),
    extras: z
      .array(z.object({ label: z.string().trim().min(1, 'Name each extra cost').max(80), amount: money }))
      .max(20)
      .optional()
      .default([]),
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .nullable()
      .transform((v) => v || null),
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date')
      .optional()
      .nullable()
      .transform((v) => v || null),
  })
  .strict()

/**
 * The quote as stored and shown: every total worked out here. Delivery is BULK_DELIVERY_PCT of the
 * mangoes' value (the lines, before extras), kept on the quote with its rate so an older quote, made
 * before the rule or under another rate, still reads as it was sent.
 */
export function priceQuote(q) {
  const lines = q.lines.map((l) => ({ label: l.label, ...(l.sku ? { sku: l.sku } : {}), ...(l.stage ? { stage: l.stage } : {}), qty: l.qty, unitPrice: l.unitPrice, linePrice: l.qty * l.unitPrice }))
  const extras = (q.extras ?? []).map((x) => ({ label: x.label, amount: x.amount }))
  const subtotal = lines.reduce((t, l) => t + l.linePrice, 0)
  const extrasTotal = extras.reduce((t, x) => t + x.amount, 0)
  const deliveryFee = Math.round((subtotal * BULK_DELIVERY_PCT) / 100)
  return { lines, extras, note: q.note ?? null, validUntil: q.validUntil ?? null, subtotal, extrasTotal, deliveryPct: BULK_DELIVERY_PCT, deliveryFee, total: subtotal + extrasTotal + deliveryFee }
}

/** "40 × Alphonso 3kg Box, special packaging" for the WhatsApp message. */
const quoteSummary = (q) => oneLine([...q.lines.map((l) => `${l.qty} × ${l.label}`), ...q.extras.map((x) => x.label.toLowerCase())].join(', '), 200)

/** The quote as words, for the panel's "Open in WhatsApp" link and the record. */
export function quoteText(e, q) {
  const r = (p) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  return [
    `Hi ${e.name}, here is your VMR Mangoes quote for bulk enquiry ${formatOrderNumber(e.number)}:`,
    ...q.lines.map((l) => `• ${l.label}: ${l.qty} × ${r(l.unitPrice)} = ${r(l.linePrice)}`),
    ...q.extras.map((x) => `• ${x.label}: ${r(x.amount)}`),
    ...(q.deliveryFee ? [`• Delivery (${q.deliveryPct}% of the order value): ${r(q.deliveryFee)}`] : []),
    `Total: ${r(q.total)}`,
    ...(q.validUntil ? [`Valid until ${q.validUntil}`] : []),
    ...(q.note ? [q.note] : []),
    `See it and accept it here: ${quoteLink(e.id)}`,
  ].join('\n')
}

async function lockEnquiry(c, id) {
  const { rows } = await c.query('SELECT * FROM bulk_enquiries WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Enquiry not found')
  return rows[0]
}

/**
 * Staff price an enquiry. A new quote replaces the last one (status back to QUOTED, unseen),
 * and any earlier quote message still waiting in the outbox is skipped, so the customer never
 * gets an old price after a new one.
 */
export async function sendQuote(c, id, input, admin) {
  const e = await lockEnquiry(c, id)
  if (e.status === 'CLOSED') throw conflict('This enquiry is closed. Reopen it by asking the customer to send a new one.', 'ENQUIRY_CLOSED')
  if (ORDER_STATUSES.includes(e.status)) throw conflict('This is a bulk order paid at bulk prices: it has no quote. Use its status and refund actions.', 'BULK_ORDER_NO_QUOTE')
  if (e.kind === 'FARM_VISIT') throw conflict('A farm visit enquiry has no quote: call the customer and plan the visit.', 'FARM_VISIT_NO_QUOTE')
  // A quote that is already out of date when sent can't be accepted: refused, so staff fix the date.
  if (input.validUntil && input.validUntil < todayIST()) throw new HttpError(400, 'VALID_UNTIL_PAST', `"Valid until" is before today (${todayIST()}). Choose today or a later date.`)
  const q = priceQuote(input)
  const at = now()
  const { rows: count } = await c.query(`SELECT count(*)::int AS n FROM bulk_enquiry_events WHERE enquiry_id = $1 AND type = 'QUOTED'`, [id])
  const round = count[0].n + 1
  await c.query(
    `UPDATE bulk_enquiries SET quote = $2, status = 'QUOTED', quoted_at = $3, quoted_by = $4, quote_seen_at = NULL, responded_at = NULL, customer_message = NULL, updated_at = $3 WHERE id = $1`,
    [id, JSON.stringify(q), at, admin.id],
  )
  await addEvent(c, id, 'QUOTED', { type: 'staff', id: admin.id }, { round, total: q.total, by: admin.email, quote: q })
  await c.query(
    `UPDATE notifications SET status = 'SKIPPED', last_error = 'replaced by a newer quote' WHERE bulk_enquiry_id = $1 AND kind = 'BULK_QUOTE' AND status = 'PENDING'`,
    [id],
  )
  await addMessage(c, {
    enquiryId: id, kind: 'BULK_QUOTE', eventId: `${id}:quote:${round}`, phone: e.phone,
    params: [oneLine(e.name, 60) || 'there', formatOrderNumber(e.number), rupeeWords(q.total), quoteSummary(q) || 'your bulk order', quoteLink(id)],
  })
  if (e.customer_id) await enqueueLinkPush(c, e.customer_id, `${id}:quote:${round}`, 'BULK_QUOTE', `/account?enquiry=${encodeURIComponent(id)}`)
  await notifyEvent(c, 'bulk.enquiry', { id, number: e.number, status: 'QUOTED', change: 'quoted' })
  return { round, quote: q }
}

export async function closeEnquiry(c, id, admin, reason) {
  const e = await lockEnquiry(c, id)
  if (e.status === 'CLOSED') return
  if (e.kind === 'FARM_VISIT' && !reason) throw new HttpError(400, 'VALIDATION_ERROR', 'Say why the farm visit enquiry is closed.')
  if (ORDER_STATUSES.includes(e.status)) throw conflict('A bulk order paid online is cancelled (and refunded) with Cancel order, not closed.', 'BULK_ORDER_NOT_CLOSABLE')
  const at = now()
  await c.query(`UPDATE bulk_enquiries SET status = 'CLOSED', closed_at = $2, close_reason = $3, updated_at = $2 WHERE id = $1`, [id, at, reason || null])
  await addEvent(c, id, 'CLOSED', { type: 'staff', id: admin.id }, { by: admin.email, ...(reason ? { reason } : {}) })
  await notifyEvent(c, 'bulk.enquiry', { id, number: e.number, status: 'CLOSED', change: 'closed' })
}

export async function addNote(c, id, admin, note) {
  await lockEnquiry(c, id)
  await addEvent(c, id, 'NOTE', { type: 'staff', id: admin.id }, { by: admin.email, text: note })
  await c.query('UPDATE bulk_enquiries SET updated_at = $2 WHERE id = $1', [id, now()])
}

// ---------------------------------------------------------------- the customer's side

/** The customer's own enquiries: sent signed in, or from the number they sign in with. */
const OWN = '(customer_id = $1 OR phone = (SELECT phone FROM customers WHERE id = $1))'

export async function ownEnquiries(db, customerId) {
  const { rows } = await db.query(`SELECT * FROM bulk_enquiries WHERE ${OWN} ORDER BY created_at DESC LIMIT 50`, [customerId])
  return rows.map(customerView)
}

async function ownLocked(c, customerId, id) {
  const { rows } = await c.query(`SELECT * FROM bulk_enquiries WHERE id = $2 AND ${OWN} FOR UPDATE`, [customerId, id])
  if (!rows.length) throw notFound('Enquiry not found')
  return rows[0]
}

export async function ownEnquiry(db, customerId, id) {
  const { rows } = await db.query(`SELECT * FROM bulk_enquiries WHERE id = $2 AND ${OWN}`, [customerId, id])
  if (!rows.length) throw notFound('Enquiry not found')
  return customerView(rows[0])
}

/** The customer opened the quote: the shop's badge and banner go. */
export async function markSeen(c, customerId, id) {
  const e = await ownLocked(c, customerId, id)
  if (e.quote && !e.quote_seen_at) {
    await c.query('UPDATE bulk_enquiries SET quote_seen_at = $2 WHERE id = $1', [id, now()])
    await addEvent(c, id, 'SEEN', { type: 'customer', id: customerId })
  }
  return customerView((await c.query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0])
}

export async function respond(c, customerId, id, decision, message) {
  const e = await ownLocked(c, customerId, id)
  if (e.status !== 'QUOTED' || !e.quote) {
    throw conflict(e.status === 'ACCEPTED' || e.status === 'DECLINED' ? 'You already answered this quote.' : 'There is no quote to answer yet.', 'NOT_QUOTED')
  }
  if (e.quote.validUntil && e.quote.validUntil < todayIST()) {
    throw conflict('This quote has expired. Message us and we will send a new one.', 'QUOTE_EXPIRED')
  }
  const status = decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED'
  const at = now()
  await c.query(
    `UPDATE bulk_enquiries SET status = $2, responded_at = $3, customer_message = $4, quote_seen_at = COALESCE(quote_seen_at, $3), customer_id = COALESCE(customer_id, $5), updated_at = $3 WHERE id = $1`,
    [id, status, at, message, customerId],
  )
  await addEvent(c, id, status, { type: 'customer', id: customerId }, { total: e.quote.total, ...(message ? { message } : {}) })
  await notifyEvent(c, 'bulk.enquiry', { id, number: e.number, status, change: 'responded' })
  return customerView((await c.query('SELECT * FROM bulk_enquiries WHERE id = $1', [id])).rows[0])
}

/** What the shop shows (paise; the shop's client turns them into rupees). */
export function customerView(e) {
  return {
    id: e.id, number: e.number, kind: e.kind ?? 'ENQUIRY', status: e.status, createdAt: e.created_at,
    // A paid order's line carries its prices in paise, named …Paise so the shop's client leaves them as they are.
    lines: (e.lines ?? []).map(({ unitPrice, shopUnitPrice, linePrice, shopLinePrice, ...l }) => ({
      ...l, label: lineLabel(l), ...(unitPrice != null ? { unitPaise: unitPrice, shopUnitPaise: shopUnitPrice, linePaise: linePrice, shopLinePaise: shopLinePrice } : {}),
    })), quantityKg: e.quantity_kg, boxes: boxes(e.lines), ripeness: e.ripeness, city: e.city,
    quote: e.quote ?? null, quotedAt: e.quoted_at ?? null, quoteSeenAt: e.quote_seen_at ?? null,
    unread: Boolean(e.quote && !e.quote_seen_at && e.status === 'QUOTED'),
    respondedAt: e.responded_at ?? null, customerMessage: e.customer_message ?? null, closedAt: e.closed_at ?? null,
    // A bulk order paid online (bulk-orders.js): its money, payment, cancel window and refund; null for the rest.
    order: bulkOrderView(e),
    // A farm visit enquiry: what was asked and, once agreed, the visit date; null for the rest.
    farmVisit: farmVisitView(e),
  }
}

/** A farm visit enquiry's own fields (kind FARM_VISIT), as the shop and the panel show them. */
export function farmVisitView(e) {
  if (e.kind !== 'FARM_VISIT') return null
  const day = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null)
  return {
    variety: e.farm_variety ?? null, kg: e.quantity_kg, preferredDate: day(e.visit_date), flexible: Boolean(e.visit_flexible), people: e.people ?? null,
    plannedDate: day(e.planned_visit_date), contactedAt: e.contacted_at ?? null, visitPlannedAt: e.visit_planned_at ?? null, visitedAt: e.visited_at ?? null,
    closeReason: e.close_reason ?? null,
  }
}

// ---------------------------------------------------------------- staff

export function staffRow(e) {
  return {
    id: e.id, number: e.number, kind: e.kind ?? 'ENQUIRY', status: e.status, createdAt: e.created_at, updatedAt: e.updated_at,
    name: e.name, business: e.business, phone: e.phone, city: e.city, customerId: e.customer_id,
    quantityKg: e.quantity_kg, boxes: boxes(e.lines), total: e.quote?.total ?? e.total ?? null, quotedAt: e.quoted_at ?? null,
    quoteSeenAt: e.quote_seen_at ?? null, respondedAt: e.responded_at ?? null,
    // A bulk order paid online: what was paid, and how its payment and refund stand.
    paid: e.kind === 'ORDER' && e.total != null, paymentStatus: e.payment_status ?? null, paidAmount: e.paid_amount ?? null, paidAt: e.paid_at ?? null,
    refundStatus: e.refund_requested_at ? (e.refunded_at ? (e.refund_status === 'processed' ? 'REFUNDED' : 'REFUND_SENT') : e.refund_gave_up_at ? 'NEEDS_MANAGER' : 'REFUND_DUE') : null,
    farmVisit: farmVisitView(e),
  }
}

export async function staffList(db, { status = null, q = null, kind = null } = {}) {
  // B-743 406 080, #b743406080 or blk-7 find the number as stored (order-number.js); a name or a city as typed.
  if (q) q = normaliseOrderNumber(q)
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null
  const digits = q ? q.replace(/\D/g, '') : ''
  const { rows } = await db.query(
    `SELECT * FROM bulk_enquiries
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR number ILIKE $2 OR name ILIKE $2 OR business ILIKE $2 OR city ILIKE $2 OR ($3 <> '' AND phone LIKE '%' || $3 || '%'))
        AND ($4::text IS NULL OR kind = $4)
      ORDER BY (kind = 'ORDER' AND total IS NOT NULL AND status IN ('PAID', 'CONFIRMED', 'DISPATCHED')) DESC,
               (status IN ('NEW', 'QUOTED', 'ACCEPTED')) DESC, created_at DESC LIMIT 200`,
    [status, like, digits.length >= 4 ? digits : '', kind],
  )
  const { rows: counts } = await db.query('SELECT kind, status, count(*)::int AS n FROM bulk_enquiries GROUP BY kind, status')
  const mine = kind ? counts.filter((r) => r.kind === kind) : counts
  const byStatus = Object.fromEntries(BULK_STATUSES.map((s) => [s, 0]))
  for (const r of mine) byStatus[r.status] += r.n
  // Per kind, for the panel's three lists and their badges: ORDER, ENQUIRY, FARM_VISIT → { status: n, ALL }.
  const kinds = Object.fromEntries(BULK_KINDS.map((k) => [k, { ALL: 0 }]))
  for (const r of counts) {
    const k = kinds[r.kind ?? 'ENQUIRY'] ?? (kinds[r.kind] = { ALL: 0 })
    k[r.status] = (k[r.status] ?? 0) + r.n
    k.ALL += r.n
  }
  return { items: rows.map(staffRow), counts: { ...byStatus, ALL: mine.reduce((t, r) => t + r.n, 0) }, kinds }
}

export async function staffDetail(db, id) {
  const { rows } = await db.query(
    `SELECT e.*, a.email AS quoted_by_email FROM bulk_enquiries e LEFT JOIN admin_users a ON a.id = e.quoted_by WHERE e.id = $1`,
    [id],
  )
  if (!rows.length) throw notFound('Enquiry not found')
  const e = rows[0]
  const { rows: events } = await db.query(
    `SELECT v.id, v.type, v.actor_type, v.actor_id, v.detail, v.created_at, a.email AS staff_email
       FROM bulk_enquiry_events v LEFT JOIN admin_users a ON v.actor_type = 'staff' AND a.id = v.actor_id
      WHERE v.enquiry_id = $1 ORDER BY v.created_at, v.id`,
    [id],
  )
  const { rows: messages } = await db.query(
    `SELECT id, kind, status, provider_id, delivery_status, last_error, sent_at, created_at, event_id FROM notifications WHERE bulk_enquiry_id = $1 ORDER BY created_at DESC`,
    [id],
  )
  return {
    ...staffRow(e),
    email: e.email, notes: e.notes, ripeness: e.ripeness,
    // Each requested line with its catalogue price (paise), the quote builder's starting point.
    lines: (e.lines ?? []).map((l) => {
      const p = findProduct(l.sku)
      // A bulk box of another size (packKg) is priced from the SKU's own box, by weight.
      const scale = l.packKg && boxKg(l.sku) ? l.packKg / boxKg(l.sku) : 1
      return {
        ...l, label: lineLabel(l), name: l.packKg ? `${p?.variety ?? l.sku} ${l.packKg}kg bulk box` : (p?.name ?? l.sku), variety: p?.variety ?? null,
        boxSize: l.packKg ? `${l.packKg}kg` : (p?.boxSize ?? null), listPrice: p?.price != null ? Math.round(p.price * scale) : null,
        // Today's bulk price (bulk-price.js): the quote builder's starting point (a quote can be lower). A paid order's
        // line carries the price it was paid at (unitPrice).
        bulkPrice: boxPrices(l.sku, l.packKg ?? null)?.bulkPrice ?? null,
      }
    }),
    quote: e.quote ?? null, quotedByEmail: e.quoted_by_email ?? null, customerMessage: e.customer_message ?? null, closedAt: e.closed_at ?? null,
    quoteText: e.quote ? quoteText(e, e.quote) : null,
    order: bulkOrderView(e), deliveryAddress: e.delivery_address ?? null, pincode: e.pincode ?? null, paymentId: e.payment_id ?? null,
    paymentMethod: e.payment_details?.method ?? e.payment_method ?? null, cancelReason: e.cancel_reason ?? null,
    refundId: e.refund_id ?? null, refundRequestedAt: e.refund_requested_at ?? null, refundedAt: e.refunded_at ?? null,
    closeReason: e.close_reason ?? null,
    events: events.map((v) => ({ id: v.id, type: v.type, actor: v.actor_type === 'staff' ? (v.staff_email ?? 'staff') : v.actor_type, detail: v.detail, at: v.created_at })),
    messages: messages.map((m) => ({
      id: m.id, kind: m.kind, status: m.status, round: m.kind === 'BULK_QUOTE' ? Number(String(m.event_id).split(':').pop()) || null : null,
      deliveryStatus: m.provider_id === 'log' ? 'logged' : (m.delivery_status ?? null),
      error: m.status === 'FAILED' || m.status === 'SKIPPED' ? (m.last_error ?? null) : null, sentAt: m.sent_at ?? null, createdAt: m.created_at,
    })),
    whatsappOn: env.WHATSAPP_BULK_UPDATES,
  }
}

// ---------------------------------------------------------------- farm visit enquiries (kind FARM_VISIT, migration 087)

/** The shop's farm visit form. Signing in is not needed; a signed-in sender's is linked to their account. */
export const farmVisitBody = z
  .object({
    name: text(100, 'the name').min(1, 'Enter your name'),
    phone: bulkPhone,
    city: text(100, 'the city').min(1, 'Enter your city'),
    // A variety we sell, or null: "Not sure yet".
    variety: z.string().trim().max(80).optional().nullable().transform((v) => v || null),
    kg: z.coerce.number({ message: 'Enter about how many kg' }).int('Whole kilograms only').min(FARM_VISIT_MIN_KG, `Farm visits are for ${FARM_VISIT_MIN_KG} kg and above`).max(100_000),
    visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date').optional().nullable().transform((v) => v || null),
    flexible: z.boolean().optional().default(false),
    people: z.coerce.number({ message: 'Enter how many people are coming' }).int('Whole people only').min(1, 'At least one person is coming').max(500),
    notes: optionalText(1000, 'the note'),
  })
  .strict()

const dayWords = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
/** "150 kg of Alphonso, 6 people, around Sat, 12 Dec" for the WhatsApp message. */
const farmVisitSummary = (b) => oneLine(`${b.kg} kg${b.variety ? ` of ${b.variety}` : ''}, ${b.people} ${b.people === 1 ? 'person' : 'people'}, ${b.visitDate ? `around ${dayWords(b.visitDate)}` : 'dates flexible'}`, 200)

/**
 * Saves a farm visit enquiry from the shop: "we got it" on WhatsApp (FARM_VISIT_ENQUIRY_RECEIVED) and the panel's live
 * event. The same Idempotency-Key rules and daily per-phone limit as an enquiry (the key counts for the same sender only).
 */
export async function createFarmVisitEnquiry(c, b, { customerId = null, idempotencyKey = null } = {}) {
  const key = idempotencyKey ? `farmvisit:${customerId ?? 'anon'}:${b.phone}:${idempotencyKey}` : null
  const hash = key ? requestHash(b) : null
  if (key) {
    const replay = await replayEnquiry(c, key, hash)
    if (replay) return replay
  }
  if (b.visitDate && b.visitDate < todayIST()) throw new HttpError(400, 'VALIDATION_ERROR', 'The visit date has passed. Choose today or a later date, or tick “I’m flexible”.', { field: 'visitDate' })
  if (b.variety && !shopProducts().some((p) => p.variety === b.variety)) throw new HttpError(400, 'VALIDATION_ERROR', `We don't grow ${b.variety}. Choose a mango from the list, or "Not sure yet".`, { field: 'variety' })
  const at = now()
  const { rows: recent } = await c.query(`SELECT count(*)::int AS n FROM bulk_enquiries WHERE phone = $1 AND created_at > $2`, [b.phone, new Date(at.getTime() - 86_400_000)])
  if (recent[0].n >= env.BULK_ENQUIRY_DAILY_LIMIT) {
    throw new HttpError(429, 'BULK_LIMIT', 'You have sent several enquiries today. We will be in touch about them; message us on WhatsApp if anything changed.')
  }
  const id = newId('benq')
  if (key) {
    const ins = await c.query('INSERT INTO idempotency_keys (key, order_id, created_at, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, id, at, hash])
    if (!ins.rowCount) {
      const first = await replayEnquiry(c, key, hash)
      if (first) return first
      throw conflict('This enquiry is still being sent. Try again in a moment.', 'IDEMPOTENCY_IN_PROGRESS')
    }
  }
  const number = await nextOrderNumber(c, 'B')
  await c.query(
    `INSERT INTO bulk_enquiries (id, number, customer_id, name, phone, city, notes, lines, quantity_kg, idempotency_key, created_at, updated_at, kind,
                                 farm_variety, visit_date, visit_flexible, people)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '[]', $8, $9, $10, $10, 'FARM_VISIT', $11, $12, $13, $14)`,
    [id, number, customerId, b.name, b.phone, b.city, b.notes, b.kg, key, at, b.variety, b.visitDate, b.flexible || !b.visitDate, b.people],
  )
  await addEvent(c, id, 'RECEIVED', customerId ? { type: 'customer', id: customerId } : { type: 'system' }, { kind: 'FARM_VISIT', kg: b.kg, people: b.people })
  await addReceivedMessage(c, { enquiryId: id, kind: 'FARM_VISIT_ENQUIRY_RECEIVED', eventId: `${id}:received`, phone: b.phone, params: [oneLine(b.name, 60) || 'there', formatOrderNumber(number), farmVisitSummary(b)] })
  await notifyEvent(c, 'bulk.enquiry', { id, number, status: 'NEW', change: 'created', kind: 'FARM_VISIT' })
  return { status: 201, body: { id, number, status: 'NEW', kind: 'FARM_VISIT' } }
}

/** The steps staff move a farm visit enquiry through, and where each may come from. CLOSED is closeEnquiry (with a reason). */
export const FARM_VISIT_MOVES = { CONTACTED: ['NEW'], VISIT_PLANNED: ['NEW', 'CONTACTED', 'VISIT_PLANNED'], VISITED: ['VISIT_PLANNED'] }
const FARM_VISIT_STAMP = { CONTACTED: 'contacted_at', VISIT_PLANNED: 'visit_planned_at', VISITED: 'visited_at' }

/** Staff move a farm visit enquiry on: "Called customer", "Visit planned" (with the agreed date) or "Visited". */
export async function moveFarmVisit(c, id, to, admin, { date = null, note = null } = {}) {
  const e = await lockEnquiry(c, id)
  if (e.kind !== 'FARM_VISIT') throw conflict('This is not a farm visit enquiry.', 'NOT_FARM_VISIT')
  if (!(FARM_VISIT_MOVES[to] ?? []).includes(e.status)) {
    throw conflict(e.status === 'CLOSED' ? 'This farm visit enquiry is closed.' : `A farm visit enquiry that is ${e.status.toLowerCase().replace('_', ' ')} can't be marked ${to.toLowerCase().replace('_', ' ')}.`, 'INVALID_TRANSITION')
  }
  if (to === 'VISIT_PLANNED') {
    if (!date) throw new HttpError(400, 'VALIDATION_ERROR', 'Give the visit date agreed with the customer.', { field: 'date' })
    if (date < todayIST()) throw new HttpError(400, 'VALIDATION_ERROR', 'The visit date has passed. Choose today or a later date.', { field: 'date' })
  }
  const at = now()
  await c.query(
    `UPDATE bulk_enquiries SET status = $2, ${FARM_VISIT_STAMP[to]} = $3, planned_visit_date = COALESCE($4, planned_visit_date), updated_at = $3 WHERE id = $1`,
    [id, to, at, to === 'VISIT_PLANNED' ? date : null],
  )
  await addEvent(c, id, to, { type: 'staff', id: admin.id }, { by: admin.email, ...(to === 'VISIT_PLANNED' ? { date } : {}), ...(note ? { text: note } : {}) })
  await notifyEvent(c, 'bulk.enquiry', { id, number: e.number, status: to, change: 'moved', kind: 'FARM_VISIT' })
}

/** New farm visit enquiries waiting for a call: for Today and Needs attention. */
export async function newFarmVisits(db) {
  const { rows } = await db.query(`SELECT count(*)::int AS n, min(created_at) AS oldest FROM bulk_enquiries WHERE kind = 'FARM_VISIT' AND status = 'NEW'`)
  return { new: rows[0].n, oldestAt: rows[0].oldest ?? null }
}
