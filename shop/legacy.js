/* Our legacy: "50 years" first, at once; the film loads behind it and plays when it is ready.

   1. The opening, within about a second: this page's own light things only. Its fonts and its photo get at most
      LX_LIGHT to arrive (after that they swap in when they come); its pollen (drawn in a worker where the browser can)
      and its timelines are set up meanwhile, and its grain is made on the side. A plain night cover hides the first
      screen while it is painted once, so the entrance's first frame has nothing left to draw from scratch; then the
      cover fades and "50 years" makes its entrance. Nothing here waits on the film.
   2. The film (One Mango, built from mango-journey/ into shop/one-mango/ and played in a frame) is only asked for once
      the visitor is plainly staying: the entrance has played, the tab is in view, and they have been here LX_DWELL (or
      scrolled, swiped or pressed a key on the opening, or pressed Begin, which asks for it at once); then in an idle
      moment. The frame is same-origin, so the film shares this page's main thread while it loads: a quick visit never
      pays for it. It fetches its code, builds every chapter, compiles every shader, uploads every texture and prepares
      its music, and reports how far it is (a fraction, by message). The "Begin the film" button shows that ("Begin
      the film · loading 40%", filling as it goes); pressed early it says "Starting… 40%" and begins the moment the
      film is ready. No word from the film for LX_STALL and the line under it says it is still loading. Once ready,
      Begin (or, a few seconds after the entrance, nobody having pressed it: muted) flies the camera through the zero
      of the 50 into the film, which then plays on its own with small controls of its own. Nothing scrolls. The automatic start never fires before the film is ready.
   3. Not ready within LX_FILM_WAIT, or the film failing: the frame is dropped and the button becomes "Play the film",
      a plain link to the film's own page ("Read it as a story" where the film can only show its stills).
   4. Leaving the page (another route, the back button, or the tab going away: pagehide) stops everything this visit
      started, at once (lxStop): the film is closed (its loop, music and graphics context first, then the frame is
      blanked and removed, so a film still loading stops loading), and every listener, timer, frame callback, idle
      callback, tween, the pollen's worker and the photo preload go with it. Each visit is one handle (lxMount); a
      promise that settles after the visit is over (a font, the photo, a frame, the film's word) finds it ended and
      does nothing. Coming back mounts the page afresh.
   /legacy/story and /legacy/film are older addresses; both open this page.

   Static (.lx-static, the fallback): prefers-reduced-motion, no GSAP, or anything in the motion setup throwing. The
   opening is a still, and plain buttons open the film's own page ("Play the film") or its long-form version.
   Styles: shop/legacy.css (.lx-, .lxo-). Loaded after pages.js (it adds to PAGES) and before app.js. */

PAGES.push([/^\/legacy(?:\/(story|film))?\/?$/, (m) => legacyView(m[1] || '')])

const LX_TITLE = 'Our legacy · VMR Mangoes'
const LX_HOME_TITLE = document.title
const LXO_SRC = '/one-mango/index.html?embed=1'
const LX_AUTO = 3000 // ms after the entrance: nobody pressed Begin, so the film starts by itself (muted)
const LX_AUTO_MIN = 1200 // ms at least between the film being ready and starting by itself
const LX_FLY = 1.6 // s: the fly-through the zero into the film
const LX_DWELL = 1500 // ms on the page before the film is asked for (with the entrance played and the tab in view)
const LX_LIGHT = 800 // ms at most the opening waits for its own fonts and photo (after that they swap in as they come)
const LX_FILM_WAIT = 45000 // ms the film may take to be ready before the button opens the film's own page instead
const LX_STALL = 8000 // ms with no word from a loading film before the line says it is still loading
const LX_PLAY = '/one-mango/index.html?play', LX_STILL = '/one-mango/index.html?still'

/** One visit's handle. Everything the page starts goes through it (listeners on one AbortController, timers, frame and
   idle callbacks, and kills: what else to undo), so lxStop ends all of it at once. A timer or frame callback of an
   ended visit never runs, so the promises built on them (lxFrames, lxTimeout) never settle and nothing after them runs. */
let lxM = null
function lxMount() {
  const ac = new AbortController(), timers = new Set(), rafs = new Set(), idles = new Set(), kills = []
  const M = {
    kills,
    live: () => lxM === M,
    on: (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal }),
    timeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (M.live()) fn() }, ms); timers.add(id); return id },
    clear: (id) => { if (!id) return; clearTimeout(id); timers.delete(id) },
    raf: (fn) => { const id = requestAnimationFrame((t) => { rafs.delete(id); if (M.live()) fn(t) }); rafs.add(id); return id },
    idle: (fn, ms = 1000) => {
      if (!window.requestIdleCallback) return M.timeout(fn, 200)
      const id = requestIdleCallback(() => { idles.delete(id); if (M.live()) fn() }, { timeout: ms }); idles.add(id); return id
    },
    end: () => {
      ac.abort()
      timers.forEach((id) => clearTimeout(id)); rafs.forEach((id) => cancelAnimationFrame(id)); idles.forEach((id) => cancelIdleCallback(id))
      timers.clear(); rafs.clear(); idles.clear()
      kills.splice(0).reverse().forEach((f) => { try { f() } catch {} })
    },
  }
  return M
}

function legacyView(at = '') {
  lxStop()
  if (at) history.replaceState(history.state, '', '/legacy' + location.search)
  document.title = LX_TITLE
  host().innerHTML = lxMarkup()
  document.documentElement.classList.add('lx-on')
  const root = $('.lx')
  if (lxMotionOk()) {
    try { lxRun(root, lxM = lxMount(), { soon: at === 'film' }); return } catch (err) {
      // Anything going wrong in the motion setup leaves the static page: the opening as a still and a plain way to the film.
      console.warn('Legacy page: motion off', err)
      lxStop({ keepPage: true })
      root.classList.remove('lx-motion', 'lx-fine')
    }
  }
  lxPlain(root)
}

const lxMotionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches && Boolean(window.gsap)
const lxFrames = (M, n = 1) => new Promise((r) => { const f = () => (--n <= 0 ? r() : M.raf(f)); M.raf(f) })
const lxTimeout = (M, p, ms) => Promise.race([p, new Promise((r) => M.timeout(r, ms))])
const LX_PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.500v13l10-6.500z"/></svg>'

/** Letters as spans, each inside its own mask (they rise from behind a baseline). */
const lxLetters = (text) => [...text].map((c) => `<span class="lx-chm"><span class="lx-ch">${c === ' ' ? '&nbsp;' : c}</span></span>`).join('')

function lxMarkup() {
  return `<article class="lx" aria-label="Our legacy: 50 years, then One Mango">
<div class="lx-boot" data-lx-boot aria-hidden="true"></div>
<div class="lx-grain" aria-hidden="true"></div>
<div class="lx-cursor" aria-hidden="true"><span class="lx-cursor-dot"></span><span class="lx-cursor-ring"><b class="lx-cursor-word"></b></span></div>

<section class="lx-scene lx-open" aria-labelledby="lx-title">
  <canvas class="lx-pollen" aria-hidden="true"></canvas>
  <canvas class="lx-pollen is-near" aria-hidden="true"></canvas>
  <div class="lx-vignette" aria-hidden="true"></div>
  <p class="lx-caps lx-open-caps">VMR Mangoes · Since 1976</p>
  <h1 id="lx-title" class="lx-open-title" tabindex="-1"><span class="lx-sr">50 years. One promise.</span>
    <span class="lx-fifty-wrap" aria-hidden="true"><span class="lx-fifty is-outline"><span>5</span><span>0</span></span><span class="lx-fifty is-photo"><span class="lx-d5">5</span><span class="lx-d0">0</span></span></span>
    <span class="lx-summers" aria-hidden="true">${lxLetters('years')}</span>
  </h1>
  <p class="lx-open-promise" aria-hidden="true">One promise.</p>
  <div class="lx-load" data-lx-load>
    <button class="lx-begin" type="button" data-lx-begin data-lx-cursor="begin"><span data-lx-begin-text>Begin the film</span>${LX_PLAY_ICON}</button>
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
    <div class="lxo-plain-go"><a class="lx-btn is-solid" href="${LX_PLAY}"><span>Play the film</span></a><a class="lx-btn is-line" href="${LX_STILL}"><span>Read it as a story</span></a></div>
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

// ---- The film's frame. It lives outside the page view (a fixed layer under the shop's pages), one at a time, for one
// visit. The layer (lxFilmHost) is cheap and made at once: it is the opening's night, and the fly-through moves it.
// The frame (lxFilmLoad) is the heavy part and is only made once the visitor is staying (lxRun's want).
const lxFilm = { host: null, frame: null }
const lxFilmMM = () => { try { return lxFilm.frame && lxFilm.frame.contentWindow && lxFilm.frame.contentWindow.__mm } catch { return null } }
function lxFilmHost() {
  if (!lxFilm.host || !lxFilm.host.isConnected) {
    lxFilm.host?.remove()
    const h = lxFilm.host = document.createElement('div')
    h.className = 'lxo-host'
    document.body.prepend(h)
  }
  return lxFilm.host
}
function lxFilmLoad() {
  if (lxFilm.frame) return lxFilm.frame
  const h = lxFilmHost()
  const f = lxFilm.frame = document.createElement('iframe')
  f.className = 'lxo-frame'
  f.title = 'One Mango: a short film, from a seed in the dark to a bowl on your counter'
  f.allow = 'autoplay'
  f.tabIndex = -1
  f.src = LXO_SRC
  h.appendChild(f)
  return f
}
/** The film goes, its layer stays. Ready, it stops its loop and music and gives its graphics context back (destroy);
   still loading (no destroy yet), its renderer, once made, loses its context here. Then the frame is stopped, blanked
   and removed, which ends its loading where it is. */
function lxFilmDrop() {
  const f = lxFilm.frame
  lxFilm.frame = null
  if (!f) return
  let w = null
  try { w = f.contentWindow } catch {}
  try {
    const mm = w && w.__mm
    if (mm && mm.destroy) mm.destroy()
    else mm?.engine?.renderer?.forceContextLoss?.()
  } catch {}
  try { w.document.querySelectorAll('video, audio').forEach((m) => { m.pause(); m.removeAttribute('src'); m.load() }) } catch {}
  try { w.stop() } catch {}
  f.src = 'about:blank'
  f.remove()
}
function lxFilmClose() {
  lxFilmDrop()
  if (lxFilm.host && window.gsap) gsap.killTweensOf(lxFilm.host)
  lxFilm.host?.remove()
  lxFilm.host = null
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
    // done for good (drawn here, not in a worker): the motes and both canvases' pixels are let go
    free: () => { running = false; opts.caf(raf); parts.length = 0; motes.length = 0; canvas.width = canvas.height = near.width = near.height = 0 },
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

function lxPollen(canvas, near, M) {
  // drawn at one canvas pixel per CSS pixel whatever the screen: soft glowing dust loses nothing, and a 2x screen would
  // otherwise fill four times the pixels on every frame (it was the costliest thing on this screen)
  const measure = () => [canvas.clientWidth, canvas.clientHeight, 1, innerWidth, innerHeight]
  let send, worker = null, eng = null
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
    eng = lxPollenEngine(canvas, near, { raf: (f) => requestAnimationFrame(f), caf: (id) => cancelAnimationFrame(id) })
    send = (m) => { if (!eng) return; if (m.size) eng.size(...m.size); if (m.ptr) eng.ptr(...m.ptr); if (typeof m.run === 'boolean') eng.run(m.run) }
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
  const resize = () => { M.clear(resizeT); resizeT = M.timeout(() => send({ size: measure() }), 150) }
  M.on(window, 'pointermove', move, { passive: true })
  M.on(window, 'blur', leave)
  M.on(document, 'visibilitychange', vis)
  M.on(window, 'resize', resize)
  // Once the film has the screen, or the visit is over, the pollen is gone for good: no frame loop, no worker left.
  const halt = () => {
    if (halted) return
    halted = true; run(false); io.disconnect(); M.clear(resizeT)
    if (worker) { worker.terminate(); worker = null }
    if (eng) { eng.free(); eng = null }
    window.__lxPollen = null
  }
  M.kills.push(halt)
  const stats = () => new Promise((res) => { if (!worker) return res(null); worker.onmessage = (e) => res(e.data.dts); worker.postMessage({ stats: true }) })
  window.__lxPollen = { stats, inWorker: Boolean(worker) }
  return { halt, go: () => { held = false; run(true) }, inWorker: Boolean(worker) }
}

/** Film grain: one tile of light and dark specks on transparency, made once (off the main thread's encoder), laid over
   the first screen with ordinary blending and cycled by CSS steps on the compositor. (It used to be an opaque grey
   noise blended with mix-blend-mode: overlay over a layer more than twice the screen: a full-screen blend every frame.) */
function lxGrain(el, M) {
  const c = document.createElement('canvas'), S = 256
  c.width = c.height = S
  const x = c.getContext('2d'), img = x.createImageData(S, S)
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0, l = v > 127 ? 255 : 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = l; img.data[i + 3] = Math.abs(v - 127) * 0.32 | 0 }
  x.putImageData(img, 0, 0)
  return new Promise((res) => c.toBlob((b) => { if (b && M.live()) { const u = URL.createObjectURL(b); el.style.backgroundImage = `url(${u})`; M.kills.push(() => URL.revokeObjectURL(u)) } res() }, 'image/png'))
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

/** The motion page: the opening at once (its own light things only), then the film behind it, then the entrance's
 *  Begin, the fly-through and the film. */
function lxRun(root, M, { soon = false } = {}) {
  const html = document.documentElement
  const fine = matchMedia('(pointer: fine)').matches && !matchMedia('(hover: none)').matches
  root.classList.add('lx-motion')
  if (fine) root.classList.add('lx-fine')
  html.classList.add('lx-stage', 'lx-booting')
  scrollTo(0, 0)
  // The page view's entrance (liquid.js) is a transform: finish it so the fly-through measures the real layout.
  $('#page-view').getAnimations?.().forEach((a) => a.finish())
  const on = M.on, alive = M.live, mountAt = performance.now()
  const timers = { auto: 0, stall: 0, wait: 0, dwell: 0 }
  let stopCursor = () => {}, pollen = null, ctx = null, fly = null
  M.kills.push(() => {
    stopCursor()
    fly?.kill()
    html.classList.remove('lx-stage', 'lx-booting', 'lx-prepaint', 'lx-filming', 'lxo-near', 'lxo-docked')
  })
  lxFilmHost() // the film's layer only (the night behind the opening): the film itself comes once the visitor stays

  // ---- 1 The opening's own light things: fonts and the photo (waited for LX_LIGHT at most), grain on the side, pollen.
  const keep = [] // decoded images stay referenced, so they stay decoded (and let go, a download stopped, on leaving)
  M.kills.push(() => { keep.splice(0).forEach((img) => { img.src = '' }) })
  const light = () => {
    const fonts = Promise.all(['400 100px "Young Serif"', 'italic 400 100px "Young Serif"', '700 16px Figtree', '500 16px Figtree'].map((f) => document.fonts.load(f))).catch(() => {})
    const img = new Image()
    img.decoding = 'async'
    img.src = '/assets/hero.webp'
    keep.push(img)
    return lxTimeout(M, Promise.all([fonts, img.decode().catch(() => {})]), LX_LIGHT)
  }
  lxGrain($('.lx-grain', root), M).catch(() => {}) // not waited for: the grain shows once its tile is made
  pollen = lxPollen($('.lx-pollen', root), $('.lx-pollen.is-near', root), M)

  // ---- 2 The opening: entrance, Begin, fly-through (built now, played later).
  let intro = null, zoom = null
  ctx = gsap.context(() => {
    const E = { out: 'expo.out', quint: 'power4.out' }
    intro = gsap.timeline({ paused: true, onComplete: () => afterEntrance() })
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
    M.kills.push(() => { open.classList.remove('is-holed'); photoEl.style.visibility = '' })
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
  M.kills.push(() => {
    ctx.revert()
    gsap.killTweensOf([intro, zoom])
    // (this page makes no scroll triggers today; any made on it later go with it)
    window.ScrollTrigger?.getAll().filter((st) => st.trigger instanceof Element && root.contains(st.trigger)).forEach((st) => st.kill())
  })

  // ---- 3 The film, loading behind the opening. Its state is the button's: 'idle' (not asked for yet), 'loading'
  // (the button says how far, and fills), 'ready' (Begin), 'failed' (a plain link to the film's own page).
  const loadEl = $('[data-lx-load]', root), beginT = $('[data-lx-begin-text]', root), loadText = $('[data-lx-load-text]', root)
  let beginB = $('[data-lx-begin]', root)
  const LINE = loadText.textContent
  let film = 'idle', filmF = 0, pct = 0, wanted = false, docked = false
  const label = () => {
    if (film === 'ready' || film === 'failed') return
    const n = pct ? ` ${pct}%` : ''
    beginT.textContent = wanted ? `Starting…${n}` : `Begin the film · loading${n}`
    beginB.style.setProperty('--lx-p', `${pct}%`)
  }
  // No word from the film for a while: say so (any step forward takes the note away again).
  const stalled = () => { if (film === 'loading') loadText.textContent = 'Still loading… the film is on its way' }
  const heard = () => { M.clear(timers.stall); timers.stall = M.timeout(stalled, LX_STALL); if (loadText.textContent !== LINE) loadText.textContent = LINE }
  const progress = (f) => {
    if (film !== 'loading' || !(f > filmF)) return
    filmF = f
    pct = Math.min(99, Math.floor(f * 100)) // 100 only when it is ready (it still waits for its fonts and music after its last step)
    heard(); label()
  }
  const ready = () => {
    if (film === 'ready' || film === 'failed' || !alive()) return
    film = 'ready'
    M.clear(timers.stall); M.clear(timers.wait)
    beginB.classList.remove('is-loading'); beginB.removeAttribute('aria-busy'); beginB.style.removeProperty('--lx-p')
    beginT.textContent = 'Begin the film'
    loadText.textContent = LINE
    if (wanted) go(true); else auto()
  }
  // The film cannot play here ('still': it can only show its stills), broke ('error') or was too slow ('slow'): drop it,
  // and the button becomes a plain link to the film's own page. Nothing on this page waits on it any more.
  const fail = (why) => {
    if (film === 'failed' || film === 'ready' || !alive()) return
    film = 'failed'
    wanted = false
    M.clear(timers.stall); M.clear(timers.wait); M.clear(timers.auto)
    lxFilmDrop()
    const still = why === 'still'
    const a = document.createElement('a')
    a.className = 'lx-begin'
    a.href = still ? LX_STILL : LX_PLAY
    a.dataset.lxCursor = 'open'
    a.innerHTML = `<span>${still ? 'Read it as a story' : 'Play the film'}</span>${LX_PLAY_ICON}`
    const focused = document.activeElement === beginB
    beginB.replaceWith(a)
    beginB = a
    if (focused) a.focus({ preventScroll: true })
    loadText.textContent = still ? 'The film cannot play on this device' : why === 'slow' ? 'The film is taking too long here. It plays on its own page too.' : 'The film could not start here. It plays on its own page too.'
    loadEl.classList.add('is-failed')
  }
  const startFilm = () => {
    if (!alive() || film !== 'idle') return
    film = 'loading'
    M.clear(timers.dwell)
    lxFilmLoad()
    heard()
    // Not ready in time: give up on it here (counted while the tab is in view only: a hidden tab loads slowly).
    const giveUp = () => { if (film !== 'loading') return; if (document.hidden) { timers.wait = M.timeout(giveUp, 5000); return } fail('slow') }
    timers.wait = M.timeout(giveUp, LX_FILM_WAIT)
  }
  on(window, 'message', (e) => {
    if (e.origin !== location.origin || !lxFilm.frame || e.source !== lxFilm.frame.contentWindow || !e.data || e.data.type !== 'one-mango') return
    const d = e.data
    if (typeof d.load === 'number') progress(d.load)
    if (d.ready) ready()
    if (d.still) fail('still'); else if (d.failed) fail('error')
    if (typeof d.ui === 'boolean' && docked) html.classList.toggle('lx-head-away', !d.ui)
    // a shop page asked for from inside the film: the shop's own router (pages.js go)
    if (typeof d.go === 'string' && d.go.startsWith('/')) { if (typeof window.go === 'function') window.go(d.go); else location.href = d.go }
  })

  // ---- Into the film: start it (from inside the click when there is one, so its music may start: browsers allow
  // sound only from a gesture), fly through the zero, hand it the screen, the pointer and the keys. Pressed before the
  // film is ready: "Starting…", and it begins the moment it is (if the browser no longer counts that as the click, the
  // film starts with its sound switch off, and one tap turns it on).
  let flying = false
  const go = async (withSound) => {
    if (flying || !alive() || film === 'failed') return
    if (film !== 'ready') { wanted = true; startFilm(); label(); return }
    flying = true
    M.clear(timers.auto)
    if (!entered) intro.progress(1)
    try { lxFilmMM().begin({ sound: withSound }) } catch (e) { console.warn('One Mango: begin', e) }
    html.classList.add('lxo-near')
    await new Promise((res) => { fly = gsap.to(zoom, { progress: 1, duration: soon ? 1.2 : LX_FLY, ease: 'power1.inOut', onComplete: res }) })
    if (!alive()) return
    docked = true
    html.classList.add('lxo-docked', 'lx-filming')
    lxFilm.host.classList.add('is-docked')
    pollen && pollen.halt(); stopCursor() // the film has the screen: nothing of the first screen draws any more
    try { lxFilm.frame.tabIndex = 0; lxFilm.frame.focus({ preventScroll: true }) } catch {}
  }
  on(beginB, 'click', () => go(true))
  // Nobody pressed Begin: the film starts by itself (muted) a few seconds after the entrance, and never before it is ready.
  const auto = () => {
    if (!entered || film !== 'ready' || flying || timers.auto || /[?&]lxhold\b/.test(location.search)) return // ?lxhold: stay on this screen (measuring it)
    // LX_AUTO counts from the entrance; a film ready only later (it is asked for after the entrance) still shows its
    // Begin button for LX_AUTO_MIN before it starts
    timers.auto = M.timeout(() => go(false), soon ? 800 : Math.max(LX_AUTO_MIN, LX_AUTO - (performance.now() - enteredAt)))
  }
  // The film is asked for once the visitor is staying: the entrance has played, the tab is in view, and they have been
  // here LX_DWELL or shown they mean to stay (a wheel, a swipe or a key on the opening; Begin asks for it at once, in go).
  // Leaving sooner costs nothing of the film's: it is never fetched.
  let entered = false, enteredAt = 0, keen = false, asked = false
  const want = () => {
    if (!alive() || film !== 'idle' || asked || !entered || document.hidden) return
    const left = LX_DWELL - (performance.now() - mountAt)
    if (left > 0 && !keen && !soon) { M.clear(timers.dwell); timers.dwell = M.timeout(want, left + 20); return }
    asked = true
    M.idle(startFilm) // in an idle moment: the frame's code runs on this page's main thread
  }
  const keenly = () => { if (!keen) { keen = true; want() } }
  on(document, 'visibilitychange', want)
  const afterEntrance = () => { entered = true; enteredAt = performance.now(); want(); auto() }
  beginB.classList.add('is-loading'); beginB.setAttribute('aria-busy', 'true'); label()

  // Keys pressed on this page (the frame does not have focus) go to the film once it has the screen.
  on(window, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof Element && e.target.closest('header, nav, .liquid-navigation, input, textarea, select, [contenteditable]')) return
    if (!docked) { keenly(); return }
    const mm = lxFilmMM()
    try { if (mm && mm.ui && mm.ui.key(e.key, null)) e.preventDefault() } catch {}
  })
  // Nothing scrolls here; a wheel on the opening points at the Begin button.
  const mine = (e) => e.target instanceof Element && root.contains(e.target)
  on(window, 'wheel', (e) => { if (docked || !mine(e)) return; e.preventDefault(); keenly(); if (html.classList.contains('lx-booting')) return; beginB.classList.remove('is-nudge'); void beginB.offsetWidth; beginB.classList.add('is-nudge') }, { passive: false })
  on(window, 'touchmove', (e) => { if (!mine(e)) return; if (e.cancelable) e.preventDefault(); if (!docked) keenly() }, { passive: false })

  // ---- 4 Once the light things are in (or LX_LIGHT is up): paint the first screen once, hidden under the night cover
  // (every layer of the entrance is made and drawn now, not on its first frame), then let the cover go and play the
  // entrance. Each wait is capped, so a background tab (no frames) cannot hold it. The film comes after (want).
  const reveal = async () => {
    const layers = $$('.lx-fifty, .lx-summers .lx-ch, .lx-open-caps, .lx-open-promise, .lx-load', root)
    layers.forEach((el) => { el.style.willChange = 'transform, opacity' })
    html.classList.add('lx-prepaint')
    intro.progress(1, true) // (no callbacks: this is only a paint)
    await lxTimeout(M, lxFrames(M, 3), 250)
    intro.progress(0, true)
    await lxTimeout(M, lxFrames(M, 2), 150)
    if (!alive()) return
    html.classList.remove('lx-booting', 'lx-prepaint')
    pollen && pollen.go()
    intro.play()
    if (fine) stopCursor = lxCursor(root, on)
  }
  light().then(() => alive() && reveal()).catch((err) => {
    // The reveal going wrong must not leave the night cover up: the static page, as when the setup throws.
    if (!alive()) return
    console.warn('Legacy page: motion off', err)
    lxStop({ keepPage: true })
    root.classList.remove('lx-motion', 'lx-fine')
    lxPlain(root)
  })
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

/** Ends the visit, if there is one: everything it started stops now, the film is closed (lxFilmClose), and the page's
   classes on <html> go. Safe to call any number of times. keepPage: the page stays on screen (it falls back to static). */
function lxStop({ keepPage = false } = {}) {
  const M = lxM
  lxM = null
  M?.end()
  lxFilmClose()
  const html = document.documentElement
  html.classList.remove('lx-head-away')
  if (!keepPage) html.classList.remove('lx-on')
}

// Leaving the page (another route, the back button): tear everything down, give the home page its title back, and let
// the shop's own scroll effects measure again.
window.addEventListener('mm:route', () => {
  if (document.body.dataset.page === 'legacy') return
  const was = lxM || document.documentElement.classList.contains('lx-on')
  lxStop()
  if (document.title === LX_TITLE) document.title = LX_HOME_TITLE
  if (was && window.ScrollTrigger) requestAnimationFrame(() => ScrollTrigger.refresh())
})
// The tab going away (a full navigation, closing, or into the back-forward cache): the same, and if the page comes
// back from that cache still on this route, it is mounted afresh.
window.addEventListener('pagehide', () => lxStop())
window.addEventListener('pageshow', (e) => { if (e.persisted && document.body.dataset.page === 'legacy' && !lxM) legacyView() })
