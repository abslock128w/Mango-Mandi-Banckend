#!/usr/bin/env node
// The two delivery templates as Meta's "create template" requests (POST
// https://graph.facebook.com/<version>/<WHATSAPP_BUSINESS_ACCOUNT_ID>/message_templates),
// for the owner to submit in WhatsApp Manager or with curl. The daily template sync
// (src/wa/meta-admin.js syncTemplates) then reads back their status, variable count and
// button, and the sender (src/notify.js) uses them only once Meta approves.
//
//   node scripts/whatsapp-template-definitions.mjs            print both
//   node scripts/whatsapp-template-definitions.mjs --shop https://mandimangoes.in
import { automationFor } from '../src/wa/registry.js'

const shop = (process.argv.includes('--shop') ? process.argv[process.argv.indexOf('--shop') + 1] : 'https://mandimangoes.in').replace(/\/$/, '')
const prefix = process.env.WHATSAPP_TEMPLATE_PREFIX ?? 'mandi_'
const language = process.env.WHATSAPP_LANGUAGE ?? 'en'
const code = automationFor('DELIVERY_CODE')
const ofd = automationFor('OUT_FOR_DELIVERY')

export const definitions = [
  {
    name: `${prefix}delivery_code`,
    language,
    category: 'AUTHENTICATION',
    message_send_ttl_seconds: code.auth.messageSendTtlSeconds,
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: code.auth.codeExpirationMinutes },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
    ],
  },
  {
    name: `${prefix}out_for_delivery`,
    language,
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, your MandiMangoes order {{2}} is on its way with {{3}} and arrives {{4}}. Your delivery code comes in the next message: share it with the rider only after you have seen your mangoes.',
        example: { body_text: [ofd.example] },
      },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Track order', url: `${shop}/orders/{{1}}`, example: [`${shop}/orders/ord_example`] }] },
    ],
  },
]

console.log(JSON.stringify(definitions, null, 2))
