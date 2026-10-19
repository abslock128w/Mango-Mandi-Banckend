// What /ready says about the maintenance loop (holds, payments, messages).
import { deployEnv } from './env.js'

/** /ready fails when the maintenance job hasn't finished a run in this long. */
export const MAINTENANCE_STALE_S = 300

/**
 * Whether the maintenance loop counts as alive, from the age of its last
 * finished run in seconds (null = it has never finished one).
 * In production "never" is a failure: the cron is missing, its secret is
 * wrong, or every run dies, and holds would never be released. Elsewhere
 * (development, tests, Vercel previews, which Vercel Cron doesn't call) a
 * fresh database with no run yet is fine.
 */
export function maintenanceReady(ageSeconds, { env = deployEnv, staleS = MAINTENANCE_STALE_S } = {}) {
  if (ageSeconds === null || ageSeconds === undefined) return env !== 'production'
  return ageSeconds <= staleS
}
