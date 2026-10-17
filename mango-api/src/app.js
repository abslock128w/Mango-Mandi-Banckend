// Express app. Middleware order follows the technical plan (section 5).
import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { router as adminRouter } from './admin.js'
import { devRouter, router as customerRouter } from './customer.js'
import { query } from './db.js'
import { env, isProd } from './env.js'
import { HttpError } from './errors.js'
import { logger } from './logger.js'
import { httpMetrics, metrics, registry } from './metrics.js'
import { recordWebhookFailure } from './payments.js'
import { handleWhatsAppWebhook } from './chat.js'
import { handleWebhook, verifySignature } from './payments.js'
import { verifyMetaSignature } from './whatsapp.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY)

  app.use(helmet())
  app.use(
    cors({
      origin: `${env.ADMIN_ORIGIN},${env.CUSTOMER_ORIGIN}`.split(',').map((s) => s.trim()).filter(Boolean),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
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

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.get('/ready', async (_req, res) => {
    try {
      await query('SELECT 1')
      res.json({ ready: true })
    } catch {
      res.status(503).json({ ready: false })
    }
  })
  app.get('/metrics', async (req, res) => {
    if (env.METRICS_TOKEN && req.get('authorization') !== `Bearer ${env.METRICS_TOKEN}`) return res.status(401).end()
    res.set('Content-Type', registry.contentType)
    res.send(await registry.metrics())
  })

  app.post('/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
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
  app.post('/webhooks/whatsapp', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
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

  const apiLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id } }),
  })
  if (!isProd) app.use('/v1/dev', devRouter)
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
    if (err?.code === '40P01') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Busy, please retry', requestId: req.id } })
    }
    logger.error({ err, reqId: req.id }, 'unhandled error')
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: req.id } })
  })

  return app
}
