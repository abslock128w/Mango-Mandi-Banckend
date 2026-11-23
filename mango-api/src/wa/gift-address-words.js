// The suggested wording of the three gift address messages (GIFT_ADDRESS_LINKS, docs/gifting.md), in one place: the
// template doc (scripts/whatsapp-templates-doc.mjs) and the giver's preview (GET /v1/preorders/groups/:id,
// addressMessage) both read it, so the shop shows the recipient the same words Meta is asked to approve.
// {{n}} are the template's body variables in the registry's order (src/wa/registry.js).

export const GIFT_ADDRESS_BODY = {
  GIFT_ADDRESS_REQUEST: 'Hi {{1}}, {{2}} is sending you a gift of VMR Mangoes: {{3}}, to be delivered in {{4}}. Tap the button below to tell us where to deliver it.',
  GIFT_ADDRESS_REMINDER: 'Hi {{1}}, your gift of VMR Mangoes from {{2}} ({{3}}) is due in {{4}}, and we still need your delivery address. Tap the button below to add it.',
  GIFT_ADDRESS_MISSING: 'Hi {{1}}, {{2}} has not given their delivery address yet for your gift ({{3}}, {{4}}). You can send them the link again from your gift’s page: {{5}}',
}

/** The body with its variables filled in. */
export const fillBody = (kind, params) => GIFT_ADDRESS_BODY[kind].replace(/\{\{(\d+)\}\}/g, (_m, i) => String(params[Number(i) - 1] ?? ''))
