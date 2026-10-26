// Long-running server (local development, Docker). On Vercel, api/index.js is
// the entry point instead and this file is not used.
import { createApp } from './app.js'
import { drainBackground } from './background.js'
import { closePool, connectWithRetry } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { runMaintenance, settleMaintenance, startMaintenance, stopMaintenance } from './maintenance.js'
import { runMigrations } from './migrate.js'
import { seed } from './seed.js'
import { flushErrors } from './sentry.js'

async function main() {
  await connectWithRetry(10, 1000)
  await runMigrations()
  await seed()

  const listening = () => logger.info({ port: env.PORT, host: env.HOST || 'all interfaces' }, 'mango-api listening')
  const server = env.HOST ? createApp().listen(env.PORT, env.HOST, listening) : createApp().listen(env.PORT, listening)
  startMaintenance()
  // One run straight away rather than a minute in: /ready (which the deploy
  // script waits on) counts a production database that has never had a run as
  // not ready.
  runMaintenance().catch((err) => logger.error({ err }, 'first maintenance run failed'))

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down')
    stopMaintenance()
    setTimeout(() => process.exit(1), 15_000).unref()
    server.close(async () => {
      if (env.API_HARDENING) {
        // PLT-14: a maintenance run in progress and after-response work (audit rows,
        // refunds after a webhook) finish before the pool closes under them.
        if (!(await settleMaintenance(10_000))) logger.warn('a maintenance run was still going at shutdown; its lease expires on its own')
        await drainBackground()
      }
      await flushErrors()
      await closePool().catch(() => {})
      process.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed')
  process.exit(1)
})
