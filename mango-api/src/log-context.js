// Log correlation: what every log line written while handling one request (or
// one maintenance step) carries, without passing it down by hand. The request-id
// middleware starts a context with { reqId }, lockOrder adds the orderId, and each
// maintenance step runs in its own context with { step }. The logger's mixin
// (logger.js) copies the current context into every line.
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage()

/** The current context's fields, or undefined outside one. */
export const logContext = () => store.getStore()

/** Runs fn in a new context: the current fields plus `fields`. Changes made inside stay inside. */
export const withLogContext = (fields, fn) => store.run({ ...store.getStore(), ...fields }, fn)

/**
 * Adds fields to the current context, so later lines in the same request or step carry them.
 * In a step that works through many orders, orderId is the last order locked.
 */
export function addLogContext(fields) {
  const s = store.getStore()
  if (s) Object.assign(s, fields)
}
