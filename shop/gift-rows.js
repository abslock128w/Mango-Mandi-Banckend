/* Gifting, the plain helpers (no page, no network): reading this tab's saved gift, the WhatsApp number check, the week
   words and the booking body. Loaded before gifts.js, which uses them; tests/unit/gift-rows.unit.ts runs them in Node.
   A person is { name, phone, ask, address, pincode, sku, stage, own }: one box each (the number of boxes is the number
   of people), `ask` true when we ask them for their address on WhatsApp (false: the giver typed it; null: not chosen
   yet, which means "ask" wherever asking is open), `own` when their box differs from the one everyone gets. */

const GIFT_DRAFT_V = 3
const GIFT_STAGES = ['RAW', 'SEMI_RIPE']
const giftStr = (v, max = 500) => String(v == null ? '' : v).slice(0, max)

/** A saved person, from any draft shape (v1: each with a box, boxes and note; v2: the box for everyone plus
 *  `own`; v3: this one). A person who had an address typed keeps it, and is "I'll enter it". */
function giftPersonFrom(r) {
  const address = giftStr(r.address), pincode = giftStr(r.pincode, 6)
  const ask = r.ask === true ? true : r.ask === false ? false : address.trim() || pincode.trim() ? false : null
  return {
    name: giftStr(r.name, 80), phone: giftStr(r.phone, 16), ask, address, pincode,
    sku: giftStr(r.sku, 40), stage: GIFT_STAGES.includes(r.stage) ? r.stage : 'SEMI_RIPE', own: !!r.own,
  }
}
const giftBlank = (r) => !r.name.trim() && !r.phone.trim() && !r.address.trim() && !r.pincode.trim()

/** This tab's saved gift (the JSON string, or null), as { box, note, people, ... }, or null when there is none. */
function readGiftDraft(json) {
  let d
  try { d = JSON.parse(json) } catch { return null }
  if (!d || typeof d !== 'object' || !Array.isArray(d.recipients) || !d.recipients.length) return null
  const raw = d.recipients.slice(0, 100).filter((r) => r && typeof r === 'object')
  let people = raw.map(giftPersonFrom), box = null, note = ''
  if (d.v === 2 || d.v === GIFT_DRAFT_V) {
    box = d.box && d.box.sku ? { sku: giftStr(d.box.sku, 40), stage: GIFT_STAGES.includes(d.box.stage) ? d.box.stage : 'SEMI_RIPE' } : null
    note = giftStr(d.note, 200)
  } else {
    // v1: every person had a box and a note of their own; the first box is everyone's, one shared note stays shared.
    people = people.filter((r) => !giftBlank(r))
    const first = people.find((r) => r.sku) || null
    box = first ? { sku: first.sku, stage: first.stage } : null
    for (const r of people) r.own = !!(box && (r.sku !== box.sku || r.stage !== box.stage))
    const notes = raw.map((r) => giftStr(r.note, 200).trim())
    if (notes.length && notes.every((x) => x && x === notes[0])) note = notes[0]
  }
  if (!people.length) return null
  return {
    box, note, people,
    date: d.date || null, slotId: d.slotId || null, sender: giftStr(d.sender, 80),
    business: !!d.business, bizName: giftStr(d.bizName, 100), gstin: giftStr(d.gstin, 20), wantPay: !!d.wantPay,
  }
}
/** What is saved: the same shape readGiftDraft reads (v3). */
function giftDraftJSON(g) {
  return JSON.stringify({
    v: GIFT_DRAFT_V, box: g.box, note: g.note,
    recipients: g.recipients.map((r) => ({ name: r.name, phone: r.phone, ask: r.ask, address: r.address, pincode: r.pincode, sku: r.sku, stage: r.stage, own: r.own })),
    date: g.date, slotId: g.slotId, sender: g.sender, business: g.business, bizName: g.bizName, gstin: g.gstin, wantPay: !!g.wantPay,
  })
}

/** A WhatsApp number as the API takes it: 10 digits, without +91 or a leading 0. */
const giftPhone = (s) => String(s || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')
/** What is wrong with a WhatsApp number, in words, or ''. */
function giftPhoneWhy(s) {
  const p = giftPhone(s)
  if (!p) return 'Enter their WhatsApp number'
  return /^[6-9]\d{9}$/.test(p) ? '' : 'Enter a 10-digit mobile number'
}

/** "week of 1 Mar", or "weeks of 1 Mar – 8 Mar" when people get different weeks; '' with none. `fmt` formats a week. */
function giftWeekSpan(weeks, fmt) {
  const ws = [...new Set((weeks || []).filter(Boolean).map(String))].sort()
  if (!ws.length) return ''
  return ws.length === 1 ? `week of ${fmt(ws[0])}` : `weeks of ${fmt(ws[0])} – ${fmt(ws[ws.length - 1])}`
}

/** One person of a gift pre-order (POST /v1/preorders/groups): one box, their week, and either their address or
 *  `askAddress` (the API asks them on WhatsApp after the payment). */
function giftGroupRecipient(r, weekStart, ask, note) {
  const gift = { recipientName: r.name.trim(), recipientPhone: giftPhone(r.phone), ...(note ? { message: note } : {}) }
  const base = { sku: r.sku, stage: r.stage, qty: 1, weekStart }
  return ask ? { ...base, askAddress: true, gift } : { ...base, pincode: r.pincode.trim(), address: r.address.trim(), gift }
}

/** The sticky bar's line: "2 boxes · Arrives week of 1 Mar". */
const giftBarLine = (boxes, when) => `${boxes} ${boxes === 1 ? 'box' : 'boxes'}${when ? ` · Arrives ${when}` : ''}`
