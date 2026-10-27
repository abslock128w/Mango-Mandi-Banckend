// Settings for the trust pack (docs/trust.md): bills, the staff customer
// profile and the CSV exports. Each feature has its own switch so it can be
// turned off on its own: off in production until set to true, on elsewhere.
// The seller's details printed on bills come from here too, so they change
// without a release (a bill keeps the details it was issued with).
import { z } from 'zod'
import { gstinProblem, normaliseGstin, stateName } from './gstin.js'

const flag = z.enum(['true', 'false']).transform((v) => v === 'true').optional()

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  // Numbered bills for paid orders, their PDFs (shop and panel) and the business details at checkout.
  BILLS_ENABLED: flag,
  // The panel's customer profile, phone search and phone reveal (managers and operators).
  CUSTOMER_PROFILES_ENABLED: flag,
  // CSV exports of orders, lines, claims, reviews, bulk orders, payments and refunds (managers).
  STAFF_EXPORTS_ENABLED: flag,
  // The seller printed on every bill. Required in production while BILLS_ENABLED is on.
  BILL_SELLER_LEGAL_NAME: z.string().trim().max(120).optional(),
  // Lines separated by "|", e.g. "12 Mandi Road|Bengaluru 560034".
  BILL_SELLER_ADDRESS: z.string().trim().max(300).optional(),
  // The GST state code of the seller's place of business, e.g. 29 for Karnataka.
  BILL_SELLER_STATE_CODE: z.string().trim().optional(),
  // Set only once the business is registered under GST: the bill becomes a Bill of Supply.
  BILL_SELLER_GSTIN: z.string().trim().optional(),
  // Optional line under the seller, e.g. "WhatsApp +91 98xxxxxxxx, hello@example.in".
  BILL_SELLER_CONTACT: z.string().trim().max(120).optional(),
  // The bill number's prefix: 1 to 3 letters or digits (MM/26-27/000001).
  BILL_NUMBER_PREFIX: z.string().trim().regex(/^[A-Za-z0-9]{1,3}$/, 'BILL_NUMBER_PREFIX is 1 to 3 letters or digits').optional(),
})

/** Reads the settings from an environment (process.env by default). Empty values mean "unset". */
export function readTrustConfig(source = process.env) {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '' && v != null)))
  const problems = []
  const raw = parsed.success ? parsed.data : {}
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join('.')}: ${issue.message}`)
  }
  const prod = (raw.NODE_ENV ?? source.NODE_ENV) === 'production'
  const on = (v) => v ?? !prod
  const stateCode = raw.BILL_SELLER_STATE_CODE ?? (prod ? null : '29')
  let gstin = raw.BILL_SELLER_GSTIN ? normaliseGstin(raw.BILL_SELLER_GSTIN) : null
  if (stateCode && !stateName(stateCode)) problems.push(`BILL_SELLER_STATE_CODE ${stateCode} is not a GST state code (two digits, e.g. 29 for Karnataka)`)
  if (gstin) {
    const p = gstinProblem(gstin)
    if (p) problems.push(`BILL_SELLER_GSTIN: ${p}`)
    else if (stateCode && gstin.slice(0, 2) !== stateCode) problems.push(`BILL_SELLER_GSTIN is registered in state ${gstin.slice(0, 2)}, but BILL_SELLER_STATE_CODE is ${stateCode}`)
    // A GSTIN that fails its checks is never printed (production refuses to start: preflight.js).
    if (p || gstin.slice(0, 2) !== stateCode) gstin = null
  }
  const configured = Boolean(raw.BILL_SELLER_LEGAL_NAME && raw.BILL_SELLER_ADDRESS && raw.BILL_SELLER_STATE_CODE)
  return {
    bills: on(raw.BILLS_ENABLED),
    customerProfiles: on(raw.CUSTOMER_PROFILES_ENABLED),
    exports: on(raw.STAFF_EXPORTS_ENABLED),
    problems,
    seller: {
      // Outside production a placeholder seller lets bills be tried locally; the bill says so.
      legalName: raw.BILL_SELLER_LEGAL_NAME ?? (prod ? null : 'MandiMangoes'),
      addressLines: (raw.BILL_SELLER_ADDRESS ?? (prod ? '' : 'Bengaluru')).split('|').map((s) => s.trim()).filter(Boolean),
      stateCode,
      stateName: stateCode ? stateName(stateCode) : null,
      gstin,
      contact: raw.BILL_SELLER_CONTACT ?? null,
      placeholder: !configured,
    },
    numberPrefix: (raw.BILL_NUMBER_PREFIX ?? 'MM').toUpperCase(),
  }
}

export const trust = readTrustConfig()

/** Test hook: re-reads the settings from `source` (merged over process.env). */
export function setTrustConfig(source = {}) {
  Object.assign(trust, readTrustConfig({ ...process.env, ...source }))
}

/** Go-live checks for preflight.js: errors stop a production start. */
export function checkTrustProduction(t = trust) {
  const errors = [...t.problems]
  const warnings = []
  if (t.bills) {
    if (t.seller.placeholder) errors.push('BILLS_ENABLED is on, so BILL_SELLER_LEGAL_NAME, BILL_SELLER_ADDRESS and BILL_SELLER_STATE_CODE are required: they are printed on every bill')
    if (!t.seller.gstin) warnings.push('BILL_SELLER_GSTIN is unset: bills are plain receipts (a seller registered under GST must set it, and the bill becomes a Bill of Supply)')
  }
  return { errors, warnings }
}
