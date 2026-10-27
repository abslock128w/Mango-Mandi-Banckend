// The help centre (HELP_CENTRE, docs/care.md). A signed-in customer opens a
// help request, about one of their orders or in general, with a topic from a
// fixed list and a message; the shop answers in the same thread from the
// panel's Help desk. Damaged, wrong or missing mangoes are not a help topic:
// they go through the claim flow (replacement or rejection), which the shop's
// help form links to.
//
// Status: OPEN waits on the shop, WAITING_CUSTOMER on the customer (staff
// replied), RESOLVED is closed. A message from either side reopens a resolved
// request (the customer's to OPEN, staff's to WAITING_CUSTOMER).
import { now } from './clock.js'
import { env } from './env.js'
import { conflict, HttpError, notFound } from './errors.js'
import { newId } from './ids.js'
import { enqueueHelpReply } from './notify.js'

/** The topics a request can have, in the order the shop lists them. */
export const HELP_TOPICS = {
  DELIVERY: 'Delivery or the delivery day',
  PAYMENT: 'Payment or a refund',
  CHANGE_ORDER: 'Changing or cancelling an order',
  SUBSCRIPTION: 'My mango subscription',
  ACCOUNT: 'My account or signing in',
  OTHER: 'Something else',
}
export const HELP_STATUSES = ['OPEN', 'WAITING_CUSTOMER', 'RESOLVED']

/** Message lengths, checked by the API (the database checks 1 to 2000 too). */
export const FIRST_MESSAGE_MIN = 5
export const MESSAGE_MAX = 2000
/** Messages a customer may add to one request in 24 hours: a thread, not a chat flood. */
export const CUSTOMER_REPLIES_PER_DAY = 20
const DAY_MS = 86_400_000

const ticketView = (t) => ({
  id: t.id, number: t.number, topic: t.topic, topicLabel: HELP_TOPICS[t.topic] ?? t.topic, status: t.status,
  order: t.order_id ? { id: t.order_id, number: t.order_number ?? null } : null,
  createdAt: t.created_at, updatedAt: t.updated_at, resolvedAt: t.resolved_at,
  lastMessage: t.last_body != null ? { from: t.last_author === 'STAFF' ? 'MandiMangoes' : 'You', preview: t.last_body.slice(0, 140), at: t.last_at } : undefined,
})

/** Staff messages show as the shop: the customer never sees who on the team wrote. */
const customerMessage = (m) => ({ id: m.id, from: m.author === 'STAFF' ? 'MANDIMANGOES' : 'YOU', body: m.body, at: m.created_at })

async function messages(c, ticketId) {
  return (await c.query('SELECT * FROM help_messages WHERE ticket_id = $1 ORDER BY created_at, id', [ticketId])).rows
}

/** The customer's own requests, newest activity first. */
export async function listOwnTickets(c, customerId) {
  const { rows } = await c.query(
    `SELECT t.*, o.number AS order_number, m.body AS last_body, m.author AS last_author, m.created_at AS last_at
       FROM help_tickets t LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN LATERAL (SELECT body, author, created_at FROM help_messages WHERE ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) m ON TRUE
      WHERE t.customer_id = $1 ORDER BY t.updated_at DESC LIMIT 100`,
    [customerId],
  )
  return rows.map(ticketView)
}

/** One request with its thread; another customer's answers 404, as if it did not exist. */
export async function ownTicket(c, customerId, id) {
  const { rows } = await c.query(
    'SELECT t.*, o.number AS order_number FROM help_tickets t LEFT JOIN orders o ON o.id = t.order_id WHERE t.id = $1 AND t.customer_id = $2',
    [id, customerId],
  )
  if (!rows.length) throw notFound('Help request not found')
  return { ...ticketView(rows[0]), messages: (await messages(c, id)).map(customerMessage) }
}

/**
 * Opens a request. At most HELP_DAILY_LIMIT in 24 hours per customer, counted
 * under a lock on the customer row so two at once can't both slip under it.
 * An order named must be the customer's own.
 */
export async function openTicket(c, customerId, { topic, orderId = null, message }) {
  await c.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId])
  const since = new Date(now().getTime() - DAY_MS)
  const { rows: recent } = await c.query('SELECT COUNT(*)::int AS n FROM help_tickets WHERE customer_id = $1 AND created_at >= $2', [customerId, since])
  if (recent[0].n >= env.HELP_DAILY_LIMIT) {
    throw new HttpError(429, 'HELP_LIMIT', `You have opened ${recent[0].n} help requests today. Add to one of them, or try again tomorrow.`)
  }
  if (orderId) {
    const { rows } = await c.query('SELECT id FROM orders WHERE id = $1 AND customer_id = $2', [orderId, customerId])
    if (!rows.length) throw notFound('Order not found')
  }
  const id = newId('hlp')
  const number = (await c.query(`SELECT 'HLP-' || nextval('help_ticket_seq') AS n`)).rows[0].n
  const at = now()
  await c.query(
    `INSERT INTO help_tickets (id, number, customer_id, order_id, topic, status, created_at, updated_at, last_customer_at)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6, $6)`,
    [id, number, customerId, orderId, topic, at],
  )
  await c.query(`INSERT INTO help_messages (id, ticket_id, author, body, created_at) VALUES ($1, $2, 'CUSTOMER', $3, $4)`, [newId('hms'), id, message, at])
  return ownTicket(c, customerId, id)
}

/** The customer writes again: the request goes back to the shop (OPEN), resolved or not. */
export async function customerReply(c, customerId, id, message) {
  const { rows } = await c.query('SELECT * FROM help_tickets WHERE id = $1 AND customer_id = $2 FOR UPDATE', [id, customerId])
  if (!rows.length) throw notFound('Help request not found')
  const { rows: n } = await c.query(
    `SELECT COUNT(*)::int AS n FROM help_messages WHERE ticket_id = $1 AND author = 'CUSTOMER' AND created_at >= $2`,
    [id, new Date(now().getTime() - DAY_MS)],
  )
  if (n[0].n >= CUSTOMER_REPLIES_PER_DAY) throw new HttpError(429, 'HELP_LIMIT', 'You have sent a lot of messages on this request today. We will answer them; try again tomorrow.')
  const at = now()
  await c.query(`INSERT INTO help_messages (id, ticket_id, author, body, created_at) VALUES ($1, $2, 'CUSTOMER', $3, $4)`, [newId('hms'), id, message, at])
  await c.query(`UPDATE help_tickets SET status = 'OPEN', updated_at = $2, last_customer_at = $2, resolved_at = NULL, resolved_by = NULL WHERE id = $1`, [id, at])
  return ownTicket(c, customerId, id)
}

// ---------------------------------------------------------------- staff

/** '+919876543210' → '******3210': the help desk never shows a full number. */
const masked = (p) => (p ? `******${String(p).slice(-4)}` : null)

const staffTicketView = (t) => ({
  id: t.id, number: t.number, topic: t.topic, topicLabel: HELP_TOPICS[t.topic] ?? t.topic, status: t.status,
  customer: { id: t.customer_id, name: t.customer_name ?? null, phoneMasked: masked(t.customer_phone) },
  order: t.order_id ? { id: t.order_id, number: t.order_number ?? null, status: t.order_status ?? null, deliveryDate: t.order_delivery_date ?? null } : null,
  createdAt: t.created_at, updatedAt: t.updated_at, lastCustomerAt: t.last_customer_at, lastStaffAt: t.last_staff_at,
  resolvedAt: t.resolved_at, resolvedBy: t.resolved_by, messageCount: t.message_count ?? undefined,
})

const STAFF_SELECT = `SELECT t.*, cu.name AS customer_name, cu.phone AS customer_phone, o.number AS order_number, o.status AS order_status,
         o.delivery_date AS order_delivery_date, (SELECT COUNT(*)::int FROM help_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM help_tickets t JOIN customers cu ON cu.id = t.customer_id LEFT JOIN orders o ON o.id = t.order_id`

/**
 * The inbox: open requests first, oldest waiting on top (they have waited
 * longest); then waiting-on-the-customer and resolved, newest first.
 * Filters: status, topic, and q (a request or order number).
 */
export async function inbox(c, { status = null, topic = null, q = null, limit = 200 } = {}) {
  const term = q ? q.trim().toUpperCase() : null
  const { rows } = await c.query(
    `${STAFF_SELECT}
      WHERE ($1::text IS NULL OR t.status = $1) AND ($2::text IS NULL OR t.topic = $2)
        AND ($3::text IS NULL OR t.number = $3 OR o.number = $3)
      ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'WAITING_CUSTOMER' THEN 1 ELSE 2 END,
               CASE WHEN t.status = 'OPEN' THEN extract(epoch FROM t.updated_at) ELSE -extract(epoch FROM t.updated_at) END, t.id
      LIMIT $4`,
    [status, topic, term, limit],
  )
  const { rows: counts } = await c.query(`SELECT status, COUNT(*)::int AS n FROM help_tickets GROUP BY status`)
  return {
    items: rows.map(staffTicketView),
    counts: Object.fromEntries(HELP_STATUSES.map((s) => [s, counts.find((r) => r.status === s)?.n ?? 0])),
  }
}

export async function staffTicket(c, id) {
  const { rows } = await c.query(`${STAFF_SELECT} WHERE t.id = $1`, [id])
  if (!rows.length) throw notFound('Help request not found')
  const msgs = await c.query(
    `SELECT m.*, a.email AS staff_email FROM help_messages m LEFT JOIN admin_users a ON a.id = m.staff_id WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`,
    [id],
  )
  return {
    ...staffTicketView(rows[0]),
    messages: msgs.rows.map((m) => ({ id: m.id, from: m.author, staffEmail: m.author === 'STAFF' ? (m.staff_email ?? null) : null, body: m.body, at: m.created_at })),
  }
}

async function lockTicket(c, id) {
  const { rows } = await c.query('SELECT * FROM help_tickets WHERE id = $1 FOR UPDATE', [id])
  if (!rows.length) throw notFound('Help request not found')
  return rows[0]
}

/** A staff reply: the request now waits on the customer, who is told (push, and WhatsApp once approved). Returns the message id. */
export async function staffReply(c, id, admin, message) {
  await lockTicket(c, id)
  const at = now()
  const messageId = newId('hms')
  await c.query(`INSERT INTO help_messages (id, ticket_id, author, staff_id, body, created_at) VALUES ($1, $2, 'STAFF', $3, $4, $5)`, [messageId, id, admin.id, message, at])
  await c.query(
    `UPDATE help_tickets SET status = 'WAITING_CUSTOMER', updated_at = $2, last_staff_at = $2, resolved_at = NULL, resolved_by = NULL WHERE id = $1`,
    [id, at],
  )
  await enqueueHelpReply(c, id, messageId)
  return messageId
}

export async function resolveTicket(c, id, admin) {
  const t = await lockTicket(c, id)
  if (t.status === 'RESOLVED') throw conflict('This request is already resolved', 'ALREADY_RESOLVED')
  await c.query(`UPDATE help_tickets SET status = 'RESOLVED', resolved_at = $2, resolved_by = $3, updated_at = $2 WHERE id = $1`, [id, now(), admin.email])
}

export async function reopenTicket(c, id) {
  const t = await lockTicket(c, id)
  if (t.status !== 'RESOLVED') throw conflict('Only a resolved request can be reopened', 'NOT_RESOLVED')
  await c.query(`UPDATE help_tickets SET status = 'OPEN', resolved_at = NULL, resolved_by = NULL, updated_at = $2 WHERE id = $1`, [id, now()])
}
