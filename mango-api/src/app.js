// Express app. Middleware order follows the technical plan (section 5).
import { randomUUID, timingSafeEqual } from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { router as adminRouter } from './admin.js'
import { devRouter, router as customerRouter } from './customer.js'
import { loadConfig } from './config.js'
import { isDbUnavailable, isPoolTimeout, query } from './db.js'
import { devRoutesOn, env, onVercel } from './env.js'
import { HttpError } from './errors.js'
import { logger } from './logger.js'
import { httpMetrics, metrics, registry } from './metrics.js'
import { recordWebhookFailure } from './payments.js'
import { handleWhatsAppWebhook } from './chat.js'
import { handleWebhook, verifySignature } from './payments.js'
import { verifyMetaSignature } from './whatsapp.js'
import { lastTickAgeSeconds, runMaintenance } from './maintenance.js'
import { loadProducts } from './products.js'
import { checkDatabaseEnvironment } from './migrate.js'
import { maintenanceReady } from './readiness.js'
import { flushErrors, reportError } from './sentry.js'

const RELOAD_MS = 60_000

// Rules and products are cached in memory. A serverless instance can start at
// any request, so they load on first use and refresh every minute (another
// instance may have changed the rules).
let loadedAt = 0
let loading = null
async function ensureLoaded() {
  if (Date.now() - loadedAt < RELOAD_MS) return
  loading ??= checkedDatabase()
    .then(() => Promise.all([loadConfig(), loadProducts()]))
    .then(() => {
      loadedAt = Date.now()
    })
    .finally(() => {
      loading = null
    })
  await loading
}

// Once per instance: refuse to serve a database that belongs to another environment.
let dbChecked = null
let lastOutageReport = 0
const checkedDatabase = () => (dbChecked ??= checkDatabaseEnvironment({ query }).catch((err) => {
  dbChecked = null
  // Unreachable is not "wrong": answer it as an outage (503 UNAVAILABLE) below.
  if (isDbUnavailable(err)) throw err
  logger.fatal({ err }, 'database environment check failed')
  throw new HttpError(503, 'WRONG_DATABASE', 'Service unavailable')
}))

const bearer = (req) => (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY)

  app.use(helmet())
  app.use(
    cors({
      origin: `${env.ADMIN_ORIGIN},${env.CUSTOMER_ORIGIN}`.split(',').map((s) => s.trim()).filter(Boolean),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Session'],
    }),
  )
  app.use(cookieParser())
  app.use((req, res, next) => {
    req.id = `req_${randomUUID().slice(0, 10)}`
    res.setHeader('X-Request-Id', req.id)
    next()
  })
  app.use(httpMetrics)
  app.use((req, res, next) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      logger.info({ reqId: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'request')
    })
    next()
  })

  // Products and rules are cached per instance. Every route that reads them
  // waits for the load, webhooks and the cron included: on a fresh serverless
  // instance a webhook can be the very first request.
  const loaded = (_req, _res, next) => ensureLoaded().then(() => next(), next)

  app.get('/health', (_req, res) => res.json({ ok: true }))
  // One check for the uptime monitor: the database answers and the maintenance
  // job (holds, payments, messages) ran in the last 5 minutes.
  app.get('/ready', async (_req, res) => {
    try {
      await query('SELECT 1')
      const age = await lastTickAgeSeconds()
      const ready = maintenanceReady(age)
      res.status(ready ? 200 : 503).json({ ready, maintenanceAgeSeconds: age })
    } catch {
      res.status(503).json({ ready: false })
    }
  })

  // The every-minute scheduler calls this with the cron secret: an external
  // pinger on Vercel Hobby (deploy/SCHEDULER.md), or Vercel Cron on Pro.
  // vercel.json keeps a once-a-day Vercel Cron as a backstop, which Hobby allows.
  // GET or POST, whichever the scheduler sends.
  const maintenance = async (req, res) => {
    if (!env.CRON_SECRET || !safeEqual(bearer(req), env.CRON_SECRET)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad cron secret', requestId: req.id } })
    }
    try {
      const out = await runMaintenance()
      res.json(out)
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'maintenance run failed')
      reportError(err, { route: 'maintenance' })
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Maintenance failed', requestId: req.id } })
    } finally {
      await flushErrors()
    }
  }
  app.get('/internal/maintenance', loaded, maintenance)
  app.post('/internal/maintenance', loaded, maintenance)

  // Prometheus scraping needs a long-running server; on Vercel use Sentry and the logs.
  app.get('/metrics', async (req, res) => {
    if (onVercel) return res.status(404).end()
    if (env.METRICS_TOKEN && req.get('authorization') !== `Bearer ${env.METRICS_TOKEN}`) return res.status(401).end()
    res.set('Content-Type', registry.contentType)
    res.send(await registry.metrics())
  })

  app.post('/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), loaded, async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!verifySignature(raw, req.get('x-razorpay-signature'))) {
      return res.status(400).json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature', requestId: req.id } })
    }
    let event
    try {
      event = JSON.parse(raw.toString('utf8'))
    } catch {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body is not JSON', requestId: req.id } })
    }
    try {
      const result = await handleWebhook(event, req.get('x-razorpay-event-id'))
      res.json({ ok: true, ...result })
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'webhook processing failed')
      metrics.webhookErrors.inc({ source: 'razorpay' })
      await recordWebhookFailure('razorpay', err.message, req.get('x-razorpay-event-id') ?? event?.event ?? null)
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: req.id } })
    }
  })

  // WhatsApp Cloud API: Meta checks the endpoint once with the verify token, then
  // posts signed message and status events. Meta retries on non-2xx, and
  // messages are deduplicated by id.
  app.get('/webhooks/whatsapp', (req, res) => {
    const ok = env.WHATSAPP_VERIFY_TOKEN && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN
    if (!ok) return res.status(403).end()
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''))
  })
  app.post('/webhooks/whatsapp', express.raw({ type: '*/*', limit: '1mb' }), loaded, async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!verifyMetaSignature(raw, req.get('x-hub-signature-256'))) {
      return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature', requestId: req.id } })
    }
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body is not JSON', requestId: req.id } })
    }
    try {
      res.json({ ok: true, handled: await handleWhatsAppWebhook(body) })
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'WhatsApp webhook processing failed')
      metrics.webhookErrors.inc({ source: 'whatsapp' })
      await recordWebhookFailure('whatsapp', err.message, body?.entry?.[0]?.id ?? null)
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: req.id } })
    }
  })

  app.use(express.json({ limit: '100kb' }))
  app.use(loaded)

  // Per address. Indian mobile networks put many customers behind one address
  // (carrier NAT), so this is a flood guard, not a per-person limit: floods
  // are stopped earlier by the Vercel firewall rule (deploy/VERCEL.md).
  const apiLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: env.API_RATE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id } }),
  })
  // Marks any order paid without paying: only on a developer's machine that asked for it.
  if (devRoutesOn()) app.use('/v1/dev', devRouter)
  app.use('/v1', apiLimiter, customerRouter)
  app.use('/admin/v1', apiLimiter, adminRouter)

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: req.id } }))

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, requestId: req.id, ...(err.extra ?? {}) } })
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body is not valid JSON', requestId: req.id } })
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId: req.id } })
    }
    if (err?.code === '23514' && err?.constraint === 'batch_lines_no_oversell') {
      return res.status(409).json({ error: { code: 'STOCK_INSUFFICIENT', message: 'Not enough stock', requestId: req.id } })
    }
    if (err?.code === '40P01' || err?.code === '40001') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Busy, please retry', requestId: req.id } })
    }
    // No free database connection in time, or Neon refusing more: a short, retryable 503.
    if (isPoolTimeout(err) || err?.code === '53300') {
      logger.warn({ reqId: req.id, path: req.path }, 'database busy')
      return res.status(503).set('Retry-After', '2').json({ error: { code: 'BUSY', message: 'We are very busy. Please try again in a moment.', requestId: req.id } })
    }
    // Database unreachable (OPS-08): a retryable 503, reported at most once a minute.
    if (isDbUnavailable(err)) {
      metrics.dbUnavailable.inc()
      if (Date.now() - lastOutageReport > 60_000) {
        lastOutageReport = Date.now()
        logger.error({ err, reqId: req.id, path: req.path }, 'database unavailable')
        reportError(err, { requestId: req.id, method: req.method, path: req.path, outage: true })
        if (onVercel) res.on('finish', () => void flushErrors())
      }
      return res
        .status(503)
        .set('Retry-After', '5')
        .json({ error: { code: 'UNAVAILABLE', message: 'We are having trouble right now. Please try again in a minute.', requestId: req.id } })
    }
    logger.error({ err, reqId: req.id }, 'unhandled error')
    reportError(err, { requestId: req.id, method: req.method, path: req.path })
    if (onVercel) res.on('finish', () => void flushErrors())
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: req.id } })
  })

  return app
}


