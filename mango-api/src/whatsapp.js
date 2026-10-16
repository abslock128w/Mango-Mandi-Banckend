// WhatsApp order updates through the Meta WhatsApp Cloud API. Business-initiated
// messages must use templates approved in WhatsApp Manager; each kind of update
// maps to one template named <WHATSAPP_TEMPLATE_PREFIX><kind>, e.g.
// vmr_order_confirmed, whose body variables are filled in order ({{1}}, {{2}}…).
import { env } from './env.js'

/** A sender for the Cloud API. Resolves to the provider's message id. */
export function metaSender(opts, fetchImpl = fetch) {
  const url = `https://graph.facebook.com/${opts.apiVersion}/${encodeURIComponent(opts.phoneNumberId)}/messages`
  return async function sendMeta({ phone, template, params }) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: opts.language },
          components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }],
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${body?.error?.message ?? 'request failed'}`)
    return body?.messages?.[0]?.id ?? null
  }
}

export const templateName = (kind) => `${env.WHATSAPP_TEMPLATE_PREFIX}${kind.toLowerCase()}`

export const whatsappSender =
  env.WHATSAPP_PROVIDER === 'meta'
    ? metaSender({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, apiVersion: env.WHATSAPP_API_VERSION, language: env.WHATSAPP_LANGUAGE })
    : null
