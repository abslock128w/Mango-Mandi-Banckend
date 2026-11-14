// Versioned business rules from app_config. The live (highest) version is
// cached in memory; every order stores the version it was placed under.
import { z } from 'zod'
import { query, tx } from './db.js'
import { SALE_STAGES, STAGES } from './stage.js'

/**
 * One variety's ripeness windows by age. A manager may only save windows for the
 * stages that are sold (SALE_STAGES: no RIPE window); older saved versions with a
 * RIPE window still load (`STAGES`), so a rollback or the version history keeps working.
 */
const profileOf = (stages) =>
  z
    .array(
      z.object({
        stage: z.enum(stages, { message: `A window's ripeness must be ${stages.join(' or ')}` }),
        minAge: z.number().int().min(0),
        maxAge: z.number().int().min(0),
      }),
    )
    .min(1)
    .refine((p) => p.every((w) => w.minAge <= w.maxAge), 'minAge must be <= maxAge')
    .refine((p) => p.every((w, i) => i === 0 || w.minAge > p[i - 1].maxAge), 'windows must be in age order without overlap')
    .refine(
      (p) => p.every((w, i) => i === 0 || STAGES.indexOf(w.stage) > STAGES.indexOf(p[i - 1].stage)),
      `stages must run ${stages.join(' → ')}`,
    )

/**
 * Delivery charge on a regular order (src/delivery-fee.js), in rupees. Off until a manager turns it on.
 * `bands` run outwards from the nearest warehouse: an address up to `uptoKm` away pays `fee` when the
 * order is `freeAbove` or more, and `feeSmall` when it is less. Past the last band the order is refused
 * (`beyond: 'refuse'`) or pays the last band's charge (`'charge'`). `origins` are the warehouses the
 * distance is measured from; empty, the warehouses' own coordinates are used. `unknownKm` is the
 * distance assumed when neither the address nor its pincode has a known position.
 */
const deliveryFeeSchema = z
  .object({
    enabled: z.boolean().default(false),
    freeAbove: z.number().int().min(0).max(100_000).default(1000),
    bands: z
      .array(z.object({ uptoKm: z.number().positive().max(200), fee: z.number().int().min(0).max(5000), feeSmall: z.number().int().min(0).max(5000) }).strict())
      .min(1)
      .max(8)
      .refine((b) => b.every((x, i) => i === 0 || x.uptoKm > b[i - 1].uptoKm), 'Each distance must be more than the one before it')
      .default([
        { uptoKm: 2, fee: 0, feeSmall: 30 },
        { uptoKm: 5, fee: 30, feeSmall: 50 },
        { uptoKm: 8, fee: 50, feeSmall: 70 },
        { uptoKm: 12, fee: 80, feeSmall: 100 },
      ]),
    beyond: z.enum(['refuse', 'charge']).default('refuse'),
    unknownKm: z.number().min(0).max(200).default(5),
    origins: z
      .array(z.object({ name: z.string().trim().min(1).max(60), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict())
      .max(20)
      .default([]),
  })
  .strict()

export const DEFAULT_DELIVERY_FEE = deliveryFeeSchema.parse({})

const rulesFieldsFor = (stages) => z.object({
  maxSellableAge: z.number().int().min(1).max(30),
  retireAge: z.number().int().min(1).max(31),
  cutoffHourIST: z.number().int().min(0).max(23),
  maxDaysAhead: z.number().int().min(1).max(30),
  holdMinutes: z.number().int().min(1).max(60),
  quoteMinutes: z.number().int().min(1).max(60),
  forecastConfidence: z.number().min(0).max(1),
  maxQcShift: z.number().int().min(0).max(3),
  transitDays: z.number().int().min(0).max(10),
  nearLimitAge: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0),
  claimWindowHours: z.number().int().min(1),
  // Unpaid orders one customer may have waiting at once, and the boxes they
  // may hold across them (INV-02). Older rule versions get the defaults.
  maxUnpaidOrders: z.number().int().min(1).max(5).default(1),
  maxHeldBoxes: z.number().int().min(1).max(500).default(40),
  // Needs attention (INV-G, INV-H): an order out for delivery this long is
  // overdue; a preorder moved more than this many weeks, or booked past the
  // season's last day, waits for a manager's decision.
  outForDeliveryAlertHours: z.number().int().min(1).max(48).default(8),
  maxPreorderMoves: z.number().int().min(1).max(20).default(3),
  seasonEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)').nullable().default(null),
  // Before the season (src/season-phase.js): from preorderOpensOn the shop's home page takes
  // pre-orders, and from seasonStartsOn it sells as usual. Unset (older versions too): in season.
  seasonStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)').nullable().default(null),
  preorderOpensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)').nullable().default(null),
  // Live tracking (LIVE_TRACKING): the rough minutes a rider spends per stop, for the shop's
  // "N stops away, about M minutes". Older rule versions get the default.
  minutesPerStop: z.number().int().min(1).max(120).default(10),
  // The delivery charge on regular orders (above). Older rule versions get it switched off.
  deliveryFee: deliveryFeeSchema.default(DEFAULT_DELIVERY_FEE),
  stageProfiles: z.record(z.string(), profileOf(stages)).refine((p) => 'default' in p, 'a "default" profile is required'),
})
const retireAfterSellable = [(r) => r.retireAge > r.maxSellableAge, { message: 'retireAge must be greater than maxSellableAge' }]
const opensBeforeStart = [
  (r) => !r.preorderOpensOn || !r.seasonStartsOn || r.preorderOpensOn < r.seasonStartsOn,
  { message: 'Pre-orders must open before the season starts', path: ['preorderOpensOn'] },
]
const startsBeforeEnd = [
  (r) => !r.seasonStartsOn || !r.seasonEndsOn || r.seasonStartsOn < r.seasonEndsOn,
  { message: 'The season must start before it ends', path: ['seasonStartsOn'] },
]

/** What a manager may save: unknown keys are a typo and are refused, and so is a RIPE window. */
export const rulesSchema = rulesFieldsFor(SALE_STAGES).strict().refine(...retireAfterSellable).refine(...opensBeforeStart).refine(...startsBeforeEnd)

/**
 * What the API reads back. Unknown keys are dropped, not refused, so a rollback
 * to this release still starts after a newer release saved rules with keys this
 * one doesn't know (PLT-01). Missing keys take their defaults, as before. Older
 * versions with a RIPE window still load.
 */
export const storedRulesSchema = rulesFieldsFor(STAGES).strip().refine(...retireAfterSellable)

/**
 * Playbook defaults, by age on the delivery date (the day of pluck is age 0): a
 * batch reaches the warehouse at 1 (transitDays), sells raw 1–3 and semi-ripe 4–7,
 * and is spoilt, never sold, from 8 (retireAge). Nothing is sold as ripe.
 * Migration 063 moves an existing database's live rules to these.
 */
export const DEFAULT_RULES = {
  maxSellableAge: 7,
  retireAge: 8,
  cutoffHourIST: 18,
  maxDaysAhead: 5,
  holdMinutes: 10,
  quoteMinutes: 5,
  forecastConfidence: 0.85,
  maxQcShift: 1,
  transitDays: 1,
  nearLimitAge: 5,
  lowStockThreshold: 5,
  claimWindowHours: 24,
  maxUnpaidOrders: 1,
  maxHeldBoxes: 40,
  outForDeliveryAlertHours: 8,
  maxPreorderMoves: 3,
  seasonEndsOn: null,
  seasonStartsOn: null,
  preorderOpensOn: null,
  minutesPerStop: 10,
  deliveryFee: DEFAULT_DELIVERY_FEE,
  stageProfiles: {
    default: [
      { stage: 'RAW', minAge: 1, maxAge: 3 },
      { stage: 'SEMI_RIPE', minAge: 4, maxAge: 7 },
    ],
  },
}

let live = { version: 0, rules: DEFAULT_RULES }

export const getConfig = () => live.rules
export const configVersion = () => live.version
export const currentConfig = () => live

/** Loads the live version, creating version 1 from the defaults on a fresh database. */
export async function loadConfig() {
  await query(
    `INSERT INTO app_config (version, value, changed_by) VALUES (1, $1, 'system') ON CONFLICT DO NOTHING`,
    [DEFAULT_RULES],
  )
  const { rows } = await query('SELECT version, value FROM app_config ORDER BY version DESC LIMIT 1')
  live = { version: rows[0].version, rules: storedRulesSchema.parse(rows[0].value) }
  return live
}

/**
 * Saves a new version. `rules` must already be validated. `inTx(c, before)` runs in the
 * same transaction with the rules it replaces (the staff audit row, admin/planning.js).
 */
export async function saveConfig(rules, actor, { inTx } = {}) {
  const version = await tx(async (c) => {
    await c.query('LOCK TABLE app_config IN EXCLUSIVE MODE')
    const { rows } = await c.query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM app_config')
    if (inTx) {
      const { rows: was } = await c.query('SELECT value FROM app_config ORDER BY version DESC LIMIT 1')
      await inTx(c, was[0]?.value ?? null)
    }
    await c.query('INSERT INTO app_config (version, value, changed_by) VALUES ($1, $2, $3)', [rows[0].v, rules, actor])
    return rows[0].v
  })
  live = { version, rules }
  return live
}
