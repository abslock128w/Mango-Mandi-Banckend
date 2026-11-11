/* Our legacy (/legacy): "Fifty summers", a full-bleed, scroll-driven piece in its own visual world.
   Scenes: 0 preloader · 1 opening (pollen canvas, the colossal 50) · 2 the promise · 3 read the rings · 4 marquee ·
   5 five things we never traded · 6 seven days · 7 fifty summers in numbers · 8 four pairs of hands ·
   9 a note from the family · 10 the next fifty summers. Plus film grain, a progress HUD and (fine pointers) a cursor.

   Two modes on the same markup:
   - static (the default): a clean long-form page, everything visible. Used with prefers-reduced-motion, without GSAP
     or ScrollTrigger, and if anything in the motion setup throws.
   - motion (.lx-motion): pinned and scrubbed scenes. All of it is made inside one gsap.context, so leaving the page
     reverts every tween, ScrollTrigger and pin; rAF loops, listeners and the html classes are undone too.
   Static content (copy as on the first version), so it works before the catalogue loads and with the API down; the only
   live number is the count of varieties (the shop's own shelf when loaded, 16 until then).
   Styles: shop/legacy.css (.lx-). Loaded after pages.js (it adds to PAGES) and before app.js. */

PAGES.push([/^\/legacy\/?$/, () => legacyView()])

const LX_TITLE = 'Our legacy · Mango Mandi'
const LX_HOME_TITLE = document.title
const LX_VARIETIES = 16
const LX_DECADES = [
  ['1976', 'The first orchard', 'A few acres, a borrowed cart, and a rule that still stands: nothing leaves the farm that we would not eat ourselves.'],
  ['1986', 'A name at the mandi', 'Ten summers in, buyers started asking for our crates by name. We learned to grade by hand and by eye, one fruit at a time.'],
  ['1996', 'Saying no to shortcuts', 'When quick ripening with chemicals became common, we kept the hay, the heat and the patience. It cost us weeks. It kept us our customers.'],
  ['2006', 'The next generation', 'The children who grew up counting crates took over the ledgers, then the orchards. More varieties went into the ground.'],
  ['2016', 'From the mandi to your door', 'We began packing boxes for homes, not just markets. Every box since has carried the day it was plucked.'],
]
const LX_VOWS = [
  ['leaf', 'Ripened the slow way', 'No carbide, no gas. Warmth, time and a watchful eye.'],
  ['hand', 'Graded by hand', 'Every mango is turned, pressed and looked at before it is packed.'],
  ['sun', 'A day from the tree', 'Fruit reaches our warehouse the day after it is plucked.'],
  ['eye', 'Sold as it really is', 'Raw is sold as raw, semi-ripe as semi-ripe. We never sell a mango past its best.'],
  ['hands', 'Fair to the grower', 'The people who tend the trees are paid first and paid properly.'],
]
const LX_HANDS = [
  ['The grower', 'Knows each tree by how it carried last year.', 'm25'],
  ['The grader', 'Decides raw or semi-ripe by touch, not by a chart.', 'm06'],
  ['The packer', 'Nests each fruit so it travels without a bruise.', 'm20'],
  ['The rider', 'Brings it to your door, usually the next day.', 'm21'],
]
const LX_PLEDGES = ['Plant more than we pick.', 'Keep telling you exactly how old your fruit is.', 'Grow with more farmers who ripen the slow way.']
const LX_MARQUEE = ['Ripened the slow way', 'Graded by hand', 'A day from the tree', 'Sold as it really is', 'Fair to the grower']
// Day 0 to 7, then the day after: the shop's real rules.
const LX_DAYS = [
  ['Plucked', 'The day it leaves the tree.'],
  ['Reaches us', 'Sold raw: firm and tangy, for pickle and cooking.'],
  ['Sold raw', 'Firm and tangy, for pickle and cooking.'],
  ['Sold raw', 'Firm and tangy, for pickle and cooking.'],
  ['Sold semi-ripe', 'Ripens on your counter in 1 to 4 days.'],
  ['Sold semi-ripe', 'Ripens on your counter in 1 to 4 days.'],
  ['Sold semi-ripe', 'Ripens on your counter in 1 to 4 days.'],
  ['Sold semi-ripe', 'Ripens on your counter in 1 to 4 days.'],
]
// The mango's colours by day: skin (light, deep), blush strength, leaf.
const LX_RIPEN = [
  ['#5f9a3c', '#1f4d22', 0, '#3f7a2c'],
  ['#6d9e3a', '#28562a', 0, '#4a7d2e'],
  ['#86a13a', '#3c5f26', 0.04, '#5a7f2f'],
  ['#a6a83a', '#566423', 0.1, '#6b7d33'],
  ['#d1b23a', '#7c7424', 0.22, '#7d7a3a'],
  ['#ecbd38', '#a57d22', 0.34, '#8c7a42'],
  ['#f8c23a', '#c97f1f', 0.46, '#9a7a48'],
  ['#ffc23d', '#dd7a1c', 0.58, '#a3794d'],
]

let lxKill = []

function legacyView() {
  lxStop()
  document.title = LX_TITLE
  const varieties = shelf.length || LX_VARIETIES
  host().innerHTML = lxMarkup(varieties)
  document.documentElement.classList.add('lx-on')
  const root = $('.lx')
  let motion = false
  if (lxMotionOk()) {
    try {
      lxMotion(root)
      motion = true
    } catch (err) {
      // Anything going wrong in the motion setup leaves the static page, fully readable.
      console.warn('Legacy page: motion off', err)
      lxStop({ keepPage: true })
      root.classList.remove('lx-motion', 'lx-fine')
    }
  }
  if (!motion) root.classList.add('lx-static')
  // The real count of varieties, once the shop's shelf has loaded (16 until then).
  if (!shelf.length) {
    shelfReady().then(() => {
      const s = $('[data-lx-varieties]')
      if (document.body.dataset.page !== 'legacy' || !shelf.length || !s || !s.isConnected) return
      const n = String(shelf.length), cols = $$('.lx-slot-col', s)
      $('.lx-num-text', s).textContent = n
      if (cols.length === n.length) {
        cols.forEach((c, i) => { c.dataset.d = n[i] })
        if (root.classList.contains('lx-motion')) ScrollTrigger.refresh()
      } else s.classList.add('is-text')
    })
  }
}

const lxMotionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches && Boolean(window.gsap && window.ScrollTrigger)

/** Words as spans (for the word-by-word light-up); key phrases marked. */
function lxWords(text, keys = []) {
  let html = text
  keys.forEach((k, i) => { html = html.replace(k, `\u0001${i}\u0002`) })
  return html.split(/(\u0001\d+\u0002|\s+)/).filter((s) => s && !/^\s+$/.test(s)).map((w) => {
    const m = /^\u0001(\d+)\u0002$/.exec(w)
    if (m) return keys[m[1]].split(' ').map((k) => `<span class="lx-w is-key">${k}</span>`).join(' ')
    return `<span class="lx-w">${w}</span>`
  }).join(' ')
}

/** Letters as spans (inside a clip, for rising in). */
const lxLetters = (text) => [...text].map((c) => `<span class="lx-ch">${c === ' ' ? '&nbsp;' : c}</span>`).join('')

/** An odometer: one column of digits per place; lxRoll() sets a (fractional) value. */
function lxOdometer(value, cls = '') {
  const digits = String(value).split('')
  const col = '<span class="lx-odo-col">' + Array.from({ length: 11 }, (_, i) => `<span>${i % 10}</span>`).join('') + '</span>'
  return `<span class="lx-odo ${cls}" aria-hidden="true" data-lx-odo="${digits.length}">${digits.map((d) => `<span class="lx-odo-cell" data-d="${d}">${col.replace('class="lx-odo-col"', `class="lx-odo-col" style="transform:translateY(${(-d * 100 / 11).toFixed(3)}%)"`)}</span>`).join('')}</span>`
}
function lxRoll(odo, v) {
  const cells = odo.querySelectorAll('.lx-odo-cell'), n = cells.length
  cells.forEach((cell, i) => {
    const p = Math.pow(10, n - 1 - i), base = Math.floor(v / p) % 10, rest = v % p
    const carry = p === 1 ? v % 1 : Math.max(0, rest - (p - 1))
    cell.firstChild.style.transform = `translateY(${-(base + carry) * 10 / 11 * 100 / 10}%)`
  })
}

/** A slot-machine number: each digit spins down through three rounds to its value. */
function lxSlot(value) {
  return `<span class="lx-slot" aria-hidden="true">${String(value).split('').map((d) => `<span class="lx-slot-cell"><span class="lx-slot-col" data-d="${d}">${Array.from({ length: 30 }, (_, i) => `<span>${i % 10}</span>`).join('')}</span></span>`).join('')}</span>`
}

function lxPartnerHidden() {
  const nav = $('.desktop-nav [data-partner-link]')
  return Boolean(nav && nav.hidden)
}

// ---- Art.

function lxClosed(pts) {
  const n = pts.length, f = (v) => v.toFixed(1)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + 'Z'
}
/** One ring: uneven and off-centre, as real growth is (k: 0 at the pith, 1 at the bark). */
function lxRingPts(radius, k, steps = 56, seed = 0) {
  const cx = 300 + (1 - k) * 14, cy = 300 - (1 - k) * 10, pts = []
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * Math.PI * 2
    const wob = 1 + 0.04 * Math.sin(2 * t + 0.7) + 0.025 * Math.sin(3 * t + 2.1) + 0.012 * Math.sin(5 * t + seed) + 0.006 * Math.sin(11 * t + seed * 3)
    pts.push([cx + Math.cos(t) * radius * wob, cy + Math.sin(t) * radius * wob])
  }
  return pts
}
const LX_DECADE_RING = [0, 10, 20, 30, 40]
function lxTrunk() {
  const N = 50, OUTER = 262
  const widths = Array.from({ length: N }, (_, i) => 1 + 0.6 * Math.sin(i * 1.7) * Math.sin(i * 0.43 + 1))
  const total = widths.reduce((a, b) => a + b, 0)
  let r = 9
  const radii = widths.map((w) => (r += (w / total) * (OUTER - 9)))
  const rings = radii.map((rad, i) => {
    const decade = LX_DECADE_RING.indexOf(i)
    const w = (0.7 + 1.3 * Math.abs(Math.sin(i * 2.3))).toFixed(2)
    return `<path class="lx-ring${decade >= 0 ? ' is-decade' : ''}${i === N - 1 ? ' is-now' : ''}" data-i="${i}"${decade >= 0 ? ` data-decade="${decade}"` : ''} style="stroke-width:${decade >= 0 ? 2.6 : w}" d="${lxClosed(lxRingPts(rad, (i + 1) / N, 56, i * 0.37))}" pathLength="1"/>`
  }).join('')
  const bark = lxRingPts(OUTER + 22, 1, 110, 4).map(([x, y], s) => {
    const j = 1 + 0.02 * Math.sin(s * 2.9) + 0.014 * Math.sin(s * 5.3) + 0.008 * Math.sin(s * 13.1)
    return [300 + (x - 300) * j, 300 + (y - 300) * j]
  })
  let rays = ''
  for (let a = 0; a < 18; a++) {
    const t = (a / 18) * Math.PI * 2 + 0.2, r1 = 26 + (a % 3) * 26, r2 = 200 + (a % 4) * 14
    rays += `M${(314 + Math.cos(t) * r1).toFixed(1)} ${(290 + Math.sin(t) * r1).toFixed(1)}L${(300 + Math.cos(t) * r2).toFixed(1)} ${(300 + Math.sin(t) * r2).toFixed(1)}`
  }
  return `<svg class="lx-trunk" viewBox="0 0 600 600" aria-hidden="true" focusable="false">
<defs><radialGradient id="lx-wood" cx="52%" cy="48%" r="55%"><stop offset="0" stop-color="#f8ecc9"/><stop offset=".7" stop-color="#ecd7a3"/><stop offset="1" stop-color="#d9bd7d"/></radialGradient>
<radialGradient id="lx-glow" cx="50%" cy="50%" r="50%"><stop offset=".6" stop-color="#ffb81f" stop-opacity="0"/><stop offset=".86" stop-color="#ffb81f" stop-opacity=".35"/><stop offset="1" stop-color="#ffb81f" stop-opacity="0"/></radialGradient></defs>
<circle class="lx-trunk-halo" cx="300" cy="300" r="300" fill="url(#lx-glow)"/>
<g class="lx-trunk-spin">
<path class="lx-bark" d="${lxClosed(bark)}"/>
<path class="lx-bark-in" d="${lxClosed(lxRingPts(OUTER + 6, 1, 72, 2))}"/>
<g class="lx-wood-grow"><path class="lx-wood" d="${lxClosed(lxRingPts(OUTER + 4, 1, 72, 2))}"/></g>
<path class="lx-rays" d="${rays}"/>
<g class="lx-rings">${rings}</g>
<path class="lx-crack" d="M552 214 L478 252 L546 238 Z"/>
<circle class="lx-pith" cx="314" cy="290" r="5"/>
</g></svg>`
}

/** The big mango of the seven days: gradients whose stops the scroll recolours. */
function lxMango(id, day) {
  const [a, b, blush, leaf] = LX_RIPEN[Math.min(7, day)]
  return `<svg class="lx-mango" viewBox="0 0 400 420" aria-hidden="true" focusable="false">
<defs>
<radialGradient id="${id}-skin" cx="38%" cy="34%" r="78%"><stop offset="0" stop-color="${a}" data-k="a"/><stop offset=".55" stop-color="${a}" data-k="a2"/><stop offset="1" stop-color="${b}" data-k="b"/></radialGradient>
<radialGradient id="${id}-blush" cx="74%" cy="38%" r="46%"><stop offset="0" stop-color="#e2492b" stop-opacity="${blush}" data-k="blush"/><stop offset="1" stop-color="#e2492b" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}-shine" cx="30%" cy="28%" r="30%"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${leaf}" data-k="leaf"/><stop offset="1" stop-color="#1d3b17" data-k="leaf2"/></linearGradient>
</defs>
<ellipse class="lx-mango-shadow" cx="206" cy="398" rx="150" ry="15"/>
<g transform="translate(206 236) rotate(-32)">
<g class="lx-mango-body">
<path id="${id}-shape" d="M-172-6C-170-82-86-122 6-118 106-114 176-66 178 4 180 64 140 104 84 118 30 132-34 130-86 112-112 103-118 86-136 76-160 63-173 40-172-6Z" fill="url(#${id}-skin)"/>
<path d="M-172-6C-170-82-86-122 6-118 106-114 176-66 178 4 180 64 140 104 84 118 30 132-34 130-86 112-112 103-118 86-136 76-160 63-173 40-172-6Z" fill="url(#${id}-blush)"/>
<path d="M-172-6C-170-82-86-122 6-118 106-114 176-66 178 4 180 64 140 104 84 118 30 132-34 130-86 112-112 103-118 86-136 76-160 63-173 40-172-6Z" fill="url(#${id}-shine)"/>
<path class="lx-mango-edge" d="M-172-6C-170-82-86-122 6-118 106-114 176-66 178 4 180 64 140 104 84 118 30 132-34 130-86 112-112 103-118 86-136 76-160 63-173 40-172-6Z"/>
<ellipse cx="-62" cy="-70" rx="58" ry="17" transform="rotate(-8 -62 -70)" fill="#fff" opacity=".32"/>
<path class="lx-mango-dots" d="M-20-40h.01M30-60h.01M60-10h.01M10 20h.01M-60 10h.01M100 30h.01M-100-30h.01M40 70h.01M-30 70h.01M120-30h.01"/>
</g>
<path class="lx-mango-stem" d="M-150-58c-12-10-22-26-24-44"/>
<path d="M-172-98c10-48 60-80 120-74-14 52-62 84-120 74Z" fill="url(#${id}-leaf)"/>
<path class="lx-mango-vein" d="M-168-100c34-20 70-44 110-70"/>
</g>
</svg>`
}

/** The five panels' drawings: strokes (drawn with stroke-dashoffset, through a hand-drawn wobble filter) over fills in a
   second colour that arrive once the lines are down. */
const LX_ART = {
  leaf: {
    f: '<circle cx="306" cy="92" r="40"/><path d="M118 238c6-52 70-84 140-70 56 12 86 52 74 92-12 42-66 60-124 52-56-8-94-36-90-74Z"/><path d="M200 168c4-38 36-66 82-68-6 40-38 64-82 68Z"/>',
    s: '<circle cx="306" cy="92" r="40"/><path d="M306 34V18M306 166v-16M248 92h-16M380 92h-16M265 51l-11-11M358 144l-11-11M265 133l-11 11M358 40l-11 11"/><path d="M118 238c6-52 70-84 140-70 56 12 86 52 74 92-12 42-66 60-124 52-56-8-94-36-90-74Z"/><path d="M150 214c16-18 42-26 70-24"/><path d="M196 174c0-10 2-18 6-26"/><path d="M200 168c4-38 36-66 82-68-6 40-38 64-82 68Z"/><path d="M202 166c20-24 44-44 76-62"/><path d="M26 352c60-46 288-46 348 0"/><path d="M58 340l42-28M92 348l52-36M152 350l32-32M206 344l46-28M258 348l40-30M306 342l36-22M108 330l-32-16M182 326l-42-18M242 328l-38-20M318 334l-42-22M340 322l-28-16M70 326l-22-12"/><path d="M96 170c8-10-2-18 6-28s-2-18 6-28M128 160c8-10-2-18 6-28s-2-18 6-28"/>',
  },
  hand: {
    f: '<path d="M152 172c10-48 70-70 126-52 44 14 62 50 48 84-14 32-60 46-108 38-46-8-74-36-66-70Z"/><circle cx="316" cy="84" r="38"/>',
    s: '<path d="M152 172c10-48 70-70 126-52 44 14 62 50 48 84-14 32-60 46-108 38-46-8-74-36-66-70Z"/><path d="M178 150c14-14 34-20 56-18"/><path d="M160 136c-6-8-8-18-6-28"/><path d="M156 110c18-22 52-26 74-10-20 18-52 22-74 10Z"/><path d="M58 252c40 4 84 24 124 30 40 6 92 0 134-14 18-6 34 6 26 22-8 14-30 22-52 30l-94 34c-40 14-88 10-126-10l-36-20"/><path d="M58 252c20-30 54-36 84-26 20 6 26 22 14 34-12 10-34 12-52 6"/><path d="M318 268c18-2 30-12 34-26M292 302c18 0 34-10 40-24M262 322c16 2 30-6 38-18"/><path d="M20 232l38 20M8 292l40 22"/><circle cx="316" cy="84" r="38"/><path d="M298 86l12 12 24-26"/><path d="M60 92v22M49 103h22M370 190v16M362 198h16"/>',
  },
  sun: {
    f: '<circle cx="300" cy="92" r="34"/><path d="M70 214c-34-4-44-46-16-64-6-38 36-58 64-40 18-32 74-28 82 10 34 2 46 48 16 66 6 30-30 46-56 30-22 18-62 18-90-2Z"/><rect x="250" y="292" width="110" height="64" rx="4"/>',
    s: '<circle cx="300" cy="92" r="34"/><path d="M300 40V22M300 162v-18M248 92h-18M370 92h-18M263 55l-12-12M349 141l-12-12M263 129l-12 12M349 43l-12 12"/><path d="M70 214c-34-4-44-46-16-64-6-38 36-58 64-40 18-32 74-28 82 10 34 2 46 48 16 66 6 30-30 46-56 30-22 18-62 18-90-2Z"/><path d="M122 354V232M122 272l-26-22M122 258l24-24"/><ellipse cx="160" cy="226" rx="12" ry="16" transform="rotate(-20 160 226)"/><path d="M158 210c0-6 2-10 6-14"/><path d="M20 356h360"/><rect x="250" y="292" width="110" height="64" rx="4"/><path d="M250 314h110M250 334h110M286 292v64M324 292v64"/><path d="M262 292c4-16 24-16 28 0M296 292c4-16 24-16 28 0M330 292c4-16 24-16 28 0"/><path d="M180 234c40-36 96-34 120 30"/><path d="M286 256l12 14 6-16"/>',
  },
  eye: {
    f: '<circle cx="200" cy="196" r="58"/><path d="M290 270h60l22 30-22 30h-60Z"/>',
    s: '<path d="M28 196c52-74 112-110 172-110s120 36 172 110c-52 74-112 110-172 110S80 270 28 196Z"/><circle cx="200" cy="196" r="58"/><circle cx="200" cy="196" r="24"/><circle cx="222" cy="176" r="8"/><path d="M86 130l-20-28M138 102l-10-32M200 90V54M262 102l10-32M314 130l20-28"/><path d="M110 270l-14 18M200 306v22M290 270l8 10"/><path d="M290 270h60l22 30-22 30h-60Z"/><circle cx="352" cy="300" r="6"/><path d="M352 294c-6-26-24-50-56-66"/><path d="M304 300h26"/>',
  },
  hands: {
    f: '<path d="M118 272c20-32 144-32 164 0Z"/><path d="M200 196c-6-40 20-70 60-74 0 40-24 68-60 74Z"/><path d="M200 216c-2-34-26-56-58-56 0 32 24 54 58 56Z"/>',
    s: '<path d="M200 272V166"/><path d="M200 196c-6-40 20-70 60-74 0 40-24 68-60 74Z"/><path d="M200 196c14-20 30-40 54-66"/><path d="M200 216c-2-34-26-56-58-56 0 32 24 54 58 56Z"/><path d="M118 272c20-32 144-32 164 0"/><path d="M40 232c20 10 40 40 52 70 10 24 40 40 108 40"/><path d="M40 232c-6-14 2-26 16-22l40 20M60 214c0-14 12-20 24-14l30 18M86 202c2-12 14-16 24-8l20 18"/><path d="M360 232c-20 10-40 40-52 70-10 24-40 40-108 40"/><path d="M360 232c6-14-2-26-16-22l-40 20M340 214c0-14-12-20-24-14l-30 18M314 202c-2-12-14-16-24-8l-20 18"/><path d="M200 104V86M176 114l-12-12M224 114l12-12"/>',
  },
}

/** The sunrise's orchard: a hill and a row of mango trees in silhouette (two rows, the far one lighter). */
function lxOrchard() {
  const hill = (x, k) => 150 - 22 * Math.sin(x / 1440 * Math.PI * 1.3 + k) - 10 * Math.sin(x / 1440 * Math.PI * 4.1 + k * 2)
  const row = (k, step, scale, cls) => {
    let trees = ''
    for (let x = 18 + k * 40; x < 1440; x += step + ((x * 7) % 23)) {
      const y = hill(x, k) + 6, s = scale * (0.8 + ((x * 13) % 9) / 22), h = 34 * s
      trees += `<rect x="${(x - 3 * s).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${(6 * s).toFixed(1)}" height="${(h + 4).toFixed(1)}"/>`
      ;[[0, -h - 18 * s, 26], [-18, -h - 6 * s, 20], [18, -h - 6 * s, 21], [-6, -h - 30 * s, 18], [10, -h - 26 * s, 17]].forEach(([dx, dy, r]) => {
        trees += `<circle cx="${(x + dx * s).toFixed(1)}" cy="${(y + dy).toFixed(1)}" r="${(r * s).toFixed(1)}"/>`
      })
    }
    let d = 'M0 260V' + hill(0, k).toFixed(1)
    for (let x = 40; x <= 1440; x += 40) d += `L${x} ${hill(x, k).toFixed(1)}`
    return `<g class="${cls}"><path d="${d}V260Z"/>${trees}</g>`
  }
  return `<svg class="lx-orchard" viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${row(1.7, 64, 0.8, 'is-far')}<g transform="translate(0 46)">${row(0, 92, 1.15, 'is-near')}</g></svg>`
}

function lxMarkup(varieties) {
  const marquee = (cls) => `<div class="lx-band ${cls}" aria-hidden="true"><div class="lx-band-track">${[0, 1].map(() => `<span>${LX_MARQUEE.map((m) => `${m}<i>✦</i>`).join('')}</span>`).join('')}</div></div>`
  const handsImg = (file) => `assets/mangoes/${file}.webp`
  return `<article class="lx" aria-label="Our legacy: fifty summers">
<div class="lx-grain" aria-hidden="true"></div>
<svg class="lx-defs" aria-hidden="true" focusable="false"><filter id="lx-duo" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="table" tableValues="0.043 0.09 0.42 0.86 0.965"/><feFuncG type="table" tableValues="0.122 0.27 0.4 0.62 0.937"/><feFuncB type="table" tableValues="0.082 0.19 0.2 0.2 0.863"/></feComponentTransfer></filter>${LX_VOWS.map((_, i) => `<filter id="lx-wob${i}" x="-6%" y="-6%" width="112%" height="112%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${3 + i * 5}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>`).join('')}</svg>
<div class="lx-hud" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" class="lx-hud-track"/><circle cx="32" cy="32" r="29" class="lx-hud-fill" pathLength="1"/></svg><span class="lx-hud-year">01 / 10</span></div>
<div class="lx-cursor" aria-hidden="true"><span class="lx-cursor-dot"></span><span class="lx-cursor-ring"><b class="lx-cursor-word"></b></span></div>
<div class="lx-pre" aria-hidden="true"><div class="lx-pre-half is-top"></div><div class="lx-pre-half is-bottom"></div><div class="lx-pre-core"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" pathLength="1"/><circle cx="60" cy="60" r="38" pathLength="1"/><circle cx="60" cy="60" r="24" pathLength="1"/></svg>${lxOdometer(1976, 'lx-pre-odo')}<small>Mango Mandi · fifty summers</small></div></div>

<section class="lx-scene lx-open" data-lx-scene="1" aria-labelledby="lx-title">
  <canvas class="lx-pollen" aria-hidden="true"></canvas>
  <div class="lx-vignette" aria-hidden="true"></div>
  <p class="lx-caps lx-open-caps">Mango Mandi · Since 1976</p>
  <h1 id="lx-title" class="lx-open-title"><span class="lx-sr">Fifty summers. One promise.</span>
    <span class="lx-fifty-wrap" aria-hidden="true"><span class="lx-fifty is-outline"><span>5</span><span>0</span></span><span class="lx-fifty is-photo"><span class="lx-d5">5</span><span class="lx-d0">0</span></span></span>
    <span class="lx-summers" aria-hidden="true">${lxLetters('summers')}</span>
  </h1>
  <p class="lx-open-promise" aria-hidden="true">One promise.</p>
  <div class="lx-cue" aria-hidden="true"><span>Scroll</span><i></i></div>
  <div class="lx-open-fade" aria-hidden="true"></div>
</section>

<section class="lx-scene lx-promise" data-lx-scene="2" aria-labelledby="lx-promise-title">
  <h2 class="lx-caps" id="lx-promise-title">The promise</h2>
  <p class="lx-manifesto">${lxWords('We have grown, picked and carried mangoes to people’s doors since 1976. The trees are older now and so are we. The promise has not moved: fruit ripened the slow way, sold honestly, at the stage it really is.', ['the slow way,', 'honestly,'])}</p>
</section>

<section class="lx-scene lx-rings" data-lx-scene="3" aria-labelledby="lx-rings-title">
  <div class="lx-rings-stage">
    <div class="lx-rings-year" aria-hidden="true">${lxOdometer(1976)}</div>
    <div class="lx-rings-head"><p class="lx-caps">A mango tree keeps its own diary</p><h2 id="lx-rings-title">Read the <em>rings.</em></h2><p class="lx-rings-sub">One ring for every summer. These are ours.</p></div>
    <div class="lx-trunk-wrap">${lxTrunk()}</div>
    <ol class="lx-decades">${LX_DECADES.map(([y, t, p], i) => `<li class="lx-decade" data-decade="${i}"><p class="lx-decade-year">${y}</p><h3>${t}</h3><p>${p}</p></li>`).join('')}<li class="lx-decade is-now" data-decade="5"><p class="lx-decade-year">2026</p><h3>The fiftieth ring is still growing.</h3></li></ol>
  </div>
</section>

<section class="lx-scene lx-marquee" data-lx-scene="4" aria-label="Five things, in short">
  ${marquee('is-fill')}${marquee('is-line')}
</section>

<section class="lx-vows" data-lx-scene="5" aria-labelledby="lx-vows-title">
  <h2 class="lx-sr" id="lx-vows-title">Five things we never traded.</h2>
  ${LX_VOWS.map(([art, title, text], i) => `<div class="lx-panel is-${['cream', 'green', 'gold', 'cream', 'green'][i]}${i % 2 ? ' is-flip' : ''}" data-ui="${['ink', 'light', 'ink', 'ink', 'light'][i]}"><div class="lx-panel-in">
    ${i === 0 ? '<p class="lx-caps lx-panel-kicker">Five things we never traded</p>' : ''}
    <span class="lx-panel-num" aria-hidden="true">0${i + 1}</span>
    <svg class="lx-panel-art" viewBox="0 0 400 400" aria-hidden="true" focusable="false"><g class="lx-art-fill">${LX_ART[art].f}</g><g class="lx-art-line" filter="url(#lx-wob${i})">${LX_ART[art].s.replace(/<(path|circle|ellipse|rect)/g, '<$1 pathLength="1"')}</g></svg>
    <div class="lx-panel-copy"><h3>${title}</h3><p>${text}</p></div>
  </div></div>`).join('')}
</section>

<section class="lx-scene lx-days" data-lx-scene="6" aria-labelledby="lx-days-title">
  <div class="lx-days-stage">
    <div class="lx-days-head"><h2 id="lx-days-title">Seven days, <em>told honestly.</em></h2><p>Most shops will not tell you how old your fruit is. We built ours around it.</p></div>
    <ol class="lx-days-track">${LX_DAYS.map(([label, line], d) => `<li class="lx-day${d >= 1 && d <= 3 ? ' is-raw' : d >= 4 ? ' is-semi' : ''}"><span class="lx-day-big" aria-hidden="true">${d}</span><div class="lx-day-mini">${lxMango(`lx-m${d}`, d)}</div><p class="lx-day-n">Day ${d}</p><p class="lx-day-label">${label}</p><p class="lx-day-line">${line}</p></li>`).join('')}<li class="lx-day is-never"><span class="lx-day-big" aria-hidden="true">8</span><div class="lx-day-mini">${lxMango('lx-m8', 7)}</div><p class="lx-day-n">After day 7</p><p class="lx-day-label">Never sold</p><p class="lx-day-line">We never sell a mango past its best.</p></li></ol>
    <div class="lx-days-hero" aria-hidden="true">${lxMango('lx-mbig', 0)}<span class="lx-stamp">Never sold</span></div>
    <div class="lx-flap" aria-hidden="true"><span class="lx-flap-day"><b>Day</b> <span class="lx-flap-n">0</span></span><span class="lx-flap-label">Plucked</span><span class="lx-flap-line">The day it leaves the tree.</span></div>
    <div class="lx-rail" aria-hidden="true"><div class="lx-rail-line"><i class="lx-rail-fill"></i><i class="lx-rail-dot"></i></div><div class="lx-rail-ticks">${Array.from({ length: 8 }, (_, d) => `<span>${d}</span>`).join('')}<span class="is-x">✕</span></div><div class="lx-rail-brackets"><span class="is-raw">Sold raw · days 1 to 3</span><span class="is-semi">Sold semi-ripe · days 4 to 7</span></div></div>
    <p class="lx-days-end">That is why every box tells you when it will be ready to eat.</p>
  </div>
</section>

<section class="lx-scene lx-numbers" data-lx-scene="7" aria-labelledby="lx-numbers-title">
  <h2 class="lx-sr" id="lx-numbers-title">Fifty summers in numbers</h2>
  <p class="lx-caps lx-numbers-kicker" aria-hidden="true">Fifty summers in numbers</p>
  <ul class="lx-beats">
    <li class="lx-beat"><strong data-lx-to="50"><span class="lx-num-text">50</span>${lxSlot(50)}</strong><span class="lx-beat-cap">summers</span></li>
    <li class="lx-beat"><strong data-lx-to="${varieties}" data-lx-varieties><span class="lx-num-text">${varieties}</span>${lxSlot(varieties)}</strong><span class="lx-beat-cap">varieties this season</span></li>
    <li class="lx-beat"><strong data-lx-to="1"><span class="lx-num-text">1</span>${lxSlot(1)}</strong><span class="lx-beat-cap">day from tree to warehouse</span></li>
    <li class="lx-beat"><strong data-lx-to="0"><span class="lx-num-text">0</span>${lxSlot(0)}</strong><span class="lx-beat-cap">shortcuts in ripening</span></li>
  </ul>
</section>

<section class="lx-scene lx-hands" data-lx-scene="8" aria-labelledby="lx-hands-title">
  <svg class="lx-thread" aria-hidden="true" focusable="false"><path/></svg>
  <h2 id="lx-hands-title"><span>A mango passes through</span> <em>four pairs of hands.</em></h2>
  <ol class="lx-roles">${LX_HANDS.map(([who, line, img], i) => `<li class="lx-role is-${['arch', 'oval', 'pill', 'circle'][i]}"><figure class="lx-photo" data-speed="${[-4, 3, -3, 4][i]}"><span class="lx-photo-line" aria-hidden="true"></span><span class="lx-photo-in"><img src="${handsImg(img)}" alt="" width="720" height="720" decoding="async"></span></figure><div class="lx-role-copy"><span class="lx-role-knot" aria-hidden="true"></span><span class="lx-caps" aria-hidden="true">0${i + 1}</span><h3>${who}</h3><p>${line}</p></div></li>`).join('')}</ol>
</section>

<section class="lx-scene lx-note" data-lx-scene="9" aria-labelledby="lx-note-title">
  <h2 class="lx-sr" id="lx-note-title">A note from the family</h2>
  <p class="lx-caps" aria-hidden="true">A note from the family</p>
  <figure class="lx-quote">
    <blockquote><p class="lx-quote-text"><span class="lx-hang">“</span>We were taught that a mango is a promise you make in spring and keep in summer. Fifty summers on, we are still keeping it.”</p></blockquote>
    <figcaption><span class="lx-sr">The Mango Mandi family</span><svg class="lx-sign" viewBox="0 0 640 150" aria-hidden="true" focusable="false"><text x="320" y="92" text-anchor="middle">The Mango Mandi family</text><path class="lx-sign-flourish" d="M96 118c80 14 170 18 260 10 72-6 132-20 190-12 20 3 34 8 42 16" pathLength="1"/></svg></figcaption>
  </figure>
</section>

<section class="lx-scene lx-finale" data-lx-scene="10" aria-labelledby="lx-finale-title">
  <div class="lx-sky" aria-hidden="true"><i class="lx-sky-warm"></i><div class="lx-sunrise"><i class="lx-rays"></i><i class="lx-bloom"></i><i class="lx-sun"></i></div>${lxOrchard()}</div>
  <div class="lx-finale-in">
    <h2 id="lx-finale-title">The next fifty <em>summers.</em></h2>
    <ol class="lx-pledges">${LX_PLEDGES.map((p) => `<li>${p}</li>`).join('')}</ol>
    <div class="lx-finale-actions"><a class="lx-btn is-solid" href="/" data-route data-lx-cursor="shop" data-lx-magnet><span>Shop this season</span></a><a class="lx-btn is-line" href="/partner" data-route data-partner-link data-lx-cursor="open" data-lx-magnet${lxPartnerHidden() ? ' hidden' : ''}><span>Grow with us</span></a></div>
    <p class="lx-bye">See you next summer.</p>
  </div>
</section>
</article>`
}

// ---- Motion.

/** Value noise for the pollen's flow field. */
function lxNoise() {
  const P = new Uint8Array(512)
  for (let i = 0; i < 256; i++) P[i] = i
  for (let i = 255; i > 0; i--) { const j = (Math.sin(i * 91.7) * 43758.5453 % 1 + 1) % 1 * (i + 1) | 0; [P[i], P[j]] = [P[j], P[i]] }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i]
  const g = (h) => (P[h] / 255) * 2 - 1, s = (t) => t * t * (3 - 2 * t)
  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y)
    const a = g(P[xi] + yi), b = g(P[xi + 1] + yi), c = g(P[xi] + yi + 1), d = g(P[xi + 1] + yi + 1)
    const u = s(xf), v = s(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
}

/** Scene 1's pollen: gold particles drifting on a flow field, pushed by the pointer; paused off-screen. */
function lxPollen(canvas, track) {
  const ctx = canvas.getContext('2d'), noise = lxNoise(), phone = innerWidth < 760
  let w = 0, h = 0, dpr = 1, raf = 0, running = false, t = 0
  const ptr = { x: -9999, y: -9999 }
  const COUNT = phone ? 1400 : 3200
  const parts = []
  const spawn = (p = {}) => Object.assign(p, { x: Math.random() * w, y: Math.random() * h, life: 80 + Math.random() * 260, age: 0, s: 0.35 + Math.random() * 1.1, r: Math.random() < 0.08 ? 1.9 : 0.5 + Math.random() * 1.1, a: 0.25 + Math.random() * 0.6 })
  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1)
    w = canvas.clientWidth; h = canvas.clientHeight
    canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0b1f15'; ctx.fillRect(0, 0, w, h)
  }
  size()
  for (let i = 0; i < COUNT; i++) parts.push(spawn())
  const frame = () => {
    raf = requestAnimationFrame(frame)
    t += 0.0026
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(11,31,21,0.16)'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    for (const p of parts) {
      const ang = noise(p.x * 0.0021 + t, p.y * 0.0021 - t * 0.6) * Math.PI * 2.6 - Math.PI / 2.4
      let vx = Math.cos(ang) * p.s, vy = Math.sin(ang) * p.s - 0.18
      const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy
      if (d2 < 22000) { const f = (1 - d2 / 22000) * 3.2, d = Math.sqrt(d2) || 1; vx += (dx / d) * f; vy += (dy / d) * f }
      p.x += vx; p.y += vy; p.age++
      if (p.age > p.life || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) { spawn(p); continue }
      const fade = Math.min(1, p.age / 30, (p.life - p.age) / 40)
      ctx.fillStyle = `rgba(255,${190 + (p.r > 1.5 ? 30 : 0)},${p.r > 1.5 ? 120 : 70},${(p.a * fade).toFixed(3)})`
      ctx.fillRect(p.x, p.y, p.r, p.r)
    }
  }
  const start = () => { if (!running && !document.hidden) { running = true; raf = requestAnimationFrame(frame) } }
  const stop = () => { running = false; cancelAnimationFrame(raf) }
  const move = (e) => { const r = canvas.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top }
  const leave = () => { ptr.x = ptr.y = -9999 }
  const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()))
  io.observe(canvas)
  const vis = () => (document.hidden ? stop() : start())
  let resizeT = 0
  const resize = () => { clearTimeout(resizeT); resizeT = setTimeout(size, 150) }
  track(window, 'pointermove', move, { passive: true })
  track(window, 'blur', leave)
  track(document, 'visibilitychange', vis)
  track(window, 'resize', resize)
  lxKill.push(() => { stop(); io.disconnect(); clearTimeout(resizeT) })
}

/** Film grain: four noise tiles made once, cycled by CSS steps. */
function lxGrain(el) {
  const c = document.createElement('canvas'), S = 220
  c.width = S * 4; c.height = S
  const x = c.getContext('2d'), img = x.createImageData(S * 4, S)
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
  x.putImageData(img, 0, 0)
  el.style.backgroundImage = `url(${c.toDataURL('image/png')})`
}

/** from() as fromTo(): the end values are the natural ones (0, 1), never whatever a refresh happened to record. */
function lxFT(v) {
  const from = {}, to = {}
  Object.keys(v).forEach((k) => {
    if (['x', 'y', 'xPercent', 'yPercent', 'rotate', 'rotateX', 'rotateY', 'strokeDashoffset'].includes(k)) { from[k] = v[k]; to[k] = 0 }
    else if (k === 'opacity' || k === 'scale') { from[k] = v[k]; to[k] = 1 }
    else to[k] = v[k]
  })
  return [from, to]
}

function lxMotion(root) {
  const fine = matchMedia('(pointer: fine)').matches && !matchMedia('(hover: none)').matches
  const phone = () => innerWidth < 760
  root.classList.add('lx-motion')
  if (fine) root.classList.add('lx-fine')
  gsap.registerPlugin(ScrollTrigger)
  // The page view's entrance (liquid.js) is a transform: finish it so pins measure the real layout.
  $('#page-view').getAnimations?.().forEach((a) => a.finish())
  const listeners = []
  const track = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); listeners.push(() => target.removeEventListener(type, fn, opts)) }
  lxKill.push(() => listeners.forEach((f) => f()))
  const rafs = new Set()
  const loop = (fn) => { let id = 0; const tick = () => { fn(); id = requestAnimationFrame(tick) }; id = requestAnimationFrame(tick); const stop = () => cancelAnimationFrame(id); rafs.add(stop); return stop }
  lxKill.push(() => rafs.forEach((s) => s()))

  lxGrain($('.lx-grain', root))
  // The HUD: the scene number ("03 / 10"); during the rings, the same year as the big odometer.
  let sceneNow = 1, ringYear = 1976
  const hudText = $('.lx-hud-year', root)
  const hudLabel = () => {
    const year = sceneNow === 3
    hudText.classList.toggle('is-year', year)
    hudText.textContent = year ? String(ringYear) : `${String(sceneNow).padStart(2, '0')} / 10`
  }
  lxPollen($('.lx-pollen', root), track)

  // The header: away while scrolling down, back on the way up.
  let lastY = scrollY
  track(window, 'scroll', () => {
    const y = scrollY, html = document.documentElement
    if (y > lastY + 6 && y > 160) html.classList.add('lx-head-away')
    else if (y < lastY - 6 || y < 160) html.classList.remove('lx-head-away')
    lastY = y
  }, { passive: true })

  const ctx = gsap.context(() => {
    const scrub = fine ? 1.2 : 0.6
    // A scene's opening lines arrive while it scrolls into place, so a pinned scene never starts empty.
    const arrive = (targets, trigger, vars = {}) => gsap.fromTo(targets, ...lxFT({ y: 70, opacity: 0, stagger: 0.12, ease: 'power3.out', ...vars, scrollTrigger: { trigger, start: 'top 85%', end: 'top 15%', scrub } }))
    const E = { out: 'expo.out', quint: 'power4.out' }

    // ---- 0 Preloader.
    const pre = $('.lx-pre', root)
    const preOdo = $('.lx-pre-odo', pre)
    const preState = { v: 1976 }
    lxRoll(preOdo, 1976)
    const preTl = gsap.timeline({ onComplete: () => { pre.remove(); intro.play() } })
    preTl.from('.lx-pre circle', { strokeDashoffset: 1, duration: 1.3, stagger: 0.12, ease: 'power3.inOut' }, 0)
      .to(preState, { v: 2026, duration: 1.5, ease: 'power3.inOut', onUpdate: () => lxRoll(preOdo, preState.v) }, 0.15)
      .to('.lx-pre-core', { scale: 0.86, opacity: 0, duration: 0.4, ease: 'power2.in' }, 1.75)
      .to('.lx-pre-half.is-top', { yPercent: -101, duration: 0.9, ease: 'expo.inOut' }, 2.0)
      .to('.lx-pre-half.is-bottom', { yPercent: 101, duration: 0.9, ease: 'expo.inOut' }, 2.0)
    const skip = () => { if (preTl.progress() < 0.82) preTl.progress(0.82) }
    ;['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => track(window, t, skip, { passive: true, once: true }))

    // ---- 1 Opening: entrance (after the preloader), then the fly-through on scroll.
    const intro = gsap.timeline({ paused: true })
    intro.from('.lx-fifty.is-photo', { scale: 1.18, opacity: 0, duration: 1.8, ease: E.out }, 0)
      .fromTo('.lx-fifty.is-outline', ...lxFT({ scale: 0.9, opacity: 0, duration: 2.2, ease: E.out }), 0.15)
      .fromTo('.lx-summers .lx-ch', ...lxFT({ yPercent: 120, rotate: 8, opacity: 0, duration: 1.3, stagger: 0.07, ease: E.out }), 0.35)
      .fromTo('.lx-open-caps, .lx-open-promise, .lx-cue', ...lxFT({ opacity: 0, y: 16, duration: 1, stagger: 0.12, ease: E.quint }), 0.8)
    const origin = () => {
      const f = $('.lx-fifty.is-photo', root), z = $('.lx-d0', root)
      const a = f.getBoundingClientRect(), b = z.getBoundingClientRect()
      return `${((b.left + b.width * 0.5 - a.left) / a.width) * 100}% ${((b.top + b.height * 0.56 - a.top) / a.height) * 100}%`
    }
    gsap.timeline({ scrollTrigger: { trigger: '.lx-open', start: 'top top', end: '+=140%', pin: true, scrub, invalidateOnRefresh: true } })
      .to('.lx-summers', { yPercent: 60, opacity: 0, ease: 'power2.in', duration: 0.35 }, 0)
      .to('.lx-open-caps, .lx-open-promise, .lx-cue', { opacity: 0, y: -30, duration: 0.25 }, 0)
      .to('.lx-fifty.is-outline', { scale: 2.4, opacity: 0, duration: 0.6, ease: 'power2.in' }, 0)
      .fromTo('.lx-fifty.is-photo', { transformOrigin: origin }, { scale: 26, ease: 'power3.in', duration: 1, transformOrigin: origin }, 0.05)
      .to('.lx-open-fade', { opacity: 1, duration: 0.25 }, 0.85)

    // ---- 2 The promise: words light up as the scroll passes them.
    arrive('.lx-promise .lx-caps', '.lx-promise')
    const words = $$('.lx-manifesto .lx-w', root)
    const pt = gsap.timeline({ scrollTrigger: { trigger: '.lx-promise', start: 'top top', end: '+=170%', pin: true, scrub } })
    words.forEach((w, i) => {
      const at = 0.05 + i * 0.05
      if (w.classList.contains('is-key')) pt.fromTo(w, { opacity: 0.13, color: '#f6efdc', rotateX: -80, yPercent: 20 }, { opacity: 1, color: '#ffb81f', rotateX: 0, yPercent: 0, duration: 0.3, ease: 'back.out(2.6)' }, at)
      else pt.fromTo(w, { opacity: 0.13 }, { opacity: 1, duration: 0.2, ease: 'none' }, at)
    })
    pt.to('.lx-manifesto', { yPercent: -10, opacity: 0, duration: 0.4, ease: 'power2.in' }, '+=0.5')

    // ---- 3 Read the rings: fifty rings from the pith out, pausing at each decade.
    const rings = $$('.lx-ring', root), odo = $('.lx-rings-year .lx-odo', root), caps = $$('.lx-decade', root)
    const st = { r: 0 }
    const wood = $('.lx-wood', root), woodFull = wood.getAttribute('d'), ringD = rings.map((p) => p.getAttribute('d'))
    let woodAt = -2
    const roll = () => {
      lxRoll(odo, Math.max(1976, 1975 + st.r))
      ringYear = Math.round(Math.max(1976, 1975 + st.r))
      if (sceneNow === 3) hudLabel()
      const k = st.r >= 50 ? 50 : Math.floor(st.r) - 1
      if (k !== woodAt) { woodAt = k; wood.setAttribute('d', k >= 50 ? woodFull : k < 0 ? 'M0 0' : ringD[k]); wood.style.opacity = k < 0 ? 0 : 1 }
    }
    roll()
    lxKill.push(() => wood.setAttribute('d', woodFull))
    gsap.set(rings, { strokeDasharray: '1 1', strokeDashoffset: 1 })
    gsap.set('.lx-bark, .lx-bark-in, .lx-crack', { opacity: 0 })
    gsap.set(caps, { opacity: 0, y: 70 })
    const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-rings', start: 'top top', end: () => `+=${phone() ? 900 : 760}%`, pin: true, scrub } })
    arrive('.lx-rings-head > *', '.lx-rings')
    gsap.fromTo('.lx-trunk-wrap', ...lxFT({ scale: 0.55, rotate: -40, opacity: 0, ease: 'power3.out', scrollTrigger: { trigger: '.lx-rings', start: 'top 80%', end: 'top top', scrub } }))
    tl.to('.lx-rings-head', { opacity: 0, y: -40, duration: 0.5, ease: 'power2.in' }, 0.7)
      .to('.lx-trunk-spin', { rotate: 38, transformOrigin: '50% 50%', duration: 30 }, 0.8)
    let at = 1.2
    rings.forEach((ring, i) => {
      const last = i === rings.length - 1
      tl.to(ring, { strokeDashoffset: last ? 0.5 : 0, duration: 0.24 }, at)
        .to(st, { r: i + 1, duration: 0.24, onUpdate: roll }, at)
      at += 0.24
      const decade = LX_DECADE_RING.indexOf(i)
      if (decade >= 0) {
        tl.to(ring, { stroke: '#ffb81f', strokeWidth: 6, duration: 0.3, ease: 'power2.out' }, at)
          .to('.lx-trunk-halo', { opacity: 1, duration: 0.3 }, at)
          .to(caps[decade], { opacity: 1, y: 0, duration: 0.55, ease: E.quint }, at + 0.05)
          .to(caps[decade], { opacity: 0, y: -60, duration: 0.45, ease: 'power2.in' }, at + 1.6)
          .to(ring, { strokeWidth: 3.4, duration: 0.4 }, at + 1.6)
          .to('.lx-trunk-halo', { opacity: 0.35, duration: 0.4 }, at + 1.6)
        at += 2.1
      }
    })
    tl.to('.lx-bark, .lx-bark-in, .lx-crack', { opacity: 1, duration: 0.5 }, at - 1.2)
      .to(st, { r: 51, duration: 0.5, onUpdate: roll }, at)
      .to(caps[5], { opacity: 1, y: 0, duration: 0.6, ease: E.quint }, at + 0.2)
      .add(() => {}, at + 1.6)
    tl.eventCallback('onUpdate', () => root.classList.toggle('lx-ring-live', tl.progress() > 0.94))

    // ---- 4 Marquee: two bands, speed and skew from the scroll's velocity.
    const bands = $$('.lx-band-track', root).map((el, i) => ({ el, x: 0, dir: i ? 1 : -1 }))
    let vel = 0
    ScrollTrigger.create({ trigger: '.lx-marquee', start: 'top bottom', end: 'bottom top', onUpdate: (s) => { vel = s.getVelocity() } })
    let skew = 0
    loop(() => {
      vel *= 0.92
      const boost = gsap.utils.clamp(-14, 14, vel / 180)
      skew += (gsap.utils.clamp(-12, 12, vel / 120) - skew) * 0.1
      bands.forEach((b) => {
        const half = b.el.scrollWidth / 2 || 1
        b.x += (1.1 + Math.abs(boost)) * b.dir * (boost < 0 ? -1 : 1)
        if (b.x <= -half) b.x += half
        if (b.x > 0) b.x -= half
        b.el.style.transform = `translate3d(${b.x}px,0,0) skewX(${(-skew * b.dir).toFixed(2)}deg)`
      })
    })
    gsap.fromTo('.lx-band', ...lxFT({ yPercent: 40, opacity: 0, stagger: 0.15, scrollTrigger: { trigger: '.lx-marquee', start: 'top 85%', end: 'top 35%', scrub } }))

    // ---- 5 Five panels stack: each pins, the next slides over, the covered one sinks and darkens.
    const panels = $$('.lx-panel', root)
    panels.forEach((p, i) => {
      const inner = $('.lx-panel-in', p)
      if (i < panels.length - 1) {
        ScrollTrigger.create({ trigger: p, start: 'top top', endTrigger: panels[panels.length - 1], end: 'top top', pin: true, pinSpacing: false })
        gsap.to(inner, { scale: 0.88, filter: 'brightness(0.45)', borderRadius: 40, ease: 'none', scrollTrigger: { trigger: panels[i + 1], start: 'top bottom', end: 'top top', scrub: true } })
      }
      const art = $$('.lx-panel-art [pathLength]', p), fills = $$('.lx-art-fill > *', p), wob = $(`#lx-wob${i} feDisplacementMap`, root)
      gsap.set(art, { strokeDasharray: '1 1' })
      gsap.timeline({ scrollTrigger: { trigger: p, start: 'top 75%', end: i === panels.length - 1 ? 'top 10%' : 'top top', scrub } })
        .fromTo(art, { strokeDashoffset: 1 }, { strokeDashoffset: 0, stagger: 0.05, ease: 'power1.inOut' }, 0)
        .fromTo(wob, { attr: { scale: 16 } }, { attr: { scale: 5 }, ease: 'power2.out' }, 0)
        .fromTo(fills, { opacity: 0, scale: 0.8, transformOrigin: '50% 50%', transformBox: 'fill-box' }, { opacity: 1, scale: 1, stagger: 0.08, ease: 'back.out(2)' }, 0.55)
        .fromTo($('.lx-panel-num', p), ...lxFT({ yPercent: 40, opacity: 0, ease: E.quint }), 0)
        .fromTo($$('.lx-panel-copy > *, .lx-panel-kicker', p), ...lxFT({ y: 60, opacity: 0, stagger: 0.12, ease: E.quint }), 0.1)
    })

    // ---- 6 Seven days: the vertical scroll travels sideways; the mango ripens in the middle.
    const track6 = $('.lx-days-track', root), big = $('.lx-days-hero .lx-mango', root)
    const stops = $$('stop[data-k]', big), flapN = $('.lx-flap-n', root), flapLabel = $('.lx-flap-label', root), flapLine = $('.lx-flap-line', root)
    const mix = (c1, c2, k) => gsap.utils.interpolate(c1, c2, k)
    let shown = -1
    const ripen = (d) => {
      const i = Math.min(7, Math.floor(d)), k = Math.min(1, d - i), A = LX_RIPEN[i], B = LX_RIPEN[Math.min(7, i + 1)]
      stops.forEach((s) => {
        const key = s.dataset.k
        if (key === 'a' || key === 'a2') s.setAttribute('stop-color', mix(A[0], B[0], k))
        else if (key === 'b') s.setAttribute('stop-color', mix(A[1], B[1], k))
        else if (key === 'blush') s.setAttribute('stop-opacity', (A[2] + (B[2] - A[2]) * k).toFixed(3))
        else if (key === 'leaf') s.setAttribute('stop-color', mix(A[3], B[3], k))
      })
      const day = Math.min(8, Math.round(d))
      if (day !== shown) {
        shown = day
        const never = day > 7, [label, line] = never ? ['Never sold', 'We never sell a mango past its best.'] : LX_DAYS[day]
        gsap.fromTo('.lx-flap > *', { rotateX: -90, opacity: 0 }, { rotateX: 0, opacity: 1, duration: 0.45, stagger: 0.05, ease: 'back.out(2)', overwrite: true })
        flapN.textContent = never ? '7+' : day
        flapLabel.textContent = label
        flapLine.textContent = line
        root.classList.toggle('lx-day-semi', day >= 4 && !never)
        root.classList.toggle('lx-day-never', never)
      }
    }
    ripen(0)
    arrive('.lx-days-head > *', '.lx-days')
    arrive('.lx-days-hero', '.lx-days', { y: 160, scale: 0.6 })
    const dstate = { d: 0 }
    gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-days', start: 'top top', end: () => `+=${phone() ? 700 : 560}%`, pin: true, scrub, invalidateOnRefresh: true } })
      .to('.lx-days-head', { opacity: 0, y: -50, duration: 0.4 }, 0.4)
      .fromTo('.lx-flap, .lx-rail', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 0.75)
      .to(track6, { x: () => -(track6.scrollWidth - innerWidth), duration: 8 }, 1)
      .to(dstate, { d: 8, duration: 8, onUpdate: () => ripen(dstate.d) }, 1)
      .to('.lx-rail-fill', { scaleX: 1, duration: 8 }, 1)
      .to('.lx-rail-dot', { left: '100%', duration: 8 }, 1)
      .to('.lx-days-hero .lx-mango', { filter: 'grayscale(0.92) brightness(0.9)', duration: 0.6 }, 8.4)
      .fromTo('.lx-stamp', { scale: 3.4, opacity: 0, rotate: -4 }, { scale: 1, opacity: 1, rotate: -14, duration: 0.35, ease: 'expo.in' }, 8.6)
      .to('.lx-days-hero', { keyframes: { x: [0, -12, 10, -6, 0] }, duration: 0.3 }, 8.95)
      .fromTo('.lx-days-end', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: E.quint }, 9.1)
      .add(() => {}, 10.2)

    // ---- 7 Numbers: one beat at a time, digits rolling in like a slot machine.
    const beats = $$('.lx-beat', root)
    const cell = (el) => 100 / 30
    const rest = (b) => $$('.lx-slot-col', b).forEach((col) => gsap.set(col, { yPercent: -(20 + Number(col.dataset.d)) * cell() }))
    // The slot spin is time-based (it always lands), started as the scroll reaches each beat.
    const spin = (b) => {
      const cols = $$('.lx-slot-col', b)
      gsap.killTweensOf(cols)
      gsap.fromTo(cols, { yPercent: (k, el) => -Number(el.dataset.d) * cell() }, { yPercent: (k, el) => -(20 + Number(el.dataset.d)) * cell(), duration: 1.25, stagger: 0.14, ease: 'power4.out' })
    }
    beats.forEach(rest)
    gsap.set(beats.slice(1), { opacity: 0 })
    ScrollTrigger.create({ trigger: '.lx-numbers', start: 'top 55%', onEnter: () => spin(beats[0]) })
    const nt = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-numbers', start: 'top top', end: '+=360%', pin: true, scrub } })
    arrive('.lx-numbers-kicker', '.lx-numbers')
    beats.forEach((b, i) => {
      const at = i * 1.4
      if (i) nt.fromTo(b, { opacity: 0, yPercent: 14 }, { opacity: 1, yPercent: 0, duration: 0.35, ease: 'power3.out' }, at)
          .call(() => spin(b), null, at + 0.02)
          .fromTo($('.lx-beat-cap', b), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, at + 0.3)
      if (i < beats.length - 1) nt.to(b, { opacity: 0, yPercent: -16, duration: 0.4, ease: 'power2.in' }, at + 1.1)
    })
    nt.add(() => {}, beats.length * 1.4 + 0.2)

    // ---- 8 Hands: photos wipe open and drift; a gold thread draws down through the roles.
    $$('.lx-photo', root).forEach((f) => {
      // The reveal wipes up inside the photo's own shape (the clip keeps the shape's rounding), so nothing paints outside it.
      const shape = getComputedStyle(f).getPropertyValue('--shape').trim() || '0px'
      gsap.fromTo($('.lx-photo-in', f), { clipPath: `inset(100% 0% 0% 0% round ${shape})` }, { clipPath: `inset(0% 0% 0% 0% round ${shape})`, ease: 'power3.out', scrollTrigger: { trigger: f, start: 'top 95%', end: 'top 50%', scrub } })
      gsap.fromTo($('.lx-photo-line', f), { opacity: 0, x: -30, y: -30 }, { opacity: 1, x: 0, y: 0, ease: 'power3.out', scrollTrigger: { trigger: f, start: 'top 70%', end: 'top 25%', scrub } })
      gsap.fromTo($('img', f), { scale: 1.35 }, { scale: 1.05, ease: 'none', scrollTrigger: { trigger: f, start: 'top bottom', end: 'bottom top', scrub: true } })
      gsap.fromTo(f, { yPercent: -Number(f.dataset.speed) }, { yPercent: Number(f.dataset.speed), ease: 'none', scrollTrigger: { trigger: f, start: 'top bottom', end: 'bottom top', scrub: true } })
    })
    $$('.lx-role-copy', root).forEach((c) => gsap.fromTo($$(':scope > *:not(.lx-role-knot)', c), ...lxFT({ y: 60, opacity: 0, stagger: 0.1, ease: E.quint, scrollTrigger: { trigger: c, start: 'top 88%', end: 'top 55%', scrub } })))
    gsap.fromTo('.lx-hands > h2 > *', ...lxFT({ y: 80, opacity: 0, stagger: 0.15, ease: E.quint, scrollTrigger: { trigger: '.lx-hands', start: 'top 80%', end: 'top 30%', scrub } }))
    const thread = $('.lx-thread', root), threadPath = $('path', thread)
    const drawThread = () => {
      const sec = $('.lx-hands', root), box = sec.getBoundingClientRect()
      const knots = $$('.lx-role-knot', root).map((k) => { const r = k.getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top] })
      if (!knots.length) return
      thread.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
      const startPt = [knots[0][0] + (phone() ? 0 : -160), Math.max(0, knots[0][1] - box.height * 0.18)]
      let d = `M${startPt[0].toFixed(1)} ${startPt[1].toFixed(1)}`
      let prev = startPt
      knots.forEach((k) => {
        const dy = k[1] - prev[1]
        d += `C${prev[0].toFixed(1)} ${(prev[1] + dy * 0.62).toFixed(1)} ${k[0].toFixed(1)} ${(k[1] - dy * 0.62).toFixed(1)} ${k[0].toFixed(1)} ${k[1].toFixed(1)}`
        prev = k
      })
      d += `C${prev[0].toFixed(1)} ${(prev[1] + 160).toFixed(1)} ${(prev[0] + 60).toFixed(1)} ${(box.height - 40).toFixed(1)} ${(box.width / 2).toFixed(1)} ${box.height.toFixed(1)}`
      threadPath.setAttribute('d', d)
      threadPath.setAttribute('pathLength', '1')
    }
    drawThread()
    ScrollTrigger.addEventListener('refreshInit', drawThread)
    lxKill.push(() => ScrollTrigger.removeEventListener('refreshInit', drawThread))
    gsap.fromTo(threadPath, { strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.lx-roles', start: 'top 75%', end: 'bottom 60%', scrub } })
    if (fine) {
      const photos = $$('.lx-photo-in', root)
      track(window, 'pointermove', (e) => {
        const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5
        photos.forEach((p, i) => gsap.to(p, { rotateY: nx * (8 + i), rotateX: -ny * (8 + i), duration: 0.8, ease: 'power3.out', overwrite: 'auto' }))
      }, { passive: true })
    }

    // ---- 9 The note: lines rise from behind a mask; the signature writes itself.
    const quote = $('.lx-quote-text', root)
    const splitLines = () => {
      const text = quote.dataset.text || quote.innerHTML
      quote.dataset.text = text
      quote.innerHTML = text.replace(/<span class="lx-hang">“<\/span>/, '\u0001').split(/\s+/).map((w) => `<span class="lx-qw">${w.replace('\u0001', '<span class="lx-hang">“</span>')}</span>`).join(' ')
      const words = $$('.lx-qw', quote), lines = []
      let top = null
      words.forEach((w) => { const t = w.offsetTop; if (t !== top) { lines.push([]); top = t } lines[lines.length - 1].push(w.outerHTML) })
      quote.innerHTML = lines.map((l) => `<span class="lx-line"><span class="lx-line-in">${l.join(' ')}</span></span>`).join(' ')
    }
    splitLines()
    arrive('.lx-note > .lx-caps', '.lx-note')
    // The quote rises line by line as the paper scrolls into place; the pinned part writes the signature.
    gsap.fromTo('.lx-line-in', { yPercent: 70, clipPath: 'inset(0% -10% 100% -10%)' }, { yPercent: 0, clipPath: 'inset(-40% -10% -40% -10%)', stagger: 0.12, ease: E.quint, scrollTrigger: { trigger: '.lx-note', start: 'top 70%', end: 'top top', scrub } })
    const signText = $('.lx-sign text', root)
    const signLen = 2600
    gsap.timeline({ scrollTrigger: { trigger: '.lx-note', start: 'top top', end: '+=150%', pin: true, scrub } })
      .fromTo(signText, { strokeDasharray: signLen, strokeDashoffset: signLen, fillOpacity: 0 }, { strokeDashoffset: 0, duration: 0.9, ease: 'power1.inOut' }, 0.2)
      .to(signText, { fillOpacity: 1, duration: 0.3 }, 0.95)
      .fromTo('.lx-sign-flourish', { strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' }, 0.95)
      .add(() => {}, 1.7)

    // ---- 10 Sunrise.
    arrive('.lx-finale h2', '.lx-finale', { y: 120 })
    gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-finale', start: 'top top', end: '+=230%', pin: true, scrub } })
      .fromTo('.lx-sunrise', { y: () => innerHeight * 0.42 }, { y: 0, duration: 2.5, ease: 'power2.out' }, 0)
      .fromTo('.lx-sky-warm', { opacity: 0 }, { opacity: 1, duration: 2.2 }, 0.15)
      .fromTo('.lx-orchard', { yPercent: 18 }, { yPercent: 0, duration: 2.5, ease: 'power2.out' }, 0)
      .fromTo('.lx-pledges li', ...lxFT({ y: 70, opacity: 0, stagger: 0.45, duration: 0.5, ease: E.quint }), 0.4)
      .fromTo('.lx-finale-actions > *', ...lxFT({ y: 50, opacity: 0, stagger: 0.12, duration: 0.4, ease: E.quint }), 1.9)
      .fromTo('.lx-bye', ...lxFT({ opacity: 0, y: 30, duration: 0.4 }), 2.3)
      .add(() => {}, 2.9)

    // ---- Background and HUD: the page colour follows the scene; the ring fills and the year ticks.
    // The page colour, the HUD's scene number and the ink of the cursor and HUD all follow the scene in the middle of the screen.
    const COLORS = { 1: '#0b1f15', 2: '#0b1f15', 3: '#174631', 4: '#ffb81f', 5: '#f6efdc', 6: '#f6efdc', 7: '#0b1f15', 8: '#174631', 9: '#f6efdc', 10: '#0b1f15' }
    const INK = { 4: true, 6: true, 9: true }
    const setUi = (ink) => root.classList.toggle('lx-ink', ink)
    const sceneEls = $$('[data-lx-scene]', root)
    sceneEls.forEach((s, k) => {
      const n = Number(s.dataset.lxScene), c = COLORS[n], next = sceneEls[k + 1]
      // A scene lasts until the next one reaches the middle of the screen (pins included).
      ScrollTrigger.create({ trigger: s, start: 'top 50%', ...(next ? { endTrigger: next, end: 'top 50%' } : { end: 'bottom 50%' }), onToggle: (self) => {
        if (!self.isActive) return
        sceneNow = n
        gsap.to(root, { backgroundColor: c, duration: 0.9, ease: 'power2.out', overwrite: 'auto' })
        hudLabel()
        if (n !== 5) setUi(Boolean(INK[n]))
        root.classList.toggle('lx-calm', n === 10)
      } })
    })
    $$('[data-ui]', root).forEach((p) => ScrollTrigger.create({ trigger: p, start: 'top 50%', end: 'bottom 50%', onToggle: (self) => { if (self.isActive) setUi(p.dataset.ui === 'ink') } }))
    const hudFill = $('.lx-hud-fill', root)
    const hud = $('.lx-hud', root)
    ScrollTrigger.create({ trigger: root, start: 'top top', end: 'bottom bottom', onLeave: () => hud.classList.add('is-away'), onEnterBack: () => hud.classList.remove('is-away'), onUpdate: (s) => {
      hudFill.style.strokeDashoffset = String(1 - s.progress)
    } })
  }, root)
  lxKill.push(() => ctx.revert())

  // ---- Cursor and magnetic buttons (fine pointers only).
  if (fine) {
    const cur = $('.lx-cursor', root), dot = $('.lx-cursor-dot', cur), ring = $('.lx-cursor-ring', cur), word = $('.lx-cursor-word', cur)
    const p = { x: innerWidth / 2, y: innerHeight / 2 }, rp = { x: p.x, y: p.y }
    track(window, 'pointermove', (e) => {
      p.x = e.clientX; p.y = e.clientY
      cur.classList.add('is-on')
      const t = e.target instanceof Element ? e.target.closest('a, button, [data-lx-cursor]') : null
      const label = t ? (t.dataset.lxCursor || (t.closest('.lx') ? 'open' : '')) : (e.target instanceof Element && e.target.closest('.lx-open, .lx-promise') ? 'scroll' : '')
      cur.classList.toggle('is-big', Boolean(label))
      if (label && word.textContent !== label) word.textContent = label
    }, { passive: true })
    track(document, 'pointerleave', () => cur.classList.remove('is-on'))
    // The word follows what is under the pointer after a scroll too, not only after a move.
    track(window, 'scroll', () => {
      const el = document.elementFromPoint(p.x, p.y)
      const t = el && el.closest('a, button, [data-lx-cursor]')
      const label = t ? (t.dataset.lxCursor || 'open') : (el && el.closest('.lx-open, .lx-promise') ? 'scroll' : '')
      cur.classList.toggle('is-big', Boolean(label))
      if (label && word.textContent !== label) word.textContent = label
    }, { passive: true })
    loop(() => {
      rp.x += (p.x - rp.x) * 0.16; rp.y += (p.y - rp.y) * 0.16
      dot.style.transform = `translate3d(${p.x}px,${p.y}px,0)`
      ring.style.transform = `translate3d(${rp.x}px,${rp.y}px,0)`
    })
    $$('[data-lx-magnet]', root).forEach((b) => {
      const inner = b.firstElementChild
      track(b, 'pointermove', (e) => {
        const r = b.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2
        gsap.to(b, { x: x * 0.35, y: y * 0.45, duration: 0.6, ease: 'power3.out' })
        gsap.to(inner, { x: x * 0.15, y: y * 0.2, duration: 0.6, ease: 'power3.out' })
      })
      track(b, 'pointerleave', () => { gsap.to([b, inner], { x: 0, y: 0, duration: 1, ease: 'elastic.out(1,0.35)' }) })
    })
  }

  document.fonts?.ready.then(() => { if (document.body.dataset.page === 'legacy' && root.isConnected) ScrollTrigger.refresh() })
}

function lxStop({ keepPage = false } = {}) {
  const kills = lxKill
  lxKill = []
  kills.reverse().forEach((f) => { try { f() } catch {} })
  const html = document.documentElement
  html.classList.remove('lx-head-away')
  if (!keepPage) html.classList.remove('lx-on')
}

// Leaving the page: tear everything down, give the home page its title back, and let the shop's own scroll effects measure again.
window.addEventListener('mm:route', () => {
  if (document.body.dataset.page === 'legacy') return
  const was = lxKill.length || document.documentElement.classList.contains('lx-on')
  lxStop()
  if (document.title === LX_TITLE) document.title = LX_HOME_TITLE
  if (was && window.ScrollTrigger) requestAnimationFrame(() => ScrollTrigger.refresh())
})
