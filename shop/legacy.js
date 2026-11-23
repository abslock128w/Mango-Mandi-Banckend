/* Our legacy: load everything first, then "Fifty summers", then the film, played by itself.

   1. Loading (cheap on purpose): a flat night screen with "50 summers" set as plain type, one thin line and
      "Loading… 62%". Nothing else moves; the line is a CSS transform. Behind it, all the heavy work, in real steps with a
      pause for the browser between them: the film (One Mango, built from mango-journey/ into shop/one-mango/ and played
      in a frame) fetches its code, builds every chapter, compiles every shader, uploads every texture and prepares its
      music; and this page decodes its photo, loads its fonts, makes its grain, sets up its pollen (drawn in a worker
      where the browser can) and builds its timelines, and paints the first screen once, hidden, so its first frame has
      nothing left to draw from scratch.
   2. Only then does "Fifty summers" appear: its entrance runs on an idle main thread. A "Begin the film" button comes
      with it; Begin (or, a few seconds after the entrance, nobody having pressed it: muted) flies the camera through the
      zero of the 50 into the film, which then plays on its own with small controls of its own. Nothing scrolls.
   3. Leaving the page parks the film (paused, drawing nothing, music held) for a few minutes: coming back within that
      time skips its loading. After that it is closed and its graphics memory given back.
   /legacy/story and /legacy/film are older addresses; both open this page.

   Static (.lx-static, the fallback): prefers-reduced-motion, no GSAP, or anything in the motion setup throwing. The
   opening is a still, and plain buttons open the film's own page ("Play the film") or its long-form version.
   Styles: shop/legacy.css (.lx-, .lxo-). Loaded after pages.js (it adds to PAGES) and before app.js. */

PAGES.push([/^\/legacy(?:\/(story|film))?\/?$/, (m) => legacyView(m[1] || '')])

const LX_TITLE = 'Our legacy · VMR Mangoes'
const LX_HOME_TITLE = document.title
const LXO_SRC = '/one-mango/index.html?embed=1'
const LX_AUTO = 3000 // ms after the entrance: nobody pressed Begin, so the film starts by itself (muted)
const LX_FLY = 1.6 // s: the fly-through the zero into the film
const LX_PARK = 180000 // ms a parked film is kept for a return visit

let lxKill = []

function legacyView(at = '') {
  lxStop()
  if (at) history.replaceState(history.state, '', '/legacy' + location.search)
  document.title = LX_TITLE
  host().innerHTML = lxMarkup()
  document.documentElement.classList.add('lx-on')
  const root = $('.lx')
  if (lxMotionOk()) {
    try { lxRun(root, { soon: at === 'film' }); return } catch (err) {
      // Anything going wrong in the motion setup leaves the static page: the opening as a still and a plain way to the film.
      console.warn('Legacy page: motion off', err)
      lxStop({ keepPage: true })
      root.classList.remove('lx-motion', 'lx-fine')
    }
  }
  lxPlain(root)
}

const lxMotionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches && Boolean(window.gsap)
const lxYield = () => (window.scheduler && scheduler.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0)))
const lxFrames = (n = 1) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) })
const lxTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))])

/** Letters as spans, each inside its own mask (they rise from behind a baseline). */
const lxLetters = (text) => [...text].map((c) => `<span class="lx-chm"><span class="lx-ch">${c === ' ' ? '&nbsp;' : c}</span></span>`).join('')

function lxMarkup() {
  return `<article class="lx" aria-label="Our legacy: fifty summers, then One Mango">
<div class="lx-boot" data-lx-boot role="status" aria-live="polite">
  <p class="lx-boot-title" aria-hidden="true"><span>50</span> <em>summers</em></p>
  <p class="lx-boot-line"><span class="lx-boot-bar" aria-hidden="true"><i data-lx-boot-bar></i></span><span data-lx-boot-text>Loading…</span></p>
</div>
<div class="lx-grain" aria-hidden="true"></div>
<div class="lx-cursor" aria-hidden="true"><span class="lx-cursor-dot"></span><span class="lx-cursor-ring"><b class="lx-cursor-word"></b></span></div>

<section class="lx-scene lx-open" aria-labelledby="lx-title">
  <canvas class="lx-pollen" aria-hidden="true"></canvas>
  <canvas class="lx-pollen is-near" aria-hidden="true"></canvas>
  <div class="lx-vignette" aria-hidden="true"></div>
  <p class="lx-caps lx-open-caps">VMR Mangoes · Since 1976</p>
  <h1 id="lx-title" class="lx-open-title" tabindex="-1"><span class="lx-sr">Fifty summers. One promise.</span>
    <span class="lx-fifty-wrap" aria-hidden="true"><span class="lx-fifty is-outline"><span>5</span><span>0</span></span><span class="lx-fifty is-photo"><span class="lx-d5">5</span><span class="lx-d0">0</span></span></span>
    <span class="lx-summers" aria-hidden="true">${lxLetters('summers')}</span>
  </h1>
  <p class="lx-open-promise" aria-hidden="true">One promise.</p>
  <div class="lx-load" data-lx-load>
    <button class="lx-begin" type="button" data-lx-begin data-lx-cursor="begin"><span data-lx-begin-text>Begin the film</span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.500v13l10-6.500z"/></svg></button>
    <div class="lx-load-side">
      <p class="lx-load-line" role="status" aria-live="polite" data-lx-load-text>Quiet music · two minutes · it plays by itself</p>
    </div>
  </div>
  <div class="lx-open-fade" aria-hidden="true"></div>
</section>

<section class="lxo-reel" id="film" data-lxo-reel aria-labelledby="lxo-title">
  <h2 class="lx-sr" id="lxo-title">One Mango: a mango’s journey from a seed to your door</h2>
  <div class="lxo-plain" hidden>
    <p class="lx-caps">One Mango · a short film</p>
    <p class="lxo-plain-title">One mango, <em>from seed to table.</em></p>
    <div class="lxo-plain-go"><a class="lx-btn is-solid" href="/one-mango/index.html?play"><span>Play the film</span></a><a class="lx-btn is-line" href="/one-mango/index.html?still"><span>Read it as a story</span></a></div>
  </div>
</section>
</article>`
}

/** Static: the opening as a still, then plain ways to the film's own page. */
function lxPlain(root) {
  root.classList.add('lx-static')
  $('[data-lx-boot]', root)?.remove()
  $('[data-lx-load]', root).hidden = true
  $('[data-lxo-reel]', root).classList.add('is-plain')
  $('.lxo-plain', root).hidden = false
}

// ---- The film's frame. It lives outside the page view (a fixed layer under the shop's pages), so it can outlive a
// visit: leaving parks it, coming back within LX_PARK finds it ready. Only one exists.
const lxFilm = { host: null, frame: null, parkT: 0 }
const lxFilmMM = () => { try { return lxFilm.frame && lxFilm.frame.contentWindow && lxFilm.frame.contentWindow.__mm } catch { return null } }
function lxFilmOpen() {
  clearTimeout(lxFilm.parkT)
  if (lxFilm.frame && lxFilm.frame.isConnected && !(lxFilmMM() && lxFilmMM().destroyed)) return lxFilm.frame
  lxFilmClose()
  const h = lxFilm.host = document.createElement('div')
  h.className = 'lxo-host'
  const f = lxFilm.frame = document.createElement('iframe')
  f.className = 'lxo-frame'
  f.title = 'One Mango: a short film, from a seed in the dark to a bowl on your counter'
  f.allow = 'autoplay'
  f.tabIndex = -1
  f.src = LXO_SRC
  h.appendChild(f)
  document.body.prepend(h)
  return f
}
function lxFilmPark() {
  if (!lxFilm.host) return
  try { lxFilmMM()?.park?.() } catch {}
  lxFilm.host.classList.add('is-parked')
  lxFilm.host.classList.remove('is-docked')
  lxFilm.frame.tabIndex = -1
  clearTimeout(lxFilm.parkT)
  lxFilm.parkT = setTimeout(lxFilmClose, LX_PARK)
}
function lxFilmClose() {
  clearTimeout(lxFilm.parkT)
  // The film stops its loop and its music and gives its graphics context back before the frame goes.
  try { lxFilmMM()?.destroy?.() } catch {}
  lxFilm.host?.remove()
  lxFilm.host = lxFilm.frame = null
}

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
   motes on their own canvas, no trails, drifting faster); pushed by the pointer. The drawing itself (lxPollenEngine)
   knows nothing of the page, so it can run in a worker on OffscreenCanvas: then the first screen keeps drifting at
   full speed while the film loads on the main thread. Where a browser cannot do that it runs here instead.
   Paused off-screen and in a hidden tab, and for good once the film is on screen (halt). */
function lxPollenEngine(canvas, near, opts) {
  const ctx = canvas.getContext('2d'), nctx = near.getContext('2d'), noise = lxNoise()
  let w = 0, h = 0, dpr = 1, raf = 0, running = false, t = 0, phone = false, area = 1
  const ptr = { x: -9999, y: -9999 }
  const parts = [], motes = []
  const spawn = (p = {}, far = false) => Object.assign(p, { far, x: Math.random() * w, y: Math.random() * h, life: 80 + Math.random() * 260, age: 0, s: far ? 0.12 + Math.random() * 0.3 : 0.4 + Math.random() * 1.1, r: far ? 0.6 + Math.random() * 0.5 : Math.random() < 0.08 ? 1.9 : 0.8 + Math.random() * 1.1, a: far ? 0.18 + Math.random() * 0.25 : 0.3 + Math.random() * 0.6 })
  const mote = (m = {}) => Object.assign(m, { x: Math.random() * w, y: Math.random() * h, r: 6 + Math.random() * 16, vx: (Math.random() - 0.4) * 0.5, vy: -0.15 - Math.random() * 0.45, a: 0.08 + Math.random() * 0.16, ph: Math.random() * 6 })
  const sprite = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(64, 64) : document.createElement('canvas')
  sprite.width = sprite.height = 64
  const sg = sprite.getContext('2d'), grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,214,120,1)'); grad.addColorStop(0.45, 'rgba(255,190,80,.45)'); grad.addColorStop(1, 'rgba(255,184,31,0)')
  sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64)
  const size = (W, H, DPR, vw, vh) => {
    dpr = DPR; w = W; h = H; phone = vw < 760
    area = Math.max(0.4, Math.min(3.2, (vw * vh) / (1440 * 900)))
    for (const [c, g] of [[canvas, ctx], [near, nctx]]) {
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr))
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    ctx.fillStyle = '#0b1f15'; ctx.fillRect(0, 0, w, h)
    const want = Math.round((phone ? 900 : 2600) * area), far = Math.round(want * 0.45)
    parts.length = 0
    for (let i = 0; i < want; i++) parts.push(spawn({}, i < far))
    motes.length = 0
    for (let i = 0; i < Math.round((phone ? 12 : 30) * Math.sqrt(area)); i++) motes.push(mote())
  }
  const LEVELS = 10, COLS = ['rgba(255,214,150,', 'rgba(255,190,70,', 'rgba(255,220,120,'], paths = new Array(3 * LEVELS).fill(null)
  const frame = () => {
    raf = opts.raf(frame)
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
      // batched: every mote joins one of a few paths by colour and (quantised) brightness, a handful of fills a frame
      // instead of one per mote (thousands of draw calls a frame were the costliest thing on this screen)
      const k = (p.far ? 0 : p.r > 1.5 ? 2 : 1) * LEVELS + Math.min(LEVELS - 1, Math.round(p.a * fade * (LEVELS - 1)))
      const path = paths[k] || (paths[k] = new Path2D())
      path.rect(p.x, p.y, p.r, p.r)
    }
    for (let k = 0; k < paths.length; k++) {
      if (!paths[k]) continue
      ctx.fillStyle = COLS[Math.floor(k / LEVELS)] + ((k % LEVELS) / (LEVELS - 1)).toFixed(3) + ')'
      ctx.fill(paths[k])
      paths[k] = null
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
  return {
    size,
    ptr: (x, y) => { ptr.x = x; ptr.y = y },
    run: (on) => { if (on && !running) { running = true; raf = opts.raf(frame) } else if (!on && running) { running = false; opts.caf(raf) } },
  }
}

/** The worker's side: the same engine, on the canvases handed over to it. */
function lxPollenWorker() {
  let eng = null
  const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(f, 16)
  const caf = self.cancelAnimationFrame ? (id) => self.cancelAnimationFrame(id) : (id) => clearTimeout(id)
  // frame times, kept for measuring (lxPollen's stats())
  const dts = []
  let last = 0
  const tick = (f) => (now) => { if (last) { dts.push(now - last); if (dts.length > 4000) dts.shift() } last = now; f(now) }
  const raf0 = raf
  self.onmessage = ({ data: d }) => {
    if (d.stats) { self.postMessage({ dts: dts.slice() }); return }
    if (d.canvas) eng = lxPollenEngine(d.canvas, d.near, { raf: (f) => raf0(tick(f)), caf })
    if (!eng) return
    if (d.size) eng.size(...d.size)
    if (d.ptr) eng.ptr(...d.ptr)
    if (typeof d.run === 'boolean') eng.run(d.run)
  }
}

function lxPollen(canvas, near, track) {
  // drawn at one canvas pixel per CSS pixel whatever the screen: soft glowing dust loses nothing, and a 2x screen would
  // otherwise fill four times the pixels on every frame (it was the costliest thing on this screen)
  const measure = () => [canvas.clientWidth, canvas.clientHeight, 1, innerWidth, innerHeight]
  let send, worker = null
  try {
    if (!(window.Worker && window.OffscreenCanvas && canvas.transferControlToOffscreen && typeof OffscreenCanvas.prototype.getContext === 'function')) throw 0
    const code = `${lxNoise};${lxPollenEngine};(${lxPollenWorker})()`
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
    const off = canvas.transferControlToOffscreen(), offNear = near.transferControlToOffscreen()
    worker.postMessage({ canvas: off, near: offNear }, [off, offNear])
    send = (m) => { if (worker) worker.postMessage(m) }
  } catch {
    worker = null
    const eng = lxPollenEngine(canvas, near, { raf: (f) => requestAnimationFrame(f), caf: (id) => cancelAnimationFrame(id) })
    send = (m) => { if (m.size) eng.size(...m.size); if (m.ptr) eng.ptr(...m.ptr); if (typeof m.run === 'boolean') eng.run(m.run) }
  }
  send({ size: measure() })
  let running = false, halted = false, visible = true, held = true // held: set up, not drawing until go()
  const run = (on) => { on = on && !halted && !held && visible && !document.hidden; if (on !== running) { running = on; send({ run: on }) } }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(true) })
  io.observe(canvas)
  let lastMove = 0
  const move = (e) => {
    const now = performance.now()
    if (now - lastMove < 16) return
    lastMove = now
    const r = canvas.getBoundingClientRect(); send({ ptr: [e.clientX - r.left, e.clientY - r.top] })
  }
  const leave = () => send({ ptr: [-9999, -9999] })
  const vis = () => run(true)
  let resizeT = 0
  const resize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => send({ size: measure() }), 150) }
  track(window, 'pointermove', move, { passive: true })
  track(window, 'blur', leave)
  track(document, 'visibilitychange', vis)
  track(window, 'resize', resize)
  const halt = () => { halted = true; run(false); io.disconnect(); clearTimeout(resizeT); if (worker) { worker.terminate(); worker = null } }
  lxKill.push(halt)
  // Once the film has the screen, the pollen is gone for good: no frame loop left running under it.
  const stats = () => new Promise((res) => { if (!worker) return res(null); worker.onmessage = (e) => res(e.data.dts); worker.postMessage({ stats: true }) })
  window.__lxPollen = { stats, inWorker: Boolean(worker) }
  return { halt, go: () => { held = false; run(true) }, inWorker: Boolean(worker) }
}

/** Film grain: one tile of light and dark specks on transparency, made once (off the main thread's encoder), laid over
   the first screen with ordinary blending and cycled by CSS steps on the compositor. (It used to be an opaque grey
   noise blended with mix-blend-mode: overlay over a layer more than twice the screen: a full-screen blend every frame.) */
function lxGrain(el) {
  const c = document.createElement('canvas'), S = 256
  c.width = c.height = S
  const x = c.getContext('2d'), img = x.createImageData(S, S)
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0, l = v > 127 ? 255 : 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = l; img.data[i + 3] = Math.abs(v - 127) * 0.32 | 0 }
  x.putImageData(img, 0, 0)
  return new Promise((res) => c.toBlob((b) => { if (b) { const u = URL.createObjectURL(b); el.style.backgroundImage = `url(${u})`; lxKill.push(() => URL.revokeObjectURL(u)) } res() }, 'image/png'))
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

/** The first screen: preloader, entrance, and the fly-through into the film (played on time, not on scroll).
 *  Returns { entrance: a promise for the end of the entrance, fly(): plays the fly-through (a promise for its end),
 *  quiet(): stops everything of this screen that draws (the film has the screen now) }. */
/** The motion page: load everything behind the cheap loading screen, then the entrance, Begin, the fly-through, the film. */
function lxRun(root, { soon = false } = {}) {
  const html = document.documentElement
  const fine = matchMedia('(pointer: fine)').matches && !matchMedia('(hover: none)').matches
  root.classList.add('lx-motion')
  if (fine) root.classList.add('lx-fine')
  html.classList.add('lx-stage', 'lx-booting')
  scrollTo(0, 0)
  // The page view's entrance (liquid.js) is a transform: finish it so the fly-through measures the real layout.
  $('#page-view').getAnimations?.().forEach((a) => a.finish())
  const listeners = []
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); listeners.push(() => target.removeEventListener(type, fn, opts)) }
  const timers = { auto: 0 }
  let stopCursor = () => {}, pollen = null, ctx = null, alive = true
  lxKill.push(() => {
    alive = false
    listeners.forEach((f) => f()); clearTimeout(timers.auto); stopCursor()
    html.classList.remove('lx-stage', 'lx-booting', 'lx-prepaint', 'lx-filming', 'lxo-near', 'lxo-docked')
    lxFilmPark() // paused and hidden: a return visit within a few minutes finds it ready
  })

  // ---- 1 Loading: real steps on both sides, one line and a number.
  const bootBar = $('[data-lx-boot-bar]', root), bootText = $('[data-lx-boot-text]', root)
  const PAGE_STEPS = 5, FILM_STEPS = 25 // the film reports its own 25 steps as a fraction
  let pageDone = 0, filmF = 0, shownPct = -1, failed = false
  const progress = () => {
    const f = Math.min(1, (pageDone + filmF * FILM_STEPS) / (PAGE_STEPS + FILM_STEPS)), pct = Math.floor(f * 100)
    if (pct === shownPct) return
    shownPct = pct
    bootBar.style.transform = `scaleX(${f.toFixed(3)})`
    bootText.textContent = `Loading… ${pct}%`
  }
  const step = () => { pageDone++; progress() }
  progress()

  const frame = lxFilmOpen()
  lxFilm.host.classList.remove('is-parked', 'is-docked')
  let filmReady = null
  const filmReadyP = new Promise((r) => { filmReady = r })
  const mm0 = lxFilmMM()
  if (mm0 && mm0.ready && !mm0.destroyed) { filmF = 1; progress(); filmReady() } // a return visit: still warm
  else if (mm0 && mm0.state === 'still') { failed = true; filmReady() }
  const loadEl = $('[data-lx-load]', root), beginB = $('[data-lx-begin]', root), beginT = $('[data-lx-begin-text]', root), loadText = $('[data-lx-load-text]', root)
  let docked = false
  on(window, 'message', (e) => {
    if (e.origin !== location.origin || !lxFilm.frame || e.source !== lxFilm.frame.contentWindow || !e.data || e.data.type !== 'one-mango') return
    const d = e.data
    if (typeof d.load === 'number') { filmF = Math.max(filmF, d.load); progress() }
    if (d.ready) { filmF = 1; progress(); filmReady() }
    if (d.failed || d.still) { failed = true; filmReady() }
    if (typeof d.ui === 'boolean' && docked) html.classList.toggle('lx-head-away', !d.ui)
    // a shop page asked for from inside the film: the shop's own router (pages.js go)
    if (typeof d.go === 'string' && d.go.startsWith('/')) { if (typeof window.go === 'function') window.go(d.go); else location.href = d.go }
  })

  // This page's own preparation, in steps, sharing the main thread politely with the film's.
  const keep = [] // decoded images stay referenced, so they stay decoded
  const prepare = async () => {
    await lxTimeout(Promise.all(['400 100px "Young Serif"', 'italic 400 100px "Young Serif"', '700 16px Figtree', '500 16px Figtree'].map((f) => document.fonts.load(f))).catch(() => {}), 4000)
    step(); await lxYield()
    const img = new Image()
    img.src = '/assets/hero.webp'
    keep.push(img)
    await lxTimeout(img.decode().catch(() => {}), 6000)
    step(); await lxYield()
    await lxGrain($('.lx-grain', root))
    step(); await lxYield()
    pollen = lxPollen($('.lx-pollen', root), $('.lx-pollen.is-near', root), on)
    step(); await lxYield()
  }

  // ---- 2 The opening: entrance, Begin, fly-through (built now, played later).
  let intro = null, zoom = null, entered = false
  ctx = gsap.context(() => {
    const E = { out: 'expo.out', quint: 'power4.out' }
    intro = gsap.timeline({ paused: true, onComplete: () => { entered = true; afterEntrance() } })
    intro.fromTo('.lx-fifty.is-photo', { scale: 1.18, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.8, ease: E.out }, 0)
      .fromTo('.lx-fifty.is-outline', ...lxFT({ scale: 0.9, opacity: 0, duration: 2.2, ease: E.out }), 0.15)
      .fromTo('.lx-summers .lx-ch', ...lxFT({ yPercent: 105, duration: 1.15, stagger: 0.06, ease: E.out }), 0.35)
      .fromTo('.lx-open-caps, .lx-open-promise, .lx-load', ...lxFT({ opacity: 0, y: 16, duration: 1, stagger: 0.12, ease: E.quint }), 0.8)
    const origin = () => {
      const f = $('.lx-fifty.is-photo', root), z = $('.lx-d0', root)
      const a = f.getBoundingClientRect(), b = z.getBoundingClientRect()
      return `${((b.left + b.width * 0.5 - a.left) / a.width) * 100}% ${((b.top + b.height * 0.56 - a.top) / a.height) * 100}%`
    }
    // The fly-through: the camera passes through the zero of the 50 into the film, which sits on its fixed layer
    // behind the opening: the opening's night (pollen, vignette) is cut away inside the zero's ring, so the film shows
    // through the hole and settles from a slight scale. Everything that moves here is a transform or an opacity on
    // its own layer (set up before the entrance, below), and the hole is a mask on the night's layers.
    const open = $('.lx-open', root), zero = $('.lx-d0', root), photoEl = $('.lx-fifty.is-photo', root)
    let holed = false, gone = false
    const hole = (t) => {
      if (!gone && t > 0.74) { gone = true; photoEl.style.visibility = 'hidden' }
      const k = Math.min(1, Math.max(0, (t - 0.1) / 0.2))
      if (k <= 0) { if (holed) { holed = false; open.classList.remove('is-holed') } return }
      const r = zero.getBoundingClientRect(), o = open.getBoundingClientRect()
      const s = open.style
      s.setProperty('--hcx', `${(r.left + r.width * 0.56 - o.left).toFixed(1)}px`)
      s.setProperty('--hcy', `${(r.top + r.height * 0.56 - o.top).toFixed(1)}px`)
      s.setProperty('--hrx', `${(r.width * 0.25 * k).toFixed(1)}px`)
      s.setProperty('--hry', `${(r.height * 0.3 * k).toFixed(1)}px`)
      if (!holed) { holed = true; open.classList.add('is-holed') }
    }
    lxKill.push(() => { open.classList.remove('is-holed'); photoEl.style.visibility = '' })
    const T0 = 0.001
    zoom = gsap.timeline({ paused: true, onUpdate() { hole(this.progress()) } })
      .fromTo('.lx-summers', { yPercent: 0, opacity: 1 }, { yPercent: 50, opacity: 0, ease: 'power2.in', duration: 0.3, immediateRender: false }, T0)
      .fromTo('.lx-open-caps, .lx-open-promise, .lx-load', { opacity: 1, y: 0 }, { opacity: 0, y: -30, duration: 0.22, immediateRender: false }, T0)
      .fromTo('.lx-fifty.is-outline', { scale: 1, opacity: 1 }, { scale: 2.4, opacity: 0, duration: 0.5, ease: 'power2.in', immediateRender: false }, T0)
      .fromTo('.lx-fifty.is-photo', { scale: 1, transformOrigin: origin }, { scale: 22, ease: 'power3.in', duration: 0.74, transformOrigin: origin, immediateRender: false }, 0.04)
      .fromTo('.lx-pollen, .lx-vignette, .lx-open-fade, .lx-grain', { opacity: 1 }, { opacity: 0, duration: 0.14, ease: 'power1.inOut', immediateRender: false }, 0.58)
      .fromTo(lxFilm.host, { scale: 1.14 }, { scale: 1, duration: 0.7, ease: 'power2.out', immediateRender: false }, 0.3)
      .fromTo('.lx-fifty.is-photo', { opacity: 1 }, { opacity: 0, duration: 0.12, immediateRender: false }, 0.6)
      .add(() => {}, 1)
  }, root)
  lxKill.push(() => ctx.revert())

  // ---- Into the film: start it (from inside the click when there is one, so its music may start: browsers allow
  // sound only from a gesture), fly through the zero, hand it the screen, the pointer and the keys.
  let flying = false
  const go = async (withSound) => {
    if (flying || !alive) return
    if (failed) { location.href = '/one-mango/index.html?still'; return }
    flying = true
    clearTimeout(timers.auto)
    if (!entered) intro.progress(1)
    try { lxFilmMM().begin({ sound: withSound }) } catch (e) { console.warn('One Mango: begin', e) }
    html.classList.add('lxo-near')
    await new Promise((res) => gsap.to(zoom, { progress: 1, duration: soon ? 1.2 : LX_FLY, ease: 'power1.inOut', onComplete: res }))
    if (!alive) return
    docked = true
    html.classList.add('lxo-docked', 'lx-filming')
    lxFilm.host.classList.add('is-docked')
    pollen && pollen.halt(); stopCursor() // the film has the screen: nothing of the first screen draws any more
    try { lxFilm.frame.tabIndex = 0; lxFilm.frame.focus({ preventScroll: true }) } catch {}
  }
  on(beginB, 'click', () => go(true))
  const afterEntrance = () => {
    if (failed) { loadText.textContent = 'The film cannot play on this device'; beginT.textContent = 'Read it as a story'; return }
    if (/[?&]lxhold\b/.test(location.search)) return // ?lxhold: stay on this screen (measuring it)
    timers.auto = setTimeout(() => go(false), soon ? 800 : LX_AUTO)
  }

  // Keys pressed on this page (the frame does not have focus) go to the film once it has the screen.
  on(window, 'keydown', (e) => {
    if (!docked || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof Element && e.target.closest('header, nav, .liquid-navigation, input, textarea, select, [contenteditable]')) return
    const mm = lxFilmMM()
    try { if (mm && mm.ui && mm.ui.key(e.key, null)) e.preventDefault() } catch {}
  })
  // Nothing scrolls here; a wheel on the opening points at the Begin button.
  const mine = (e) => e.target instanceof Element && root.contains(e.target)
  on(window, 'wheel', (e) => { if (docked || !mine(e)) return; e.preventDefault(); if (html.classList.contains('lx-booting')) return; beginB.classList.remove('is-nudge'); void beginB.offsetWidth; beginB.classList.add('is-nudge') }, { passive: false })
  on(window, 'touchmove', (e) => { if (mine(e) && e.cancelable) e.preventDefault() }, { passive: false })

  // ---- 3 When everything is ready: paint the first screen once, hidden under the loading screen (every layer of
  // the entrance is made and drawn now, not on its first frame), then let the loading screen go and play the entrance.
  const reveal = async () => {
    const layers = $$('.lx-fifty, .lx-summers .lx-ch, .lx-open-caps, .lx-open-promise, .lx-load', root)
    layers.forEach((el) => { el.style.willChange = 'transform, opacity' })
    html.classList.add('lx-prepaint')
    intro.progress(1, true) // (no callbacks: this is only a paint)
    await lxFrames(3)
    intro.progress(0, true)
    await lxFrames(2)
    step()
    if (!alive) return
    html.classList.remove('lx-booting', 'lx-prepaint')
    pollen && pollen.go()
    intro.play()
    if (fine) stopCursor = lxCursor(root, on)
    if (failed) loadEl.classList.add('is-failed')
  }
  Promise.all([prepare(), filmReadyP]).then(() => alive && reveal())
}

/** The opening's cursor (fine pointers only): a dot, and a ring that follows it and names what is under it. */
function lxCursor(root, on) {
  const cur = $('.lx-cursor', root), dot = $('.lx-cursor-dot', cur), ring = $('.lx-cursor-ring', cur), word = $('.lx-cursor-word', cur)
  const p = { x: innerWidth / 2, y: innerHeight / 2 }, rp = { x: p.x, y: p.y }
  let id = 0, idle = 0
  const setLabel = (el) => {
    const t = el instanceof Element ? el.closest('a, button, [data-lx-cursor]') : null
    const label = t ? (t.dataset.lxCursor || 'open') : ''
    cur.classList.toggle('is-big', Boolean(label))
    if (label && word.textContent !== label) word.textContent = label
  }
  // it only runs while it has somewhere to go: at rest, no frame loop at all
  const tick = () => {
    rp.x += (p.x - rp.x) * 0.16; rp.y += (p.y - rp.y) * 0.16
    dot.style.transform = `translate3d(${p.x}px,${p.y}px,0)`
    ring.style.transform = `translate3d(${rp.x}px,${rp.y}px,0)`
    idle = Math.abs(p.x - rp.x) + Math.abs(p.y - rp.y) < 0.3 ? idle + 1 : 0
    id = idle > 2 ? 0 : requestAnimationFrame(tick)
  }
  on(window, 'pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; cur.classList.add('is-on'); setLabel(e.target); if (!id) { idle = 0; id = requestAnimationFrame(tick) } }, { passive: true })
  on(document, 'pointerleave', () => cur.classList.remove('is-on'))
  return () => { cancelAnimationFrame(id); id = 0; cur.classList.remove('is-on') }
}

function lxStop({ keepPage = false } = {}) {
  const kills = lxKill
  lxKill = []
  kills.reverse().forEach((f) => { try { f() } catch {} })
  const html = document.documentElement
  html.classList.remove('lx-head-away')
  if (!keepPage) html.classList.remove('lx-on')
}

// Leaving the page: tear everything down (the film is parked), give the home page its title back, and let the shop's
// own scroll effects measure again.
window.addEventListener('mm:route', () => {
  if (document.body.dataset.page === 'legacy') return
  const was = lxKill.length || document.documentElement.classList.contains('lx-on')
  lxStop()
  if (document.title === LX_TITLE) document.title = LX_HOME_TITLE
  if (was && window.ScrollTrigger) requestAnimationFrame(() => ScrollTrigger.refresh())
})
