/* Partner Network (docs/partner-network.md): the home doorway and dock tab (links), /partner (the pitch and the
   status check) and /partner/apply (the questionnaire GET /v1/partner-network serves, one step at a time).
   While the feature is off every route answers 404: the links to it hide, and the pages
   say it is not open right now. The form's rules are a port of customer-app/src/partner-form.ts: which
   sections apply to the ticked categories, which questions show, and the same checks the API makes.
   Answers are kept in localStorage (mm-partner-draft) until the enquiry is received; files are sent after,
   one request each, so a failed upload never hides the reference.
   Loaded after pages.js (it adds to PAGES) and before app.js, so top-level code only declares and listens. */

PAGES.push(
  [/^\/partner\/?$/, () => partnerView()],
  [/^\/partner\/apply\/?$/, () => partnerApplyView()],
)

// ---- The form's rules (a port of partner-form.ts).

const pnBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
const pnChosen = (a) => (Array.isArray(a.categories) ? a.categories.filter((c) => typeof c === 'string') : [])

/** The steps for these answers: a section with categories only while one is ticked, a key asked once. */
function pnSteps(steps, answers) {
  const chosen = pnChosen(answers), seen = new Set(), out = []
  for (const st of steps) {
    const sections = []
    for (const s of st.sections) {
      if (s.categories && !s.categories.some((c) => chosen.includes(c))) continue
      const questions = s.questions.filter((q) => !seen.has(q.key))
      questions.forEach((q) => seen.add(q.key))
      if (questions.length) sections.push({ ...s, questions })
    }
    // A step of only category sections stays while nothing is ticked, so the count does not jump.
    if (sections.length || (!chosen.length && st.sections.length > 0 && st.sections.every((s) => s.categories))) out.push({ ...st, sections })
  }
  return out
}
const pnIsShown = (q, a) => !q.showIf || q.showIf.in.includes(a[q.showIf.key])
const pnShown = (step, a) => step.sections.flatMap((s) => s.questions.filter((q) => pnIsShown(q, a)))
function pnOptions(q, a) {
  const all = q.options || []
  if (q.optionsFrom || q.key === 'primaryCategory') {
    const chosen = pnChosen(a)
    return all.filter((o) => chosen.includes(o.value))
  }
  return all
}
function pnMobile(raw) {
  const s = String(raw).replace(/[\s()-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  return /^[6-9]\d{9}$/.test(s) ? `+91${s}` : null
}
const PN_EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
function pnAmount(raw) {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'string') return NaN
  const s = raw.replace(/,/g, '').trim()
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN
}
function pnPatternApplies(q, a, all) {
  if (!q.pattern) return false
  const when = q.patternOnlyWhen
  if (!when) return true
  const other = a[when.key], fallback = all.get(when.key)?.default
  const value = pnBlank(other) ? fallback : other
  return String(value ?? '').trim().toLowerCase() === String(when.equals).trim().toLowerCase()
}
/** One shown answer checked the way the API does: a problem { code, vars?, message? } or null. */
function pnCheck(q, raw, a, all = new Map()) {
  if (q.type === 'FILE_UPLOAD') return null
  if (q.type === 'CHECKBOX') return q.required && raw !== true ? { code: q.key === 'consent' ? 'consent' : 'required' } : null
  let value = raw
  if (pnBlank(value) && q.default !== undefined) value = q.default
  if (pnBlank(value)) {
    if (!q.required) return null
    if (q.key === 'categories') return { code: 'chooseOne' }
    return { code: ['BOOLEAN', 'RADIO', 'SELECT', 'MULTI_SELECT'].includes(q.type) ? 'choose' : 'required' }
  }
  // every way to partner is on offer; one applicant picks at most three of them (the owner's rule)
  if (q.key === 'categories' && Array.isArray(value) && value.length > PN_MAX) return { code: 'tooMany' }
  switch (q.type) {
    case 'TEXT': case 'TEXTAREA': {
      const v = String(value).replace(/\r\n?/g, '\n').trim(), max = q.max ?? (q.type === 'TEXT' ? 200 : 3000)
      if (q.min && v.length < q.min) return { code: 'tooShort', vars: { min: q.min } }
      if (v.length > max) return { code: 'tooLong', vars: { max } }
      if (pnPatternApplies(q, a, all) && !new RegExp(q.pattern).test(v)) return { code: 'pattern', message: q.patternMessage }
      return null
    }
    case 'EMAIL': {
      const v = String(value).trim()
      if (v.length > (q.max ?? 200)) return { code: 'tooLong', vars: { max: q.max ?? 200 } }
      return PN_EMAIL.test(v) ? null : { code: 'email' }
    }
    case 'PHONE': return pnMobile(String(value)) ? null : { code: 'phone' }
    case 'NUMBER': case 'CURRENCY': {
      const n = pnAmount(value)
      if (!Number.isFinite(n)) return { code: q.type === 'CURRENCY' ? 'amount' : 'number' }
      if (q.type === 'NUMBER' && !Number.isInteger(n)) return { code: 'wholeNumber' }
      if (q.min != null && n < q.min) return { code: 'tooSmall', vars: { min: q.min } }
      if (q.max != null && n > q.max) return { code: 'tooLarge', vars: { max: q.max } }
      return null
    }
    case 'SELECT': case 'RADIO': {
      if (q.key === 'primaryCategory' && !pnChosen(a).includes(String(value))) return { code: 'primaryNotTicked' }
      return pnOptions(q, a).map((o) => o.value).includes(String(value)) ? null : { code: 'choose' }
    }
    case 'MULTI_SELECT': {
      const allowed = (q.options || []).map((o) => o.value)
      return !Array.isArray(value) || value.some((v) => !allowed.includes(v)) ? { code: 'choose' } : null
    }
    case 'BOOLEAN': return typeof value === 'boolean' ? null : { code: 'choose' }
    case 'DATE': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : { code: 'date' }
    default: return null
  }
}
function pnQuestionMap(steps) {
  const m = new Map()
  for (const q of steps.flatMap((st) => st.sections.flatMap((s) => s.questions))) if (!m.has(q.key)) m.set(q.key, q)
  return m
}
function pnValidate(step, a, all) {
  const out = {}
  for (const q of pnShown(step, a)) {
    const p = pnCheck(q, a[q.key], a, all)
    if (p) out[q.key] = p
  }
  return out
}
const pnStepOf = (steps, key) => steps.findIndex((st) => st.sections.some((s) => s.questions.some((q) => q.key === key)))
function pnInitial(net, category) {
  const a = {}
  for (const q of pnQuestionMap(net.steps).values()) if (q.default !== undefined) a[q.key] = q.default
  if (category && net.categories.some((c) => c.code === category)) {
    a.categories = [category]
    a.primaryCategory = category
  }
  return a
}
/** Ticking categories keeps the main interest among them, and picks it when exactly one is ticked. */
function pnSet(a, key, value) {
  const next = { ...a, [key]: value }
  if (key === 'categories') {
    const chosen = pnChosen(next)
    if (chosen.length === 1) next.primaryCategory = chosen[0]
    else if (typeof next.primaryCategory === 'string' && !chosen.includes(next.primaryCategory)) delete next.primaryCategory
  }
  return next
}
/** What is sent: only the shown questions, no files, numbers as numbers, text trimmed, blanks left out. */
function pnBuild(steps, a) {
  const out = {}
  for (const st of pnSteps(steps, a)) {
    for (const q of pnShown(st, a)) {
      if (q.type === 'FILE_UPLOAD') continue
      let v = a[q.key]
      if (pnBlank(v) && q.default !== undefined) v = q.default
      if (q.type === 'CHECKBOX') {
        if (typeof v === 'boolean') out[q.key] = v
        continue
      }
      if (pnBlank(v)) continue
      if (q.type === 'NUMBER' || q.type === 'CURRENCY') {
        const n = pnAmount(v)
        out[q.key] = Number.isFinite(n) ? n : v
      } else out[q.key] = typeof v === 'string' ? v.trim() : v
    }
  }
  return out
}
/** The answers that still fit a newer questionnaire (409 QUESTIONNAIRE_CHANGED, or an old draft). */
function pnKeepMatching(steps, categories, a) {
  const all = pnQuestionMap(steps), codes = categories.map((c) => c.code), out = {}
  for (const [key, v] of Object.entries(a)) {
    const q = all.get(key)
    if (!q) continue
    if (key === 'categories') {
      const kept = pnChosen(a).filter((c) => codes.includes(c))
      if (kept.length) out[key] = kept
      continue
    }
    if (key === 'primaryCategory') {
      if (typeof v === 'string' && codes.includes(v)) out[key] = v
      continue
    }
    const values = (q.options || []).map((o) => o.value)
    if (q.type === 'SELECT' || q.type === 'RADIO') {
      if (typeof v === 'string' && values.includes(v)) out[key] = v
    } else if (q.type === 'MULTI_SELECT') {
      const kept = Array.isArray(v) ? v.filter((x) => values.includes(x)) : []
      if (kept.length) out[key] = kept
    } else if (q.type === 'BOOLEAN' || q.type === 'CHECKBOX') {
      if (typeof v === 'boolean') out[key] = v
    } else if (typeof v === 'string' || typeof v === 'number') out[key] = v
  }
  if (typeof out.primaryCategory === 'string' && !pnChosen(out).includes(out.primaryCategory)) delete out.primaryCategory
  return out
}
const pnFileProblem = (file, uploads) => (!uploads.types.includes(file.type) ? 'type' : file.size > uploads.maxFileBytes ? 'size' : null)
const pnMB = (bytes) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
const pnSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : pnMB(bytes))

/** A problem in words. */
function pnProblemText(q, p) {
  switch (p.code) {
    case 'required': return 'Please fill this in.'
    case 'choose': return q && q.type === 'MULTI_SELECT' ? 'Pick at least one.' : 'Please pick one.'
    case 'chooseOne': return 'Tick at least one way you’d like to work with us.'
    case 'tooMany': return `Choose up to ${PN_MAX_WORD} ways to partner: untick the ones that matter less.`
    case 'tooShort': return `A little more, please: at least ${p.vars.min} characters.`
    case 'tooLong': return `That’s a bit long. Keep it under ${p.vars.max} characters.`
    case 'email': return 'That email address doesn’t look quite right.'
    case 'phone': return 'Enter a 10-digit Indian mobile number.'
    case 'number': return 'Enter a number, like 5.'
    case 'wholeNumber': return 'Enter a whole number.'
    case 'amount': return 'Enter an amount in rupees, like 25000.'
    case 'tooSmall': return `It can’t be less than ${p.vars.min}.`
    case 'tooLarge': return `It can’t be more than ${p.vars.max}.`
    case 'pattern': return p.message || 'Check the format of this answer.'
    case 'date': return 'Pick a date.'
    case 'consent': return 'Please tick this so we can get in touch.'
    case 'primaryNotTicked': return 'Pick one of the ways you ticked above.'
    default: return 'Please check this answer.'
  }
}

// ---- The categories: a few words of our own for each, and an icon from the sprite.

const PN_FLAVOUR = {
  FARMERS_SUPPLIERS: ['leaf', 'You grow mangoes. We find them a good home.'],
  SALES_DISTRIBUTION: ['box', 'Take our mango boxes to your city.'],
  RETAIL_RESELLER: ['bag', 'Mango season, on your shelves.'],
  CORPORATE: ['user', 'Mangoes for the whole team, or the whole hotel.'],
  LOGISTICS: ['pin', 'Keep good fruit moving, gently.'],
  MARKETING: ['heart', 'Tell the story with us.'],
  PRODUCT_DEVELOPMENT: ['sun', 'Bring us the next big bite.'],
  BUSINESS_COLLAB: ['check', 'Big ideas, side by side.'],
  OTHER: ['search', 'Something else? Surprise us.'],
}
const pnFlavour = (code) => PN_FLAVOUR[code] || ['leaf', '']

// ---- The questionnaire, fetched once per visit (again after a 409 QUESTIONNAIRE_CHANGED).

// Every way to partner the API describes is on offer; one applicant may tick at most three of them (the owner's rule).
// The API's own hint for that question ("Choose all that apply.") is replaced to say so.
const PN_MAX = 3, PN_MAX_WORD = 'three'
function pnLimit(net) {
  if (!net || !Array.isArray(net.steps)) return net
  for (const st of net.steps) for (const sec of st.sections || []) for (const q of sec.questions || []) {
    if (q.key === 'categories') q.description = `Choose up to ${PN_MAX_WORD}.`
  }
  return net
}
/** Text from the API still carries the shop's old name in places. */
const pnBrand = (s) => String(s || '').replace(/MandiMangoes|Mandi Mangoes|Mango Mandi/g, 'VMR Mangoes')
/** The API's questions and descriptions still carry the old name: every string in its answer reads VMR Mangoes. */
function pnRebrand(net) {
  try { return JSON.parse(pnBrand(JSON.stringify(net))) } catch { return net }
}

let pnNet = null
function partnerNetwork(fresh = false) {
  if (fresh || !pnNet) pnNet = MM.partnerNetwork().then((net) => pnLimit(pnRebrand(net))).catch((e) => {
    pnNet = null
    if (e.status === 404) partnerOff()
    throw e
  })
  return pnNet
}

/** The feature is off (404): the section and the links to it go. */
function partnerOff() {
  document.querySelectorAll('[data-partner-link]').forEach((el) => { el.hidden = true })
}
function partnerOn() {
  document.querySelectorAll('[data-partner-link]').forEach((el) => { el.hidden = false })
}

// ---- The links to /partner (the home doorway, the dock tab, the nav and footer): shown only while the feature is on.
document.addEventListener('DOMContentLoaded', () => partnerNetwork().then(partnerOn, () => {}))

// ---- Shared bits of the pages.

function pnClosed(seq) {
  host().innerHTML = pageHead('Grow with us') + marker(seq) + `
    <section class="page-card pn-closed">
      <span class="pn-closed-art" aria-hidden="true">${icon('leaf')}</span>
      <h2>The orchard gate is <em>closed for now.</em></h2>
      <p>We aren’t taking partner applications at the moment. We open them again when there’s room to grow, so please check back soon.</p>
      <a class="button primary" href="/" data-route>Back to the mangoes ${icon('arrow')}</a>
    </section>`
}

function pnLoadFailed(seq, e, retry) {
  host().innerHTML = pageHead('Grow with us') + marker(seq) + `<p class="prototype-tag" role="alert">${esc(e.message)}</p><button class="button secondary" data-pn-retry>Try again</button>`
  $('[data-pn-retry]', host()).addEventListener('click', retry)
}

// ---- /partner: the pitch, the ways to partner, how it works, and the status check.

async function partnerView(seq = ++sheetSeq) {
  document.title = 'Grow with us · VMR Mangoes'
  host().innerHTML = pageHead('Grow with us') + marker(seq) + '<p>Loading…</p>'
  let net
  try {
    net = await partnerNetwork()
  } catch (e) {
    if (!alive(seq)) return
    return e.status === 404 ? pnClosed(seq) : pnLoadFailed(seq, e, () => partnerView())
  }
  if (!alive(seq)) return
  partnerOn()
  host().innerHTML = pageHead('Grow with us') + marker(seq) + `
    <section class="pn-hero">
      <span class="pn-kicker">The VMR Mangoes partner network</span>
      <h2>Grow mangoes with us. <em>Sell mangoes with us.</em></h2>
      <p>We have grown mangoes since 1976: on sun, soil and rain, ripened the slow way. We’re looking for mango farmers who grow the same way, and for people who can take good mangoes further: distributors in new cities, and shops that want naturally ripened fruit on their shelves.</p>
      <div class="pn-hero-actions"><a class="button cream" href="/partner/apply" data-route>Start my application ${icon('arrow')}</a><button class="button pn-check" type="button" data-pn-check>${icon('search')} Check my application status</button></div>
      <small>No registration needed · individuals welcome · about 10 minutes</small>
    </section>
    <section class="page-card pn-status is-key" id="pn-status">
      <h3>${icon('search')} Check your application status</h3>
      <p class="page-note">Already applied? Enter the reference we gave you when you sent your application.</p>
      <form id="pn-status-form" class="pn-status-form" novalidate>
        <label class="field">Your reference<input name="ref" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="MMP-7K2QXD9T" maxlength="20" aria-describedby="pn-status-result"></label>
        <button class="button primary" type="submit">Check status</button>
      </form>
      <div id="pn-status-result" class="pn-status-result" aria-live="polite"></div>
    </section>
    <section class="page-card">
      <h3>Ways to grow with us</h3>
      <div class="pn-ways">${net.categories.map((c) => {
        const [ic, line] = pnFlavour(c.code)
        return `<a class="pn-way" href="/partner/apply?category=${encodeURIComponent(c.code)}" data-route><span class="pn-icon">${icon(ic)}</span><span class="pn-way-text"><strong>${esc(c.name)}</strong>${line ? `<em>${esc(line)}</em>` : ''}<small>${esc(pnBrand(c.description))}</small></span><span class="pn-way-go" aria-hidden="true">${icon('arrow')}</span></a>`
      }).join('')}</div>
    </section>
    <section class="page-card">
      <h3>How it works</h3>
      <ol class="pn-how">
        <li><span>1</span><div><strong>Tell us about you</strong><p>A few questions about you, your work and the partnership you have in mind. Save as you go.</p></div></li>
        <li><span>2</span><div><strong>We call within a few days</strong><p>Someone from our partnerships team reads every application and gets in touch.</p></div></li>
        <li><span>3</span><div><strong>We grow together</strong><p>We agree what works for both of us, start small and build from there, season after season.</p></div></li>
      </ol>
      <a class="button primary" href="/partner/apply" data-route>Start my application ${icon('arrow')}</a>
    </section>
    `
}

// "Check my application status" in the hero: bring the status box into view and put the cursor in it.
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-pn-check]') : null
  if (!b) return
  const box = $('#pn-status')
  if (!box) return
  box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  setTimeout(() => $('#pn-status-form input')?.focus({ preventScroll: true }), 350)
})

/** "mmp 7k2q xd9t" or "7K2QXD9T" → "MMP-7K2QXD9T"; null when it can't be a reference. */
function pnReference(raw) {
  let s = String(raw || '').toUpperCase().replace(/[\s-]/g, '')
  if (s.startsWith('MMP')) s = s.slice(3)
  return /^[A-Z0-9]{8}$/.test(s) ? `MMP-${s}` : null
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'pn-status-form') return
  e.preventDefault()
  const form = e.target, out = $('#pn-status-result'), input = form.elements.ref, button = form.querySelector('button')
  const ref = pnReference(input.value)
  if (!ref) {
    out.innerHTML = '<p class="pn-status-msg is-bad">That doesn’t look like a reference. It starts with MMP- and has 8 letters and numbers, like MMP-7K2QXD9T.</p>'
    input.setAttribute('aria-invalid', 'true')
    return
  }
  input.removeAttribute('aria-invalid')
  input.value = ref
  button.disabled = true
  out.innerHTML = '<p class="pn-status-msg">Looking…</p>'
  try {
    const r = await MM.partnerStatus(ref)
    out.innerHTML = r && r.received
      ? `<p class="pn-status-msg is-good">${icon('check')}<span><strong>We have it.</strong> ${esc(r.reference || ref)} is with our partnerships team, and we’ll be in touch.</span></p>`
      : `<p class="pn-status-msg is-bad">We couldn’t find ${esc(ref)}.</p>`
  } catch (err) {
    out.innerHTML = err.status === 404
      ? `<p class="pn-status-msg is-bad"><strong>We couldn’t find ${esc(ref)}.</strong> Check the letters and numbers against your confirmation and try again.</p>`
      : `<p class="pn-status-msg is-bad">${esc(err.status === 429 ? 'That’s a lot of checks in a short while. Please try again in a few minutes.' : err.message)}</p>`
  } finally {
    button.disabled = false
  }
})

// ---- /partner/apply: the form.

const PN_DRAFT = 'mm-partner-draft'
const pnNewKey = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `pn-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
function pnReadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(PN_DRAFT))
    return d && typeof d === 'object' && d.answers && typeof d.key === 'string' ? d : null
  } catch { return null }
}
function pnSaveDraft() {
  if (!pn || pn.done) return
  try { localStorage.setItem(PN_DRAFT, JSON.stringify({ version: pn.version, answers: pn.answers, step: pn.at, key: pn.key, hadFiles: pn.files.length > 0 || pn.hadFiles })) } catch {}
}
function pnClearDraft() {
  try { localStorage.removeItem(PN_DRAFT) } catch {}
}

/** The form while /partner/apply is open. */
let pn = null

const PN_AUTOCOMPLETE = { fullName: 'name', mobile: 'tel', email: 'email', city: 'address-level2', state: 'address-level1', pincode: 'postal-code', country: 'country-name', businessName: 'organization', website: 'url' }

async function partnerApplyView(seq = ++sheetSeq) {
  document.title = 'Your application · VMR Mangoes'
  host().innerHTML = pageHead('Your application') + marker(seq) + '<p>Getting the form ready…</p>'
  let net
  try {
    net = await partnerNetwork()
  } catch (e) {
    if (!alive(seq)) return
    return e.status === 404 ? pnClosed(seq) : pnLoadFailed(seq, e, () => partnerApplyView())
  }
  if (!alive(seq)) return
  partnerOn()
  const category = new URLSearchParams(location.search).get('category')
  const draft = pnReadDraft()
  let answers, at = 0, key = pnNewKey(), restored = false, hadFiles = false
  if (draft) {
    const same = draft.version === net.version
    answers = same ? draft.answers : pnKeepMatching(net.steps, net.categories, draft.answers)
    at = same && Number.isInteger(draft.step) ? draft.step : 0
    key = draft.key
    hadFiles = Boolean(draft.hadFiles)
    restored = Object.keys(answers).some((k) => !pnBlank(answers[k]) && k !== 'country')
    const chosen = pnChosen(answers)
    if (category && net.categories.some((c) => c.code === category) && !chosen.includes(category)) answers = pnSet(answers, 'categories', [...chosen, category])
  } else answers = pnInitial(net, category)
  pn = { seq, net, all: pnQuestionMap(net.steps), answers, at, version: net.version, key, errors: {}, files: [], fileErrors: [], notice: restored ? { kind: 'restored' } : null, sending: false, captcha: null, widget: null, hadFiles, done: false }
  pnSaveDraft()
  pnRender()
}

/** The keys whose answer changes what else is asked: those are redrawn at once. */
function pnDeps() {
  const deps = new Set(['categories'])
  for (const q of pn.all.values()) if (q.showIf) deps.add(q.showIf.key)
  return deps
}

function pnProgress(steps) {
  const at = pn.at
  return `<ol class="pn-progress" aria-label="Application steps" style="--pn-n:${steps.length};--pn-fill:${steps.length > 1 ? at / (steps.length - 1) : 1}">${steps.map((st, i) => {
    const state = i < at ? 'done' : i === at ? 'current' : ''
    const dot = i < at ? icon('check') : `<span>${i + 1}</span>`
    const inner = `<span class="pn-dot">${dot}</span><span class="pn-progress-title">${esc(st.title)}</span>`
    return `<li class="${state}"${i === at ? ' aria-current="step"' : ''}>${i < at ? `<button type="button" data-pn-step="${i}" aria-label="Back to step ${i + 1}: ${esc(st.title)}">${inner}</button>` : inner}</li>`
  }).join('')}</ol>`
}

function pnNoticeHtml() {
  const n = pn.notice
  if (!n) return ''
  const text = {
    restored: 'Welcome back. We kept your answers, so you can carry on where you left off.',
    fix: 'A few answers need another look before we can send your application.',
    changed: 'We’ve just updated the form. We kept every answer that still fits, so please check this step and send again.',
    rate: 'We’ve had several applications from this connection in the last hour. Please try again a little later.',
    captcha: 'Please finish the quick check below so we know you’re not a robot.',
    failed: `We couldn’t send your application: ${n.reason || 'please try again.'} Your answers are safe here; try again when you’re ready.`,
  }[n.kind] || ''
  const good = n.kind === 'restored' || n.kind === 'changed'
  return `<div class="pn-notice${good ? ' is-soft' : ''}" role="${good ? 'status' : 'alert'}" tabindex="-1">${text}</div>`
}

function pnLabel(q) {
  return `${esc(q.label)}${q.required ? '' : ' <span class="pn-opt">optional</span>'}`
}

function pnQuestion(q) {
  const a = pn.answers, id = `pn-q-${q.key}`, err = pn.errors[q.key], value = a[q.key]
  const hintId = q.description ? `${id}-hint` : '', errId = `${id}-err`
  const hint = q.description ? `<p class="pn-hint" id="${hintId}">${esc(q.description)}</p>` : ''
  const errP = `<p class="pn-err" id="${errId}"${err ? '' : ' hidden'}>${err ? esc(err) : ''}</p>`
  const described = [hintId, err ? errId : ''].filter(Boolean).join(' ')
  const aria = `${described ? ` aria-describedby="${described}"` : ''}${err ? ' aria-invalid="true"' : ''}`
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  const ph = q.placeholder ? ` placeholder="${esc(q.placeholder)}"` : ''
  const req = q.required === true ? ' aria-required="true"' : ''
  switch (q.type) {
    case 'TEXTAREA': {
      const left = q.max ? q.max - text.trim().length : null
      return `<div class="field pn-q${err ? ' has-err' : ''}" data-q="${esc(q.key)}"><label for="${id}">${pnLabel(q)}</label>${hint}<textarea id="${id}" name="${esc(q.key)}" rows="${q.max && q.max > 600 ? 5 : 3}"${ph}${aria}${req}>${esc(text)}</textarea>${left !== null ? `<p class="pn-count-chars${left < 0 ? ' is-over' : ''}" data-count="${esc(q.key)}">${left >= 0 ? `${left} characters left` : `${-left} characters over`}</p>` : ''}${errP}</div>`
    }
    case 'CURRENCY':
      return `<div class="field pn-q${err ? ' has-err' : ''}" data-q="${esc(q.key)}"><label for="${id}">${pnLabel(q)}</label>${hint}<div class="pn-prefixed"><span aria-hidden="true">₹</span><input id="${id}" name="${esc(q.key)}" type="text" inputmode="decimal" autocomplete="off" value="${esc(text)}"${ph}${aria}${req}></div>${errP}</div>`
    case 'SELECT':
      return `<div class="field pn-q${err ? ' has-err' : ''}" data-q="${esc(q.key)}"><label for="${id}">${pnLabel(q)}</label>${hint}<select id="${id}" name="${esc(q.key)}" autocomplete="${PN_AUTOCOMPLETE[q.key] || 'off'}"${aria}${req}><option value="">Choose…</option>${pnOptions(q, a).map((o) => `<option value="${esc(o.value)}"${String(o.value) === text ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${errP}</div>`
    case 'RADIO': case 'BOOLEAN': {
      const options = q.type === 'BOOLEAN' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : pnOptions(q, a)
      const empty = q.key === 'primaryCategory' && !options.length ? '<p class="pn-hint">Tick at least one way to partner above, then pick the main one here.</p>' : ''
      return `<fieldset class="field pn-q pn-choices${err ? ' has-err' : ''}" data-q="${esc(q.key)}"${aria}><legend>${pnLabel(q)}</legend>${hint}${empty}<div class="pn-pills${q.type === 'BOOLEAN' ? ' is-yesno' : ''}">${options.map((o, i) => `<label class="pn-pill"><input type="radio" id="${i ? `${id}-${i}` : id}" name="${esc(q.key)}" value="${esc(String(o.value))}" data-kind="${q.type === 'BOOLEAN' ? 'bool' : 'text'}"${value === o.value ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>${errP}</fieldset>`
    }
    case 'MULTI_SELECT': {
      const picked = Array.isArray(value) ? value : []
      if (q.key === 'categories') {
        const full = picked.length >= PN_MAX
        const cap = `<p class="pn-cap${full ? ' is-full' : ''}" role="status">${icon(full ? 'info' : 'check')}<span>${full ? `That’s ${PN_MAX_WORD}, the most you can pick. Untick one to choose another.` : `${picked.length} of ${PN_MAX} chosen`}</span></p>`
        return `<fieldset class="field pn-q pn-choices${err ? ' has-err' : ''}" data-q="${esc(q.key)}"${aria}><legend>${pnLabel(q)}</legend>${hint}${full ? cap : ''}<div class="pn-cats">${pnOptions(q, a).map((o, i) => {
          const c = pn.net.categories.find((x) => x.code === o.value), [ic] = pnFlavour(o.value), off = full && !picked.includes(o.value)
          return `<label class="pn-cat${off ? ' is-off' : ''}"${off ? ` title="Untick one of your ${PN_MAX_WORD} to choose this"` : ''}><input type="checkbox" id="${i ? `${id}-${i}` : id}" name="categories" value="${esc(o.value)}"${picked.includes(o.value) ? ' checked' : ''}${off ? ' disabled' : ''}><span class="pn-icon">${icon(ic)}</span><span class="pn-cat-text"><strong>${esc(o.label)}</strong>${c && c.description ? `<small>${esc(c.description)}</small>` : ''}</span><span class="pn-tick" aria-hidden="true">${icon(off ? 'lock' : 'check')}</span></label>`
        }).join('')}</div>${full ? cap.replace(' role="status"', ' aria-hidden="true"') : cap}${errP}</fieldset>`
      }
      return `<fieldset class="field pn-q pn-choices${err ? ' has-err' : ''}" data-q="${esc(q.key)}"${aria}><legend>${pnLabel(q)}</legend>${hint}<div class="pn-pills">${(q.options || []).map((o, i) => `<label class="pn-pill is-multi"><input type="checkbox" id="${i ? `${id}-${i}` : id}" name="${esc(q.key)}" value="${esc(o.value)}"${picked.includes(o.value) ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>${errP}</fieldset>`
    }
    case 'CHECKBOX': {
      const consent = q.key === 'consent'
      const label = consent && pn.net.consent && pn.net.consent.text ? pn.net.consent.text : q.label
      const privacy = consent ? `<p class="pn-hint" id="${id}-privacy">How we look after your details: <a href="${esc((pn.net.consent && pn.net.consent.privacyPath) || '/privacy')}" target="_blank" rel="noopener">our privacy notice</a>.</p>` : ''
      const desc = [consent ? `${id}-privacy` : '', err ? errId : ''].filter(Boolean).join(' ')
      return `<div class="field pn-q pn-consent${err ? ' has-err' : ''}" data-q="${esc(q.key)}"><label class="pn-check" for="${id}"><input type="checkbox" id="${id}" name="${esc(q.key)}"${value === true ? ' checked' : ''}${desc ? ` aria-describedby="${desc}"` : ''}${err ? ' aria-invalid="true"' : ''}><span class="pn-box" aria-hidden="true">${icon('check')}</span><span>${esc(label)}</span></label>${privacy}${errP}</div>`
    }
    case 'FILE_UPLOAD': {
      const { maxFiles, maxFileBytes, types } = pn.net.uploads
      const kinds = types.map((t) => ({ 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' })[t] || t).join(', ')
      return `<div class="field pn-q pn-files" data-q="${esc(q.key)}"><span class="pn-files-label" id="${id}-label">${pnLabel(q)}</span><p class="pn-hint" id="${id}-hint">${esc(q.description || 'A profile, catalogue, photos or certificates help us understand you faster.')} ${kinds}; up to ${pnMB(maxFileBytes)} each, ${maxFiles} files at most. We send them right after your application.</p>${pn.hadFiles && !pn.files.length ? '<p class="pn-notice is-soft">The files you picked before the page reloaded can’t be kept. Please add them again.</p>' : ''}<div id="pn-file-list">${pnFileList()}</div></div>`
    }
    default: {
      const type = q.type === 'EMAIL' ? 'email' : q.type === 'PHONE' ? 'tel' : q.type === 'DATE' ? 'date' : 'text'
      const mode = q.type === 'PHONE' ? 'tel' : q.type === 'NUMBER' ? 'numeric' : q.type === 'EMAIL' ? 'email' : ''
      return `<div class="field pn-q${err ? ' has-err' : ''}" data-q="${esc(q.key)}"><label for="${id}">${pnLabel(q)}</label>${hint}<input id="${id}" name="${esc(q.key)}" type="${type}"${mode ? ` inputmode="${mode}"` : ''} autocomplete="${PN_AUTOCOMPLETE[q.key] || 'off'}" value="${esc(text)}"${ph}${aria}${req}>${errP}</div>`
    }
  }
}

function pnFileList() {
  const { maxFiles, types } = pn.net.uploads
  const list = pn.files.map((f) => `<li><span class="pn-file-icon" aria-hidden="true">${f.file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span><span class="pn-file-name"><strong>${esc(f.file.name)}</strong><small>${pnSize(f.file.size)}</small></span><label class="pn-file-kind"><span class="sr-only">What is ${esc(f.file.name)}?</span><select data-pn-file-kind="${f.id}">${pn.net.documentCategories.map((c) => `<option value="${esc(c.code)}"${c.code === f.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><button type="button" class="text-button" data-pn-file-remove="${f.id}">Remove<span class="sr-only"> ${esc(f.file.name)}</span></button></li>`).join('')
  const errs = pn.fileErrors.length ? `<div class="pn-err" role="alert">${pn.fileErrors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : ''
  return `${list ? `<ul class="pn-file-list" aria-labelledby="pn-q-documents-label">${list}</ul>` : ''}${pn.files.length < maxFiles ? `<label class="pn-drop" data-pn-drop><input type="file" id="pn-q-documents" class="sr-only" multiple accept="${esc(types.join(','))}" aria-describedby="pn-q-documents-hint"><span class="pn-drop-icon" aria-hidden="true">+</span><span><strong>${pn.files.length ? 'Add another file' : 'Add files'}</strong><small>or drop them here</small></span></label>` : `<p class="pn-hint">That’s the most we can take (${maxFiles} files).</p>`}${errs}`
}

function pnRender() {
  const steps = pnSteps(pn.net.steps, pn.answers)
  pn.at = Math.max(0, Math.min(pn.at, steps.length - 1))
  const step = steps[pn.at], last = pn.at === steps.length - 1
  const shown = pnShown(step, pn.answers)
  const problems = shown.filter((q) => pn.errors[q.key])
  const summary = problems.length ? `<div class="pn-summary" role="alert" tabindex="-1"><p><strong>${problems.length === 1 ? 'One answer needs' : `${problems.length} answers need`} a little attention</strong></p><ul>${problems.map((q) => `<li data-sum="${esc(q.key)}"><button type="button" class="text-button" data-pn-goto="${esc(q.key)}">${esc(q.label)}</button>: ${esc(pn.errors[q.key])}</li>`).join('')}</ul></div>` : ''
  const captcha = last && pn.net.captcha && pn.net.captcha.siteKeyRequired
  host().innerHTML = pageHead('Your application') + marker(pn.seq) + `
    <div class="pn-apply">
      <p class="pn-crumb"><a href="/partner" data-route>${icon('leaf')} Grow with us</a></p>
      ${pnProgress(steps)}
      <form id="pn-form" class="page-card pn-form" novalidate aria-labelledby="pn-step-title">
        <p class="pn-step-count">Step ${pn.at + 1} of ${steps.length}</p>
        <h2 id="pn-step-title" tabindex="-1">${esc(step.title)}</h2>
        ${step.description ? `<p class="pn-step-desc">${esc(step.description)}</p>` : ''}
        <div id="pn-notice">${pnNoticeHtml()}</div>
        ${summary}
        ${step.sections.map((s) => {
          const qs = s.questions.filter((q) => shown.includes(q))
          if (!qs.length) return ''
          const titled = step.sections.length > 1 || Boolean(s.categories)
          const tag = s.categories ? pn.net.categories.filter((c) => s.categories.includes(c.code) && pnChosen(pn.answers).includes(c.code)).map((c) => `<span class="pn-tag">${icon(pnFlavour(c.code)[0])}${esc(c.name)}</span>`).join('') : ''
          return `<section class="pn-section"${titled ? ` aria-labelledby="pn-sec-${esc(s.key)}"` : ''}>${titled ? `<div class="pn-section-head"><h3 id="pn-sec-${esc(s.key)}">${esc(s.title)}</h3>${tag}</div>` : ''}${qs.map(pnQuestion).join('')}</section>`
        }).join('')}
        ${!step.sections.length ? '<p class="pn-hint">Tick at least one way to partner on the step before, and the questions for it appear here.</p>' : ''}
        ${captcha ? '<div id="pn-captcha" class="pn-captcha"></div>' : ''}
        <div class="pn-actions">
          ${pn.at > 0 ? `<button type="button" class="button secondary" data-pn-back>${icon('back')} Back</button>` : '<span></span>'}
          <button type="submit" class="button primary" data-pn-next${pn.sending ? ' disabled' : ''}>${last ? (pn.sending ? 'Sending…' : 'Send my application') : 'Continue'} ${icon('arrow')}</button>
        </div>
        <p class="pn-saved">${icon('check')} Your answers are saved on this device as you go.</p>
      </form>
    </div>`
  document.title = `${step.title} · Your application · VMR Mangoes`
  if (captcha) pnMountCaptcha(pn.seq)
}

/** Redraws the step, keeping focus (and the caret) where it was. */
function pnRerender() {
  const a = document.activeElement, id = a && a.id, sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null
  pnRender()
  const el = id && document.getElementById(id)
  if (!el) return
  el.focus({ preventScroll: true })
  try { if (sel && sel[0] != null) el.setSelectionRange(sel[0], sel[1]) } catch {}
}

function pnFocus(what) {
  const el = what === 'summary' ? $('.pn-summary') : what === 'notice' ? $('#pn-notice .pn-notice') : $('#pn-step-title')
  if (!el) return
  el.focus({ preventScroll: true })
  const top = what === 'heading' ? $('.pn-progress') || el : el
  top.scrollIntoView({ block: what === 'heading' ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}

function pnShowNotice(n) {
  pn.notice = n
  const box = $('#pn-notice')
  if (box) box.innerHTML = pnNoticeHtml()
  if (n) pnFocus('notice')
}

async function pnMountCaptcha(seq) {
  const el = $('#pn-captcha')
  if (!el) return
  pn.captcha = null
  pn.widget = null
  let key = pn.net.captcha.siteKey
  if (!key) {
    const c = await (authConfig ??= MM.authConfig().catch(() => { authConfig = null; return {} }))
    key = c && c.turnstileSiteKey
  }
  if (!key) return
  try { await loadScript(TURNSTILE) } catch { return }
  if (!el.isConnected || !window.turnstile || !alive(seq)) return
  pn.widget = turnstile.render(el, {
    sitekey: key, action: pn.net.captcha.action || 'partner', size: 'flexible',
    callback: (t) => {
      pn.captcha = t
      if (pn.notice && pn.notice.kind === 'captcha') pnShowNotice(null)
    },
    'expired-callback': () => { pn.captcha = null },
    'error-callback': () => { pn.captcha = null },
  })
}
/** A token works once: the check runs again for the next try. */
function pnResetCaptcha() {
  pn.captcha = null
  if (pn.widget != null && window.turnstile) try { turnstile.reset(pn.widget) } catch {}
}

function pnStepErrors(step) {
  const found = pnValidate(step, pn.answers, pn.all), out = {}
  for (const [k, p] of Object.entries(found)) out[k] = pnProblemText(pn.all.get(k), p)
  return out
}

function pnNext() {
  const steps = pnSteps(pn.net.steps, pn.answers)
  const found = pnStepErrors(steps[pn.at])
  if (Object.keys(found).length) {
    pn.errors = { ...pn.errors, ...found }
    pn.notice = null
    pnRender()
    return pnFocus('summary')
  }
  pn.errors = {}
  pn.notice = null
  pn.at++
  pnSaveDraft()
  pnRender()
  pnFocus('heading')
}

function pnGoStep(i) {
  pn.errors = {}
  pn.notice = null
  pn.at = i
  pnSaveDraft()
  pnRender()
  pnFocus('heading')
}

async function pnSubmit() {
  const steps = pnSteps(pn.net.steps, pn.answers)
  // Every step again (an answer may have changed on the way back), stopping on the first with a problem.
  for (let i = 0; i < steps.length; i++) {
    const found = pnStepErrors(steps[i])
    if (Object.keys(found).length) {
      pn.at = i
      pn.errors = found
      pn.notice = null
      pnRender()
      return pnFocus('summary')
    }
  }
  if (pn.net.captcha && pn.net.captcha.siteKeyRequired && !pn.captcha) return pnShowNotice({ kind: 'captcha' })
  const seq = pn.seq, b = $('[data-pn-next]')
  pn.sending = true
  if (b) {
    b.disabled = true
    b.innerHTML = `Sending… ${icon('arrow')}`
  }
  const body = { questionnaireVersion: pn.version, answers: pnBuild(pn.net.steps, pn.answers), ...(pn.captcha ? { captchaToken: pn.captcha } : {}) }
  try {
    const r = await MM.partnerEnquiry(body, pn.key)
    if (!alive(seq)) return
    pnClearDraft()
    pnReceived(r, pn.files, false)
  } catch (e) {
    if (!alive(seq)) return
    pn.sending = false
    pnResetCaptcha()
    const x = e.extra || {}
    if (e.status === 400 && e.code === 'VALIDATION_ERROR' && x.fields && typeof x.fields === 'object') {
      // The API names each problem by question. A fixed answer is a new submission, so a new key.
      pn.key = pnNewKey()
      pnSaveDraft()
      const placed = Object.keys(x.fields).map((k) => pnStepOf(steps, k)).filter((i) => i >= 0)
      if (!placed.length) {
        pnRender()
        return pnShowNotice({ kind: 'failed', reason: String(Object.values(x.fields)[0] || e.message) })
      }
      pn.at = Math.min(...placed)
      pn.errors = { ...x.fields }
      pn.notice = { kind: 'fix' }
      pnRender()
      return pnFocus('summary')
    }
    if (e.status === 409 && e.code === 'DUPLICATE_ENQUIRY' && x.reference) {
      pnClearDraft()
      return pnReceived({ reference: String(x.reference) }, pn.files, true)
    }
    if (e.status === 409 && e.code === 'QUESTIONNAIRE_CHANGED') {
      pn.key = pnNewKey()
      try {
        const fresh = await partnerNetwork(true)
        if (!alive(seq)) return
        pn.net = fresh
        pn.all = pnQuestionMap(fresh.steps)
        pn.answers = pnKeepMatching(fresh.steps, fresh.categories, pn.answers)
        pn.version = fresh.version
      } catch (err) {
        if (!alive(seq)) return
        if (err.status === 404) return pnClosed(seq)
      }
      pn.errors = {}
      pn.notice = { kind: 'changed' }
      pnSaveDraft()
      pnRender()
      return pnFocus('notice')
    }
    if (e.status === 404) return pnClosed(seq)
    pnRender()
    if (e.status === 429) return pnShowNotice({ kind: 'rate' })
    // Offline, busy or anything else: the answers and the key stay, so trying again is safe.
    toast(e.message)
    pnShowNotice({ kind: 'failed', reason: e.message })
  }
}

// ---- Received: the reference, the uploads, what happens next.

function pnReceived(r, files, duplicate) {
  pn.done = true
  pn.sending = false
  pn.received = { reference: r.reference, token: r.uploadToken || null, duplicate }
  pn.uploads = duplicate || !r.uploadToken ? [] : files.map((f) => ({ ...f, status: 'waiting', progress: 0, reason: '' }))
  const skipped = (duplicate || !r.uploadToken) && files.length
  document.title = 'Application received · VMR Mangoes'
  host().innerHTML = pageHead(duplicate ? 'Already with us' : 'Application received') + marker(pn.seq) + `
    <section class="page-card pn-done">
      <div class="pn-sprout" aria-hidden="true"><span class="pn-sprout-ring"></span><svg viewBox="0 0 64 64"><path class="pn-stem" pathLength="1" d="M32 54V30"/><path class="pn-leaf-l" pathLength="1" d="M32 38c-9 0-15-6-15-15 9 0 15 6 15 15Z"/><path class="pn-leaf-r" pathLength="1" d="M32 32c0-10 7-16 17-16 0 10-7 16-17 16Z"/><path class="pn-soil" pathLength="1" d="M18 54h28"/></svg></div>
      <h2 tabindex="-1" id="pn-done-title">${duplicate ? 'We already have <em>your application.</em>' : 'Thank you. <em>The first seed is planted.</em>'}</h2>
      <p>${duplicate ? 'The same answers reached us recently, so we kept the first one. Here is its reference.' : 'Your application is with our partnerships team. Keep this reference handy, in case you call us or want to check on it.'}</p>
      <div class="pn-ref"><span>Your reference</span><strong id="pn-ref">${esc(r.reference)}</strong><button type="button" class="button secondary" data-pn-copy>${icon('check')} Copy</button></div>
      ${pn.uploads.length ? `<div class="pn-uploads"><h3>Your documents</h3><ul id="pn-upload-list"></ul></div>` : ''}
      ${skipped ? '<p class="pn-notice is-soft">The files you picked weren’t sent with this one. If we need them, we’ll ask when we call.</p>' : ''}
      <div class="pn-next-steps"><h3>What happens next</h3><ol>
        <li><strong>We read it properly.</strong> Every application is read by a person, not a filter.</li>
        <li><strong>We call within a few days,</strong> on the number you gave us, at the time you prefer.</li>
        <li><strong>We grow together.</strong> If it’s a fit, we start small and build from there.</li>
      </ol></div>
      <a class="button primary" href="/" data-route>Back to the mangoes ${icon('arrow')}</a>
    </section>`
  window.scrollTo({ top: 0, behavior: 'instant' })
  $('#pn-done-title').focus({ preventScroll: true })
  if (pn.uploads.length) {
    pnRenderUploads()
    pnUploadAll()
  }
}

function pnUploadRow(u) {
  const status = u.status === 'done' ? `<span class="pn-up-state is-good">${icon('check')} Sent</span>`
    : u.status === 'failed' ? `<span class="pn-up-state is-bad">${esc(u.reason)}</span><button type="button" class="text-button" data-pn-retry-upload="${u.id}">Try again</button>`
    : u.status === 'uploading' ? `<span class="pn-up-state">${Math.round(u.progress * 100)}%</span>`
    : '<span class="pn-up-state">Waiting…</span>'
  return `<li class="pn-up is-${u.status}" data-up="${u.id}"><span class="pn-file-name"><strong>${esc(u.file.name)}</strong><small>${pnSize(u.file.size)} · ${esc((pn.net.documentCategories.find((c) => c.code === u.category) || {}).label || u.category)}</small></span>${status}<span class="pn-bar" aria-hidden="true"><i style="width:${u.status === 'done' ? 100 : Math.round(u.progress * 100)}%"></i></span></li>`
}
function pnRenderUploads(only) {
  const list = $('#pn-upload-list')
  if (!list) return
  if (only) {
    const row = list.querySelector(`[data-up="${only.id}"]`)
    if (row) return row.outerHTML = pnUploadRow(only)
  }
  list.innerHTML = pn.uploads.map(pnUploadRow).join('')
}
const PN_UPLOAD_ERRORS = {
  FILE_INVALID: 'We couldn’t read this one as a PDF or photo.',
  PAYLOAD_TOO_LARGE: 'This file is too big.',
  TOO_MANY_FILES: 'We already have the most files we can take.',
  UPLOAD_TOKEN_INVALID: 'The upload window has closed. We’ll ask for it when we call.',
}
async function pnUpload(u) {
  const seq = pn.seq
  u.status = 'uploading'
  u.progress = 0
  pnRenderUploads(u)
  try {
    await MM.partnerDocument(pn.received.reference, pn.received.token, u.file, u.category, (p) => {
      u.progress = p
      if (alive(seq)) {
        const bar = $(`[data-up="${u.id}"] .pn-bar i`), pct = $(`[data-up="${u.id}"] .pn-up-state`)
        if (bar) bar.style.width = `${Math.round(p * 100)}%`
        if (pct) pct.textContent = `${Math.round(p * 100)}%`
      }
    })
    u.status = 'done'
  } catch (e) {
    u.status = 'failed'
    u.reason = PN_UPLOAD_ERRORS[e.code] || e.message
  }
  if (alive(seq)) pnRenderUploads(u)
}
async function pnUploadAll() {
  for (const u of pn.uploads) if (u.status === 'waiting') await pnUpload(u)
  const failed = pn.uploads.filter((u) => u.status === 'failed').length
  if (failed) toast(failed === 1 ? 'One file didn’t go through. Your application is safe.' : `${failed} files didn’t go through. Your application is safe.`)
  else toast(pn.uploads.length === 1 ? 'Your document is with us' : 'All your documents are with us')
}

// ---- Events on the form.

function pnAnswerFrom(t) {
  const key = t.name
  if (t.type === 'checkbox' && key !== 'consent' && pn.all.get(key)?.type === 'MULTI_SELECT') return [key, [...document.querySelectorAll(`#pn-form input[type=checkbox][name="${CSS.escape(key)}"]:checked`)].map((x) => x.value)]
  if (t.type === 'checkbox') return [key, t.checked]
  if (t.type === 'radio') return [key, t.dataset.kind === 'bool' ? t.value === 'true' : t.value]
  return [key, t.value]
}

function pnClearError(key) {
  if (!(key in pn.errors)) return
  delete pn.errors[key]
  // The summary loses the line too, and goes once nothing is left in it.
  const line = document.querySelector(`.pn-summary [data-sum="${CSS.escape(key)}"]`)
  if (line) {
    const sum = line.closest('.pn-summary')
    line.remove()
    if (!sum.querySelector('li')) sum.remove()
    else sum.querySelector('strong').textContent = `${sum.querySelectorAll('li').length === 1 ? 'One answer needs' : `${sum.querySelectorAll('li').length} answers need`} a little attention`
  }
  const box = document.querySelector(`#pn-form [data-q="${CSS.escape(key)}"]`)
  if (!box) return
  box.classList.remove('has-err')
  const err = box.querySelector('.pn-err')
  if (err) {
    err.hidden = true
    err.textContent = ''
  }
  box.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'))
}

function pnOnAnswer(e) {
  const t = e.target
  if (!pn || pn.done || !t.closest || !t.closest('#pn-form') || !t.name || t.type === 'file') return
  if (!pn.all.has(t.name)) return
  let [key, value] = pnAnswerFrom(t)
  if (key === 'categories' && Array.isArray(value) && value.length > PN_MAX) {
    // a fourth tick (the boxes past three are switched off, so this is a keyboard or assistive-technology path)
    t.checked = false
    value = value.filter((v) => v !== t.value)
  }
  pn.answers = pnSet(pn.answers, key, value)
  pnClearError(key)
  if (key === 'categories') pnClearError('primaryCategory')
  pnSaveDraft()
  const q = pn.all.get(key)
  if (q.type === 'TEXTAREA' && q.max) {
    const c = document.querySelector(`[data-count="${CSS.escape(key)}"]`), left = q.max - String(value).trim().length
    if (c) {
      c.textContent = left >= 0 ? `${left} characters left` : `${-left} characters over`
      c.classList.toggle('is-over', left < 0)
    }
  }
  if (e.type === 'change' && pnDeps().has(key)) pnRerender()
}
document.addEventListener('input', pnOnAnswer)
document.addEventListener('change', pnOnAnswer)

function pnAddFiles(picked) {
  const { maxFiles, maxFileBytes } = pn.net.uploads
  const fallback = (pn.net.documentCategories.find((c) => c.code === 'OTHER') || pn.net.documentCategories[0] || { code: 'OTHER' }).code
  const problems = [], added = []
  for (const file of picked) {
    const p = pnFileProblem(file, pn.net.uploads)
    if (p === 'type') problems.push(`${file.name}: we can take PDFs and JPEG, PNG or WebP photos.`)
    else if (p === 'size') problems.push(`${file.name} is over ${pnMB(maxFileBytes)}.`)
    else if (pn.files.length + added.length >= maxFiles) {
      problems.push(`That’s the most we can take: ${maxFiles} files.`)
      break
    } else added.push({ id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, file, category: file.type.startsWith('image/') ? (pn.net.documentCategories.find((c) => c.code === 'PRODUCT_PHOTOS') || {}).code || fallback : fallback })
  }
  pn.fileErrors = problems
  pn.files = [...pn.files, ...added]
  pn.hadFiles = pn.hadFiles && !pn.files.length
  pnSaveDraft()
  const box = $('#pn-file-list')
  if (box) box.innerHTML = pnFileList()
  $('.pn-files > .pn-notice')?.remove()
}

document.addEventListener('change', (e) => {
  const t = e.target
  if (!pn || !t.closest || !t.closest('#pn-form')) return
  if (t.id === 'pn-q-documents') {
    const picked = [...(t.files || [])]
    t.value = ''
    pnAddFiles(picked)
    $('#pn-q-documents')?.focus()
  } else if (t.dataset.pnFileKind) {
    const f = pn.files.find((x) => x.id === t.dataset.pnFileKind)
    if (f) f.category = t.value
  }
})

// Dropping files on the picker.
document.addEventListener('dragover', (e) => {
  const d = e.target instanceof Element && e.target.closest('[data-pn-drop]')
  if (!d) return
  e.preventDefault()
  d.classList.add('is-over')
})
document.addEventListener('dragleave', (e) => {
  const d = e.target instanceof Element && e.target.closest('[data-pn-drop]')
  if (d) d.classList.remove('is-over')
})
document.addEventListener('drop', (e) => {
  const d = e.target instanceof Element && e.target.closest('[data-pn-drop]')
  if (!d || !pn) return
  e.preventDefault()
  pnAddFiles([...(e.dataTransfer?.files || [])])
})

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'pn-form') return
  e.preventDefault()
  if (!pn || pn.sending) return
  const steps = pnSteps(pn.net.steps, pn.answers)
  if (pn.at >= steps.length - 1) pnSubmit()
  else pnNext()
})

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b || !pn) return
  if (b.hasAttribute('data-pn-back')) {
    pn.errors = {}
    pnGoStep(pn.at - 1)
  } else if (b.dataset.pnStep) pnGoStep(Number(b.dataset.pnStep))
  else if (b.dataset.pnGoto) {
    const el = document.getElementById(`pn-q-${b.dataset.pnGoto}`)
    if (el) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'center' })
    }
  } else if (b.dataset.pnFileRemove) {
    pn.files = pn.files.filter((f) => f.id !== b.dataset.pnFileRemove)
    pn.fileErrors = []
    pnSaveDraft()
    const box = $('#pn-file-list')
    if (box) box.innerHTML = pnFileList()
    $('#pn-q-documents')?.focus()
  } else if (b.hasAttribute('data-pn-copy')) {
    const ref = pn.received && pn.received.reference
    const done = () => {
      b.innerHTML = `${icon('check')} Copied`
      b.classList.add('is-copied')
      toast('Reference copied')
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ref).then(done, () => toast('Copy didn’t work. Press and hold the reference to copy it.'))
    else toast('Press and hold the reference to copy it.')
  } else if (b.dataset.pnRetryUpload) {
    const u = pn.uploads.find((x) => x.id === b.dataset.pnRetryUpload)
    if (u) pnUpload(u).then(() => { if (u.status === 'done') toast(`${u.file.name} is with us`) })
  }
})
