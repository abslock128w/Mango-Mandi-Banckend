// OTP delivery. Production sends login codes through the Jio SMS gateway;
// development and tests only log them (the API also returns them as devCode).
// Indian SMS needs DLT registration, so the sender ID, template ID and entity
// ID must match what is registered, and the text must match the template.
import { env } from './env.js'
import { HttpError } from './errors.js'
import { logger } from './logger.js'

const mask = (phone) => `${phone.slice(0, 5)}*****`

/** A sender for the Jio SMS gateway. `opts` mirrors the JIO_SMS_* settings. */
export function jioSender(opts, fetchImpl = fetch) {
  return async function sendJio(phone, code) {
    const res = await fetchImpl(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        to: phone.replace(/^\+/, ''),
        sender: opts.senderId,
        message: opts.text.replaceAll('{code}', code),
        templateId: opts.templateId,
        entityId: opts.entityId,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    }).catch((err) => {
      logger.error({ err, phone: mask(phone) }, 'Jio SMS request failed')
      return null
    })
    if (!res?.ok) {
      if (res) logger.error({ status: res.status, body: (await res.text()).slice(0, 500), phone: mask(phone) }, 'Jio SMS rejected the OTP')
      throw new HttpError(502, 'OTP_NOT_SENT', 'We could not send the code. Please try again.')
    }
  }
}

async function logOnly(phone, code) {
  logger.info({ phone }, `OTP for ${phone} is ${code}`)
}

export const sendOtp =
  env.SMS_PROVIDER === 'jio'
    ? jioSender({
        url: env.JIO_SMS_URL,
        apiKey: env.JIO_SMS_API_KEY,
        senderId: env.JIO_SMS_SENDER_ID,
        templateId: env.JIO_SMS_TEMPLATE_ID,
        entityId: env.JIO_SMS_ENTITY_ID,
        text: env.JIO_SMS_TEXT,
      })
    : logOnly
