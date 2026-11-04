// Live updates for the panel (Mango Ops v2, docs/design/ops-dashboard-v2.md §6): GET /admin/v1/events.
//
// Writers call notify(c, type, data) inside their transaction: pg_notify is transactional, so an event
// goes out only when the change commits, and every instance of the API hears it through one LISTEN
// connection (Neon: the direct, unpooled URL; PgBouncer in transaction mode cannot LISTEN). Inside the
// process an EventEmitter fans each one out to the open streams. When LISTEN cannot connect the streams
// poll order_events and rider_locations every 10 seconds instead (eventsMode() says which).
import { EventEmitter } from 'node:events'
import pg from 'pg'
import { now } from './clock.js'
import { query } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'

export const CHANNEL = 'mango_events'
/** pg_notify refuses payloads of 8000 bytes or more; events are a few ids, far under this. */
const MAX_PAYLOAD = 7900

const bus = new EventEmitter()
bus.setMaxListeners(0)

/**
 * Queues an event for when the transaction on `c` commits. Never throws: a bad payload is dropped
 * before it reaches the database (a failed statement would abort the caller's transaction).
 */
export async function notify(c, type, data) {
  let payload
  try {
    payload = JSON.stringify({ type, data })
  } catch {
    return
  }
  if (payload.length > MAX_PAYLOAD) return
  await c.query('SELECT pg_notify($1, $2)', [CHANNEL, payload])
}

/** order.changed { id, number, status, date } for the order's new status, on commit (orders.js addEvent). */
export async function notifyOrder(c, orderId, status) {
  await c.query(
    `SELECT pg_notify($1, json_build_object('type', 'order.changed', 'data', json_build_object('id', o.id, 'number', o.number, 'status', $3::text, 'date', o.delivery_date))::text)
       FROM orders o WHERE o.id = $2`,
    [CHANNEL, orderId, status],
  )
}

/** Delivers an event to this process's streams now (tests, and events that need no commit). */
export const publish = (type, data) => bus.emit('event', { type, data })

let subscribers = 0
/** Listens to every event; returns the function that stops listening. */
export function subscribe(fn) {
  bus.on('event', fn)
  subscribers++
  ensureListening()
  return () => {
    bus.off('event', fn)
    subscribers--
    if (subscribers === 0) scheduleStop()
  }
}

// ---------------------------------------------------------------- LISTEN bridge

let client = null
/** 'off' (nobody listening), 'connecting', 'listening' or 'polling' (LISTEN failed: streams poll). */
let mode = 'off'
let retryMs = 1_000
let retryTimer = null
let stopTimer = null
let warned = false

export const eventsMode = () => mode

function ensureListening() {
  if (stopTimer) {
    clearTimeout(stopTimer)
    stopTimer = null
  }
  if (client || mode === 'connecting' || retryTimer) return
  void connect()
}

async function connect() {
  mode = 'connecting'
  const c = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL })
  c.on('error', (err) => dropped(c, err))
  c.on('end', () => dropped(c, null))
  c.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return
    try {
      const { type, data } = JSON.parse(msg.payload)
      if (typeof type === 'string') bus.emit('event', { type, data })
    } catch {
      // Not one of ours.
    }
  })
  try {
    await c.connect()
    // Never what keeps the process alive (tests, a server shutting down).
    c.connection?.stream?.unref?.()
    await c.query(`LISTEN ${CHANNEL}`)
    if (subscribers === 0) {
      await c.end().catch(() => {})
      mode = 'off'
      return
    }
    client = c
    mode = 'listening'
    retryMs = 1_000
    warned = false
  } catch (err) {
    c.end().catch(() => {})
    failed(err)
  }
}

function dropped(c, err) {
  if (client !== c) return
  client = null
  if (subscribers === 0) {
    mode = 'off'
    return
  }
  failed(err)
}

function failed(err) {
  mode = 'polling'
  if (!warned) {
    warned = true
    logger.warn({ err }, 'live updates: LISTEN unavailable, streams poll instead')
  }
  if (subscribers === 0) {
    mode = 'off'
    return
  }
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (subscribers > 0) void connect()
  }, retryMs)
  retryTimer.unref()
  retryMs = Math.min(retryMs * 2, 60_000)
}

function scheduleStop() {
  if (stopTimer) clearTimeout(stopTimer)
  const stop = () => {
    stopTimer = null
    if (subscribers === 0) void stopEvents()
  }
  if (!env.EVENTS_LISTEN_LINGER_MS) return stop()
  stopTimer = setTimeout(stop, env.EVENTS_LISTEN_LINGER_MS)
  stopTimer.unref()
}

/** Closes the LISTEN connection (last stream gone, or a test's teardown). */
export async function stopEvents() {
  if (retryTimer) clearTimeout(retryTimer)
  if (stopTimer) clearTimeout(stopTimer)
  retryTimer = null
  stopTimer = null
  const c = client
  client = null
  mode = 'off'
  if (c) await c.end().catch(() => {})
}

// ---------------------------------------------------------------- polling fallback

/**
 * What changed after `since` (a Date), for a stream whose process has no LISTEN connection:
 * order steps and rider positions, oldest first. Returns { events, cursor }.
 */
export async function changesSince(since) {
  const cursor = now()
  const [orders, spots] = await Promise.all([
    query(
      `SELECT DISTINCT ON (e.order_id) e.order_id, e.status, o.number, o.delivery_date, e.created_at
         FROM order_events e JOIN orders o ON o.id = e.order_id
        WHERE e.created_at > $1 AND e.created_at <= $2 ORDER BY e.order_id, e.created_at DESC`,
      [since, cursor],
    ),
    query(
      `SELECT DISTINCT ON (rider_id) rider_id, at FROM rider_locations WHERE at > $1 AND at <= $2 ORDER BY rider_id, at DESC`,
      [since, cursor],
    ),
  ])
  const events = [
    ...orders.rows.map((r) => ({ at: r.created_at, type: 'order.changed', data: { id: r.order_id, number: r.number, status: r.status, date: r.delivery_date } })),
    ...spots.rows.map((r) => ({ at: r.at, type: 'rider.position', data: { riderId: r.rider_id, at: r.at } })),
  ].sort((a, b) => a.at - b.at)
  return { events: events.map(({ type, data }) => ({ type, data })), cursor }
}

// ---------------------------------------------------------------- attention count

let attention = { count: null, at: 0 }
let attentionTimer = null
const ATTENTION_EVERY_MS = 60_000

/**
 * The Needs attention count, at most a minute old, while a stream is open. `load` is
 * () => Promise<number> (admin/reports.js attentionCount of attentionReport), passed in so this
 * module does not import the reports. Emits attention.changed when the count moves.
 */
export async function attentionNow(load) {
  if (attention.count !== null && Date.now() - attention.at < ATTENTION_EVERY_MS) return attention.count
  const count = await load()
  const before = attention.count
  attention = { count, at: Date.now() }
  if (before !== null && before !== count) bus.emit('event', { type: 'attention.changed', data: { count } })
  return count
}

/** Re-reads the count every minute while anyone listens. */
export function watchAttention(load) {
  if (attentionTimer) return
  attentionTimer = setInterval(() => {
    if (subscribers === 0) {
      clearInterval(attentionTimer)
      attentionTimer = null
      return
    }
    attentionNow(load).catch((err) => logger.warn({ err }, 'live updates: attention count failed'))
  }, ATTENTION_EVERY_MS)
  attentionTimer.unref()
}

/** Test hook: forget the cached count. */
export const resetAttention = () => {
  attention = { count: null, at: 0 }
}
