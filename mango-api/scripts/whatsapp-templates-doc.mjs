#!/usr/bin/env node
// Writes docs/whatsapp/TEMPLATES.md from the registry (src/wa/registry.js): every automated
// WhatsApp message, its template name, category, who may receive it, its variables in order
// with an example, its button, when it is sent and what happens if it can't be. With the
// suggested wording to submit to Meta (the owner words the final text in WhatsApp Manager;
// the number and order of variables must stay as listed).
//
//   node scripts/whatsapp-templates-doc.mjs           write the file
//   node scripts/whatsapp-templates-doc.mjs --check   exit 1 if the committed file is out of date
//
// test/whatsapp-docs.test.js runs --check, so the doc can't drift from the code.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AUTOMATIONS, LOGIN_CODE } from '../src/wa/registry.js'

export const DOC_FILE = new URL('../../docs/whatsapp/TEMPLATES.md', import.meta.url)
const PREFIX = 'mandi_'
const SUMMARY_TEMPLATE = 'mandimangoes_daily_summary'
const nameOf = (a) => (a.kind === 'MANAGER_DAILY_SUMMARY' ? SUMMARY_TEMPLATE : `${PREFIX}${(a.template ?? a.kind).toLowerCase()}`)

/** The confirmation's second template, with the invoice button (registry `invoice`). */
const INVOICE_BODY = 'Hi {{1}}, your MandiMangoes order {{2}} is confirmed and paid. It will be delivered on {{3}}, {{4}}. Your invoice is ready.'

/** Suggested body text. {{n}} are the variables in the registry's order. Utility wording carries no offer. */
const BODY = {
  ORDER_CONFIRMED: 'Hi {{1}}, your MandiMangoes order {{2}} is confirmed and paid. It will be delivered on {{3}}, {{4}}.',
  REPLACEMENT_CONFIRMED: 'Hi {{1}}, your replacement order {{2}} is booked at no cost. It will be delivered on {{3}}, {{4}}.',
  RIPENESS_GUIDE: 'Hi {{1}}, a guide for order {{2}}: {{3}}. {{4}}',
  DATE_MOVED: "Hi {{1}}, order {{2}} will now arrive on {{3}}, {{4}}. If that date doesn't suit you, cancel it in the app before it is packed for a full refund.",
  OUT_FOR_DELIVERY: 'Hi {{1}}, your MandiMangoes order {{2}} is on its way with {{3}} and arrives {{4}}. Your delivery code comes in the next message: share it with the rider only after you have seen your mangoes.',
  GIFT_OUT_FOR_DELIVERY: '(shares mandi_out_for_delivery)',
  DELIVERY_CODE: "(Meta's fixed authentication wording: \"{{1}} is your verification code.\" with the security recommendation and the expiry footer; copy-code button)",
  GIFT_DELIVERY_CODE: '(shares mandi_delivery_code)',
  DELIVERED: 'Hi {{1}}, order {{2}} has been delivered. If a box is damaged, report it in the app within a day and we will replace it.',
  DELIVERY_FAILED: "Hi {{1}}, we couldn't deliver order {{2}} today. We will bring it on {{3}}.",
  CANCELLED: 'Hi {{1}}, order {{2}} has been cancelled. If you paid for it, the refund has been started.',
  REFUNDED: 'Hi {{1}}, the refund for {{2}} of {{3}} has been started. Your bank usually shows it within 5 to 7 working days.',
  PREORDER_BOOKED: 'Hi {{1}}, booking {{2}} is confirmed: {{3}} for {{4}}. We will confirm the delivery day nearer the time.',
  PREORDER_SPOT_OPEN: 'Hi {{1}}, a spot opened for {{2}} for {{3}}. Pay here to keep it: {{4}}',
  PREORDER_MOVED: 'Hi {{1}}, booking {{2}} ({{3}}) moves to {{4}} because the mangoes were not ready. You can cancel it in the app for a full refund.',
  BACK_IN_STOCK: 'Hi {{1}}, {{2}} is back. The first delivery day is {{3}}. Order here: {{4}}',
  REORDER_REMINDER: 'Hi {{1}}, enjoyed the {{2}}? Order again here: {{3}}. Reply STOP OFFERS to stop these reminders.',
  REVIEW_REQUEST: 'Hi {{1}}, how were the mangoes in order {{2}}? Rate them in the app; it helps other customers choose.',
  CLAIM_RECEIVED: 'Hi {{1}}, we have your report about order {{2}}. We will look at it and reply here within a day.',
  CLAIM_REJECTED: 'Hi {{1}}, we looked into your report about order {{2}} and could not offer a replacement: {{3}}. Reply here if you would like to talk to us about it.',
  REFERRAL_REWARD: 'Hi {{1}}, thank you for bringing a friend to MandiMangoes. Here is {{2}} off your next order of {{5}} or more: code {{3}}, valid until {{4}}.',
  HELP_REPLY: 'Hi {{1}}, we replied to your help request {{2}}. Read it here: {{3}}',
  SUBSCRIPTION_DUE: 'Hi {{1}}, your next subscription box, {{2}}, is set for {{3}}. Pay here to confirm it: {{4}}',
  BULK_ENQUIRY_RECEIVED: 'Hi {{1}}, we have your MandiMangoes bulk enquiry {{2}} for {{3}}. We will price it and send you a quote here soon.',
  BULK_QUOTE: 'Hi {{1}}, your quote for bulk enquiry {{2}} is ready: {{3}} for {{4}}. See the details and accept it here: {{5}}',
  MANAGER_DAILY_SUMMARY: 'MandiMangoes, {{1}}: {{2}} orders, {{3}} taken. Delivered {{4}} boxes, failed {{5}}. New claims {{6}}, unhappy ratings {{7}}, needs attention {{8}}.',
}

const CONSENT_WORDS = {
  updates: 'Order and service update: sent unless the number sent STOP',
  requested: 'Asked for by the person: sent unless the number sent STOP',
  marketing: 'Promotional: only with an opt-in (shop setting or START OFFERS), never after STOP or STOP OFFERS',
}
const BUTTON_WORDS = {
  'order-link': 'URL button "Open order", `https://<shop>/orders/{{1}}` (always sent)',
  'order-link-flag': 'URL button "Open order", `https://<shop>/orders/{{1}}`, sent only with WHATSAPP_ORDER_LINKS=true once Meta approved the button',
  'track-order': 'URL button "Track order", `https://<shop>/orders/{{1}}` (always sent; part of this template version)',
  'copy-code': "Copy code (Meta's one-time password button; the code is the button's parameter too)",
}
const BUTTON_SHORT = { 'track-order': 'Track order', 'copy-code': 'Copy code' }

export function render() {
  const out = [
    '# WhatsApp templates',
    '',
    'Generated from `mango-api/src/wa/registry.js` by `mango-api/scripts/whatsapp-templates-doc.mjs`. Do not edit by hand.',
    '',
    `Each automated message is one Meta template in \`WHATSAPP_LANGUAGE\` (default \`en\`), named \`WHATSAPP_TEMPLATE_PREFIX\` (default \`${PREFIX}\`) plus the kind, except the managers' summary (\`MANAGER_SUMMARY_TEMPLATE\`, default \`${SUMMARY_TEMPLATE}\`). The variables are filled in the order listed; a template with a different number of variables is refused before Meta is called (the WhatsApp page shows "Template variables do not match").`,
    '',
    'The category is what to ask Meta for; Meta decides the final one. A STOP OFFERS also stops every template Meta bills as marketing.',
    '',
    'The wording is a suggestion for the submission. Keep the variables, their order and the button; Meta rejects utility templates with promotional text.',
    '',
    '| Kind | Template | Category | Variables | Button |',
    '|------|----------|----------|-----------|--------|',
  ]
  for (const a of AUTOMATIONS) {
    out.push(`| ${a.kind} | \`${nameOf(a)}\` | ${a.category} | ${a.params.length} | ${a.button ? (BUTTON_SHORT[a.button] ?? 'Open order') : '—'} |`)
    if (a.invoice) out.push(`| ${a.kind} (with the invoice) | \`${PREFIX}${a.invoice.template.toLowerCase()}\` | ${a.category} | ${a.params.length} | Track order, Download invoice |`)
  }
  out.push(`| LOGIN_CODE | \`${PREFIX}login_code\` | AUTHENTICATION | 1 | Copy code (Meta's one-time password button) |`, '')
  for (const a of AUTOMATIONS) {
    out.push(`## ${a.kind}`, '')
    out.push(`- Template: \`${nameOf(a)}\`${a.template ? ` (shared with ${a.template})` : ''}`)
    out.push(`- Category: ${a.category}`)
    out.push(`- Who may receive it: ${CONSENT_WORDS[a.consent]}`)
    out.push(`- Sent when: ${a.trigger}`)
    if (a.flag) out.push(`- Only with \`${a.flag}=true\``)
    if (a.auth) out.push(`- Authentication settings: code_expiration_minutes ${a.auth.codeExpirationMinutes}, message_send_ttl_seconds ${a.auth.messageSendTtlSeconds}, add_security_recommendation true`)
    out.push(`- Button: ${a.button ? BUTTON_WORDS[a.button] : 'none'}`)
    out.push(`- If it can't be sent: ${a.fallback}`)
    out.push('- Variables:')
    a.params.forEach((p, i) => out.push(`  ${i + 1}. ${p} (example: ${a.example[i] ?? '—'})`))
    out.push('', `Suggested wording: ${BODY[a.kind] ?? '(write it in WhatsApp Manager)'}`, '')
    if (a.invoice) {
      out.push(`### ${a.kind} with the invoice`, '')
      out.push(`- Template: \`${PREFIX}${a.invoice.template.toLowerCase()}\`, category ${a.category}, the same ${a.params.length} variables in the same order`)
      out.push(`- Sent in place of \`${nameOf(a)}\` when the order has a bill (\`BILLS_ENABLED\`) and \`${a.invoice.flag}=true\`. One message: the confirmation, a button to track the order and a button to the invoice. The PDF itself is not attached.`)
      out.push('- Buttons, in this order (the order matters: the API fills them by position):')
      out.push('  1. URL button "Track order", `https://<shop>/orders/{{1}}` (the order id; example: ord_3f9c2a7b1d4e5f60a1b2)')
      out.push('  2. URL button "Download invoice", `https://<api>/v1/invoice/{{1}}` (a signed link that opens the invoice PDF without a sign-in for 180 days; example: ord_3f9c2a7b1d4e5f60a1b2.t9x2k1.Zk3mQ0aB7cD9eF1gH2iJ4kL6mN8oP0qR)')
      out.push(`- Until Meta approves it, and for an order without a bill, \`${nameOf(a)}\` is sent as before. After a template sync, a template that is missing, not approved or without its buttons is not used.`)
      out.push('', `Suggested wording: ${INVOICE_BODY}`, '')
    }
  }
  out.push('## LOGIN_CODE', '')
  out.push(`- Template: \`${PREFIX}login_code\`, category AUTHENTICATION, Meta's fixed authentication wording with a copy-code button`)
  out.push(`- Sent when: ${LOGIN_CODE.trigger}`)
  out.push('- Sent directly by `src/sms.js`, not through the order-update outbox; an opt-out does not stop a code the person asked for.')
  out.push('')
  return out.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = render()
  if (process.argv.includes('--check')) {
    let now = ''
    try {
      now = readFileSync(DOC_FILE, 'utf8')
    } catch {}
    if (now !== text) {
      console.error('docs/whatsapp/TEMPLATES.md is out of date: run node scripts/whatsapp-templates-doc.mjs')
      process.exit(1)
    }
  } else {
    writeFileSync(DOC_FILE, text)
    console.log(`Wrote ${fileURLToPath(DOC_FILE)}`)
  }
}
