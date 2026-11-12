/* Our legacy (/legacy): "Fifty summers", a full-bleed, scroll-driven piece in its own visual world.
   Scenes: 0 preloader · 1 opening (pollen canvas, the colossal 50) · 2 the promise · 3 read the rings · 4 marquee ·
   5 five things we never traded · 6 seven days · 7 fifty summers in numbers · 8 four pairs of hands ·
   9 a note from the family · 10 the film (One Mango, a link to /one-mango/) · 11 the next fifty summers. Plus film
   grain, a progress HUD and (fine pointers) a cursor.

   Two modes on the same markup:
   - static (the default): a clean long-form page, everything visible. Used with prefers-reduced-motion, without GSAP
     or ScrollTrigger, and if anything in the motion setup throws.
   - motion (.lx-motion): pinned and scrubbed scenes. All of it is made inside one gsap.context, so leaving the page
     reverts every tween, ScrollTrigger and pin; rAF loops, listeners and the html classes are undone too.
   Motion rules that keep every frame painted: one fixed backdrop whose colour follows the scroll continuously (scenes
   have no backgrounds of their own, so no seams); no CSS filter on any full-viewport element; the five panels stack
   with position:sticky (no pinning), dimmed by an overlay's opacity and sunk by a transform.
   The art is inline SVG painted with gradients, masks and grain, and draws itself in three passes: a graphite sketch,
   a watercolour wash (soft, displaced blobs growing in a mask), then shadows, highlights and speckles.
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
  ['crate', 'Ripened the slow way', 'No carbide, no gas. Warmth, time and a watchful eye.'],
  ['hand', 'Graded by hand', 'Every mango is turned, pressed and looked at before it is packed.'],
  ['tree', 'A day from the tree', 'Fruit reaches our warehouse the day after it is plucked.'],
  ['scale', 'Sold as it really is', 'Raw is sold as raw, semi-ripe as semi-ripe. We never sell a mango past its best.'],
  ['sapling', 'Fair to the grower', 'The people who tend the trees are paid first and paid properly.'],
]
const LX_PANEL_TONE = ['cream', 'green', 'gold', 'green', 'cream']
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
// How ripe the mango of the seven days is on each day (0 hard green, 1 fully coloured).
const LX_RIPE_BY_DAY = [0, 0.1, 0.2, 0.32, 0.5, 0.66, 0.82, 0.96]

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
        lxSlotFit(s, n)
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

/** Letters as spans, each inside its own mask (they rise from behind a baseline). */
const lxLetters = (text) => [...text].map((c) => `<span class="lx-chm"><span class="lx-ch">${c === ' ' ? '&nbsp;' : c}</span></span>`).join('')

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

/** A slot-machine number: each digit spins down through three rounds to its value. Every digit sits in a tall row and
   the window shows only its middle, so a neighbouring digit can never peek in. */
function lxSlot(value) {
  return `<span class="lx-slot" aria-hidden="true">${String(value).split('').map((d) => `<span class="lx-slot-cell"><span class="lx-slot-col" data-d="${d}">${Array.from({ length: 30 }, (_, i) => `<span>${i % 10}</span>`).join('')}</span></span>`).join('')}</span>`
}

// Young Serif's figures are old-style (6 and 8 rise, 3 4 5 7 9 descend): ink above and below the baseline, in em.
const LX_INK_UP = [0.55, 0.563, 0.546, 0.546, 0.554, 0.602, 0.763, 0.56, 0.765, 0.743]
const LX_INK_DOWN = [0.018, 0, 0.013, 0.193, 0.2, 0.189, 0.014, 0.219, 0.01, 0.034]
/** Fits a slot number's window to the ink of its own digits, so every numeral is optically centred and its caption sits
   the same distance below the ink. In a 1.6em row the baseline is 1.14em down. */
/** The real ink of each digit (above, below the baseline, in em), read from pixels drawn in the page's own font; the
   font's figures are old-style. Falls back to measured values for Young Serif. */
let lxInkCache = null
function lxInk(el) {
  if (lxInkCache) return lxInkCache
  const fallback = LX_INK_UP.map((u, i) => [u, LX_INK_DOWN[i]])
  try {
    const row = el.querySelector('.lx-slot-col > span') || el
    const fam = getComputedStyle(row).fontFamily, S = 200, c = document.createElement('canvas')
    c.width = S * 1.4; c.height = S * 2
    const g = c.getContext('2d', { willReadFrequently: true })
    const out = []
    for (let d = 0; d < 10; d++) {
      g.clearRect(0, 0, c.width, c.height)
      g.font = `400 ${S}px ${fam}`
      g.textBaseline = 'alphabetic'
      g.fillText(String(d), S * 0.2, S * 1.3)
      const px = g.getImageData(0, 0, c.width, c.height).data
      let top = -1, bot = -1
      for (let y = 0; y < c.height && top < 0; y++) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 8) { top = y; break }
      for (let y = c.height - 1; y >= 0 && bot < 0; y--) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 8) { bot = y; break }
      if (top < 0) return fallback
      out.push([(S * 1.3 - top) / S, Math.max(0, (bot + 1 - S * 1.3) / S)])
    }
    if (document.fonts && document.fonts.check(`400 20px ${fam}`)) lxInkCache = out
    return out
  } catch { return fallback }
}
function lxBaseline(el) {
  const row = el.querySelector('.lx-slot-col > span')
  if (!row || !row.offsetHeight) return 1.14
  const mark = document.createElement('i')
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  row.appendChild(mark)
  const fs = parseFloat(getComputedStyle(row).fontSize) || 1, b = (mark.getBoundingClientRect().top - row.getBoundingClientRect().top) / fs
  mark.remove()
  return b
}
function lxSlotFit(el, value) {
  const ds = String(value).split('').map(Number)
  const ink = lxInk(el)
  const up = Math.max(...ds.map((d) => ink[d][0])), down = Math.max(...ds.map((d) => ink[d][1])), pad = 0.06
  el.style.setProperty('--win', `${(up + down + pad * 2).toFixed(3)}em`)
  el.style.setProperty('--slot-shift', `${(-(lxBaseline(el) - up - pad)).toFixed(3)}em`)
}

function lxPartnerHidden() {
  const nav = $('.desktop-nav [data-partner-link]')
  return Boolean(nav && nav.hidden)
}

// ---- Art: helpers.

const lxN = (v) => (Math.round(v * 10) / 10).toString()
/** A small seeded random (the art is the same on every visit). */
function lxRand(seed) {
  let s = (seed * 2654435761) >>> 0 || 7
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
function lxMix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const ch = (sh) => Math.round(((pa >> sh) & 255) + ((((pb >> sh) & 255) - ((pa >> sh) & 255)) * k))
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)
}
/** A smooth closed path through points (Catmull-Rom as cubic Béziers). */
function lxClosed(pts) {
  const n = pts.length, f = (v) => v.toFixed(1)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + 'Z'
}
/** An open smooth path through points. */
function lxOpen(pts) {
  const n = pts.length, f = (v) => v.toFixed(1)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}
/** A wobbly blob around a centre (leaf masses, soil, hills of foliage). */
function lxBlob(cx, cy, rx, ry, seed, wob = 0.14, steps = 14) {
  const r = lxRand(seed), pts = []
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * Math.PI * 2, k = 1 + (r() - 0.5) * 2 * wob
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k])
  }
  return lxClosed(pts)
}

/** Mango skin by ripeness k (0 hard green … 1 fully coloured): shoulder, middle, bottom, blush strength. */
const LX_SKIN = [
  [0, '#2f6a27', '#4c8a33', '#7aa743', 0],
  [0.35, '#557e2b', '#8ea53a', '#b8b545', 0.05],
  [0.65, '#87902e', '#d9ad37', '#eec24b', 0.3],
  [1, '#94892c', '#f1a22d', '#f9c853', 0.74],
]
function lxSkin(k) {
  k = Math.max(0, Math.min(1, k))
  let i = 0
  while (i < LX_SKIN.length - 2 && k > LX_SKIN[i + 1][0]) i++
  const A = LX_SKIN[i], B = LX_SKIN[i + 1], t = (k - A[0]) / (B[0] - A[0])
  return [lxMix(A[1], B[1], t), lxMix(A[2], B[2], t), lxMix(A[3], B[3], t), A[4] + (B[4] - A[4]) * t]
}
/** The leaf of a mango by how long it has been off the tree (0 fresh … 1 dried). */
const lxLeafTone = (k) => [lxMix('#5d9a40', '#a8904c', k), lxMix('#1d4c1f', '#5c4626', k)]

const LX_MANGO = 'M-172-6C-170-82-86-122 6-118 106-114 176-66 178 4 180 64 140 104 84 118 30 132-34 130-86 112-112 103-118 86-136 76-160 63-173 40-172-6Z'

/** A lanceolate mango leaf along +x from its base, with a two-tone blade, a midrib and veins. */
function lxLeaf(id, len, tone, opts = {}) {
  const w = len * (opts.w || 0.2), [l1, l2] = tone
  const d = `M0 0C${lxN(len * 0.2)} ${lxN(-w * 1.05)} ${lxN(len * 0.62)} ${lxN(-w * 1.02)} ${lxN(len)} 0C${lxN(len * 0.62)} ${lxN(w * 0.92)} ${lxN(len * 0.2)} ${lxN(w)} 0 0Z`
  const lower = `M0 0Q${lxN(len * 0.5)} ${lxN(len * 0.012)} ${lxN(len)} 0C${lxN(len * 0.62)} ${lxN(w * 0.92)} ${lxN(len * 0.2)} ${lxN(w)} 0 0Z`
  let veins = ''
  for (let t = 0.14; t < 0.86; t += 0.09) {
    const x = len * t, dx = len * 0.13
    const wt = w * Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.86
    veins += `M${lxN(x)} 0q${lxN(dx * 0.4)} ${lxN(-wt * 0.5)} ${lxN(dx)} ${lxN(-wt)}M${lxN(x)} 0q${lxN(dx * 0.4)} ${lxN(wt * 0.5)} ${lxN(dx)} ${lxN(wt)}`
  }
  const k = opts.dk ? ` data-k="${opts.dk}"` : ''
  return {
    defs: `<linearGradient id="${id}-lf" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${l1}"${opts.dk ? ' data-k="l1"' : ''}/><stop offset="1" stop-color="${l2}"${opts.dk ? ' data-k="l2"' : ''}/></linearGradient>`,
    paint: `<path d="${d}" fill="url(#${id}-lf)"${k}/>`,
    detail: `<path d="${lower}" fill="#0b2a10" opacity=".22"/><path d="${veins}" fill="none" stroke="#e8f0c0" stroke-opacity=".28" stroke-width="${lxN(len * 0.008 + 0.5)}" stroke-linecap="round"/><path d="M0 0Q${lxN(len * 0.5)} ${lxN(len * 0.012)} ${lxN(len * 0.97)} 0" fill="none" stroke="#f1f4cf" stroke-opacity=".55" stroke-width="${lxN(len * 0.016 + 0.6)}" stroke-linecap="round"/><path d="M${lxN(len * 0.12)} ${lxN(-w * 0.55)}Q${lxN(len * 0.45)} ${lxN(-w * 0.95)} ${lxN(len * 0.8)} ${lxN(-w * 0.45)}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="${lxN(w * 0.3)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#10260f" stroke-opacity=".35" stroke-width="${lxN(len * 0.006 + 0.6)}"/>`,
    sketch: `<path d="${d}"/><path d="M0 0L${lxN(len)} 0"/>`,
  }
}

/** A painted mango: base gradient (green → yellow → blush), core shadow, reflected light, specular highlight, lenticels,
   grain and a fine contour; optional stem and leaf. Returns the paint (washed in), the details (settle in last) and the
   sketch lines, all in place. `dk` marks the gradient stops so the seven days can ripen it. */
function lxFruit(o) {
  const { id, x = 0, y = 0, s = 1, rot = 0, k = 0.5, leaf = false, leafK = 0, seed = 1, flip = false, dots = 80, dk = false, stem = true } = o
  const [c1, c2, c3, bl] = lxSkin(k), r = lxRand(seed)
  const tf = `translate(${lxN(x)} ${lxN(y)}) rotate(${rot}) scale(${flip ? -s : s} ${s})`
  const K = (name) => (dk ? ` data-k="${name}"` : '')
  let speck = ''
  for (let i = 0; i < dots; i++) {
    const px = -165 + r() * 335, py = -112 + r() * 238, rr = 1 + r() * 1.9
    const dark = r() < 0.18
    speck += `<circle cx="${lxN(px)}" cy="${lxN(py)}" r="${lxN(rr)}" fill="${dark ? '#5a3510' : '#fff4c4'}" opacity="${lxN(dark ? 0.2 : 0.3 + r() * 0.35)}"/>`
  }
  const lf = leaf ? lxLeaf(`${id}-l`, 230, lxLeafTone(leafK), { dk: dk ? 'leaf' : '' }) : null
  const defs = `<linearGradient id="${id}-g" x1=".08" y1=".02" x2=".72" y2="1"><stop offset="0" stop-color="${c1}"${K('c1')}/><stop offset=".5" stop-color="${c2}"${K('c2')}/><stop offset="1" stop-color="${c3}"${K('c3')}/></linearGradient>
<radialGradient id="${id}-b" cx=".74" cy=".26" r=".62"><stop offset="0" stop-color="#d63f2a" stop-opacity="${lxN(bl)}"${K('bl')}/><stop offset=".55" stop-color="#e2602e" stop-opacity="${lxN(bl * 0.5)}"${K('bl2')}/><stop offset="1" stop-color="#e2602e" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}-sh" cx=".36" cy=".28" r=".8"><stop offset=".5" stop-color="#2a1404" stop-opacity="0"/><stop offset=".8" stop-color="#2a1404" stop-opacity=".26"/><stop offset="1" stop-color="#1e0e02" stop-opacity=".5"/></radialGradient>
<linearGradient id="${id}-rl" x1="0" y1="0" x2="1" y2="1"><stop offset=".55" stop-color="#fff2c0" stop-opacity="0"/><stop offset="1" stop-color="#fff2c0" stop-opacity=".5"/></linearGradient>
<radialGradient id="${id}-hi"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<clipPath id="${id}-c"><path d="${LX_MANGO}"/></clipPath>${lf ? lf.defs : ''}`
  const stemD = 'M-158-52C-164-62-170-76-172-94'
  const leafG = lf ? `<g class="lx-fruit-leaf" transform="translate(-168 -90) rotate(-148)">` : ''
  const paint = `<g transform="${tf}">${lf ? `${leafG}${lf.paint}</g>` : ''}<path d="${LX_MANGO}" fill="url(#${id}-g)"/><path d="${LX_MANGO}" fill="url(#${id}-b)"/>${stem ? `<path d="${stemD}" fill="none" stroke="#5b4124" stroke-width="10" stroke-linecap="round"/>` : ''}</g>`
  const detail = `<g transform="${tf}">${lf ? `${leafG}${lf.detail}</g>` : ''}<g clip-path="url(#${id}-c)"><path d="${LX_MANGO}" fill="url(#${id}-sh)"/><path d="${LX_MANGO}" fill="none" stroke="url(#${id}-rl)" stroke-width="20" opacity=".7"/>${speck}<ellipse cx="-62" cy="-62" rx="86" ry="34" transform="rotate(-12 -62 -62)" fill="url(#${id}-hi)" opacity=".34"/><ellipse cx="-84" cy="-74" rx="22" ry="9" transform="rotate(-16 -84 -74)" fill="#fff" opacity=".55"/><rect x="-190" y="-140" width="380" height="290" fill="url(#lx-grainpat)" opacity=".5"/></g><path d="${LX_MANGO}" fill="none" stroke="#3d2408" stroke-opacity=".28" stroke-width="${lxN(1.3 / s)}"/>${stem ? `<path d="${stemD}" fill="none" stroke="#a88456" stroke-width="3" stroke-linecap="round" opacity=".7" transform="translate(-2 -1)"/><ellipse cx="-158" cy="-52" rx="9" ry="6" fill="#4a3418" opacity=".7"/>` : ''}</g>`
  const sketch = `<g transform="${tf}"><path d="${LX_MANGO}"/>${stem ? `<path d="${stemD}"/>` : ''}${lf ? `${leafG}${lf.sketch}</g>` : ''}</g>`
  return { defs, paint, detail, sketch }
}

/** A soft cast shadow on the ground plane (light from the top left, so it falls to the right). */
const lxShadow = (cx, cy, rx, ry, o = 0.4, id = 'lx-cast') => `<ellipse cx="${lxN(cx)}" cy="${lxN(cy)}" rx="${lxN(rx)}" ry="${lxN(ry)}" fill="url(#${id})" opacity="${o}"/>`

/** Straw: thin golden strands, some lit and some in shadow. */
function lxStraw(seed, n, x0, x1, y0, y1, tones = ['#e9c66a', '#cf9f40', '#f6df98', '#a97a2c']) {
  const r = lxRand(seed)
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), a = (r() - 0.5) * 1.1 + (r() < 0.5 ? 0 : Math.PI), L = 30 + r() * 70
    const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L * 0.55, qx = (x + ex) / 2 + (r() - 0.5) * 24, qy = (y + ey) / 2 - 6 - r() * 14
    out += `<path d="M${lxN(x)} ${lxN(y)}Q${lxN(qx)} ${lxN(qy)} ${lxN(ex)} ${lxN(ey)}" stroke="${tones[Math.floor(r() * tones.length)]}" stroke-width="${lxN(1.2 + r() * 2.2)}"/>`
  }
  return `<g fill="none" stroke-linecap="round">${out}</g>`
}

/** One illustration: objects in painting order, each { paint, detail } (details settle in last), one sketch on top,
   washes (blobs growing in a soft, displaced mask) in the order they are painted. */
function lxIllo({ id, view = 600, defs = '', ground = '', objects = [], over = '', sketch = '', guides = '', blobs = [] }) {
  const mask = `<mask id="${id}-wash" maskUnits="userSpaceOnUse" x="-100" y="-100" width="${view + 200}" height="${view + 200}"><g filter="url(#lx-bleed)">${blobs.concat([[view / 2, view / 2, view * 0.95]]).map(([cx, cy, r]) => `<circle class="lx-blob" cx="${cx}" cy="${cy}" r="${r}" data-r="${r}" fill="#fff"/>`).join('')}</g></mask>`
  return `<svg class="lx-panel-art" viewBox="0 0 ${view} ${view}" aria-hidden="true" focusable="false"><defs>${defs}${mask}</defs>
<g class="lx-art-ground">${ground}</g>
${objects.map((o) => `<g class="lx-obj"><g class="lx-art-paint" mask="url(#${id}-wash)">${o.paint}</g><g class="lx-art-detail">${o.detail || ''}</g></g>`).join('')}
<g class="lx-art-over">${over}</g>
<g class="lx-art-sketch" filter="url(#lx-pencil)"><g class="lx-art-guides">${guides}</g>${sketch}</g></svg>`
}

// ---- Art: the five panels.

/** 01 Ripened the slow way: three mangoes at three stages, nestled in straw in a shallow crate, warm light across. */
function lxArtCrate() {
  const fr = [
    lxFruit({ id: 'c1a', x: 300, y: 300, s: 0.44, rot: 8, k: 0.55, seed: 3, leaf: true, leafK: 0.15 }),
    lxFruit({ id: 'c1b', x: 182, y: 330, s: 0.42, rot: -16, k: 0.08, seed: 5 }),
    lxFruit({ id: 'c1c', x: 418, y: 334, s: 0.43, rot: 12, k: 0.95, seed: 9, flip: true }),
  ]
  const wood = (y0, h, sd) => {
    const r = lxRand(sd)
    let g = ''
    for (let i = 0; i < 6; i++) {
      const yy = y0 + 8 + r() * (h - 16)
      g += `<path d="M66 ${lxN(yy)}C170 ${lxN(yy + (r() - 0.5) * 8)} 300 ${lxN(yy + (r() - 0.5) * 10)} 534 ${lxN(yy + (r() - 0.5) * 6)}" stroke="#4a2a12" stroke-opacity="${lxN(0.12 + r() * 0.16)}" stroke-width="${lxN(0.8 + r() * 1.2)}" fill="none"/>`
    }
    return g
  }
  const defs = fr.map((f) => f.defs).join('') + `<linearGradient id="c1-front" x1="0" y1="0" x2="1" y2=".3"><stop offset="0" stop-color="#c88b4e"/><stop offset=".55" stop-color="#a66a37"/><stop offset="1" stop-color="#7c4a24"/></linearGradient>
<linearGradient id="c1-in" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4d27"/><stop offset="1" stop-color="#3e2410"/></linearGradient>
<linearGradient id="c1-post" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a6234"/><stop offset="1" stop-color="#6e4220"/></linearGradient>
<linearGradient id="c1-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1406" stop-opacity="0"/><stop offset="1" stop-color="#2a1406" stop-opacity=".45"/></linearGradient>
<radialGradient id="c1-light" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3c6" stop-opacity=".55"/><stop offset="1" stop-color="#fff3c6" stop-opacity="0"/></radialGradient>`
  const inside = 'M64 372L106 298H494L536 372Z'
  const front = 'M64 372H536V482H64Z'
  const crateBack = { paint: `<path d="${inside}" fill="url(#c1-in)"/><path d="M106 298H494L500 308H100Z" fill="#d6a46a"/><path d="M64 372L106 298L112 300L74 372Z" fill="#c08850"/><path d="M536 372L494 298L488 300L526 372Z" fill="#8a5a30"/>${lxStraw(11, 120, 96, 504, 318, 372)}`, detail: `<path d="M106 298H494V312H106Z" fill="#2a1406" opacity=".18"/>` }
  const strawFront = { paint: lxStraw(23, 70, 80, 520, 350, 384, ['#f2d483', '#ddb057', '#c6923a']), detail: '' }
  const crateFront = {
    paint: `<path d="${front}" fill="url(#c1-front)"/><path d="M64 425H536" stroke="#3b2210" stroke-width="3" opacity=".55"/><path d="M64 372H96V482H64ZM504 372H536V482H504Z" fill="url(#c1-post)"/>`,
    detail: `${wood(372, 52, 4)}${wood(428, 54, 7)}<path d="M64 372H536" stroke="#f1c98e" stroke-width="5" opacity=".8"/><path d="M64 427H536" stroke="#e6b47a" stroke-width="2" opacity=".55"/><path d="${front}" fill="url(#c1-shade)"/>${[[80, 390], [80, 460], [520, 390], [520, 460], [300, 398], [300, 455]].map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="3.6" fill="#2b1a0c"/><circle cx="${cx - 1}" cy="${cy - 1}" r="1.3" fill="#d9c3a0" opacity=".8"/>`).join('')}<rect x="64" y="372" width="472" height="110" fill="url(#lx-grainpat)" opacity=".55"/><path d="${front}" fill="none" stroke="#3b2210" stroke-opacity=".5" stroke-width="1.4"/>`,
  }
  return lxIllo({
    id: 'lx-a0', defs,
    ground: lxShadow(330, 488, 300, 30, 0.55) + lxShadow(360, 492, 200, 14, 0.5),
    objects: [crateBack, fr[0], fr[1], fr[2], strawFront, crateFront],
    over: `<ellipse cx="170" cy="250" rx="300" ry="150" transform="rotate(28 170 250)" fill="url(#c1-light)"/>`,
    guides: '<path d="M40 372H560M300 250V500"/><ellipse cx="300" cy="330" rx="230" ry="60"/>',
    sketch: `<path d="${inside}"/><path d="${front}"/>${fr.map((f) => f.sketch).join('')}<path d="M64 425H536M96 372V482M504 372V482"/>`,
    blobs: [[300, 330, 260], [180, 340, 190], [420, 340, 190], [300, 430, 330]],
  })
}

/** 02 Graded by hand: a hand cradling a mango, thumb resting on the skin (the pose of shop photo m06), on a 720 grid. */
function lxArtHand() {
  const mango = lxClosed([[332, 24], [420, 28], [494, 62], [538, 128], [552, 214], [540, 298], [508, 366], [466, 412], [414, 434], [356, 436], [304, 422], [262, 392], [228, 350], [204, 296], [192, 230], [198, 156], [224, 92], [270, 46]])
  const hand = lxClosed([[546, 118], [560, 160], [566, 236], [556, 318], [534, 388], [504, 446], [480, 498], [468, 560], [464, 640], [462, 760], [290, 760], [294, 650], [300, 574], [292, 528], [276, 494], [252, 456], [226, 420], [196, 382], [170, 336], [154, 286], [146, 240], [154, 212], [176, 206], [194, 228], [206, 280], [240, 330], [360, 300], [470, 220], [520, 132]])
  const thumb = lxClosed([[150, 236], [156, 212], [174, 204], [192, 214], [200, 244], [206, 292], [222, 336], [246, 374], [272, 404], [276, 436], [252, 446], [226, 420], [196, 382], [172, 338], [156, 288]])
  const r = lxRand(17)
  let speck = ''
  for (let i = 0; i < 260; i++) {
    const px = 196 + r() * 356, py = 26 + r() * 410, rr = 1.1 + r() * 1.9
    speck += `<circle cx="${lxN(px)}" cy="${lxN(py)}" r="${lxN(rr)}" fill="#fff0a8" opacity="${lxN(0.35 + r() * 0.4)}"/>`
  }
  const defs = `<clipPath id="h2-mc"><path d="${mango}"/></clipPath><clipPath id="h2-hc"><path d="${hand}"/></clipPath><clipPath id="h2-tc"><path d="${thumb}"/></clipPath>
<linearGradient id="h2-skin" x1="0" y1="0" x2="1" y2=".25"><stop offset="0" stop-color="#e7b08a"/><stop offset=".5" stop-color="#d0926c"/><stop offset="1" stop-color="#a86a4a"/></linearGradient>
<linearGradient id="h2-thumb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0bd98"/><stop offset=".6" stop-color="#d49a73"/><stop offset="1" stop-color="#b47652"/></linearGradient>
<radialGradient id="h2-cup" cx="390" cy="470" r="150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5a2a14" stop-opacity=".5"/><stop offset=".55" stop-color="#5a2a14" stop-opacity=".2"/><stop offset="1" stop-color="#5a2a14" stop-opacity="0"/></radialGradient>
<linearGradient id="h2-m" x1=".85" y1=".05" x2=".2" y2=".95"><stop offset="0" stop-color="#e2443a"/><stop offset=".38" stop-color="#ec6a3a"/><stop offset=".7" stop-color="#f6ac2c"/><stop offset="1" stop-color="#f7cc3c"/></linearGradient>
<radialGradient id="h2-green" cx="210" cy="190" r="150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4f9a3a"/><stop offset=".55" stop-color="#7aa83c" stop-opacity=".75"/><stop offset="1" stop-color="#c8b23c" stop-opacity="0"/></radialGradient>
<radialGradient id="h2-pink" cx="480" cy="150" r="170" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ef6f7a" stop-opacity=".55"/><stop offset="1" stop-color="#ef6f7a" stop-opacity="0"/></radialGradient>
<radialGradient id="h2-core" cx="300" cy="150" r="330" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#3a0e04" stop-opacity="0"/><stop offset=".85" stop-color="#3a0e04" stop-opacity=".28"/><stop offset="1" stop-color="#2a0802" stop-opacity=".5"/></radialGradient>
<radialGradient id="h2-hi"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="h2-fadeg" x1="0" y1="590" x2="0" y2="740" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="h2-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="800"><rect width="720" height="800" fill="url(#h2-fadeg)"/></mask>
<linearGradient id="h2-wrist" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".75" stop-color="#3a1608" stop-opacity="0"/><stop offset="1" stop-color="#3a1608" stop-opacity=".35"/></linearGradient>`
  const handObj = {
    paint: `<g mask="url(#h2-fade)"><path d="${hand}" fill="url(#h2-skin)"/></g>`,
    detail: `<g clip-path="url(#h2-hc)" mask="url(#h2-fade)"><rect x="140" y="100" width="440" height="660" fill="url(#h2-wrist)"/><ellipse cx="390" cy="470" rx="190" ry="90" fill="url(#h2-cup)"/>
<path d="M318 498C350 488 404 486 446 474" stroke="#7a3e24" stroke-opacity=".38" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M300 470C334 470 372 462 404 446" stroke="#7a3e24" stroke-opacity=".28" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M316 560C352 552 410 552 450 548M322 584C360 578 404 578 446 574" stroke="#7a3e24" stroke-opacity=".3" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M352 610C356 650 350 700 356 760M410 606C404 650 414 700 408 760" stroke="#6a7ca8" stroke-opacity=".18" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M540 196C548 214 552 236 552 256M548 290C546 312 540 330 532 346M522 384C512 404 500 420 490 434" stroke="#6e3420" stroke-opacity=".45" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<path d="M556 140C560 160 563 190 563 214" stroke="#ffe0c8" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M298 640C298 690 296 720 294 760" stroke="#ffe3cc" stroke-opacity=".35" stroke-width="7" fill="none" stroke-linecap="round"/>
<rect x="140" y="100" width="440" height="660" fill="url(#lx-grainpat)" opacity=".45"/><path d="${hand}" fill="none" stroke="#5a2a14" stroke-opacity=".35" stroke-width="1.6"/></g>`,
  }
  const mangoObj = {
    paint: `<path d="${mango}" fill="url(#h2-m)"/><path d="${mango}" fill="url(#h2-green)"/><path d="${mango}" fill="url(#h2-pink)"/>`,
    detail: `<g clip-path="url(#h2-mc)"><path d="${mango}" fill="url(#h2-core)"/>${speck}<path d="${mango}" fill="none" stroke="#ffe7a0" stroke-opacity=".35" stroke-width="22" transform="translate(-6 -6)" opacity=".6" clip-path="url(#h2-mc)"/><ellipse cx="300" cy="110" rx="90" ry="40" transform="rotate(-30 300 110)" fill="url(#h2-hi)" opacity=".55"/><ellipse cx="282" cy="96" rx="20" ry="9" transform="rotate(-34 282 96)" fill="#fff" opacity=".6"/><rect x="180" y="20" width="380" height="420" fill="url(#lx-grainpat)" opacity=".5"/><path d="M200 430C300 450 440 440 520 380L560 460H180Z" fill="#3a0e04" opacity=".22"/></g><path d="${mango}" fill="none" stroke="#5a1a08" stroke-opacity=".3" stroke-width="1.6"/><path d="M318 26C322 16 330 10 340 8" stroke="#5b4124" stroke-width="7" stroke-linecap="round" fill="none"/>`,
  }
  const thumbObj = {
    paint: `<path d="${thumb}" fill="url(#h2-thumb)"/>`,
    detail: `<g clip-path="url(#h2-tc)"><path d="M156 214C160 236 162 252 168 262C176 268 188 262 192 248C190 232 186 216 178 208Z" fill="#f6d2c0" opacity=".75"/><path d="M160 220C164 236 168 248 174 254" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M162 292C174 296 190 292 200 284" stroke="#7a3e24" stroke-opacity=".4" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M200 246C206 290 222 332 250 372C262 388 272 400 276 420" stroke="#5a2410" stroke-opacity=".3" stroke-width="9" fill="none"/><path d="M152 248C156 300 176 344 210 386" stroke="#ffe6d2" stroke-opacity=".4" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="140" y="200" width="150" height="250" fill="url(#lx-grainpat)" opacity=".45"/></g><path d="${thumb}" fill="none" stroke="#5a2a14" stroke-opacity=".38" stroke-width="1.6"/>`,
  }
  return lxIllo({
    id: 'lx-a1', view: 720, defs,
    ground: '',
    objects: [handObj, mangoObj, thumbObj],
    guides: '<ellipse cx="372" cy="230" rx="178" ry="206"/><path d="M380 430V760M150 230L280 430"/>',
    sketch: `<g mask="url(#h2-fade)"><path d="${hand}"/></g><path d="${mango}"/><path d="${thumb}"/><path d="M318 498C350 488 404 486 446 474M156 214C160 236 162 252 168 262C176 268 188 262 192 248"/>`,
    blobs: [[370, 230, 260], [380, 560, 260], [200, 320, 140], [520, 260, 160]],
  })
}

/** 03 A day from the tree: a mango tree in the morning, fruit hanging, a ladder and a crate below, long shadows. */
function lxArtTree() {
  const r = lxRand(29)
  const masses = []
  const layer = (n, cy, ry, rxs, tone, seed) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, a = Math.PI * (1.05 + t * 0.9)
      masses.push({ cx: 300 + Math.cos(a) * 205 * (0.75 + r() * 0.3), cy: cy + Math.sin(a) * ry * (0.7 + r() * 0.4), rx: rxs * (0.8 + r() * 0.4), ry: rxs * (0.62 + r() * 0.25), tone, seed: seed + i })
    }
  }
  for (let i = 0; i < 5; i++) masses.push({ cx: 150 + i * 75 + (r() - 0.5) * 20, cy: 292 + (r() - 0.5) * 16, rx: 70 + r() * 16, ry: 46 + r() * 10, tone: 0, seed: 50 + i })
  layer(7, 270, 140, 88, 0, 100)
  layer(6, 252, 110, 82, 1, 200)
  layer(5, 232, 70, 74, 2, 300)
  masses.push({ cx: 300, cy: 150, rx: 96, ry: 70, tone: 2, seed: 400 }, { cx: 236, cy: 196, rx: 80, ry: 60, tone: 2, seed: 401 }, { cx: 372, cy: 186, rx: 84, ry: 62, tone: 1, seed: 402 })
  const TONES = [['#2c5a26', '#173818'], ['#3f7a32', '#1f4a20'], ['#6ea444', '#2d6427']]
  const defs = TONES.map(([a, b], i) => `<radialGradient id="t3-g${i}" cx=".32" cy=".26" r=".85"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`).join('') + `
<linearGradient id="t3-bark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6442"/><stop offset=".45" stop-color="#5e4128"/><stop offset="1" stop-color="#2e1e10"/></linearGradient>
<linearGradient id="t3-ladder" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e2b77a"/><stop offset="1" stop-color="#a87a44"/></linearGradient>
<radialGradient id="t3-ground" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b9862a" stop-opacity=".55"/><stop offset=".7" stop-color="#c9922a" stop-opacity=".25"/><stop offset="1" stop-color="#c9922a" stop-opacity="0"/></radialGradient>
<radialGradient id="t3-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe8" stop-opacity=".95"/><stop offset=".25" stop-color="#fff2c0" stop-opacity=".55"/><stop offset="1" stop-color="#fff2c0" stop-opacity="0"/></radialGradient>
<linearGradient id="t3-long" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a3608" stop-opacity=".5"/><stop offset="1" stop-color="#5a3608" stop-opacity="0"/></linearGradient>`
  const canopy = masses.map((m) => `<path d="${lxBlob(m.cx, m.cy, m.rx, m.ry, m.seed, 0.16, 16)}" fill="url(#t3-g${m.tone})"/>`).join('')
  let leaves = ''
  for (let i = 0; i < 150; i++) {
    const m = masses[Math.floor(r() * masses.length)], a = r() * Math.PI * 2
    const x = m.cx + Math.cos(a) * m.rx * (0.6 + r() * 0.38), y = m.cy + Math.sin(a) * m.ry * (0.6 + r() * 0.38)
    const lit = Math.cos(a + 0.8) < -0.1 ? 1 : 0
    leaves += `<path d="M0 0C5 -4 14 -4 20 0C14 4 5 4 0 0Z" transform="translate(${lxN(x)} ${lxN(y)}) rotate(${lxN(a * 57.3 + (r() - 0.5) * 70)}) scale(${lxN(0.9 + r() * 0.8)})" fill="${lit ? (r() < 0.5 ? '#86b856' : '#a5c862') : (r() < 0.5 ? '#2a5424' : '#356a2c')}"/>`
  }
  const fruitAt = [[214, 318, 0.13, 0.3], [262, 334, 0.12, 0.55], [330, 322, 0.13, 0.2], [380, 340, 0.12, 0.7], [430, 300, 0.11, 0.4], [168, 290, 0.11, 0.1], [300, 300, 0.11, 0.85], [452, 330, 0.1, 0.25]]
  const fruits = fruitAt.map(([x, y, s, k], i) => lxFruit({ id: `t3f${i}`, x, y: y + 28, s, rot: 72 + (i % 3) * 8, k, seed: 40 + i, dots: 0, stem: false }))
  const stalks = fruitAt.map(([x, y]) => `<path d="M${x - 6} ${y - 4}Q${x - 2} ${y + 8} ${x - 1} ${y + 18}" stroke="#4a3418" stroke-width="2.4" fill="none"/>`).join('')
  const trunk = 'M262 572C270 520 276 470 280 420C284 380 282 350 272 318L254 268L276 262L296 312L306 280L336 246L352 258L318 312C314 350 316 400 320 440C324 490 330 530 344 572Z'
  const ladder = (() => {
    let rungs = ''
    for (let t = 0.1; t < 0.95; t += 0.11) rungs += `<path d="M${lxN(392 - 56 * t)} ${lxN(574 - 244 * t)}L${lxN(432 - 56 * t)} ${lxN(570 - 244 * t)}"/>`
    return { rails: 'M392 574L336 330M432 570L376 326', rungs }
  })()
  const crate = lxFruit({ id: 't3c1', x: 488, y: 528, s: 0.16, rot: -8, k: 0.35, seed: 61, dots: 20 })
  const crate2 = lxFruit({ id: 't3c2', x: 528, y: 530, s: 0.15, rot: 14, k: 0.6, seed: 62, dots: 20, flip: true })
  const treeObj = {
    paint: `<path d="${trunk}" fill="url(#t3-bark)"/>${stalks}${canopy}`,
    detail: `<path d="M286 560C292 500 298 440 296 380M304 560C312 500 308 430 306 360M276 520C282 470 288 420 286 380" stroke="#22150a" stroke-opacity=".35" stroke-width="2" fill="none"/><path d="M268 560C276 500 280 440 282 400" stroke="#d8b08a" stroke-opacity=".35" stroke-width="3" fill="none"/>${leaves}${masses.map((m) => `<path d="${lxBlob(m.cx + m.rx * 0.18, m.cy + m.ry * 0.22, m.rx * 0.8, m.ry * 0.7, m.seed, 0.16, 16)}" fill="#0c2410" opacity=".14"/>`).join('')}`,
  }
  const ladderObj = { paint: `<g stroke="url(#t3-ladder)" stroke-width="9" stroke-linecap="round" fill="none"><path d="${ladder.rails}"/></g><g stroke="#c89a5e" stroke-width="6" stroke-linecap="round" fill="none">${ladder.rungs}</g>`, detail: `<g stroke="#5a3a18" stroke-opacity=".45" stroke-width="2" fill="none" transform="translate(3 2)"><path d="${ladder.rails}"/></g><g stroke="#fff3d0" stroke-opacity=".4" stroke-width="2" fill="none" transform="translate(-2 -1)"><path d="${ladder.rails}"/></g>` }
  const crateObj = {
    paint: `${crate.paint}${crate2.paint}<path d="M450 532H566V580H450Z" fill="#b07a44"/><path d="M450 556H566" stroke="#5a3418" stroke-width="2"/>`,
    detail: `${crate.detail}${crate2.detail}<path d="M450 532H566" stroke="#ecc08a" stroke-width="3"/><rect x="450" y="532" width="116" height="48" fill="url(#lx-grainpat)" opacity=".5"/><path d="M450 532H566V580H450Z" fill="none" stroke="#4a2a12" stroke-opacity=".5" stroke-width="1.2"/>`,
  }
  return lxIllo({
    id: 'lx-a2', defs: defs + fruits.map((f) => f.defs).join('') + crate.defs + crate2.defs,
    ground: `<ellipse cx="320" cy="578" rx="300" ry="34" fill="url(#t3-ground)"/><path d="M262 568C380 560 520 566 640 586L640 600C520 590 380 584 262 578Z" fill="url(#t3-long)"/><ellipse cx="560" cy="584" rx="140" ry="14" fill="#5a3608" opacity=".2"/><path d="M392 576L600 590M432 572L620 584" stroke="#5a3608" stroke-opacity=".22" stroke-width="5"/><path d="M566 580L640 590" stroke="#5a3608" stroke-opacity=".3" stroke-width="16"/>`,
    objects: [treeObj, { paint: fruits.map((f) => f.paint).join(''), detail: fruits.map((f) => f.detail).join('') }, ladderObj, crateObj],
    over: `<circle cx="70" cy="70" r="150" fill="url(#t3-sun)"/>`,
    guides: '<ellipse cx="300" cy="230" rx="240" ry="160"/><path d="M296 572V250M20 575H600"/>',
    sketch: `<path d="${trunk}"/>${masses.slice(-6).map((m) => `<path d="${lxBlob(m.cx, m.cy, m.rx, m.ry, m.seed, 0.16, 16)}"/>`).join('')}<path d="${ladder.rails}"/><path d="M450 532H566V580H450Z"/>`,
    blobs: [[300, 220, 260], [300, 470, 150], [380, 460, 150], [500, 550, 100]],
  })
}

/** 04 Sold as it really is: a green mango and a gold one on a brass scale pan, each tagged with its true stage. */
function lxArtScale() {
  const g = lxFruit({ id: 's4g', x: 222, y: 352, s: 0.42, rot: -14, k: 0.12, seed: 71, leaf: true, leafK: 0 })
  const y = lxFruit({ id: 's4y', x: 386, y: 350, s: 0.42, rot: 12, k: 0.9, seed: 73, flip: true })
  const defs = g.defs + y.defs + `<linearGradient id="s4-brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e5220"/><stop offset=".16" stop-color="#c9a14c"/><stop offset=".3" stop-color="#f8e6a8"/><stop offset=".46" stop-color="#b98c38"/><stop offset=".72" stop-color="#7a5a22"/><stop offset=".88" stop-color="#d8b05a"/><stop offset="1" stop-color="#7e5e24"/></linearGradient>
<radialGradient id="s4-dish" cx=".42" cy=".3" r=".75"><stop offset="0" stop-color="#e9cc84"/><stop offset=".6" stop-color="#a98232"/><stop offset="1" stop-color="#5e4318"/></radialGradient>
<linearGradient id="s4-tag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf1d8"/><stop offset="1" stop-color="#e2cfa4"/></linearGradient>`
  const pan = {
    paint: `<path d="M64 408A236 44 0 0 0 536 408Q514 470 300 478Q86 470 64 408Z" fill="url(#s4-brass)"/><ellipse cx="300" cy="408" rx="236" ry="44" fill="url(#s4-dish)"/><path d="M284 476H316V540H284Z" fill="url(#s4-brass)"/><path d="M190 548V562A110 18 0 0 0 410 562V548Z" fill="url(#s4-brass)"/><ellipse cx="300" cy="548" rx="110" ry="18" fill="#d8b464"/>`,
    detail: `<ellipse cx="300" cy="408" rx="236" ry="44" fill="none" stroke="#fff1c2" stroke-width="4" opacity=".7"/><ellipse cx="300" cy="412" rx="200" ry="30" fill="#3a2608" opacity=".14"/><path d="M90 430Q300 470 510 430" stroke="#fff7d8" stroke-opacity=".35" stroke-width="5" fill="none"/><ellipse cx="300" cy="548" rx="110" ry="18" fill="none" stroke="#fff1c2" stroke-opacity=".6" stroke-width="2"/><ellipse cx="300" cy="400" rx="120" ry="14" fill="#2a1a04" opacity=".22"/>`,
  }
  const rim = { paint: `<path d="M64 408A236 44 0 0 0 536 408" fill="none" stroke="#e8c779" stroke-width="7"/>`, detail: `<path d="M70 414A236 44 0 0 0 530 414" fill="none" stroke="#fff6d6" stroke-opacity=".6" stroke-width="2"/>` }
  const tag = (x, yy, rot, big, small, ink) => `<g transform="translate(${x} ${yy}) rotate(${rot})"><path d="M0 0H178Q186 0 186 8V70Q186 78 178 78H0L-22 50V28Z" fill="url(#s4-tag)"/><circle cx="-6" cy="39" r="6" fill="none" stroke="#b9975a" stroke-width="3"/><circle cx="-6" cy="39" r="3.2" fill="#174631"/><text x="16" y="40" font-family="'Young Serif',Georgia,serif" font-size="28" fill="${ink}" letter-spacing="-.5">${big}</text><text x="17" y="62" font-family="'Figtree',system-ui,sans-serif" font-weight="700" font-size="11.5" letter-spacing="2.4" fill="${ink}" opacity=".75">${small}</text></g>`
  const tags = {
    paint: `<path d="M150 312C130 360 110 420 90 484" stroke="#efe2bf" stroke-width="2" fill="none"/><path d="M466 318C480 370 476 420 466 478" stroke="#efe2bf" stroke-width="2" fill="none"/>${tag(96, 456, -9, 'Raw', 'DAY 2 · FIRM', '#174631')}${tag(372, 470, 7, 'Semi-ripe', 'DAY 5 · RIPENS', '#a4520f')}`,
    detail: '',
  }
  return lxIllo({
    id: 'lx-a3', defs,
    ground: lxShadow(336, 566, 210, 18, 0.6) + lxShadow(330, 482, 230, 20, 0.25),
    objects: [pan, g, y, rim, tags],
    guides: '<ellipse cx="300" cy="408" rx="236" ry="44"/><path d="M300 330V560M40 408H560"/>',
    sketch: `<path d="M64 408A236 44 0 0 0 536 408Q514 470 300 478Q86 470 64 408Z"/><path d="M284 476V540M316 476V540M190 548A110 18 0 0 0 410 548"/>${g.sketch}${y.sketch}<path d="M96 456h186v78h-186z" transform="rotate(-9 96 456)"/><path d="M372 470h186v78h-186z" transform="rotate(7 372 470)"/>`,
    blobs: [[300, 420, 260], [222, 350, 170], [386, 350, 170], [180, 500, 120], [470, 510, 120]],
  })
}

/** 05 Fair to the grower: two hands, a grower's and a receiver's, cradling a sapling in its ball of soil. */
function lxArtSapling() {
  const soil = lxBlob(300, 398, 128, 80, 77, 0.07, 18)
  const r = lxRand(91)
  let crumbs = ''
  for (let i = 0; i < 110; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r())
    const x = 300 + Math.cos(a) * 120 * d, y = 398 + Math.sin(a) * 74 * d
    crumbs += `<circle cx="${lxN(x)}" cy="${lxN(y)}" r="${lxN(1 + r() * 3.2)}" fill="${r() < 0.5 ? '#2a170a' : '#8a6040'}" opacity="${lxN(0.4 + r() * 0.5)}"/>`
  }
  const pebbles = [[250, 420, 9, 6], [338, 432, 7, 5], [290, 452, 6, 4], [362, 400, 5, 4]].map(([x, y, a, b]) => `<ellipse cx="${x}" cy="${y}" rx="${a}" ry="${b}" fill="#b8a48a"/><ellipse cx="${x - a * 0.3}" cy="${y - b * 0.35}" rx="${a * 0.4}" ry="${b * 0.3}" fill="#fff" opacity=".5"/>`).join('')
  const leaves = [
    [296, 274, 132, -168, 'g'], [302, 252, 140, -14, 'g'], [298, 212, 108, -146, 'g'], [300, 196, 104, -36, 'b'], [298, 166, 76, -116, 'b'], [299, 160, 70, -66, 'b'],
  ].map(([x, y, len, ang, t], i) => ({ x, y, ang, L: lxLeaf(`s5l${i}`, len, t === 'b' ? ['#c6763c', '#7a2e18'] : ['#6aa848', '#22541f'], { w: 0.19 }) }))
  const stem = 'M296 352C298 320 302 290 300 260C298 228 300 200 299 158L303 158C304 200 302 228 304 260C306 290 304 320 306 352Z'
  // Two cupped hands seen from the front, the little fingers together: palms and wrists behind the soil (fading out
  // downwards), a row of fingertips curling up in front of it, a thumb on either side. The grower's (left) is darker.
  const mir = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${lxN(600 - Number(x))} ${y}`)
  const palmL = 'M300 444C240 438 182 442 152 462C136 500 144 548 174 580C188 602 194 640 196 700H298C298 640 298 600 300 556Z'
  const thumbL = 'M138 486C128 446 130 404 144 378C150 366 170 366 174 382C178 410 178 444 182 478Z'
  const tip = (x, top, w, bottom) => `M${lxN(x - w / 2)} ${bottom}L${lxN(x - w / 2)} ${lxN(top + w / 2)}A${lxN(w / 2)} ${lxN(w / 2)} 0 0 1 ${lxN(x + w / 2)} ${lxN(top + w / 2)}L${lxN(x + w / 2)} ${bottom}Z`
  const FING = [[180, 452, 33, 548, -9], [213, 445, 33, 556, -4], [245, 449, 31, 556, 1], [275, 460, 27, 548, 5]]
  const hand = (side, tone) => {
    const [base, lite, dark, nail] = tone, flip = side === 'R'
    const X = (x) => (flip ? 600 - x : x)
    const fingers = FING.map(([x, top, w, bottom, rot]) => {
      const cx = X(x), r2 = flip ? -rot : rot, tr = `rotate(${r2} ${cx} ${bottom})`
      return `<g transform="${tr}"><path d="${tip(cx, top, w, bottom)}" fill="url(#s5-f${side})"/><path d="${tip(cx, top, w, bottom)}" fill="none" stroke="${dark}" stroke-opacity=".55" stroke-width="1.6"/><ellipse cx="${cx}" cy="${lxN(top + w * 0.5)}" rx="${lxN(w * 0.3)}" ry="${lxN(w * 0.36)}" fill="${nail}" opacity=".85"/><ellipse cx="${lxN(cx - w * 0.08)}" cy="${lxN(top + w * 0.4)}" rx="${lxN(w * 0.1)}" ry="${lxN(w * 0.16)}" fill="#fff" opacity=".55"/><path d="M${lxN(cx - w * 0.36)} ${lxN(top + (bottom - top) * 0.56)}q${lxN(w * 0.36)} 6 ${lxN(w * 0.72)} 0" stroke="${dark}" stroke-opacity=".45" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M${lxN(cx - w * 0.3)} ${lxN(top + w * 0.9)}V${lxN(bottom - 14)}" stroke="${lite}" stroke-opacity=".45" stroke-width="${lxN(w * 0.16)}" stroke-linecap="round"/></g>`
    }).join('')
    const th = flip ? mir(thumbL) : thumbL
    const tx = X(158)
    return {
      paint: `<path d="${th}" fill="url(#s5-f${side})"/>${fingers}`,
      detail: `<path d="${th}" fill="none" stroke="${dark}" stroke-opacity=".5" stroke-width="1.6"/><ellipse cx="${tx}" cy="388" rx="10" ry="13" fill="${nail}" opacity=".85"/><ellipse cx="${lxN(tx - 3)}" cy="384" rx="3" ry="5" fill="#fff" opacity=".5"/><path d="M${X(140)} 440q${flip ? -18 : 18} 6 ${flip ? -36 : 36} 0" stroke="${dark}" stroke-opacity=".4" stroke-width="1.6" fill="none"/><path d="M${X(140)} 470C${X(136)} 440 ${X(138)} 410 ${X(146)} 390" stroke="${lite}" stroke-opacity=".5" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M${X(164)} 556H${X(292)}" stroke="#2a1206" stroke-opacity=".3" stroke-width="8" stroke-linecap="round"/>`,
    }
  }
  const TONE_L = ['#8a5636', '#c08660', '#3e2112', '#d8b29a'], TONE_R = ['#d39a72', '#f8d0ae', '#7a4228', '#f6dccc']
  const defs = leaves.map((l) => l.L.defs).join('') + `<radialGradient id="s5-soil" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#7d5638"/><stop offset=".55" stop-color="#4c2f1a"/><stop offset="1" stop-color="#24140a"/></radialGradient>
<linearGradient id="s5-stem" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5a4426"/><stop offset=".5" stop-color="#5f7a34"/><stop offset="1" stop-color="#8a5a2a"/></linearGradient>
<linearGradient id="s5-pL" x1="0" y1="0" x2="1" y2=".4"><stop offset="0" stop-color="#9a6442"/><stop offset=".7" stop-color="#7a4a2e"/><stop offset="1" stop-color="#5a321e"/></linearGradient>
<linearGradient id="s5-pR" x1="1" y1="0" x2="0" y2=".4"><stop offset="0" stop-color="#e2ab84"/><stop offset=".7" stop-color="#c88a64"/><stop offset="1" stop-color="#a86c4a"/></linearGradient>
<linearGradient id="s5-fL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b47a54"/><stop offset=".55" stop-color="#8e5838"/><stop offset="1" stop-color="#6a3c22"/></linearGradient>
<linearGradient id="s5-fR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f0c09a"/><stop offset=".55" stop-color="#d69c74"/><stop offset="1" stop-color="#b47852"/></linearGradient>
<linearGradient id="s5-fadeg" x1="0" y1="560" x2="0" y2="690" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<mask id="s5-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="720"><rect width="600" height="720" fill="url(#s5-fadeg)"/></mask>
<radialGradient id="s5-cup" cx="300" cy="470" r="150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1e0e04" stop-opacity=".55"/><stop offset="1" stop-color="#1e0e04" stop-opacity="0"/></radialGradient>
<clipPath id="s5-sc"><path d="${soil}"/></clipPath>`
  const palms = { paint: `<g mask="url(#s5-fade)"><path d="${palmL}" fill="url(#s5-pL)"/><path d="${mir(palmL)}" fill="url(#s5-pR)"/></g>`, detail: `<g mask="url(#s5-fade)"><ellipse cx="300" cy="478" rx="150" ry="46" fill="url(#s5-cup)"/><path d="M300 452V640" stroke="#2a1206" stroke-opacity=".35" stroke-width="2"/><path d="M160 500C150 540 170 570 190 600" stroke="#d9a47e" stroke-opacity=".3" stroke-width="6" fill="none" stroke-linecap="round"/></g>` }
  const soilObj = { paint: `<path d="${soil}" fill="url(#s5-soil)"/>`, detail: `<g clip-path="url(#s5-sc)">${crumbs}${pebbles}<path d="${soil}" fill="none" stroke="#c49a70" stroke-opacity=".3" stroke-width="12" transform="translate(-5 -6)"/><rect x="170" y="310" width="260" height="180" fill="url(#lx-grainpat)" opacity=".6"/></g>` }
  const plantObj = {
    paint: `<path d="${stem}" fill="url(#s5-stem)"/>${leaves.map((l) => `<g transform="translate(${l.x} ${l.y}) rotate(${l.ang})">${l.L.paint}</g>`).join('')}`,
    detail: `${leaves.map((l) => `<g transform="translate(${l.x} ${l.y}) rotate(${l.ang})">${l.L.detail}</g>`).join('')}<path d="M300 350C302 300 300 240 301 160" stroke="#e4f0b0" stroke-opacity=".35" stroke-width="1.4" fill="none"/>`,
  }
  const hl = hand('L', TONE_L), hr = hand('R', TONE_R)
  return lxIllo({
    id: 'lx-a4', defs,
    ground: '',
    objects: [palms, soilObj, plantObj, hl, hr],
    guides: '<ellipse cx="300" cy="398" rx="128" ry="80"/><path d="M300 150V560M120 500H480"/>',
    sketch: `<path d="${soil}"/><path d="${stem}"/>${leaves.map((l) => `<g transform="translate(${l.x} ${l.y}) rotate(${l.ang})">${l.L.sketch}</g>`).join('')}<g mask="url(#s5-fade)"><path d="${palmL}"/><path d="${mir(palmL)}"/></g><path d="${thumbL}"/><path d="${mir(thumbL)}"/>${FING.map(([x, top, w, bottom]) => `<path d="${tip(x, top, w, bottom)}"/><path d="${tip(600 - x, top, w, bottom)}"/>`).join('')}`,
    blobs: [[300, 400, 170], [300, 240, 170], [200, 500, 170], [400, 500, 170]],
  })
}

const LX_ART = { crate: lxArtCrate, hand: lxArtHand, tree: lxArtTree, scale: lxArtScale, sapling: lxArtSapling }

/** One ring of the trunk: uneven and off-centre, as real growth is (k: 0 at the pith, 1 at the bark). */
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
/** The trunk's cross-section: darker heartwood, rings of uneven width and tone, rays, radial checks, a fissured bark with
   depth, a slab edge and a soft shadow. */
function lxTrunk() {
  const N = 50, OUTER = 262
  const widths = Array.from({ length: N }, (_, i) => 1 + 0.6 * Math.sin(i * 1.7) * Math.sin(i * 0.43 + 1))
  const total = widths.reduce((a, b) => a + b, 0)
  let r = 9
  const radii = widths.map((w) => (r += (w / total) * (OUTER - 9)))
  const rings = radii.map((rad, i) => {
    const decade = LX_DECADE_RING.indexOf(i)
    const w = (0.6 + 1.6 * Math.abs(Math.sin(i * 2.3))).toFixed(2)
    const tone = lxMix('#6e4a22', '#a07a44', Math.abs(Math.sin(i * 1.3 + 0.4)))
    return `<path class="lx-ring${decade >= 0 ? ' is-decade' : ''}${i === N - 1 ? ' is-now' : ''}" data-i="${i}"${decade >= 0 ? ` data-decade="${decade}"` : ''} style="stroke-width:${decade >= 0 ? 2.6 : w};stroke:${decade >= 0 || i === N - 1 ? '' : tone}" d="${lxClosed(lxRingPts(rad, (i + 1) / N, 56, i * 0.37))}" pathLength="1"/>`
  }).join('')
  const bark = lxRingPts(OUTER + 24, 1, 120, 4).map(([x, y], s) => {
    const j = 1 + 0.022 * Math.sin(s * 2.9) + 0.016 * Math.sin(s * 5.3) + 0.01 * Math.sin(s * 13.1)
    return [300 + (x - 300) * j, 300 + (y - 300) * j]
  })
  const rr = lxRand(5)
  let rays = '', fissures = '', checks = ''
  for (let a = 0; a < 26; a++) {
    const t = (a / 26) * Math.PI * 2 + rr() * 0.2, r1 = 30 + rr() * 60, r2 = 170 + rr() * 80
    rays += `M${lxN(314 + Math.cos(t) * r1)} ${lxN(290 + Math.sin(t) * r1)}L${lxN(300 + Math.cos(t) * r2)} ${lxN(300 + Math.sin(t) * r2)}`
  }
  for (let a = 0; a < 90; a++) {
    const t = (a / 90) * Math.PI * 2 + rr() * 0.04, r1 = OUTER + 5 + rr() * 6, r2 = OUTER + 18 + rr() * 9
    fissures += `M${lxN(300 + Math.cos(t) * r1)} ${lxN(300 + Math.sin(t) * r1)}L${lxN(300 + Math.cos(t + 0.01) * r2)} ${lxN(300 + Math.sin(t + 0.01) * r2)}`
  }
  ;[0.35, 2.2, 3.9, 5.2].forEach((t, i) => {
    const r1 = OUTER + 4, r2 = 120 + i * 22, w = 0.016
    const mid = (r1 + r2) / 2
    checks += `<path class="lx-check" d="M${lxN(300 + Math.cos(t - w) * r1)} ${lxN(300 + Math.sin(t - w) * r1)}L${lxN(300 + Math.cos(t + 0.01) * mid)} ${lxN(300 + Math.sin(t + 0.01) * mid)}L${lxN(300 + Math.cos(t) * r2)} ${lxN(300 + Math.sin(t) * r2)}L${lxN(300 + Math.cos(t - 0.004) * mid)} ${lxN(300 + Math.sin(t - 0.004) * mid)}L${lxN(300 + Math.cos(t + w) * r1)} ${lxN(300 + Math.sin(t + w) * r1)}Z"/>`
  })
  const barkD = lxClosed(bark)
  return `<svg class="lx-trunk" viewBox="0 0 600 600" aria-hidden="true" focusable="false">
<defs><radialGradient id="lx-wood" cx="314" cy="290" r="270" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6e3f1e"/><stop offset=".06" stop-color="#8e5a2e"/><stop offset=".36" stop-color="#a86f3a"/><stop offset=".44" stop-color="#c9975a"/><stop offset=".56" stop-color="#e2c088"/><stop offset=".86" stop-color="#ecd5a2"/><stop offset="1" stop-color="#d6b070"/></radialGradient>
<radialGradient id="lx-barkg" cx="300" cy="300" r="290" gradientUnits="userSpaceOnUse"><stop offset=".86" stop-color="#7a5430"/><stop offset=".92" stop-color="#3d2a18"/><stop offset="1" stop-color="#1c130a"/></radialGradient>
<radialGradient id="lx-trunk-sh" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="#03100a" stop-opacity=".55"/><stop offset="1" stop-color="#03100a" stop-opacity="0"/></radialGradient>
<radialGradient id="lx-woodlight" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#fff6dc" stop-opacity=".28"/><stop offset=".6" stop-color="#fff6dc" stop-opacity="0"/><stop offset="1" stop-color="#3a1e08" stop-opacity=".25"/></radialGradient>
<radialGradient id="lx-glow" cx="50%" cy="50%" r="50%"><stop offset=".6" stop-color="#ffb81f" stop-opacity="0"/><stop offset=".86" stop-color="#ffb81f" stop-opacity=".3"/><stop offset="1" stop-color="#ffb81f" stop-opacity="0"/></radialGradient>
<clipPath id="lx-woodclip"><path d="${lxClosed(lxRingPts(OUTER + 4, 1, 72, 2))}"/></clipPath></defs>
<circle class="lx-trunk-halo" cx="300" cy="300" r="300" fill="url(#lx-glow)"/>
<g class="lx-trunk-depth"><ellipse cx="330" cy="336" rx="300" ry="292" fill="url(#lx-trunk-sh)"/><path d="${barkD}" fill="#1a1109" transform="translate(6 16)"/></g>
<g class="lx-trunk-spin">
<path class="lx-bark" d="${barkD}" fill="url(#lx-barkg)"/>
<path class="lx-bark-fis" d="${fissures}"/>
<path class="lx-bark-in" d="${lxClosed(lxRingPts(OUTER + 8, 1, 72, 2))}"/>
<g class="lx-wood-grow"><path class="lx-wood" d="${lxClosed(lxRingPts(OUTER + 4, 1, 72, 2))}"/></g>
<g clip-path="url(#lx-woodclip)" class="lx-wood-tex"><rect x="30" y="30" width="540" height="540" fill="url(#lx-grainpat)" opacity=".5"/></g>
<path class="lx-rays" d="${rays}"/>
<g class="lx-rings">${rings}</g>
<g class="lx-checks">${checks}</g>
<path class="lx-wood-light" d="${lxClosed(lxRingPts(OUTER + 4, 1, 72, 2))}" fill="url(#lx-woodlight)"/>
<circle class="lx-pith" cx="314" cy="290" r="5"/>
</g></svg>`
}

/** The big mango of the seven days: the painted mango, its stops recoloured by the scroll; a two-part contact shadow. */
function lxMango(id, day) {
  const k = LX_RIPE_BY_DAY[Math.min(7, day)]
  const f = lxFruit({ id, x: 206, y: 226, s: 1, rot: -32, k, leaf: true, leafK: k, seed: 101 + day, dots: 120, dk: true })
  return `<svg class="lx-mango" viewBox="0 0 400 420" aria-hidden="true" focusable="false"><defs>${f.defs}</defs>
<ellipse class="lx-mango-shadow" cx="226" cy="396" rx="180" ry="20" fill="url(#lx-cast)" opacity=".45"/><ellipse cx="214" cy="388" rx="110" ry="8" fill="url(#lx-cast)" opacity=".7"/>
<g class="lx-mango-body">${f.paint}${f.detail}</g></svg>`
}

/** The sunrise's orchard: four layers of hills and trees, each farther one lighter (the sky shows through), and birds. */
function lxOrchard() {
  const hill = (x, k, amp) => 150 - amp * Math.sin(x / 1440 * Math.PI * 1.3 + k) - amp * 0.45 * Math.sin(x / 1440 * Math.PI * 4.1 + k * 2)
  const tree = (x, y, s, kind) => {
    const h = 34 * s
    let t = `<path d="M${lxN(x - 2.6 * s)} ${lxN(y + 4)}L${lxN(x - 1.6 * s)} ${lxN(y - h)}H${lxN(x + 1.6 * s)}L${lxN(x + 2.6 * s)} ${lxN(y + 4)}Z"/>`
    const blobs = kind === 0 ? [[0, -h - 16, 25], [-18, -h - 5, 19], [18, -h - 5, 20], [-6, -h - 29, 17], [10, -h - 25, 16]]
      : kind === 1 ? [[0, -h - 12, 13], [0, -h - 30, 12], [0, -h - 46, 9], [-5, -h - 22, 11], [5, -h - 38, 9]]
        : [[0, -h - 6, 16], [-26, -h - 2, 14], [26, -h - 2, 15], [-12, -h - 14, 15], [13, -h - 13, 15]]
    blobs.forEach(([dx, dy, r]) => { t += `<circle cx="${lxN(x + dx * s)}" cy="${lxN(y + dy * (kind === 2 ? 0.8 : 1))}" r="${lxN(r * s)}"/>` })
    return t
  }
  const row = (k, step, scale, amp, cls, dy) => {
    let trees = ''
    for (let x = 12 + k * 37; x < 1460; x += step + ((x * 7) % 29)) {
      const kind = ((x * 13) % 7) < 4 ? 0 : ((x * 13) % 7) < 6 ? 2 : 1
      trees += tree(x, hill(x, k, amp) + 6, scale * (0.75 + ((x * 13) % 9) / 20), kind)
    }
    let d = 'M0 300V' + hill(0, k, amp).toFixed(1)
    for (let x = 30; x <= 1440; x += 30) d += `L${x} ${hill(x, k, amp).toFixed(1)}`
    return `<g class="${cls}" transform="translate(0 ${dy})"><path d="${d}V300Z"/>${trees}</g>`
  }
  const birds = [[960, 70, 1], [1000, 52, 0.8], [1036, 82, 0.9], [1080, 60, 0.7], [610, 40, 0.6]].map(([x, y, s], i) => `<path class="lx-bird" style="--d:${i}" d="M${x - 10 * s} ${y}q${5 * s} ${-5 * s} ${10 * s} 1q${5 * s} ${-6 * s} ${10 * s} -1"/>`).join('')
  return `<svg class="lx-orchard" viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><g class="lx-birds">${birds}</g>${row(2.6, 40, 0.42, 14, 'is-l1', 30)}${row(1.7, 56, 0.62, 18, 'is-l2', 52)}${row(0.8, 74, 0.86, 22, 'is-l3', 78)}${row(0, 96, 1.18, 24, 'is-l4', 108)}</svg>`
}

/** A tile of grain for the art (dark specks with varying alpha), made once per visit. */
function lxGrainTile() {
  try {
    const c = document.createElement('canvas'), S = 160
    c.width = c.height = S
    const x = c.getContext('2d'), img = x.createImageData(S, S), r = lxRand(3)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r()
      const dark = v < 0.62
      img.data[i] = img.data[i + 1] = img.data[i + 2] = dark ? 30 : 255
      img.data[i + 3] = Math.floor((dark ? (0.62 - v) / 0.62 * 60 : (v - 0.62) / 0.38 * 26))
    }
    x.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  } catch { return '' }
}

function lxMarkup(varieties) {
  const marquee = (cls) => `<div class="lx-band ${cls}" aria-hidden="true"><div class="lx-band-track">${[0, 1].map(() => `<span>${LX_MARQUEE.map((m) => `${m}<i>✦</i>`).join('')}</span>`).join('')}</div></div>`
  const handsImg = (file) => `assets/mangoes/${file}.webp`
  const grain = lxGrainTile()
  return `<article class="lx" aria-label="Our legacy: fifty summers">
<div class="lx-bg" aria-hidden="true"><i class="lx-bg-glow"></i><i class="lx-bg-paper"></i><i class="lx-bg-vig"></i></div>
<div class="lx-grain" aria-hidden="true"></div>
<svg class="lx-defs" aria-hidden="true" focusable="false"><defs>
<filter id="lx-duo" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="table" tableValues="0.043 0.09 0.42 0.86 0.965"/><feFuncG type="table" tableValues="0.122 0.27 0.4 0.62 0.937"/><feFuncB type="table" tableValues="0.082 0.19 0.2 0.2 0.863"/></feComponentTransfer></filter>
<filter id="lx-pencil" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="d"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.75" result="holes"/><feComposite in="d" in2="holes" operator="in"/></filter>
<filter id="lx-bleed" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1200" height="1200"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="3" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="70" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="7"/></filter>
<radialGradient id="lx-cast"><stop offset="0" stop-color="#1e1206" stop-opacity=".8"/><stop offset=".55" stop-color="#1e1206" stop-opacity=".35"/><stop offset="1" stop-color="#1e1206" stop-opacity="0"/></radialGradient>
${grain ? `<pattern id="lx-grainpat" width="160" height="160" patternUnits="userSpaceOnUse"><image href="${grain}" width="160" height="160"/></pattern>` : '<pattern id="lx-grainpat" width="4" height="4" patternUnits="userSpaceOnUse"></pattern>'}
</defs></svg>
<div class="lx-hud" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" class="lx-hud-track"/><circle cx="32" cy="32" r="29" class="lx-hud-fill" pathLength="1"/></svg><span class="lx-hud-year">01 / 11</span></div>
<div class="lx-cursor" aria-hidden="true"><span class="lx-cursor-dot"></span><span class="lx-cursor-ring"><b class="lx-cursor-word"></b></span></div>
<div class="lx-pre" aria-hidden="true"><div class="lx-pre-half is-top"></div><div class="lx-pre-half is-bottom"></div><div class="lx-pre-core"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" pathLength="1"/><circle cx="60" cy="60" r="38" pathLength="1"/><circle cx="60" cy="60" r="24" pathLength="1"/></svg>${lxOdometer(1976, 'lx-pre-odo')}<small>Mango Mandi · fifty summers</small></div></div>

<section class="lx-scene lx-open" data-lx-scene="1" aria-labelledby="lx-title">
  <canvas class="lx-pollen" aria-hidden="true"></canvas>
  <canvas class="lx-pollen is-near" aria-hidden="true"></canvas>
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
  <div class="lx-promise-in"><h2 class="lx-caps" id="lx-promise-title">The promise</h2>
  <p class="lx-manifesto">${lxWords('We have grown, picked and carried mangoes to people’s doors since 1976. The trees are older now and so are we. The promise has not moved: fruit ripened the slow way, sold honestly, at the stage it really is.', ['the slow way,', 'honestly,'])}</p></div>
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
  ${LX_VOWS.map(([art, title, text], i) => `<div class="lx-panel is-${LX_PANEL_TONE[i]}${i % 2 ? ' is-flip' : ''}" data-ui="${LX_PANEL_TONE[i] === 'green' ? 'light' : 'ink'}"><div class="lx-panel-sink"><div class="lx-panel-in">
    ${i === 0 ? '<p class="lx-caps lx-panel-kicker">Five things we never traded</p>' : ''}
    <span class="lx-panel-num" aria-hidden="true">0${i + 1}</span>
    <div class="lx-panel-artbox">${LX_ART[art]()}</div>
    <div class="lx-panel-copy"><h3>${title}</h3><p>${text}</p></div>
  </div><i class="lx-panel-dim" aria-hidden="true"></i></div></div><div class="lx-panel-hold" aria-hidden="true"></div>`).join('')}
</section>

<section class="lx-scene lx-days" data-lx-scene="6" aria-labelledby="lx-days-title">
  <div class="lx-days-stage">
    <div class="lx-days-head"><h2 id="lx-days-title">Seven days, <em>told honestly.</em></h2><p>Most shops will not tell you how old your fruit is. We built ours around it.</p></div>
    <ol class="lx-days-track">${LX_DAYS.map(([label, line], d) => `<li class="lx-day${d >= 1 && d <= 3 ? ' is-raw' : d >= 4 ? ' is-semi' : ''}"><span class="lx-day-big" aria-hidden="true">${d}</span><div class="lx-day-mini">${lxMango(`lx-m${d}`, d)}</div><p class="lx-day-n">Day ${d}</p><p class="lx-day-label">${label}</p><p class="lx-day-line">${line}</p></li>`).join('')}<li class="lx-day is-never"><span class="lx-day-big" aria-hidden="true">8</span><div class="lx-day-mini">${lxMango('lx-m8', 7)}</div><p class="lx-day-n">After day 7</p><p class="lx-day-label">Never sold</p><p class="lx-day-line">We never sell a mango past its best.</p></li></ol>
    <div class="lx-days-hero" aria-hidden="true">${lxMango('lx-mbig', 0)}<span class="lx-stamp">Never sold</span></div>
    <div class="lx-flap" aria-hidden="true"><span class="lx-flap-day"><b>Day</b> <span class="lx-flap-n">0</span></span><span class="lx-flap-label">Plucked</span><span class="lx-flap-line">The day it leaves the tree.</span></div>
    <div class="lx-rail" aria-hidden="true"><div class="lx-rail-line"><i class="lx-rail-fill"></i>${Array.from({ length: 9 }, (_, d) => `<b style="left:${d * 12.5}%"></b>`).join('')}<i class="lx-rail-dot"></i></div><div class="lx-rail-ticks">${Array.from({ length: 8 }, (_, d) => `<span style="left:${d * 12.5}%">${d}</span>`).join('')}<span class="is-x" style="left:100%">✕</span></div><div class="lx-rail-brackets"><span class="is-raw">Sold raw · days 1 to 3</span><span class="is-semi">Sold semi-ripe · days 4 to 7</span></div></div>
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
    <figcaption><span class="lx-sr">The Mango Mandi family</span><svg class="lx-sign" viewBox="0 0 640 150" aria-hidden="true" focusable="false"><defs><mask id="lx-sign-mask" maskUnits="userSpaceOnUse" x="-60" y="-20" width="760" height="190"><path class="lx-sign-pen" d="M-10 72C120 64 200 80 280 66S440 80 520 64 630 74 660 70" pathLength="1"/></mask></defs><text x="320" y="88" text-anchor="middle" mask="url(#lx-sign-mask)">The Mango Mandi family</text><path class="lx-sign-flourish" d="M96 116c80 12 170 16 260 9 72-6 132-18 190-11 20 3 34 8 42 14" pathLength="1"/></svg></figcaption>
  </figure>
</section>

<section class="lx-scene lx-film" data-lx-scene="10" aria-labelledby="lx-film-title">
  <a class="lx-film-poster" href="/one-mango/" tabindex="-1" aria-hidden="true" data-lx-cursor="open"><img src="one-mango/poster.jpg" alt="" width="1600" height="900" loading="lazy" decoding="async"><span class="lx-film-play"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg></span></a>
  <div class="lx-film-copy">
    <p class="lx-caps">A film you scroll</p>
    <h2 id="lx-film-title">One <em>Mango.</em></h2>
    <p class="lx-film-line">Follow a single mango from a seed in the dark to a bowl on your counter: the tree, the pick, the crate, the road, the door. Scroll at your own pace, with quiet music.</p>
    <a class="lx-btn is-solid" href="/one-mango/" data-lx-cursor="open" data-lx-magnet><span>Watch the film</span></a>
  </div>
</section>

<section class="lx-scene lx-finale" data-lx-scene="11" aria-labelledby="lx-finale-title">
  <div class="lx-sky" aria-hidden="true"><i class="lx-sky-warm"></i><div class="lx-sunrise"><i class="lx-sunrays"></i><i class="lx-bloom"></i><i class="lx-sun"></i></div>${lxOrchard()}</div>
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

/** Scene 1's pollen in three depths: far (fine, slow, dim), mid (the flow field, with trails) and near (a few large soft
   motes on their own canvas, no trails, drifting faster); pushed by the pointer; paused off-screen. */
function lxPollen(canvas, near, track) {
  const ctx = canvas.getContext('2d'), nctx = near.getContext('2d'), noise = lxNoise(), phone = innerWidth < 760
  let w = 0, h = 0, dpr = 1, raf = 0, running = false, t = 0
  const ptr = { x: -9999, y: -9999 }
  const area = () => Math.max(0.4, Math.min(3.2, (innerWidth * innerHeight) / (1440 * 900)))
  const parts = [], motes = []
  const spawn = (p = {}, far = false) => Object.assign(p, { far, x: Math.random() * w, y: Math.random() * h, life: 80 + Math.random() * 260, age: 0, s: far ? 0.12 + Math.random() * 0.3 : 0.4 + Math.random() * 1.1, r: far ? 0.6 + Math.random() * 0.5 : Math.random() < 0.08 ? 1.9 : 0.8 + Math.random() * 1.1, a: far ? 0.18 + Math.random() * 0.25 : 0.3 + Math.random() * 0.6 })
  const mote = (m = {}) => Object.assign(m, { x: Math.random() * w, y: Math.random() * h, r: 6 + Math.random() * 16, vx: (Math.random() - 0.4) * 0.5, vy: -0.15 - Math.random() * 0.45, a: 0.08 + Math.random() * 0.16, ph: Math.random() * 6 })
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 64
  const sg = sprite.getContext('2d'), grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,214,120,1)'); grad.addColorStop(0.45, 'rgba(255,190,80,.45)'); grad.addColorStop(1, 'rgba(255,184,31,0)')
  sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64)
  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1)
    w = canvas.clientWidth; h = canvas.clientHeight
    for (const [c, g] of [[canvas, ctx], [near, nctx]]) {
      c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    ctx.fillStyle = '#0b1f15'; ctx.fillRect(0, 0, w, h)
    const want = Math.round((phone ? 1500 : 3000) * area()), far = Math.round(want * 0.45)
    parts.length = 0
    for (let i = 0; i < want; i++) parts.push(spawn({}, i < far))
    motes.length = 0
    for (let i = 0; i < Math.round((phone ? 16 : 34) * Math.sqrt(area())); i++) motes.push(mote())
  }
  size()
  const frame = () => {
    raf = requestAnimationFrame(frame)
    t += 0.0026
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(11,31,21,0.16)'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    for (const p of parts) {
      const ang = noise(p.x * 0.0021 + t, p.y * 0.0021 - t * 0.6) * Math.PI * 2.6 - Math.PI / 2.4
      let vx = Math.cos(ang) * p.s, vy = Math.sin(ang) * p.s - (p.far ? 0.05 : 0.18)
      if (!p.far) {
        const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy
        if (d2 < 22000) { const f = (1 - d2 / 22000) * 3.2, d = Math.sqrt(d2) || 1; vx += (dx / d) * f; vy += (dy / d) * f }
      }
      p.x += vx; p.y += vy; p.age++
      if (p.age > p.life || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) { spawn(p, p.far); continue }
      const fade = Math.min(1, p.age / 30, (p.life - p.age) / 40)
      ctx.fillStyle = p.far ? `rgba(255,214,150,${(p.a * fade).toFixed(3)})` : `rgba(255,${190 + (p.r > 1.5 ? 30 : 0)},${p.r > 1.5 ? 120 : 70},${(p.a * fade).toFixed(3)})`
      ctx.fillRect(p.x, p.y, p.r, p.r)
    }
    nctx.clearRect(0, 0, w, h)
    for (const m of motes) {
      m.x += m.vx + Math.sin(t * 9 + m.ph) * 0.2; m.y += m.vy
      const dx = m.x - ptr.x, dy = m.y - ptr.y, d2 = dx * dx + dy * dy
      if (d2 < 40000) { const d = Math.sqrt(d2) || 1, f = (1 - d2 / 40000) * 1.6; m.x += (dx / d) * f; m.y += (dy / d) * f }
      if (m.y < -40 || m.x < -40 || m.x > w + 40) { mote(m); m.y = h + 30 }
      nctx.globalAlpha = m.a * (0.75 + 0.25 * Math.sin(t * 14 + m.ph))
      nctx.drawImage(sprite, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2)
    }
    nctx.globalAlpha = 1
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

/** The three passes of a panel drawing, as a timeline 0…1 (scrubbed by its panel's hold). */
function lxDrawArt(svg) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } })
  const guides = $$('.lx-art-guides > *', svg), lines = $$('.lx-art-sketch > :not(.lx-art-guides) path, .lx-art-sketch > :not(.lx-art-guides) ellipse, .lx-art-sketch > path', svg)
  const all = [...guides, ...lines]
  all.forEach((p) => p.setAttribute('pathLength', '1'))
  gsap.set(all, { strokeDasharray: '1 1', strokeDashoffset: 1 })
  // 1 Graphite: the guides first, then the forms in drawing order; each stroke quick but hand-timed.
  tl.to(guides, { strokeDashoffset: 0, duration: 0.07, stagger: 0.025, ease: 'power1.inOut' }, 0)
  tl.to(lines, { strokeDashoffset: 0, duration: 0.09, stagger: Math.min(0.03, 0.34 / Math.max(1, lines.length)), ease: 'power2.inOut' }, 0.06)
  tl.to(guides, { opacity: 0.35, duration: 0.1 }, 0.36)
  // 2 Watercolour: soft blobs bloom in the mask, one wash after another.
  $$('.lx-blob', svg).forEach((b, i) => tl.fromTo(b, { attr: { r: 0 } }, { attr: { r: Number(b.dataset.r) }, duration: 0.3, ease: 'power2.out' }, 0.3 + i * 0.07))
  // 3 Shadows, highlights and speckles settle; the pencil softens to a faint contour.
  tl.fromTo($$('.lx-art-ground, .lx-art-detail, .lx-art-over', svg), { opacity: 0 }, { opacity: 1, duration: 0.2, stagger: 0.025, ease: 'power1.out' }, 0.7)
  tl.fromTo($('.lx-art-sketch', svg), { opacity: 1 }, { opacity: 0.14, duration: 0.2, ease: 'power1.inOut' }, 0.8)
  return tl
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
    hudText.textContent = year ? String(ringYear) : `${String(sceneNow).padStart(2, '0')} / 11`
  }
  lxPollen($('.lx-pollen', root), $('.lx-pollen.is-near', root), track)

  // The header: away while scrolling down, back on the way up.
  let lastY = scrollY
  track(window, 'scroll', () => {
    const y = scrollY, html = document.documentElement
    if (y > lastY + 6 && y > 160) html.classList.add('lx-head-away')
    else if (y < lastY - 6 || y < 160) html.classList.remove('lx-head-away')
    lastY = y
  }, { passive: true })

  const ctx = gsap.context(() => {
    const scrub = fine ? 1 : 0.5
    const E = { out: 'expo.out', quint: 'power4.out', in: 'power3.in', inOut: 'expo.inOut' }
    // A scene's opening lines arrive while it scrolls into place, so a pinned scene never starts empty.
    const arrive = (targets, trigger, vars = {}, start = 'top 92%', end = 'top 30%') => gsap.fromTo(targets, ...lxFT({ y: 70, opacity: 0, stagger: 0.12, ease: E.quint, ...vars, scrollTrigger: { trigger, start, end, scrub } }))

    // ---- 0 Preloader.
    const pre = $('.lx-pre', root)
    const preOdo = $('.lx-pre-odo', pre)
    const preState = { v: 1976 }
    lxRoll(preOdo, 1976)
    const preTl = gsap.timeline({ onComplete: () => { pre.remove(); intro.play() } })
    preTl.from('.lx-pre circle', { strokeDashoffset: 1, duration: 1.3, stagger: 0.12, ease: 'power3.inOut' }, 0)
      .to(preState, { v: 2026, duration: 1.5, ease: 'power3.inOut', onUpdate: () => lxRoll(preOdo, preState.v) }, 0.15)
      .to('.lx-pre-core', { scale: 0.86, opacity: 0, duration: 0.4, ease: 'power2.in' }, 1.75)
      .to('.lx-pre-half.is-top', { yPercent: -101, duration: 0.9, ease: E.inOut }, 2.0)
      .to('.lx-pre-half.is-bottom', { yPercent: 101, duration: 0.9, ease: E.inOut }, 2.0)
    const skip = () => { if (preTl.progress() < 0.82) preTl.progress(0.82) }
    ;['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => track(window, t, skip, { passive: true, once: true }))

    // ---- 1 Opening: entrance (after the preloader), then the fly-through on scroll.
    const intro = gsap.timeline({ paused: true })
    intro.from('.lx-fifty.is-photo', { scale: 1.18, opacity: 0, duration: 1.8, ease: E.out }, 0)
      .fromTo('.lx-fifty.is-outline', ...lxFT({ scale: 0.9, opacity: 0, duration: 2.2, ease: E.out }), 0.15)
      .fromTo('.lx-summers .lx-ch', ...lxFT({ yPercent: 105, duration: 1.15, stagger: 0.06, ease: E.out }), 0.35)
      .fromTo('.lx-open-caps, .lx-open-promise, .lx-cue', ...lxFT({ opacity: 0, y: 16, duration: 1, stagger: 0.12, ease: E.quint }), 0.8)
    const origin = () => {
      const f = $('.lx-fifty.is-photo', root), z = $('.lx-d0', root)
      const a = f.getBoundingClientRect(), b = z.getBoundingClientRect()
      return `${((b.left + b.width * 0.5 - a.left) / a.width) * 100}% ${((b.top + b.height * 0.56 - a.top) / a.height) * 100}%`
    }
    // The zoom passes through the zero quickly; the promise rises over the pollen before the pin lets go (it overlaps
    // the end of this pin), so the fly-through never ends on an empty screen.
    gsap.timeline({ scrollTrigger: { trigger: '.lx-open', start: 'top top', end: '+=90%', pin: true, scrub, invalidateOnRefresh: true } })
      .to('.lx-summers', { yPercent: 50, opacity: 0, ease: 'power2.in', duration: 0.3 }, 0)
      .to('.lx-open-caps, .lx-open-promise, .lx-cue', { opacity: 0, y: -30, duration: 0.22 }, 0)
      .to('.lx-fifty.is-outline', { scale: 2.4, opacity: 0, duration: 0.5, ease: 'power2.in' }, 0)
      .fromTo('.lx-fifty.is-photo', { transformOrigin: origin }, { scale: 22, ease: 'power3.in', duration: 0.7, transformOrigin: origin }, 0.04)
      .to('.lx-fifty.is-photo', { opacity: 0, duration: 0.1 }, 0.56)
      .to('.lx-vignette', { opacity: 0, duration: 0.3 }, 0.6)
      .add(() => {}, 1)

    // ---- 2 The promise: words light up as the scroll passes them (the first ones already as it rises in).
    arrive('.lx-promise .lx-caps', '.lx-promise', {}, 'top 95%', 'top 55%')
    gsap.fromTo('.lx-manifesto', ...lxFT({ y: 120, opacity: 0, ease: E.quint, scrollTrigger: { trigger: '.lx-promise', start: 'top 100%', end: 'top 40%', scrub } }))
    const words = $$('.lx-manifesto .lx-w', root)
    const pt = gsap.timeline({ scrollTrigger: { trigger: '.lx-promise', start: 'top 80%', endTrigger: '.lx-promise', end: () => `top+=${innerHeight * 1.2} top`, scrub } })
    words.forEach((w, i) => {
      const at = i * 0.05
      if (w.classList.contains('is-key')) pt.fromTo(w, { opacity: 0.2, color: '#f6efdc', yPercent: 18 }, { opacity: 1, color: '#ffb81f', yPercent: 0, duration: 0.3, ease: 'back.out(2.2)' }, at)
      else pt.fromTo(w, { opacity: 0.2 }, { opacity: 1, duration: 0.2, ease: 'none' }, at)
    })
    ScrollTrigger.create({ trigger: '.lx-promise', start: 'top top', end: '+=150%', pin: true })
    // It leaves as the rings arrive (no empty frame between them).
    gsap.to('.lx-promise-in', { y: -80, opacity: 0, ease: E.in, scrollTrigger: { trigger: '.lx-rings', start: 'top 85%', end: 'top 35%', scrub } })

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
    // The whole slice is there from the start (bark, depth, a darker inner disc); the light wood grows ring by ring inside it.
    gsap.set('.lx-checks, .lx-wood-light', { opacity: 0 })
    gsap.set('.lx-trunk-halo', { opacity: 0 })
    gsap.set('.lx-wood-tex, .lx-wood-light, .lx-rays', { opacity: 0 })
    gsap.set(caps, { opacity: 0, y: 70 })
    const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-rings', start: 'top top', end: () => `+=${phone() ? 880 : 760}%`, pin: true, scrub } })
    arrive('.lx-rings-head > *', '.lx-rings', {}, 'top 95%', 'top 25%')
    gsap.fromTo('.lx-trunk-wrap', ...lxFT({ scale: 0.7, rotate: -30, opacity: 0, ease: E.quint, scrollTrigger: { trigger: '.lx-rings', start: 'top 95%', end: 'top 10%', scrub } }))
    gsap.fromTo('.lx-rings-year', ...lxFT({ opacity: 0, y: 60, ease: E.quint, scrollTrigger: { trigger: '.lx-rings', start: 'top 70%', end: 'top 10%', scrub } }))
    tl.to('.lx-rings-head', { opacity: 0, y: -40, duration: 0.5, ease: 'power2.in' }, 0.9)
      .to('.lx-trunk-spin', { rotate: 38, transformOrigin: '50% 50%', duration: 30 }, 0.4)
      .to('.lx-wood-tex', { opacity: 1, duration: 3 }, 0.6).to('.lx-rays', { opacity: 0.2, duration: 3 }, 0.6)
    let at = 1.2
    rings.forEach((ring, i) => {
      const last = i === rings.length - 1
      tl.to(ring, { strokeDashoffset: last ? 0.5 : 0, duration: 0.24 }, at)
        .to(st, { r: i + 1, duration: 0.24, onUpdate: roll }, at)
      at += 0.24
      const decade = LX_DECADE_RING.indexOf(i)
      if (decade >= 0) {
        tl.to(ring, { stroke: '#ffb81f', strokeWidth: 6, duration: 0.3, ease: 'power2.out' }, at)
          .to('.lx-trunk-halo', { opacity: 0.55, duration: 0.3 }, at)
          .to(caps[decade], { opacity: 1, y: 0, duration: 0.55, ease: E.quint }, at + 0.05)
          .to(caps[decade], { opacity: 0, y: -60, duration: 0.45, ease: 'power2.in' }, at + 1.6)
          .to(ring, { strokeWidth: 3.4, duration: 0.4 }, at + 1.6)
          .to('.lx-trunk-halo', { opacity: 0.2, duration: 0.4 }, at + 1.6)
        at += 2.1
      }
    })
    tl.to('.lx-checks, .lx-wood-light', { opacity: 1, duration: 1.4 }, at - 2.4)
      .to(st, { r: 51, duration: 0.5, onUpdate: roll }, at)
      .to(caps[5], { opacity: 1, y: 0, duration: 0.6, ease: E.quint }, at + 0.2)
      .add(() => {}, at + 2.6)
    tl.eventCallback('onUpdate', () => root.classList.toggle('lx-ring-live', tl.progress() > 0.9))
    // The fiftieth ring stays on screen as the marquee arrives.
    gsap.to('.lx-rings-stage', { yPercent: -18, opacity: 0.0, ease: 'power2.in', scrollTrigger: { trigger: '.lx-marquee', start: 'top 70%', end: 'top 10%', scrub } })

    // ---- 4 Marquee: two bands, speed and skew from the scroll's velocity.
    const bands = $$('.lx-band-track', root).map((el, i) => ({ el, x: 0, dir: i ? 1 : -1 }))
    let vel = 0, bandsOn = false
    ScrollTrigger.create({ trigger: '.lx-marquee', start: 'top bottom', end: 'bottom top', onUpdate: (s) => { vel = s.getVelocity() }, onToggle: (s) => { bandsOn = s.isActive } })
    let skew = 0
    loop(() => {
      if (!bandsOn) return
      vel *= 0.92
      const boost = gsap.utils.clamp(-14, 14, vel / 180)
      skew += (gsap.utils.clamp(-10, 10, vel / 140) - skew) * 0.1
      bands.forEach((b) => {
        const half = b.el.scrollWidth / 2 || 1
        b.x += (1.1 + Math.abs(boost)) * b.dir * (boost < 0 ? -1 : 1)
        if (b.x <= -half) b.x += half
        if (b.x > 0) b.x -= half
        b.el.style.transform = `translate3d(${b.x.toFixed(1)}px,0,0) skewX(${(-skew * b.dir).toFixed(2)}deg)`
      })
    })
    gsap.fromTo('.lx-band', ...lxFT({ yPercent: 60, opacity: 0, stagger: 0.15, ease: E.quint, scrollTrigger: { trigger: '.lx-marquee', start: 'top 95%', end: 'top 35%', scrub } }))
    // The bands drift up and stay in view while panel 01 rises under them, then fade as it settles.
    gsap.timeline({ scrollTrigger: { trigger: '.lx-vows', start: 'top 100%', end: 'top 0%', scrub } })
      .to('.lx-marquee', { y: () => -innerHeight * 0.35, ease: 'none', duration: 1 }, 0)
      .to('.lx-marquee', { opacity: 0, ease: 'power1.in', duration: 0.35 }, 0.6)

    // ---- 5 Five panels: sticky (no pinning). Each holds while its drawing paints itself; the next slides over it while
    // the covered one sinks (a transform) and dims (an overlay's opacity). Triggers are the holds, never the sticky panels.
    const panels = $$('.lx-panel', root), holds = $$('.lx-panel-hold', root), vows = $('.lx-vows', root)
    // Panel 01 rises straight on the backdrop (no edge), and becomes a solid card once it is in place.
    ScrollTrigger.create({ trigger: vows, start: 'top top', toggleClass: { targets: panels[0], className: 'is-solid' } })
    panels.forEach((p, i) => {
      const sink = $('.lx-panel-sink', p), dim = $('.lx-panel-dim', p), hold = holds[i]
      const startAt = i === 0 ? { trigger: vows, start: 'top 95%' } : { trigger: holds[i - 1], start: 'bottom 95%' }
      const art = lxDrawArt($('.lx-panel-art', p))
      gsap.timeline({ scrollTrigger: { ...startAt, endTrigger: hold, end: 'bottom bottom', scrub } })
        .add(art.tweenFromTo(0, art.duration(), { ease: 'none' }), 0)
        .fromTo($('.lx-panel-num', p), ...lxFT({ yPercent: 30, opacity: 0, duration: 0.3, ease: E.quint }), 0)
        .fromTo($$('.lx-panel-copy > *, .lx-panel-kicker', p), ...lxFT({ y: 60, opacity: 0, stagger: 0.06, duration: 0.3, ease: E.quint }), 0.05)
      if (i < panels.length - 1) {
        gsap.timeline({ scrollTrigger: { trigger: hold, start: 'bottom bottom', end: 'bottom top', scrub: true } })
          .fromTo(sink, { scale: 1, y: 0 }, { scale: 0.9, y: () => -innerHeight * 0.03, ease: 'none' }, 0)
          .fromTo(sink, { '--r': '0px' }, { '--r': '36px', ease: 'none' }, 0)
          .fromTo(dim, { opacity: 0 }, { opacity: 0.38, ease: 'none' }, 0)
      }
    })

    // ---- 6 Seven days: the vertical scroll travels sideways; the mango ripens in the middle.
    const track6 = $('.lx-days-track', root), big = $('.lx-days-hero .lx-mango', root)
    const stops = $$('[data-k]', big), flapN = $('.lx-flap-n', root), flapLabel = $('.lx-flap-label', root), flapLine = $('.lx-flap-line', root)
    const leafG = $('.lx-fruit-leaf', big), leafBase = leafG ? leafG.getAttribute('transform') : ''
    let shown = -1
    const ripen = (d) => {
      const i = Math.min(7, Math.floor(d)), f = Math.min(1, d - i)
      const k = LX_RIPE_BY_DAY[i] + ((LX_RIPE_BY_DAY[Math.min(7, i + 1)] - LX_RIPE_BY_DAY[i]) * f)
      const [c1, c2, c3, bl] = lxSkin(k), [l1, l2] = lxLeafTone(Math.min(1, d / 7.5))
      stops.forEach((s) => {
        const key = s.dataset.k
        if (key === 'c1' || key === 'c2' || key === 'c3') s.setAttribute('stop-color', { c1, c2, c3 }[key])
        else if (key === 'bl') s.setAttribute('stop-opacity', bl.toFixed(3))
        else if (key === 'bl2') s.setAttribute('stop-opacity', (bl * 0.5).toFixed(3))
        else if (key === 'l1') s.setAttribute('stop-color', l1)
        else if (key === 'l2') s.setAttribute('stop-color', l2)
      })
      // The leaf dries and curls a little.
      if (leafG) leafG.setAttribute('transform', `${leafBase} rotate(${(d * 1.6).toFixed(2)}) scale(1 ${(1 - d * 0.03).toFixed(3)})`)
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
    lxKill.push(() => { if (leafG) leafG.setAttribute('transform', leafBase) })
    arrive('.lx-days-head > *', '.lx-days', {}, 'top 95%', 'top 20%')
    arrive('.lx-days-hero', '.lx-days', { y: 160, scale: 0.7 }, 'top 95%', 'top 10%')
    const dstate = { d: 0 }
    gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-days', start: 'top top', end: () => `+=${phone() ? 700 : 560}%`, pin: true, scrub, invalidateOnRefresh: true } })
      .to('.lx-days-head', { opacity: 0, y: -50, duration: 0.4 }, 0.4)
      .fromTo('.lx-flap, .lx-rail', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 0.55)
      .to(track6, { x: () => -(track6.scrollWidth - innerWidth), duration: 8 }, 1)
      .to(dstate, { d: 8, duration: 8, onUpdate: () => ripen(dstate.d) }, 1)
      .to('.lx-rail-fill', { scaleX: 1, duration: 8 }, 1)
      .to('.lx-rail-dot', { left: '100%', duration: 8 }, 1)
      .fromTo('.lx-days-hero .lx-mango', { filter: 'grayscale(0) brightness(1)' }, { filter: 'grayscale(0.92) brightness(0.95)', duration: 0.6, immediateRender: false }, 8.4)
      .fromTo('.lx-stamp', { scale: 2.6, opacity: 0, rotate: -4 }, { scale: 1, opacity: 1, rotate: -14, duration: 0.35, ease: 'expo.in' }, 8.6)
      .to('.lx-days-hero', { keyframes: { x: [0, -12, 10, -6, 0] }, duration: 0.3 }, 8.95)
      .to('.lx-flap', { opacity: () => (phone() ? 0 : 1), duration: 0.3 }, 8.9)
      .fromTo('.lx-days-end', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: E.quint }, 9.1)
      .add(() => {}, 10.4)

    // ---- 7 Numbers: one beat at a time, digits rolling in like a slot machine; beats cross-fade.
    const beats = $$('.lx-beat', root)
    $$('[data-lx-to]', root).forEach((el) => lxSlotFit(el, el.dataset.lxTo))
    const cell = 100 / 30
    const rest = (b) => $$('.lx-slot-col', b).forEach((col) => gsap.set(col, { yPercent: -(20 + Number(col.dataset.d)) * cell }))
    // The slot spin is time-based (it always lands), started as the scroll reaches each beat.
    const spin = (b) => {
      const cols = $$('.lx-slot-col', b)
      gsap.killTweensOf(cols)
      gsap.fromTo(cols, { yPercent: (k, el) => -Number(el.dataset.d) * cell }, { yPercent: (k, el) => -(20 + Number(el.dataset.d)) * cell, duration: 1.25, stagger: 0.14, ease: 'power4.out' })
    }
    beats.forEach(rest)
    gsap.set(beats.slice(1), { opacity: 0 })
    ScrollTrigger.create({ trigger: '.lx-numbers', start: 'top 70%', onEnter: () => spin(beats[0]) })
    gsap.fromTo('.lx-beats', ...lxFT({ opacity: 0, y: 160, ease: E.quint, scrollTrigger: { trigger: '.lx-numbers', start: 'top 100%', end: 'top 25%', scrub } }))
    const nt = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-numbers', start: 'top top', end: '+=330%', pin: true, scrub } })
    arrive('.lx-numbers-kicker', '.lx-numbers')
    beats.forEach((b, i) => {
      const at = i * 1.3
      if (i) nt.fromTo(b, { opacity: 0, yPercent: 12 }, { opacity: 1, yPercent: 0, duration: 0.4, ease: 'power3.out' }, at - 0.15)
          .call(() => spin(b), null, at - 0.13)
          .fromTo($('.lx-beat-cap', b), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, at + 0.1)
      if (i < beats.length - 1) nt.to(b, { opacity: 0, yPercent: -12, duration: 0.3, ease: 'power2.in' }, at + 0.85)
    })
    nt.add(() => {}, beats.length * 1.3)

    // ---- 8 Hands: photos wipe open and drift; a gold thread draws down through the roles.
    $$('.lx-photo', root).forEach((f) => {
      // The reveal wipes up inside the photo's own shape (the clip keeps the shape's rounding), so nothing paints outside it.
      const shape = getComputedStyle(f).getPropertyValue('--shape').trim() || '0px'
      gsap.fromTo($('.lx-photo-in', f), { clipPath: `inset(100% 0% 0% 0% round ${shape})` }, { clipPath: `inset(0% 0% 0% 0% round ${shape})`, ease: 'power3.out', scrollTrigger: { trigger: f, start: 'top 95%', end: 'top 45%', scrub } })
      gsap.fromTo($('.lx-photo-line', f), { opacity: 0, x: -30, y: -30 }, { opacity: 1, x: 0, y: 0, ease: 'power3.out', scrollTrigger: { trigger: f, start: 'top 70%', end: 'top 25%', scrub } })
      gsap.fromTo($('img', f), { scale: 1.3 }, { scale: 1.04, ease: 'none', scrollTrigger: { trigger: f, start: 'top bottom', end: 'bottom top', scrub: true } })
      // A slow drift on wide screens; on a phone the photo stays put so it never meets the next role.
      gsap.fromTo(f, { yPercent: () => (phone() ? 0 : -Number(f.dataset.speed)) }, { yPercent: () => (phone() ? 0 : Number(f.dataset.speed)), ease: 'none', scrollTrigger: { trigger: f, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true } })
    })
    $$('.lx-role-copy', root).forEach((c) => gsap.fromTo($$(':scope > *:not(.lx-role-knot)', c), ...lxFT({ y: 60, opacity: 0, stagger: 0.1, ease: E.quint, scrollTrigger: { trigger: c, start: 'top 92%', end: 'top 55%', scrub } })))
    gsap.fromTo('.lx-hands > h2 > *', ...lxFT({ y: 80, opacity: 0, stagger: 0.15, ease: E.quint, scrollTrigger: { trigger: '.lx-hands', start: 'top 85%', end: 'top 30%', scrub } }))
    const thread = $('.lx-thread', root), threadPath = $('path', thread)
    const drawThread = () => {
      const sec = $('.lx-hands', root), box = sec.getBoundingClientRect()
      const knots = $$('.lx-role-knot', root).map((k) => { const r = k.getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top] })
      if (!knots.length || !box.height) return
      thread.setAttribute('viewBox', `0 0 ${box.width.toFixed(1)} ${box.height.toFixed(1)}`)
      const startPt = [knots[0][0] + (phone() ? 0 : -160), Math.max(0, knots[0][1] - Math.min(box.height * 0.18, innerHeight * 0.6))]
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
    ScrollTrigger.addEventListener('refresh', drawThread)
    lxKill.push(() => ScrollTrigger.removeEventListener('refresh', drawThread))
    gsap.fromTo(threadPath, { strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.lx-roles', start: 'top 75%', end: 'bottom 60%', scrub } })
    if (fine) {
      const photos = $$('.lx-photo-in', root)
      track(window, 'pointermove', (e) => {
        const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5
        photos.forEach((p, i) => gsap.to(p, { rotateY: nx * (8 + i), rotateX: -ny * (8 + i), duration: 0.8, ease: 'power3.out', overwrite: 'auto' }))
      }, { passive: true })
    }

    // ---- 9 The note: lines rise from behind a mask; the signature writes itself, then a gold underline.
    // Lines are split from the real layout: after the fonts load and again whenever the width changes.
    const quote = $('.lx-quote-text', root)
    const source = quote.innerHTML
    let lineTween = null, splitW = 0
    const splitLines = () => {
      quote.innerHTML = source.replace(/<span class="lx-hang">“<\/span>/, '\u0001').split(/\s+/).map((w) => `<span class="lx-qw">${w.replace('\u0001', '<span class="lx-hang">“</span>')}</span>`).join(' ')
      const qw = $$('.lx-qw', quote), lines = []
      let top = null
      qw.forEach((w) => { const t = Math.round(w.offsetTop); if (top === null || Math.abs(t - top) > 4) { lines.push([]); top = t } lines[lines.length - 1].push(w.innerHTML) })
      quote.innerHTML = lines.map((l) => `<span class="lx-line"><span class="lx-line-in">${l.join(' ')}</span></span>`).join('')
      splitW = quote.clientWidth
    }
    const buildQuote = () => {
      const p = lineTween ? lineTween.progress() : 0
      if (lineTween) { lineTween.scrollTrigger?.kill(); lineTween.kill() }
      splitLines()
      lineTween = gsap.fromTo($$('.lx-line-in', quote), { yPercent: 105 }, { yPercent: 0, stagger: 0.1, ease: E.quint, scrollTrigger: { trigger: '.lx-note', start: 'top 85%', end: 'top 5%', scrub } })
      lineTween.progress(p)
    }
    buildQuote()
    let qT = 0
    track(window, 'resize', () => { clearTimeout(qT); qT = setTimeout(() => { if (Math.abs(quote.clientWidth - splitW) > 1) { quote.innerHTML = source; buildQuote(); ScrollTrigger.refresh() } }, 180) })
    lxKill.push(() => { clearTimeout(qT); quote.innerHTML = source })
    document.fonts?.ready.then(() => { if (root.isConnected && document.body.dataset.page === 'legacy') { quote.innerHTML = source; buildQuote() } })
    arrive('.lx-note > .lx-caps', '.lx-note', {}, 'top 95%', 'top 40%')
    gsap.timeline({ scrollTrigger: { trigger: '.lx-note', start: 'top top', end: '+=140%', pin: true, scrub } })
      .fromTo('.lx-sign-pen', { strokeDasharray: '1 2', strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8, ease: 'power1.inOut' }, 0.1)
      .fromTo('.lx-sign-flourish', { strokeDasharray: '1 2', strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' }, 0.85)
      .add(() => {}, 1.6)

    // ---- 10 Sunrise.
    arrive('.lx-finale h2', '.lx-finale', { y: 120 }, 'top 95%', 'top 20%')
    gsap.fromTo('.lx-sky-warm', { opacity: 0 }, { opacity: 0.45, ease: 'none', scrollTrigger: { trigger: '.lx-finale', start: 'top 40%', end: 'top top', scrub } })
    // The note steps back as the night comes in (dark ink on a darkening sky would vanish anyway).
    gsap.to('.lx-note > *', { opacity: 0, y: -40, ease: 'power2.in', scrollTrigger: { trigger: '.lx-film', start: 'top 95%', end: 'top 45%', scrub } })
    arrive('.lx-film-poster', '.lx-film', { y: 110, scale: 0.94 }, 'top 85%', 'top 25%')
    arrive('.lx-film-copy > *', '.lx-film', {}, 'top 70%', 'top 15%')
    gsap.fromTo('.lx-pledges li:first-child', ...lxFT({ y: 70, opacity: 0, ease: E.quint, scrollTrigger: { trigger: '.lx-finale', start: 'top 45%', end: 'top 5%', scrub } }))
    gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.lx-finale', start: 'top top', end: '+=220%', pin: true, scrub } })
      .fromTo('.lx-sunrise', { y: () => innerHeight * 0.18 }, { y: 0, duration: 2, ease: 'power2.out' }, 0)
      .fromTo('.lx-sunrays', { opacity: 0 }, { opacity: 1, duration: 1.2 }, 0.3)
      .fromTo('.lx-sky-warm', { opacity: 0.45 }, { opacity: 1, duration: 1.4, immediateRender: false }, 0)
      .fromTo('.lx-orchard', { yPercent: 14 }, { yPercent: 0, duration: 2.5, ease: 'power2.out' }, 0)
      .fromTo('.lx-pledges li:not(:first-child)', ...lxFT({ y: 70, opacity: 0, stagger: 0.4, duration: 0.5, ease: E.quint }), 0.1)
      .fromTo('.lx-finale-actions > *', ...lxFT({ y: 50, opacity: 0, stagger: 0.12, duration: 0.4, ease: E.quint }), 1.5)
      .fromTo('.lx-bye', ...lxFT({ opacity: 0, y: 30, duration: 0.4 }), 1.9)
      .add(() => {}, 2.8)

    // ---- The backdrop: one fixed layer whose colour follows the scroll continuously between scenes (no seams), with the
    // note's paper and a soft glow faded in by the same measure. HUD and cursor ink follow the scene in mid-screen.
    const COLORS = { 1: '#0b1f15', 2: '#0b1f15', 3: '#174631', 4: '#ffb81f', 5: '#f6efdc', 6: '#f6efdc', 7: '#0b1f15', 8: '#174631', 9: '#f6efdc', 10: '#0b1f15', 11: '#0b1f15' }
    const GLOW = { 3: 1, 7: 0.8, 8: 0.5 }
    const PAPER = { 9: 1 }
    const INK = { 4: true, 5: true, 6: true, 9: true }
    const bg = $('.lx-bg', root), glow = $('.lx-bg-glow', root), paper = $('.lx-bg-paper', root)
    const setUi = (ink) => root.classList.toggle('lx-ink', ink)
    const sceneEls = $$('[data-lx-scene]', root)
    // Each scene's colour washes in while its top crosses the middle 60% of the screen (after any pin before it).
    // Hand-overs into a full-colour scene are quicker, so mixed in-between tones never linger.
    const WINDOW = { 4: ['top 95%', 'top 45%'], 5: ['top 100%', 'top 45%'], 7: ['top 90%', 'top 45%'], 10: ['top 80%', 'top 40%'] }
    const fades = sceneEls.slice(1).map((s) => { const [start, end] = WINDOW[s.dataset.lxScene] || ['top 75%', 'top 20%']; return ScrollTrigger.create({ trigger: s, start, end }) })
    let painted = ''
    const paint = () => {
      let n = Number(sceneEls[0].dataset.lxScene), prev = n, k = 1
      fades.forEach((f, i) => {
        const m = Number(sceneEls[i + 1].dataset.lxScene)
        if (f.progress > 0) { prev = n; n = m; k = f.progress }
      })
      const c = k >= 1 ? COLORS[n] : gsap.utils.interpolate(COLORS[prev], COLORS[n], k)
      const g = (GLOW[prev] || 0) + ((GLOW[n] || 0) - (GLOW[prev] || 0)) * k
      const pa = (PAPER[prev] || 0) + ((PAPER[n] || 0) - (PAPER[prev] || 0)) * k
      const key = `${c}|${g.toFixed(3)}|${pa.toFixed(3)}`
      if (key === painted) return
      painted = key
      bg.style.backgroundColor = c
      glow.style.opacity = g.toFixed(3)
      paper.style.opacity = pa.toFixed(3)
    }
    paint()
    ScrollTrigger.addEventListener('refresh', paint)
    lxKill.push(() => ScrollTrigger.removeEventListener('refresh', paint))
    ScrollTrigger.create({ trigger: root, start: 'top top', end: 'bottom bottom', onUpdate: paint })
    sceneEls.forEach((s, k) => {
      const n = Number(s.dataset.lxScene), next = sceneEls[k + 1]
      ScrollTrigger.create({ trigger: s, start: 'top 50%', ...(next ? { endTrigger: next, end: 'top 50%' } : { end: 'bottom 50%' }), onToggle: (self) => {
        if (!self.isActive) return
        sceneNow = n
        hudLabel()
        if (n !== 5) setUi(Boolean(INK[n]))
      } })
    })
    panels.forEach((p, i) => ScrollTrigger.create({ trigger: i ? holds[i - 1] : vows, start: i ? 'bottom 50%' : 'top 50%', endTrigger: holds[i], end: 'bottom 50%', onToggle: (self) => { if (self.isActive) setUi(p.dataset.ui === 'ink') } }))
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
    const labelFor = (el) => {
      const t = el instanceof Element ? el.closest('a, button, [data-lx-cursor]') : null
      return t ? (t.dataset.lxCursor || 'open') : (el instanceof Element && el.closest('.lx-open, .lx-promise') ? 'scroll' : '')
    }
    const setLabel = (label) => {
      cur.classList.toggle('is-big', Boolean(label))
      if (label && word.textContent !== label) word.textContent = label
    }
    track(window, 'pointermove', (e) => {
      p.x = e.clientX; p.y = e.clientY
      cur.classList.add('is-on')
      setLabel(labelFor(e.target))
    }, { passive: true })
    track(document, 'pointerleave', () => cur.classList.remove('is-on'))
    // The word follows what is under the pointer after a scroll too, not only after a move.
    track(window, 'scroll', () => setLabel(labelFor(document.elementFromPoint(p.x, p.y))), { passive: true })
    loop(() => {
      rp.x += (p.x - rp.x) * 0.16; rp.y += (p.y - rp.y) * 0.16
      dot.style.transform = `translate3d(${p.x}px,${p.y}px,0)`
      ring.style.transform = `translate3d(${rp.x}px,${rp.y}px,0)`
    })
    $$('[data-lx-magnet]', root).forEach((b) => {
      const inner = b.firstElementChild
      track(b, 'pointermove', (e) => {
        const r = b.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2
        gsap.to(b, { x: x * 0.3, y: y * 0.4, duration: 0.6, ease: 'power3.out' })
        gsap.to(inner, { x: x * 0.12, y: y * 0.16, duration: 0.6, ease: 'power3.out' })
      })
      track(b, 'pointerleave', () => { gsap.to([b, inner], { x: 0, y: 0, duration: 1, ease: 'elastic.out(1,0.35)' }) })
    })
  }

  document.fonts?.ready.then(() => {
    if (document.body.dataset.page !== 'legacy' || !root.isConnected) return
    $$('[data-lx-to]', root).forEach((el) => lxSlotFit(el, el.dataset.lxTo))
    ScrollTrigger.refresh()
  })
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
