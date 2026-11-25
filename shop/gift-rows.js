/* Gifting, the plain helpers (no page, no network): reading this tab's saved gift, the WhatsApp number check, the box
   lines (add, count, the 20-box cap), the one week a gift arrives in, the week words and the booking bodies. Loaded
   before gifts.js, which uses them; tests/unit/gift-rows.unit.ts runs them in Node.
   A gift goes to ONE person with as many boxes as they like (change request 02, CR2-06/07): `lines` [{ sku, stage, qty }]
   (one line per box size and ripeness), and the person { name, phone, ask, address, landmark, pincode }, `ask` true when
   we ask them for their address on WhatsApp (false: the giver typed it; null: not chosen yet, which means "ask" wherever
   asking is open). */

const GIFT_DRAFT_V = 4
const GIFT_STAGES = ['RAW', 'SEMI_RIPE']
/** The most boxes in one gift (change request 02, Q2; the API's GIFT_MAX_BOXES, policy giftMaxBoxes). */
const GIFT_MAX_BOXES = 20
const giftStr = (v, max = 500) => String(v == null ? '' : v).slice(0, max)

/** The person, from any draft shape (a v1 to v3 person kept a box too, read separately). A person who had an address
 *  typed keeps it, and is "I'll enter it". */
function giftPersonFrom(r) {
  r = r && typeof r === 'object' ? r : {}
  const address = giftStr(r.address), pincode = giftStr(r.pincode, 6)
  const ask = r.ask === true ? true : r.ask === false ? false : address.trim() || pincode.trim() ? false : null
  return { name: giftStr(r.name, 80), phone: giftStr(r.phone, 16), ask, address, landmark: giftStr(r.landmark, 100), pincode }
}
const giftBlank = (r) => !r.name.trim() && !r.phone.trim() && !r.address.trim() && !r.pincode.trim() && !String(r.landmark || '').trim()

/** One saved box line, or null when it is not one. */
function giftLineFrom(l) {
  if (!l || typeof l !== 'object' || !l.sku) return null
  const qty = Math.floor(Number(l.qty))
  return { sku: giftStr(l.sku, 40), stage: GIFT_STAGES.includes(l.stage) ? l.stage : 'SEMI_RIPE', qty: qty >= 1 ? Math.min(qty, GIFT_MAX_BOXES) : 1 }
}

/** Box lines with one line per box and ripeness (added up), at most `max` boxes in all (the later lines cut back). */
function giftMergeLines(lines, max = GIFT_MAX_BOXES) {
  const out = []
  let left = max
  for (const raw of lines || []) {
    const l = giftLineFrom(raw)
    if (!l || left <= 0) continue
    const q = Math.min(l.qty, left)
    const same = out.find((x) => x.sku === l.sku && x.stage === l.stage)
    if (same) same.qty += q
    else out.push({ ...l, qty: q })
    left -= q
  }
  return out
}

/** This tab's saved gift (the JSON string, or null), as { lines, person, note, ... }, or null when there is none.
 *  v4 is this shape; a v1 to v3 draft (a gift for several people) becomes a gift for its first person, with their box. */
function readGiftDraft(json) {
  let d
  try { d = JSON.parse(json) } catch { return null }
  if (!d || typeof d !== 'object') return null
  let lines = [], person = null, note = ''
  if (d.v === GIFT_DRAFT_V) {
    lines = giftMergeLines(Array.isArray(d.lines) ? d.lines : [])
    person = giftPersonFrom(d.person)
    note = giftStr(d.note, 200)
  } else if (Array.isArray(d.recipients) && d.recipients.length) {
    const raw = d.recipients.slice(0, 100).filter((r) => r && typeof r === 'object')
    const first = raw.find((r) => !giftBlank(giftPersonFrom(r))) || raw[0]
    if (!first) return null
    person = giftPersonFrom(first)
    const box = (d.v === 2 || d.v === 3) && d.box && d.box.sku && !first.own ? d.box : first.sku ? first : d.box
    lines = giftMergeLines(box && box.sku ? [{ sku: box.sku, stage: box.stage, qty: 1 }] : [])
    if (d.v === 2 || d.v === 3) note = giftStr(d.note, 200)
    else {
      const notes = raw.map((r) => giftStr(r.note, 200).trim())
      if (notes.length && notes.every((x) => x && x === notes[0])) note = notes[0]
    }
  } else return null
  if (!lines.length && giftBlank(person)) return null
  return {
    lines, person, note,
    date: d.date || null, slotId: d.slotId || null, sender: giftStr(d.sender, 80),
    business: !!d.business, bizName: giftStr(d.bizName, 100), gstin: giftStr(d.gstin, 20), wantPay: !!d.wantPay,
  }
}
/** What is saved: the same shape readGiftDraft reads (v4). */
function giftDraftJSON(g) {
  const p = g.person || {}
  return JSON.stringify({
    v: GIFT_DRAFT_V, lines: (g.lines || []).map((l) => ({ sku: l.sku, stage: l.stage, qty: l.qty })), note: g.note,
    person: { name: p.name, phone: p.phone, ask: p.ask, address: p.address, landmark: p.landmark, pincode: p.pincode },
    date: g.date, slotId: g.slotId, sender: g.sender, business: g.business, bizName: g.bizName, gstin: g.gstin, wantPay: !!g.wantPay,
  })
}

/** How many boxes the lines hold. */
const giftBoxCount = (lines) => (lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0)

/** The lines after `delta` boxes of one box and ripeness (a new line when it is not in yet; a line at 0 goes), never more
 *  than `max` boxes in all: { lines, capped } (capped: some of the boxes asked for did not fit). */
function giftAddLine(lines, sku, stage, delta, max = GIFT_MAX_BOXES) {
  const out = (lines || []).map((l) => ({ ...l }))
  const i = out.findIndex((l) => l.sku === sku && l.stage === stage)
  const room = max - giftBoxCount(out)
  const d = delta > 0 ? Math.min(delta, Math.max(room, 0)) : delta
  if (i < 0) { if (d > 0) out.push({ sku, stage, qty: d }) }
  else {
    out[i].qty += d
    if (out[i].qty <= 0) out.splice(i, 1)
  }
  return { lines: out, capped: delta > 0 && d < delta }
}

/** The one week a gift arrives in, before the season (the API's togetherWeek): the earliest week in which every line
 *  has room together, lines of one variety sharing its room, which is the week of the box that is ready last. `daysOf(sku)`
 *  gives that box's variety weeks [{ weekStart, remaining }], `varietyOf(sku)` its variety and `need(qty, sku)` what a
 *  line takes from a week (kg). Returns the week (YYYY-MM-DD) or null when no week can take the whole gift. */
function giftTogetherWeek(lines, daysOf, varietyOf, need) {
  if (!lines || !lines.length) return null
  const byVariety = new Map()
  for (const l of lines) {
    const v = varietyOf(l.sku)
    const x = byVariety.get(v) || { sku: l.sku, kg: 0 }
    x.kg += need(l.qty, l.sku)
    byVariety.set(v, x)
  }
  const weeks = [...new Set(lines.flatMap((l) => (daysOf(l.sku) || []).map((d) => String(d.weekStart))))].sort()
  return weeks.find((w) => [...byVariety.values()].every((x) => {
    const d = (daysOf(x.sku) || []).find((y) => String(y.weekStart) === w)
    return !!d && Number(d.remaining) >= x.kg - 1e-9
  })) || null
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

/** One box line of a gift for one person before the season (POST /v1/preorders/groups with oneDelivery): the line, the
 *  gift's one week, and either the address (and landmark) or `askAddress` (the API asks them on WhatsApp after paying). */
function giftGroupLine(p, l, weekStart, ask, note) {
  const gift = { recipientName: p.name.trim(), recipientPhone: giftPhone(p.phone), ...(note ? { message: note } : {}) }
  const base = { sku: l.sku, stage: l.stage, qty: l.qty, weekStart }
  if (ask) return { ...base, askAddress: true, gift }
  const landmark = String(p.landmark || '').trim()
  return { ...base, pincode: p.pincode.trim(), address: p.address.trim(), ...(landmark ? { landmark } : {}), gift }
}

/** The one recipient of a gift order in season (POST /v1/gifts/quote): every box line in their one delivery. */
function giftSeasonRecipient(p, lines, note) {
  const landmark = String(p.landmark || '').trim()
  return {
    name: p.name.trim(), phone: giftPhone(p.phone), address: p.address.trim(), ...(landmark ? { landmark } : {}), pincode: p.pincode.trim(),
    lines: lines.map((l) => ({ sku: l.sku, stage: l.stage, qty: l.qty })), note: note || null,
  }
}

/** "3 boxes · 9 kg" (kg left out while unknown). */
const giftBarLine = (boxes, kg) => `${boxes} ${boxes === 1 ? 'box' : 'boxes'}${kg ? ` · ${Math.round(kg * 10) / 10} kg` : ''}`

/** The recipient's box in words (the address page): "Alphonso gift box · Semi-ripe", "2 × Kesar gift box · Raw".
 *  `stageWord` turns RAW / SEMI_RIPE into its word. */
function giftBoxWords(b, stageWord) {
  if (!b) return 'A box of mangoes'
  return `${b.qty > 1 ? `${b.qty} × ` : ''}${b.name || 'Mangoes'}${b.stage ? ` · ${stageWord(b.stage)}` : ''}`
}
/** When an address link may be sent again (the API's addressLink.resendAfter: a time, or seconds from `now`), or null. */
function giftResendAt(l, now = Date.now()) {
  if (!l || l.resendAfter == null) return null
  const t = typeof l.resendAfter === 'number' ? new Date(now + l.resendAfter * 1000) : new Date(l.resendAfter)
  return Number.isNaN(t.getTime()) ? null : t
}
