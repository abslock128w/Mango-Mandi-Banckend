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
import { z } from 'zod'
import { now, todayIST } from './clock.js'
import { env } from './env.js'
import { conflict, HttpError, notFound } from './errors.js'
import { notify as notifyEvent } from './events.js'
import { newId } from './ids.js'
import { findProduct, productName } from './products.js'
import { enqueueLinkPush } from './push.js'
import { SALE_STAGES, STAGES } from './stage.js'

export const BULK_STATUSES = ['NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED']
/** An enquiry asks for a price; an order is placed directly and an agent phones to confirm it. */
export const BULK_KINDS = ['ENQUIRY', 'ORDER']
/** The smallest bulk order, in kg. An enquiry may be for any amount (the owner's rule: the enquiry is always open). */
export const BULK_MIN_KG = 100
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

/** The box's weight in kg from its size ("3kg" → 3), 0 when unknown. */
const boxKg = (sku) => parseFloat(findProduct(sku)?.boxSize ?? '') || 0

/** The lines as stored: known boxes only, kg from the box size. */
function cleanLines(lines) {
  const out = []
  for (const l of lines) {
    const p = findProduct(l.sku)
    if (!p) throw new HttpError(400, 'VALIDATION_ERROR', `We don't sell ${l.sku}. Refresh the page and build the list again.`)
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

const shopUrl = () => env.CUSTOMER_ORIGIN.split(',')[0]?.trim().replace(/\/$/, '') || 'https://mandimangoes.in'
/** Where the customer reads the quote: the shop's Account page, opened at this enquiry. */
export const quoteLink = (id) => `${shopUrl()}/account?enquiry=${encodeURIComponent(id)}`
const rupeeWords = (paise) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
/** One line, at most n characters: template variables may not hold line breaks. */
const oneLine = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

async function addEvent(c, enquiryId, type, actor, detail = null) {
  await c.query(
    'INSERT INTO bulk_enquiry_events (id, enquiry_id, type, actor_type, actor_id, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [newId('bev'), enquiryId, type, actor.type, actor.id ?? null, detail ? JSON.stringify(detail) : null, now()],
  )
}

async function addMessage(c, { enquiryId, kind, eventId, phone, params }) {
  if (!env.WHATSAPP_BULK_UPDATES) return
  const at = now()
  await c.query(
    `INSERT INTO notifications (id, bulk_enquiry_id, event_id, kind, phone, bulk_params, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (event_id, kind) DO NOTHING`,
    [newId('ntf'), enquiryId, eventId, kind, phone, JSON.stringify(params), at],
  )
}

/**
 * Saves an enquiry from the shop (and queues "we got your enquiry"). A repeated
 * Idempotency-Key answers the first enquiry again (status 200) instead of a second one.
 * More than BULK_ENQUIRY_DAILY_LIMIT from one number in 24 hours is refused.
 */
export async function createEnquiry(c, b, { customerId = null, idempotencyKey = null } = {}) {
  if (idempotencyKey) {
    const { rows } = await c.query('SELECT id, number, status, kind FROM bulk_enquiries WHERE idempotency_key = $1', [idempotencyKey])
    if (rows.length) return { status: 200, body: { id: rows[0].id, number: rows[0].number, status: rows[0].status, kind: rows[0].kind ?? 'ENQUIRY' } }
  }
  const lines = cleanLines(b.lines ?? [])
  const kg = lines.length ? Math.round(lines.reduce((t, l) => t + l.kg, 0)) : b.quantityKg
  if (!kg) throw new HttpError(400, 'VALIDATION_ERROR', 'Tell us how many kg you need.')
  const order = b.kind === 'ORDER'
  if (order) {
    if (!lines.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Add boxes to your bulk list to place a bulk order.')
    if (kg < BULK_MIN_KG) {
      throw new HttpError(400, 'BULK_TOO_SMALL', `Bulk orders start at ${BULK_MIN_KG} kg. Send an enquiry for less, or use the shop's checkout.`)
    }
    if (lines.some((l) => !BULK_PACKS_KG.includes(l.packKg ?? boxKg(l.sku)))) {
      throw new HttpError(400, 'BULK_BOX_SIZE', `Bulk orders are packed in ${BULK_PACKS_KG.join(' kg or ')} kg boxes only.`)
    }
  }
  const at = now()
  const { rows: recent } = await c.query(`SELECT count(*)::int AS n FROM bulk_enquiries WHERE phone = $1 AND created_at > $2`, [b.phone, new Date(at.getTime() - 86_400_000)])
  if (recent[0].n >= env.BULK_ENQUIRY_DAILY_LIMIT) {
    throw new HttpError(429, 'BULK_LIMIT', 'You have sent several enquiries today. We will be in touch about them; message us on WhatsApp if anything changed.')
  }
  const id = newId('benq')
  const { rows: seq } = await c.query(`SELECT 'BLK-' || lpad(nextval('bulk_enquiry_seq')::text, 4, '0') AS n`)
  const number = seq[0].n
  await c.query(
    `INSERT INTO bulk_enquiries (id, number, customer_id, name, business, email, phone, city, notes, lines, quantity_kg, ripeness, idempotency_key, created_at, updated_at, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15)`,
    [id, number, customerId, b.name, b.business, b.email, b.phone, b.city, b.notes, JSON.stringify(lines), kg, b.ripeness, idempotencyKey, at, order ? 'ORDER' : 'ENQUIRY'],
  )
  await addEvent(c, id, 'RECEIVED', customerId ? { type: 'customer', id: customerId } : { type: 'system' }, { kg, boxes: boxes(lines), ...(order ? { kind: 'ORDER' } : {}) })
  await addMessage(c, { enquiryId: id, kind: 'BULK_ENQUIRY_RECEIVED', eventId: `${id}:received`, phone: b.phone, params: [oneLine(b.name, 60) || 'there', number, quantityWords({ quantity_kg: kg, lines })] })
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
    `Hi ${e.name}, here is your MandiMangoes quote for bulk enquiry ${e.number}:`,
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
    params: [oneLine(e.name, 60) || 'there', e.number, rupeeWords(q.total), quoteSummary(q) || 'your bulk order', quoteLink(id)],
  })
  if (e.customer_id) await enqueueLinkPush(c, e.customer_id, `${id}:quote:${round}`, 'BULK_QUOTE', `/account?enquiry=${encodeURIComponent(id)}`)
  await notifyEvent(c, 'bulk.enquiry', { id, number: e.number, status: 'QUOTED', change: 'quoted' })
  return { round, quote: q }
}

export async function closeEnquiry(c, id, admin, reason) {
  const e = await lockEnquiry(c, id)
  if (e.status === 'CLOSED') return
  const at = now()
  await c.query(`UPDATE bulk_enquiries SET status = 'CLOSED', closed_at = $2, updated_at = $2 WHERE id = $1`, [id, at])
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
    lines: (e.lines ?? []).map((l) => ({ ...l, label: lineLabel(l) })), quantityKg: e.quantity_kg, boxes: boxes(e.lines), ripeness: e.ripeness, city: e.city,
    quote: e.quote ?? null, quotedAt: e.quoted_at ?? null, quoteSeenAt: e.quote_seen_at ?? null,
    unread: Boolean(e.quote && !e.quote_seen_at && e.status === 'QUOTED'),
    respondedAt: e.responded_at ?? null, customerMessage: e.customer_message ?? null, closedAt: e.closed_at ?? null,
  }
}

// ---------------------------------------------------------------- staff

export function staffRow(e) {
  return {
    id: e.id, number: e.number, kind: e.kind ?? 'ENQUIRY', status: e.status, createdAt: e.created_at, updatedAt: e.updated_at,
    name: e.name, business: e.business, phone: e.phone, city: e.city, customerId: e.customer_id,
    quantityKg: e.quantity_kg, boxes: boxes(e.lines), total: e.quote?.total ?? null, quotedAt: e.quoted_at ?? null,
    quoteSeenAt: e.quote_seen_at ?? null, respondedAt: e.responded_at ?? null,
  }
}

export async function staffList(db, { status = null, q = null } = {}) {
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null
  const digits = q ? q.replace(/\D/g, '') : ''
  const { rows } = await db.query(
    `SELECT * FROM bulk_enquiries
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR number ILIKE $2 OR name ILIKE $2 OR business ILIKE $2 OR city ILIKE $2 OR ($3 <> '' AND phone LIKE '%' || $3 || '%'))
      ORDER BY created_at DESC LIMIT 200`,
    [status, like, digits.length >= 4 ? digits : ''],
  )
  const { rows: counts } = await db.query('SELECT status, count(*)::int AS n FROM bulk_enquiries GROUP BY status')
  const byStatus = Object.fromEntries(BULK_STATUSES.map((s) => [s, 0]))
  for (const r of counts) byStatus[r.status] = r.n
  return { items: rows.map(staffRow), counts: { ...byStatus, ALL: counts.reduce((t, r) => t + r.n, 0) } }
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
      }
    }),
    quote: e.quote ?? null, quotedByEmail: e.quoted_by_email ?? null, customerMessage: e.customer_message ?? null, closedAt: e.closed_at ?? null,
    quoteText: e.quote ? quoteText(e, e.quote) : null,
    events: events.map((v) => ({ id: v.id, type: v.type, actor: v.actor_type === 'staff' ? (v.staff_email ?? 'staff') : v.actor_type, detail: v.detail, at: v.created_at })),
    messages: messages.map((m) => ({
      id: m.id, kind: m.kind, status: m.status, round: m.kind === 'BULK_QUOTE' ? Number(String(m.event_id).split(':').pop()) || null : null,
      deliveryStatus: m.provider_id === 'log' ? 'logged' : (m.delivery_status ?? null),
      error: m.status === 'FAILED' || m.status === 'SKIPPED' ? (m.last_error ?? null) : null, sentAt: m.sent_at ?? null, createdAt: m.created_at,
    })),
    whatsappOn: env.WHATSAPP_BULK_UPDATES,
  }
}
