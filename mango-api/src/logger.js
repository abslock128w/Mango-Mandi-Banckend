import pino from 'pino'
import { env, isProd } from './env.js'

// Sensitive values are redacted at every depth.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.password_hash',
  // Login and delivery codes in request bodies, not error codes (OPS-06):
  // err.code carries SQLSTATEs and network errors that diagnosis needs.
  'body.code',
  '*.body.code',
  'input.code',
  '*.input.code',
  '*.devCode',
  '*.accessToken',
  '*.refreshToken',
  'password',
  'password_hash',
  'code',
  'devCode',
  'accessToken',
  'refreshToken',
]

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  ...(isProd || env.NODE_ENV === 'test' ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
})
