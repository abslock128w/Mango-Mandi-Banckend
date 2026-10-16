// WhatsApp order updates through Gupshup or the Meta WhatsApp Cloud API.
// Business-initiated messages must use approved templates; each kind of update
// maps to one template named <WHATSAPP_TEMPLATE_PREFIX><kind>, e.g.
// vmr_order_confirmed, whose body variables are filled in order ({{1}}, {{2}}…).
import { env } from './env.js'

/**
 * A sender for Gupshup's template API. Gupshup addresses templates by the id it
 * gives each one on approval, so `templateIds` maps template name → id.
 */
export function gupshupSender(opts, fetchImpl = fetch) {
  const url = opts.url ?? 'https://api.gupshup.io/wa/api/v1/template/msg'
  return async function sendGupshup({ phone, template, params }) {
    const id = opts.templateIds[template]
    if (!id) throw new Error(`Gupshup: no template id for ${template}`)
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: opts.apiKey },
      body: new URLSearchParams({
        channel: 'whatsapp',
        source: opts.source.replace(/^\+/, ''),
        destination: phone.replace(/^\+/, ''),
        'src.name': opts.appName,
        template: JSON.stringify({ id, params: params.map(String) }),
      }).toString(),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.status === 'error') throw new Error(`Gupshup ${res.status}: ${body?.message ?? 'request failed'}`)
    return body?.messageId ?? null
  }
}

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
    : env.WHATSAPP_PROVIDER === 'gupshup'
      ? gupshupSender({ apiKey: env.GUPSHUP_API_KEY, appName: env.GUPSHUP_APP_NAME, source: env.GUPSHUP_SOURCE_NUMBER, templateIds: env.GUPSHUP_TEMPLATE_IDS })
      : null
