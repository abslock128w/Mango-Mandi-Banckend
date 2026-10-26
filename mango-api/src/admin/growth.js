// Growth, for managers only (docs/growth.md): the Referrals view (REFERRALS), the
// funnel on the Analytics page (FUNNEL_ANALYTICS), and the evening WhatsApp summary
// (MANAGER_DAILY_SUMMARY): each manager's own opt-in and number, and a preview of
// today's summary. While a switch is off its routes answer 404.
import express from 'express'
import { z } from 'zod'
import { requireManager } from '../auth.js'
import { addDays, diffDays, isDate, todayIST } from '../clock.js'
import { query } from '../db.js'
import { env } from '../env.js'
import { asyncHandler, badRequest, notFound, parse } from '../errors.js'
import { FUNNEL_RETENTION_DAYS, funnelReport } from '../funnel.js'
import { summaryNumbers, summaryParams, summaryText } from '../manager-summary.js'
import { listReferrals } from '../referrals.js'
import { isOn } from '../feature-switches.js'

export const router = express.Router()

const whenOn = (on) => (_req, _res, next) => next(on() ? undefined : notFound())
const date = z.string().refine(isDate, 'dates must be YYYY-MM-DD')
const present = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''))

// ---------------------------------------------------------------- referrals

router.get(
  '/referrals',
  requireManager,
  whenOn(() => isOn('REFERRALS')),
  asyncHandler(async (req, res) => {
    const f = parse(z.object({ status: z.enum(['PENDING', 'REWARDED', 'VOID']).optional() }), present(req.query))
    res.json(await listReferrals({ status: f.status ?? null }))
  }),
)

// ---------------------------------------------------------------- funnel

/** Day by day, browsers at each step and conversion. Defaults to the last 14 days, today included. */
router.get(
  '/analytics/funnel',
  requireManager,
  whenOn(() => isOn('FUNNEL_ANALYTICS')),
  asyncHandler(async (req, res) => {
    const f = parse(z.object({ from: date.optional(), to: date.optional() }), present(req.query))
    const to = f.to ?? todayIST()
    const from = f.from ?? addDays(to, -13)
    if (from > to) throw badRequest('from must be on or before to', 'INVALID_DATE')
    // Events are kept 90 days; older days come from the daily rollup. A range longer than that is refused.
    if (diffDays(to, from) > FUNNEL_RETENTION_DAYS + 2) throw badRequest(`Pick at most ${FUNNEL_RETENTION_DAYS} days`, 'INVALID_DATE')
    res.json(await funnelReport({ from, to }))
  }),
)

// ---------------------------------------------------------------- daily summary

const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a 10-digit Indian mobile number')
  .transform((s) => `+91${s}`)
const masked = (p) => (p ? `${p.slice(0, -6)}••••${p.slice(-2)}` : null)

const settingsView = (u) => ({ optedIn: Boolean(u.daily_summary_opt_in), phone: masked(u.daily_summary_phone), time: env.MANAGER_SUMMARY_TIME })

/** My own summary setting. The number is shown masked. */
router.get(
  '/me/daily-summary',
  requireManager,
  whenOn(() => isOn('MANAGER_DAILY_SUMMARY')),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT daily_summary_opt_in, daily_summary_phone FROM admin_users WHERE id = $1', [req.admin.id])
    if (!rows.length) throw notFound('No staff member with that id')
    res.json(settingsView(rows[0]))
  }),
)

/** Turns my own evening summary on (with the WhatsApp number to send it to) or off. */
router.put(
  '/me/daily-summary',
  requireManager,
  whenOn(() => isOn('MANAGER_DAILY_SUMMARY')),
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ optedIn: z.boolean(), phone: phoneSchema.optional() }).strict(), req.body ?? {})
    const { rows: cur } = await query('SELECT daily_summary_phone FROM admin_users WHERE id = $1', [req.admin.id])
    const phone = b.phone ?? cur[0]?.daily_summary_phone ?? null
    if (b.optedIn && !phone) throw badRequest('Enter the WhatsApp number to send the summary to', 'PHONE_REQUIRED')
    const { rows } = await query(
      'UPDATE admin_users SET daily_summary_opt_in = $2, daily_summary_phone = $3 WHERE id = $1 RETURNING daily_summary_opt_in, daily_summary_phone',
      [req.admin.id, b.optedIn, phone],
    )
    res.json(settingsView(rows[0]))
  }),
)

/** Today's numbers so far and the message as it would read now (the Today page). Sends nothing. */
router.get(
  '/daily-summary/preview',
  requireManager,
  whenOn(() => isOn('MANAGER_DAILY_SUMMARY')),
  asyncHandler(async (_req, res) => {
    const day = todayIST()
    const numbers = await summaryNumbers(day)
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM admin_users WHERE role = 'MANAGER' AND daily_summary_opt_in AND daily_summary_phone IS NOT NULL`,
    )
    const sent = await query('SELECT COUNT(*)::int AS n FROM manager_summaries WHERE day = $1', [day])
    res.json({ day, numbers, text: summaryText(summaryParams(numbers)), sendsAt: env.MANAGER_SUMMARY_TIME, recipients: rows[0].n, sentToday: sent.rows[0].n })
  }),
)
