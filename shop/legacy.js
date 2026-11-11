/* Our legacy (/legacy): fifty summers of Mango Mandi, the shop's one editorial page.
   Static content, so it works before the catalogue loads and with the API down; the only live number is the count of
   varieties (the shop's own shelf, once loaded; 16 until then or without it).
   The art is inline SVG drawn here (the hero's rings, the trunk with fifty rings, the week of mangoes, the hands' path).
   Motion is extra: GSAP and ScrollTrigger (already shipped) reveal the sections and draw the rings, the numbers count up,
   all skipped with prefers-reduced-motion or when the scripts are missing. Nothing waits on motion to be readable.
   The ring for the decade card in view lights up (IntersectionObserver; without it every decade ring stays lit).
   Styles: the "Our legacy" block in style.css (.lg-), dark rules in theme.css.
   Loaded after pages.js (it adds to PAGES) and before app.js, so top-level code only declares and listens. */

PAGES.push([/^\/legacy\/?$/, () => legacyView()])

const LG_TITLE = 'Our legacy · Mango Mandi'
const LG_HOME_TITLE = document.title
const LG_VARIETIES = 16
const LG_DECADES = [
  ['1976', 'The first orchard', 'A few acres, a borrowed cart, and a rule that still stands: nothing leaves the farm that we would not eat ourselves.'],
  ['1986', 'A name at the mandi', 'Ten summers in, buyers started asking for our crates by name. We learned to grade by hand and by eye, one fruit at a time.'],
  ['1996', 'Saying no to shortcuts', 'When quick ripening with chemicals became common, we kept the hay, the heat and the patience. It cost us weeks. It kept us our customers.'],
  ['2006', 'The next generation', 'The children who grew up counting crates took over the ledgers, then the orchards. More varieties went into the ground.'],
  ['2016', 'From the mandi to your door', 'We began packing boxes for homes, not just markets. Every box since has carried the day it was plucked.'],
]
const LG_VOWS = [
  ['leaf', 'Ripened the slow way', 'No carbide, no gas. Warmth, time and a watchful eye.'],
  ['check', 'Graded by hand', 'Every mango is turned, pressed and looked at before it is packed.'],
  ['sun', 'A day from the tree', 'Fruit reaches our warehouse the day after it is plucked.'],
  ['info', 'Sold as it really is', 'Raw is sold as raw, semi-ripe as semi-ripe. We never sell a mango past its best.'],
  ['heart', 'Fair to the grower', 'The people who tend the trees are paid first and paid properly.'],
]
const LG_HANDS = [
  ['The grower', 'Knows each tree by how it carried last year.'],
  ['The grader', 'Decides raw or semi-ripe by touch, not by a chart.'],
  ['The packer', 'Nests each fruit so it travels without a bruise.'],
  ['The rider', 'Brings it to your door, usually the next day.'],
]
const LG_PLEDGES = ['Plant more than we pick.', 'Keep telling you exactly how old your fruit is.', 'Grow with more farmers who ripen the slow way.']

let lgCleanup = []

function legacyView() {
  document.title = LG_TITLE
  lgStop()
  const varieties = shelf.length || LG_VARIETIES
  host().innerHTML = `<div class="page-head lg-head"><button class="icon-button" data-page-back aria-label="Back">${icon('back')}</button><p class="lg-head-title">Our legacy</p></div>
<article class="lg">
  <section class="lg-hero" aria-labelledby="lg-title">
    ${lgHeroRings()}
    <span class="lg-hero-50" aria-hidden="true">50</span>
    <div class="lg-hero-copy">
      <p class="lg-kicker">Since 1976</p>
      <h1 id="lg-title">Fifty summers.<br><em>One promise.</em></h1>
      <p class="lg-hero-lead">We have grown, picked and carried mangoes to people’s doors since 1976. The trees are older now and so are we. The promise has not moved: fruit ripened the slow way, sold honestly, at the stage it really is.</p>
      <div class="lg-hero-actions"><a class="button cream" href="/" data-route>Shop this season ${icon('arrow')}</a><a class="lg-hero-link" href="#lg-rings" data-lg-jump>Read our story ${icon('chevron')}</a></div>
    </div>
  </section>

  <section class="lg-sec lg-rings" id="lg-rings" aria-labelledby="lg-rings-title">
    <div class="lg-sec-head"><h2 id="lg-rings-title">Read the rings.</h2><p>A mango tree keeps its own diary: one ring for every summer. These are ours.</p></div>
    <div class="lg-rings-body">
      <div class="lg-disc-wrap">${lgDisc()}</div>
      <div class="lg-decades-wrap">
        <ol class="lg-decades">${LG_DECADES.map(([year, title, text], i) => `<li class="lg-decade${i ? '' : ' is-on'}" data-lg-decade="${i}"><span class="lg-dot" aria-hidden="true"></span><p class="lg-year">${year}</p><h3>${title}</h3><p>${text}</p></li>`).join('')}</ol>
        <p class="lg-now"><span class="lg-now-ring" aria-hidden="true"></span><span><b>2026</b> · The fiftieth ring is still growing.</span></p>
      </div>
    </div>
  </section>

  <section class="lg-sec lg-vows-sec" aria-labelledby="lg-vows-title">
    <div class="lg-sec-head"><h2 id="lg-vows-title">Five things we never traded.</h2></div>
    <ul class="lg-vows">${LG_VOWS.map(([ic, title, text]) => `<li><span class="lg-vow-icon">${icon(ic)}</span><h3>${title}</h3><p>${text}</p></li>`).join('')}</ul>
  </section>

  <section class="lg-sec lg-week-sec" aria-labelledby="lg-week-title">
    <div class="lg-sec-head"><h2 id="lg-week-title">Seven days, told honestly.</h2><p>Most shops will not tell you how old your fruit is. We built ours around it.</p></div>
    ${lgWeek()}
    <p class="lg-week-note">${icon('info')}<span>That is why every box tells you when it will be ready to eat.</span></p>
  </section>

  <section class="lg-sec lg-stats-sec" aria-labelledby="lg-stats-title">
    <h2 class="lg-sr" id="lg-stats-title">Fifty summers in numbers</h2>
    <ul class="lg-stats">
      <li><strong data-lg-count="50">50</strong><span>summers</span></li>
      <li><strong data-lg-count="${varieties}" data-lg-varieties>${varieties}</strong><span>varieties this season</span></li>
      <li><strong>1</strong><span>day from tree to warehouse</span></li>
      <li><strong>0</strong><span>shortcuts in ripening</span></li>
    </ul>
  </section>

  <section class="lg-sec lg-hands-sec" aria-labelledby="lg-hands-title">
    <div class="lg-sec-head"><h2 id="lg-hands-title">A mango passes through four pairs of hands.</h2></div>
    <div class="lg-hands-track">
      <svg class="lg-hands-path" viewBox="0 0 300 34" preserveAspectRatio="none" aria-hidden="true"><path d="M0 34C30 2 70 2 100 34C130 2 170 2 200 34C230 2 270 2 300 34"/></svg>
      <ol class="lg-hands">${LG_HANDS.map(([who, text], i) => `<li><span class="lg-hand-mark" aria-hidden="true">${i + 1}</span><h3>${who}</h3><p>${text}</p></li>`).join('')}</ol>
    </div>
    <img class="lg-hands-photo" src="assets/mangoes/m06.webp" alt="" width="720" height="720" loading="lazy" decoding="async">
  </section>

  <section class="lg-sec lg-note-sec" aria-labelledby="lg-note-title">
    <h2 class="lg-sr" id="lg-note-title">A note from the family</h2>
    <figure class="lg-note">
      <svg class="lg-note-mark" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22"/><circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="24" r="2" class="lg-note-pith"/></svg>
      <blockquote><p>“We were taught that a mango is a promise you make in spring and keep in summer. Fifty summers on, we are still keeping it.”</p></blockquote>
      <figcaption>The Mango Mandi family</figcaption>
    </figure>
  </section>

  <section class="lg-sec lg-next" aria-labelledby="lg-next-title">
    ${lgHeroRings('lg-next-rings')}
    <h2 id="lg-next-title">The next fifty summers.</h2>
    <ul class="lg-pledges">${LG_PLEDGES.map((p) => `<li>${icon('check')}<span>${p}</span></li>`).join('')}</ul>
    <div class="lg-next-actions"><a class="button primary" href="/" data-route>Shop this season ${icon('arrow')}</a><a class="button secondary" href="/partner" data-route data-partner-link${lgPartnerHidden() ? ' hidden' : ''}>Grow with us ${icon('arrow')}</a></div>
  </section>
</article>`
  lgRingsLight()
  lgMotion()
  if (!shelf.length) {
    shelfReady().then(() => {
      if (document.body.dataset.page !== 'legacy' || !shelf.length) return
      const n = $('[data-lg-varieties]')
      if (n) { n.textContent = shelf.length; n.dataset.lgCount = shelf.length }
    })
  }
}

/** The partner links are hidden while the partner network is closed (partner.js): follow what the header link says. */
function lgPartnerHidden() {
  const nav = $('.desktop-nav [data-partner-link]')
  return Boolean(nav && nav.hidden)
}

// ---- Art.

/** Faint rings radiating from the bottom-right corner (the hero, and again on the closing card). */
function lgHeroRings(cls = 'lg-hero-rings') {
  let rings = '', r = 34
  for (let i = 0; i < 22; i++) {
    r += 18 + ((i * 7) % 5) * 3
    rings += `<circle cx="600" cy="600" r="${r}"${i === 6 || i === 13 ? ' class="is-mark"' : ''}/>`
  }
  return `<svg class="${cls}" viewBox="0 0 600 600" aria-hidden="true" focusable="false">${rings}</svg>`
}

/** Smooth closed path through points (Catmull-Rom as cubic Béziers). */
function lgClosed(pts) {
  const n = pts.length, f = (v) => v.toFixed(1)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + 'Z'
}

/** One ring of the trunk: a little uneven and off-centre, as real growth is. k is 0 (pith) to 1 (bark). */
function lgRingPts(radius, k, steps = 40) {
  const cx = 220 + (1 - k) * 9, cy = 220 - (1 - k) * 7, pts = []
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * Math.PI * 2
    const wob = 1 + 0.035 * Math.sin(2 * t + 0.7) + 0.022 * Math.sin(3 * t + 2.1) + 0.012 * k * Math.sin(7 * t + radius * 0.05)
    pts.push([cx + Math.cos(t) * radius * wob, cy + Math.sin(t) * radius * wob])
  }
  return pts
}

/** The trunk: fifty rings, the five decade rings in the accent, the fiftieth still being drawn. */
function lgDisc() {
  const RINGS = 50, OUTER = 186, decade = [1, 11, 21, 31, 41]
  // Each summer's ring is a slightly different width (a good year, a dry year), scaled to fill the trunk.
  const widths = Array.from({ length: RINGS }, (_, i) => 1 + 0.55 * Math.sin(i * 1.7) * Math.sin(i * 0.43 + 1))
  const total = widths.reduce((a, b) => a + b, 0)
  let r = 8, rings = ''
  const radii = widths.map((w) => (r += (w / total) * (OUTER - 8)))
  radii.forEach((rad, i) => {
    const n = i + 1, at = decade.indexOf(n)
    if (n === RINGS) return
    rings += `<path class="lg-ring${at >= 0 ? ' is-decade' : ''}"${at >= 0 ? ` data-lg-ring="${at}"` : ''} d="${lgClosed(lgRingPts(rad, n / RINGS))}" pathLength="1"/>`
  })
  // The fiftieth ring: most of the way round, with the growing tip.
  const nowPts = lgRingPts(radii[RINGS - 1], 1), tip = nowPts[Math.round(nowPts.length * 0.84) % nowPts.length]
  const now = `<path class="lg-ring is-now" d="${lgClosed(nowPts)}" pathLength="1"/><circle class="lg-ring-tip" cx="${tip[0].toFixed(1)}" cy="${tip[1].toFixed(1)}" r="5"/>`
  // Bark: a rough outer edge.
  const bark = lgRingPts(OUTER + 14, 1, 72).map(([x, y], s) => {
    const j = 1 + 0.018 * Math.sin(s * 2.9) + 0.012 * Math.sin(s * 5.3)
    return [220 + (x - 220) * j, 220 + (y - 220) * j]
  })
  // Rays from the pith, and a drying crack in from the bark.
  let rays = ''
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2 + 0.2, r1 = 22 + (a % 3) * 18, r2 = 150 + (a % 4) * 9
    rays += `M${(213 + Math.cos(t) * r1).toFixed(1)} ${(225 + Math.sin(t) * r1).toFixed(1)}L${(220 + Math.cos(t) * r2).toFixed(1)} ${(220 + Math.sin(t) * r2).toFixed(1)}`
  }
  // Year labels, one per decade ring, shown for the ring that is lit.
  const labels = decade.map((n, i) => {
    const pts = lgRingPts(radii[n - 1], n / RINGS), p = pts[Math.round(pts.length * 0.875) % pts.length]
    return `<g class="lg-ring-label" data-lg-label="${i}" transform="translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})"><circle r="4.5"/><g transform="translate(10 -14)"><rect x="0" y="-13" width="50" height="24" rx="12"/><text x="25" y="4">${LG_DECADES[i][0]}</text></g></g>`
  }).join('')
  return `<svg class="lg-disc" viewBox="0 0 440 440" aria-hidden="true" focusable="false">
<path class="lg-bark" d="${lgClosed(bark)}"/>
<path class="lg-wood" d="${lgClosed(lgRingPts(OUTER + 3, 1, 48))}"/>
<path class="lg-rays" d="${rays}"/>
<g class="lg-ring-set">${rings}${now}</g>
<path class="lg-crack" d="M392 168 L352 190 L388 184 Z"/>
<circle class="lg-pith" cx="229" cy="213" r="4"/>
${labels}
</svg>`
}

/** Days 0 to 7 of a mango, and the day after: never sold. */
function lgWeek() {
  const mango = (day) => {
    // Deep green on day 0 to a warm yellow-orange by day 7 (raw dot to semi dot to mango).
    const k = day / 7
    return `<svg class="lg-mango" viewBox="0 0 40 40" aria-hidden="true" focusable="false" style="--k:${(k * 100).toFixed(0)}%"><path class="lg-mango-stem" d="M10 13c-.6-2-.4-3.8.8-5.4"/><path class="lg-mango-leaf" d="M11 7.6c3.2-3 8.6-3.6 12.6-1.4-3.4 3-8.8 3.6-12.6 1.4Z"/><path class="lg-mango-fruit" d="M5.5 19c1.6-6.6 10-9.6 18.4-7.6 7.8 1.8 12.4 7.6 10.8 14-1.6 6-9.6 8.8-17.6 7-6-1.4-9.4-4.4-7.6-6.8 1.4-1.8-4.8-2.2-4-6.6Z"/><path class="lg-mango-shine" d="M22 15.4c3.6.6 6.6 2.6 8 5.6"/></svg>`
  }
  const NOTE = { 0: 'Plucked', 1: 'Reaches us' }
  const days = Array.from({ length: 8 }, (_, d) => `<li class="lg-day${d >= 1 && d <= 3 ? ' is-raw' : d >= 4 ? ' is-semi' : ''}">${mango(d)}<span class="lg-day-n">Day ${d}</span>${NOTE[d] ? `<span class="lg-day-note">${NOTE[d]}</span>` : ''}</li>`).join('')
  const never = `<li class="lg-day is-never">${mango(7)}<span class="lg-day-n">After day 7</span><span class="lg-day-note">Never sold</span></li>`
  return `<div class="lg-week" role="group" aria-label="A mango’s first week">
    <ol class="lg-days">${days}${never}</ol>
    <div class="lg-brackets">
      <p class="lg-bracket is-raw"><span class="lg-bracket-days">Days 1 to 3</span><span>Sold raw: firm and tangy, for pickle and cooking</span></p>
      <p class="lg-bracket is-semi"><span class="lg-bracket-days">Days 4 to 7</span><span>Sold semi-ripe: ripens on your counter in 1 to 4 days</span></p>
    </div>
  </div>`
}

// ---- Behaviour.

/** The decade card in view lights its ring (and its dot). */
function lgRingsLight() {
  const cards = $$('[data-lg-decade]'), wrap = $('.lg-disc-wrap')
  const light = (i) => {
    cards.forEach((c) => c.classList.toggle('is-on', Number(c.dataset.lgDecade) === i))
    if (wrap) wrap.dataset.lgOn = String(i)
  }
  light(0)
  if (!('IntersectionObserver' in window)) { if (wrap) wrap.dataset.lgOn = 'all'; return }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) light(Number(e.target.dataset.lgDecade)) })
  }, { rootMargin: '-42% 0px -48% 0px' })
  cards.forEach((c) => io.observe(c))
  lgCleanup.push(() => io.disconnect())
}

const lgMotionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches

/** Gentle reveals as each part scrolls in, the rings drawing from the pith out, and the count-up. All optional: without
   motion (or IntersectionObserver) nothing is hidden, and every number is already right. GSAP, when it loaded, plays the
   hero's entrance and draws the rings; no ScrollTrigger here, so a missed trigger can never leave anything invisible. */
function lgMotion() {
  if (!lgMotionOk() || !('IntersectionObserver' in window)) return
  const once = (els, run, opts) => {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return
      io.unobserve(e.target)
      run(e.target)
    }), opts)
    els.forEach((el) => io.observe(el))
    lgCleanup.push(() => io.disconnect())
  }
  // Reveals: groups fade up in turn (the stagger is --lg-i).
  const groups = [...$$('.lg-sec-head').map((h) => [...h.children]), $$('.lg-decade, .lg-now'), $$('.lg-vows > li'), $$('.lg-day'), $$('.lg-stats > li'), $$('.lg-hands > li'), $$('.lg-note'), $$('.lg-next > :not(svg)')]
  const items = []
  groups.forEach((g) => g.forEach((el, i) => { el.classList.add('lg-rv'); el.style.setProperty('--lg-i', String(Math.min(i, 8))); items.push(el) }))
  once(items, (el) => el.classList.add('is-in'), { rootMargin: '0px 0px -8% 0px' })
  // Count-up on first view: the numbers roll up from zero once.
  once($$('[data-lg-count]'), (el) => {
    const t0 = performance.now(), ms = 1400
    const step = (t) => {
      if (!el.isConnected) return
      const to = Number(el.dataset.lgCount) || 0, k = Math.min(1, (t - t0) / ms)
      el.textContent = k < 1 ? Math.round(to * (1 - Math.pow(1 - k, 3))) : to
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, { threshold: 0.6 })
  if (!window.gsap) return
  const tweens = []
  tweens.push(gsap.from('.lg-hero-copy > *', { y: 20, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out', delay: 0.15, clearProps: 'transform,opacity' }))
  tweens.push(gsap.from('.lg-hero-50', { opacity: 0, scale: 0.94, duration: 1.6, ease: 'power2.out', clearProps: 'transform,opacity' }))
  once($$('.lg-disc'), () => tweens.push(gsap.fromTo('.lg-ring:not(.is-now)', { strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', stagger: 0.022, clearProps: 'strokeDasharray,strokeDashoffset' })), { threshold: 0.3 })
  lgCleanup.push(() => tweens.forEach((t) => t.kill()))
}

function lgStop() {
  lgCleanup.forEach((f) => f())
  lgCleanup = []
}

/** "Read our story": scroll to the rings without leaving the page (a #link would go to the home page's anchors). */
window.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('[data-lg-jump]') : null
  if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault()
  const target = document.getElementById(a.getAttribute('href').slice(1))
  if (!target) return
  const head = $('.header'), top = target.getBoundingClientRect().top + scrollY - (head ? head.getBoundingClientRect().bottom : 0) - 20
  window.scrollTo({ top: Math.max(0, top), behavior: lgMotionOk() ? 'smooth' : 'instant' })
  const h = $('h2', target)
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}, true)

// Leaving the page: stop its observers and tweens, and give the home page its title back.
window.addEventListener('mm:route', () => {
  if (document.body.dataset.page === 'legacy') return
  lgStop()
  if (document.title === LG_TITLE) document.title = LG_HOME_TITLE
})
