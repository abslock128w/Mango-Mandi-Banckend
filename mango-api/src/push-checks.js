// Go-live checks for browser notifications (WEB_PUSH). Apart from push.js so
// preflight.js (which env.js loads) does not import env.js back.
import { vapidKey } from './webpush.js'

/** Production checks for push (preflight.js): errors stop a production start. */
export function pushProblems(e) {
  const errors = []
  const warnings = []
  if (!e.WEB_PUSH) return { errors, warnings }
  if (e.WEB_PUSH_PROVIDER !== 'vapid') errors.push('WEB_PUSH is on but WEB_PUSH_PROVIDER is not vapid: notifications would only be logged')
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) errors.push('WEB_PUSH needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (node scripts/vapid-keys.mjs)')
  else {
    try {
      vapidKey(e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY)
    } catch (err) {
      errors.push(`VAPID keys unusable: ${err.message}`)
    }
  }
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(e.VAPID_SUBJECT ?? '')) errors.push('VAPID_SUBJECT must be a mailto: address or an https: URL the push services can reach us at')
  return { errors, warnings }
}

