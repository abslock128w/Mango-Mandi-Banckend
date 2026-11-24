// One Mango: the director. Builds the page, the stage and the chapters, then plays the film by itself: a clock → the
// film's time τ → one master progress p (0…13, player.js) that drives every scene's state, the camera, the post look and
// a single paused GSAP timeline for the type. Small controls (controls.js) pause, seek, step and switch the music.
//
// Loading is real work counted step by step (every chapter's set built, every shader compiled, every texture uploaded,
// one still of each chapter taken, the music's instrument rendered) and all of it happens before the film starts, so
// nothing is built or compiled while it plays.
//
// Embedded in the shop's Legacy page (?embed=1) the page around it shows the loading and the Begin button, and starts
// the film through window.__mm.begin(); on its own the film has its own opening card and Begin button. Either way, if
// nobody presses Begin the film starts by itself a few seconds after it is ready, muted.
import * as THREE from 'three'
import gsap from 'gsap'
import { Engine, detectTier } from './engine.js'
import { CHAPTERS, SECONDS, LEAD, fruitDay } from './chapters.js'
import { ICONS } from './icons.js'
import { Sound } from './sound.js'
import { buildStill } from './still.js'
import { makeTimeline } from './player.js'
import { controls } from './controls.js'
import { clamp, damp, smooth, easeInOut } from './lib/util.js'

const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const html = document.documentElement
const params = new URLSearchParams(location.search)
// Embedded: the shop shows the film inside its Legacy page, in a frame, under its own header and dock.
const embed = params.has('embed') && parent !== window
if (embed) document.documentElement.classList.add('is-embed')
const tell = (msg) => { if (embed) parent.postMessage({ type: 'one-mango', ...msg }, location.origin) }
// links to the shop's pages ("/") are opened by the shop's own router, not inside the frame
if (embed) document.addEventListener('click', (e) => { const a = e.target instanceof Element ? e.target.closest('a[href^="/"]') : null; if (a) { e.preventDefault(); tell({ go: a.getAttribute('href') }) } }, true)
const N = CHAPTERS.length
const T0 = 0.86 // where a chapter's iris into the next one begins
const STAGE_OF = ['seed', 'seed', 'tree', 'blossom', 'fruit', 'fruit', 'crate', 'road', 'grade', 'pack', 'door', 'counter', 'finale']
const KEY_T = [0.3, 0.7, 0.85, 0.55, 0.55, 0.5, 0.5, 0.55, 0.45, 0.6, 0.7, 0.88, 0.88]
const AUTO_START = 4000 // ms after the film is ready: nobody pressed Begin, so it starts by itself, muted
const MM = (window.__mm = { ready: false, state: 'loading', load: 0, p: 0, fps: 0, tier: '', errors: [], steps: [] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// Give the browser a moment between loading steps (to draw a frame of whatever is on screen), without waiting long.
const yieldNow = () => (window.scheduler && scheduler.yield ? scheduler.yield() : wait(0))

// ---- Mode -----------------------------------------------------------------------------------------------------------

function webglOk() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2')) } catch { return false }
}
// Reduced motion keeps the long-form still version unless the visitor chose to play the film (?play).
const reduced = (matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('play')) || params.has('still')
const hasGL = webglOk() && !params.has('nogl')

// ---- Type: words in masks; the key phrase (between asterisks) in italic gold ---------------------------------------

function splitLine(text) {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((part) => {
    const key = part.startsWith('*')
    const words = part.replace(/\*/g, '').trim().split(/\s+/).map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ')
    return key ? `<em>${words}</em>` : words
  }).join(' ')
}
const plain = (t) => t.replace(/\*/g, '')

function odometer(digits) {
  const col = '<span class="odo-col">' + Array.from({ length: 11 }, (_, i) => `<span>${i % 10}</span>`).join('') + '</span>'
  return `<span class="odo" aria-hidden="true">${Array.from({ length: digits }, () => `<span class="odo-c">${col}</span>`).join('')}</span>`
}
function roll(odo, v) {
  // each number rests square on its line and turns over quickly in between: rolled in step with the scroll, the last
  // digit sat half-way between two figures wherever the reader stopped
  { const w = Math.floor(v), f = clamp((v - w - 0.3) / 0.4); v = w + f * f * (3 - 2 * f) }
  const cells = odo.querySelectorAll('.odo-c'), n = cells.length
  cells.forEach((cell, i) => {
    const p = Math.pow(10, n - 1 - i), base = Math.floor(v / p) % 10, rest = v % p
    const carry = p === 1 ? v % 1 : Math.max(0, rest - (p - 1))
    cell.firstChild.style.transform = `translateY(${(-(base + carry) * 100 / 11).toFixed(3)}%)`
  })
}

function buildFilm() {
  const film = $('[data-film]')
  film.innerHTML = CHAPTERS.map((c, i) => {
    if (c.id === 'finale') {
      return `<section class="ch pos-center" data-id="finale" data-i="${i}" aria-label="${c.name}">
        <div class="fin">
          <p class="ch-kick"><span>${c.kicker}</span></p>
          <h2 class="ch-line">${splitLine(c.line)}</h2>
          <ul class="nums">
            <li><b data-num="50">${odometer(2)}</b><span>summers</span></li>
            <li><b data-num="16">${odometer(2)}</b><span>varieties</span></li>
            <li><b data-num="1">${odometer(1)}</b><span>day from tree to warehouse</span></li>
            <li><b data-num="0">${odometer(1)}</b><span>shortcuts</span></li>
          </ul>
          <div class="ctas">
            <a class="btn is-gold" href="/" data-magnet data-cursor="shop">Shop the mangoes <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
            <button class="btn is-line" type="button" data-replay data-magnet data-cursor="again">Watch again</button>
          </div>
        </div>
      </section>`
    }
    return `<section class="ch pos-${c.pos}" data-id="${c.id}" data-i="${i}" aria-label="${c.name}">
      <div class="ch-box">
        <p class="ch-kick"><span>${c.kicker}</span></p>
        ${i === 0 ? '<h1' : '<h2'} class="ch-line">${splitLine(c.line)}${i === 0 ? '</h1>' : '</h2>'}
        <p class="ch-cap"><span class="cl"><span class="cli">${c.cap}</span></span></p>
        ${c.hint ? `<p class="ch-hint">${c.hint}</p>` : ''}
      </div>
      ${c.after ? `<p class="ch-after" aria-label="${plain(c.after)}">${splitLine(c.after)}</p>` : ''}
    </section>`
  }).join('')
  // The year odometer for the tree.
  const tree = $('[data-id=tree]', film)
  tree.insertAdjacentHTML('beforeend', `<div class="year" aria-hidden="true"><small>Year</small>${odometer(4)}</div>`)
  return film
}

function buildRail(goto) {
  const ol = $('[data-rail]')
  ol.innerHTML = CHAPTERS.map((c, i) => `<li><button type="button" data-go="${i}" aria-label="${String(i).padStart(2, '0')} ${c.name}">${ICONS[c.id] || ''}</button></li>`).join('')
  $$('button', ol).forEach((b) => b.addEventListener('click', () => goto(Number(b.dataset.go))))
}

// ---- Loading ----------------------------------------------------------------------------------------------------------

const STAGE_MODS = {
  seed: () => import('./scenes/seed.js'), tree: () => import('./scenes/tree.js'), blossom: () => import('./scenes/blossom.js'),
  fruit: () => import('./scenes/fruit.js'), crate: () => import('./scenes/crate.js'), road: () => import('./scenes/road.js'),
  grade: () => import('./scenes/grade.js'), pack: () => import('./scenes/pack.js'), door: () => import('./scenes/door.js'),
  counter: () => import('./scenes/counter.js'), finale: () => import('./scenes/finale.js'),
}

/** Every chapter's set: fetch its code, build it (a placeholder for any set that fails: never a blank frame). */
async function loadStages(engine, step) {
  const out = {}
  for (const key of Object.keys(STAGE_MODS)) {
    try {
      const m = await STAGE_MODS[key]()
      await yieldNow()
      out[key] = new m.default(engine)
    } catch (e) {
      console.warn('stage', key, e)
      const m = await import('./scenes/placeholder.js')
      out[key] = new m.default(engine, key)
    }
    step('build ' + key)
    await yieldNow()
  }
  return out
}

/** Get a set fully ready to draw: every material's shaders compiled (the ones hidden at this moment of the chapter
 *  too, so nothing compiles when they appear later), off the main thread where the browser can (compileAsync), and
 *  every texture uploaded. */
async function warm(engine, st) {
  const r = engine.renderer, hidden = []
  st.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true } })
  try {
    if (r.compileAsync) await r.compileAsync(st.scene, st.camera)
    else r.compile(st.scene, st.camera)
  } finally { hidden.forEach((o) => { o.visible = false }) }
  uploadTextures(engine, st)
}

/** Upload every texture a set's materials use that is new or has changed since (initTexture skips the rest). */
function uploadTextures(engine, st) {
  const r = engine.renderer, tex = new Set()
  st.scene.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) tex.add(v) }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) tex.add(v) }
    }
  })
  for (const t of tex) { try { if (!t.isRenderTargetTexture && !t.isDepthTexture) r.initTexture(t) } catch { /* drawn later */ } }
}

/** A still of what the canvas shows now, encoded off the main thread (a blob: address). */
function shot(src) {
  const c = document.createElement('canvas')
  c.width = 800; c.height = 500
  c.getContext('2d').drawImage(src, 0, 0, 800, 500)
  return new Promise((res) => c.toBlob((b) => res(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.86))
}

// ---- Boot -----------------------------------------------------------------------------------------------------------

async function boot() {
  const film = buildFilm()
  if (!hasGL) { tell({ still: true }); return still(null) }

  // In a frame, the page can start before the frame has been given its size: wait for a real viewport.
  while (!(innerWidth > 0 && innerHeight > 0)) await wait(50)
  const tier = detectTier()
  MM.tier = tier.name
  const engine = new Engine($('#gl'), tier)
  MM.engine = engine
  // If the browser takes the graphics context away (a phone under memory pressure, a long spell in the background),
  // ask for it back and start the film again cleanly, instead of leaving a frozen or black picture.
  $('#gl').addEventListener('webglcontextlost', (e) => { if (MM.destroyed) return; e.preventDefault(); MM.errors.push('context lost') })
  $('#gl').addEventListener('webglcontextrestored', () => { if (!MM.destroyed) location.reload() })
  engine.setSize(innerWidth, innerHeight)

  // The loading card: on its own page the opening card (#pre); embedded, the shop's page shows it (told by message).
  const pre = $('#pre'), preNum = $('[data-pre-num]'), preWord = $('[data-pre-word]')
  if (embed) pre?.remove()
  let shown = 0, word = ''
  const wordAt = (n) => (n < 34 ? 'Planting the seed' : n < 68 ? 'Waking the orchard' : n < 99 ? 'Tuning the quiet music' : 'Ready when you are')
  const setLoad = (v) => {
    MM.load = v
    tell({ load: v })
    if (!pre || !pre.isConnected) return
    const target = Math.round(v * 100)
    gsap.to({ v: shown }, { v: target, duration: 0.5, ease: 'power2.out', onUpdate() {
      shown = this.targets()[0].v; preNum.textContent = Math.round(shown); pre.style.setProperty('--p', (shown / 100).toFixed(3))
      const w = wordAt(shown); if (preWord && w !== word) { word = w; preWord.textContent = w }
    } })
  }
  // Real steps: build each of the 11 sets, ready each of the 13 chapters (shaders, textures, a still), the music.
  const sound = reduced ? null : new Sound()
  const total = Object.keys(STAGE_MODS).length + N + (sound ? 1 : 0)
  let done = 0, stepAt = performance.now()
  const step = (label) => {
    const now = performance.now()
    MM.steps.push([label, Math.round(now - stepAt)]); stepAt = now
    setLoad(++done / total)
  }
  const soundReady = sound ? sound.prepare().then(() => step('music'), () => step('music')) : null

  const stages = await loadStages(engine, step)
  const S = STAGE_OF.map((k) => stages[k])
  S.forEach((s, i) => s.mountUI && !s._mounted && (s._mounted = true, s.mountUI(film, i)))

  // Compile every set's shaders and grab one still of each chapter (for the finale's ribbon and the still version).
  const shots = []
  {
    const w0 = engine.w, h0 = engine.h
    engine.setSize(800, 500)
    for (let i = 0; i < N; i++) {
      const st = S[i]
      try {
        st.update(i, KEY_T[i], 3, 0.016)
        engine.frameCamera(st)
        st.sunToView()
        await warm(engine, st)
        st.update(i, KEY_T[i], 3, 0.016)
        engine.frameCamera(st)
        st.sunToView()
        engine.render(st, null, 0, null, 0, { ...st.look, ca: 0, radial: 0, fade: 0, grain: 0 })
        if (i < N - 1) shots.push(await shot(engine.renderer.domElement))
      } catch (e) { console.warn('warm', i, e); if (i < N - 1) shots.push(null) }
      step('ready ' + CHAPTERS[i].id)
      await yieldNow()
    }
    engine.setSize(w0, h0)
    await stages.finale.setShots?.(shots)
    // The sets redraw their printed labels once the brand fonts arrive: wait for those fonts, then upload whatever
    // changed, so no label is re-uploaded on its chapter's first frame (WebKit pays dearly for canvas uploads).
    await Promise.race([Promise.all(['700 30px Figtree', '800 40px Figtree', "400 40px 'Young Serif'"].map((f) => document.fonts.load(f))).catch(() => {}), wait(2500)])
    await yieldNow()
    for (const st of new Set(S)) { try { uploadTextures(engine, st) } catch { /* drawn later */ } }
    // one frame of the opening at the real size, so the first frame the visitor sees allocates and compiles nothing
    try {
      const st = S[0]
      st.update(0, 0, 0, 0.016); engine.frameCamera(st); st.sunToView()
      engine.render(st, null, 0, null, 0, { ...st.look, rc: new THREE.Vector2(0.5, 0.5), ca: 0, radial: 0, fade: 1, grain: 0 })
    } catch (e) { console.warn('warm frame', e) }
  }
  MM.shots = shots
  if (soundReady) await soundReady
  await Promise.race([document.fonts?.ready, wait(1500)])
  // Reduced motion: the long-form version, illustrated with stills rendered from the film itself.
  if (reduced) { MM.ready = true; MM.state = 'still'; tell({ still: true }); return still(shots) }

  run(engine, S, film, sound)
}

function still(shots) {
  html.classList.add('is-still')
  $('[data-still]').hidden = false
  buildStill($('[data-still-list]'), shots)
  $('#pre')?.remove()
}

// ---- The film -------------------------------------------------------------------------------------------------------

function run(engine, S, film, sound) {
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
  if (fine) html.classList.add('is-fine')
  gsap.ticker.lagSmoothing(0)
  // Phones and tablets: draw at 60 a second at most. Many now refresh at 90 or 120, and the film gains nothing from
  // drawing twice as often; it only costs battery and heat.
  const touch = matchMedia('(pointer: coarse)').matches
  if (touch) gsap.ticker.fps(60)

  // ---- The playhead: the film's time τ (seconds) and what it maps to.
  const TL = makeTimeline(CHAPTERS.map((c) => SECONDS[c.id]), LEAD)
  MM.duration = TL.end
  const P = { tau: 0, playing: false, glide: null, fade: null, scrub: false, anchor: null, ended: false, fadeK: 0 }
  let p = 0, pvel = 0, pv = 0, time = 0, running = false, fpsAcc = 0, fpsN = 0, fpsWork = 0, fpsDt = [], slow = 0, needSize = false, cutNext = true
  let lastNow = performance.now(), begun = false, parkAt = 0
  const freeze = params.has('freeze')

  const setState = (s) => {
    if (MM.state === s) return
    MM.state = s
    html.dataset.state = s
    tell({ state: s })
    ui.sync()
  }
  /** Draw frames (or stop drawing: the film is not on screen, or it has ended and sat still a while). */
  const wakeLoop = () => {
    parkAt = P.ended ? performance.now() + 12000 : 0
    if (running || document.hidden || !begun || MM.destroyed || MM.parked) return
    running = true; lastNow = performance.now()
    gsap.ticker.wake()
    gsap.ticker.add(frame)
  }
  // Not drawing: the GSAP ticker (its own rAF loop) is put to sleep too; any new tween wakes it again.
  const sleepLoop = () => { if (!running) return; running = false; gsap.ticker.remove(frame); gsap.ticker.sleep() }
  const playNow = () => {
    if (P.ended || P.tau >= TL.end - 0.05) { P.ended = false; jump(0, 'fade') }
    P.playing = true; P.anchor = null
    sound?.hold(false)
    setState('playing')
    wakeLoop()
  }
  const pauseNow = (quiet = false) => {
    if (!P.playing) return
    P.playing = false
    sound?.hold(true)
    setState('paused')
    if (!quiet) ui.show()
  }
  const toggle = () => (P.playing ? pauseNow() : playNow())
  /** Move the playhead. 'glide': a short eased travel through what lies between (near targets); 'fade': through the
   *  night colour and back (far targets); 'cut': at once (scrubbing the bar). */
  const jump = (tau, how = 'glide') => {
    tau = clamp(tau, 0, TL.end)
    P.anchor = null
    if (tau < TL.end - 0.05) P.ended = false
    if (how === 'cut') { P.glide = null; P.fade = null; P.tau = tau; cutNext = true }
    else if (how === 'fade') { P.glide = null; P.fade = { to: tau, t0: performance.now(), swapped: false } }
    else { P.fade = null; const d = Math.abs(TL.p(tau) - TL.p(P.tau)); P.glide = { from: P.tau, to: tau, t0: performance.now(), dur: 700 + Math.min(900, d * 450) } }
    if (MM.state === 'ended' && tau < TL.end - 0.05) setState(P.playing ? 'playing' : 'paused')
    wakeLoop()
  }
  const toP = (pp, how) => jump(TL.tauOf(pp), how)
  const nearOrFar = (tau) => (Math.abs(TL.p(tau) - p) <= 1.6 ? 'glide' : 'fade')
  const chapterNow = () => Math.floor(clamp(TL.p(P.glide ? P.glide.to : P.fade ? P.fade.to : P.tau), 0, N - 0.0001))
  const toChapter = (i) => { i = clamp(i, 0, N - 1); const tau = i === 0 ? 0 : TL.starts[i]; jump(tau, nearOrFar(tau)) }
  const next = () => toChapter(chapterNow() + 1)
  const prev = () => {
    const i = chapterNow(), into = P.tau - TL.starts[i]
    toChapter(into > 2.5 && i > 0 ? i : i - 1) // like a player: back to this chapter's start, or the one before
  }
  const end = () => {
    P.playing = false; P.ended = true
    setState('ended')
    sound?.hold(true, 4) // the music dies away with the last picture
    ui.show(true)
    parkAt = performance.now() + 12000 // the end card sits still: after a while, stop drawing
  }
  const soundOn = () => { sound?.start(); ui.sync() }
  const soundOff = () => { sound?.mute(); ui.sync() }

  // ---- The controls.
  const ui = controls({
    chapters: CHAPTERS, starts: TL.starts, duration: TL.end, embed, touch,
    state: () => MM.state, tau: () => P.tau, p: () => p, sound: () => Boolean(sound && sound.on && !sound.blocked),
    toggle, next, prev, toChapter, replay: () => { P.ended = false; jump(0, 'fade'); playNow() },
    soundOn, soundOff, soundToggle: () => (sound && sound.on ? soundOff() : soundOn()),
    seek: (tau, how) => jump(tau, how || nearOrFar(tau)),
    scrub: (on) => { P.scrub = on; if (on) P.wasPlaying = P.playing, P.playing = false; else if (P.wasPlaying && !P.ended) { P.playing = true; P.anchor = null } },
    onUi: (on) => tell({ ui: on }),
    wake: wakeLoop,
  })
  MM.ui = ui
  MM.sound = sound
  // the switch follows what is really heard: sound wanted but held back by the browser shows as off
  sound?.ctx?.addEventListener?.('statechange', () => setTimeout(() => ui.sync(), 300))

  // ---- The master timeline for type: chapter i occupies [i, i+1).
  const tl = gsap.timeline({ paused: true })
  const chEls = $$('.ch', film)
  chEls.forEach((el, i) => {
    const words = $$('.ch-box .wi, .fin .ch-line .wi', el), kick = $$('.ch-kick span', el), cap = $$('.cli', el), hint = $$('.ch-hint', el)
    const extra = $$('.year, .nums li, .ctas .btn', el)
    const o = i === N - 1 ? 0.5 : 0 // the finale's type lands after the fly-back
    if (i > 0) {
      if (kick.length) tl.fromTo(kick, { yPercent: 120 }, { yPercent: 0, duration: 0.1, ease: 'expo.out' }, i + 0.02 + o)
      if (words.length) tl.fromTo(words, { yPercent: 118, rotate: 5 }, { yPercent: 0, rotate: 0, duration: 0.16, stagger: 0.014, ease: 'expo.out' }, i + 0.03 + o)
      if (cap.length) tl.fromTo(cap, { yPercent: 105, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.12, ease: 'expo.out' }, i + 0.1)
      if (hint.length) tl.fromTo(hint, { opacity: 0 }, { opacity: 1, duration: 0.06 }, i + 0.18)
      if (extra.length) tl.fromTo(extra, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.12, stagger: 0.03, ease: 'expo.out' }, i + 0.12 + o)
    }
    if (i < N - 1) {
      const exitAt = CHAPTERS[i].id === 'pick' ? 0.4 : CHAPTERS[i].id === 'begin' ? 0.5 : 0.7
      tl.fromTo(words, { yPercent: 0, rotate: 0 }, { yPercent: -118, rotate: -3, duration: 0.1, stagger: 0.006, ease: 'power3.in', immediateRender: false }, i + exitAt)
      tl.fromTo(kick, { yPercent: 0 }, { yPercent: -120, duration: 0.08, ease: 'power3.in', immediateRender: false }, i + exitAt)
      tl.fromTo(cap, { opacity: 1 }, { opacity: 0, duration: 0.07, immediateRender: false }, i + exitAt)
      if (hint.length) tl.fromTo(hint, { opacity: 1 }, { opacity: 0, duration: 0.05, immediateRender: false }, i + exitAt)
      if (extra.length) tl.fromTo(extra, { opacity: 1 }, { opacity: 0, duration: 0.08, immediateRender: false }, i + 0.8)
    }
    const after = $$('.ch-after .wi', el)
    if (after.length) {
      tl.fromTo(after, { yPercent: 118 }, { yPercent: 0, duration: 0.1, stagger: 0.012, ease: 'expo.out' }, i + 0.6)
      tl.fromTo(after, { yPercent: 0 }, { yPercent: -118, duration: 0.08, stagger: 0.006, ease: 'power3.in', immediateRender: false }, i + 0.84)
    }
  })
  tl.set({}, {}, N)
  // Chapter 0's title arrives on its own time as the film begins.
  const intro = gsap.timeline({ paused: true })
  {
    const el = chEls[0]
    intro.fromTo($$('.wi', el), { yPercent: 118, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 1.6, stagger: 0.12, ease: 'expo.out' }, 0.2)
      .fromTo($$('.ch-kick span', el), { yPercent: 120 }, { yPercent: 0, duration: 1.2, ease: 'expo.out' }, 0.1)
      .fromTo($$('.cli', el), { yPercent: 105, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, ease: 'expo.out' }, 0.7)
  }

  // ---- HUD
  buildRail((i) => { toChapter(i); ui.show() })
  $('[data-skip]').addEventListener('click', (e) => { e.preventDefault(); toChapter(N - 1) })
  $('[data-skip]').addEventListener('focus', (e) => e.target.classList.add('is-shown'))
  $$('[data-replay]').forEach((b) => b.addEventListener('click', () => { P.ended = false; jump(0, 'fade'); playNow() }))
  const railBtns = $$('[data-rail] button'), railName = $('[data-rail-name]'), count = $('[data-count]')
  const day = $('[data-day]'), dayNum = $('[data-day-num]'), daySub = $('[data-day-sub]')
  const yearOdo = $('.year .odo'), numOdos = $$('[data-num]')
  let lastI = -1, lastDay = -1, lastInk = ''
  const dayWord = (i, d) => i <= 6 ? 'Plucked' : i === 7 ? (d < 1 ? 'On the road' : 'At the warehouse') : i === 8 ? 'Graded by hand' : i === 9 ? (d < 4 ? 'Raw: days 1 to 3' : 'Semi-ripe: days 4 to 7') : i === 10 ? 'At your door' : 'On your counter'

  // ---- Pointer: parallax, cursor, magnetic buttons, drag-to-turn
  const ptr = { x: 0, y: 0, sx: 0, sy: 0, cx: innerWidth / 2, cy: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2, dragging: false, lx: 0, ly: 0 }
  const cursor = $('[data-cursor]'), cWord = $('[data-cursor-word]'), cDot = $('.cursor-dot'), cRing = $('.cursor-ring')
  addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = -((e.clientY / innerHeight) * 2 - 1)
    ptr.cx = e.clientX; ptr.cy = e.clientY
    if (e.pointerType === 'mouse') cursor.classList.add('is-on')
    if (ptr.dragging) { curStage()?.dragBy?.((e.clientX - ptr.lx) / innerWidth, (e.clientY - ptr.ly) / innerHeight); ptr.lx = e.clientX; ptr.ly = e.clientY }
  }, { passive: true })
  document.addEventListener('mouseleave', () => cursor.classList.remove('is-on'))
  const curStage = () => S[Math.floor(clamp(p, 0, N - 0.001))]
  const canDrag = (e) => { const s = curStage(); return s && s.dragHit && !e.target.closest('a,button,[data-ctl]') && s.dragHit((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1), Math.floor(p), p % 1) }
  addEventListener('pointerdown', (e) => { if (canDrag(e)) { ptr.dragging = true; ui.dragging = true; ptr.lx = e.clientX; ptr.ly = e.clientY; cursor.classList.add('is-drag') } })
  addEventListener('pointerup', () => { ptr.dragging = false; setTimeout(() => { ui.dragging = false }, 0); cursor.classList.remove('is-drag') })
  addEventListener('pointercancel', () => { ptr.dragging = false; ui.dragging = false })
  $$('[data-magnet]').forEach((b) => {
    b.addEventListener('pointermove', (e) => { if (!fine) return; const r = b.getBoundingClientRect(); gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.5, ease: 'power3.out' }) })
    b.addEventListener('pointerleave', () => gsap.to(b, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1,.4)' }))
  })
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('a,button,[data-ctl-track]')
    cursor.classList.toggle('is-big', Boolean(t) && !e.target.closest('[data-ctl]'))
    if (t) cWord.textContent = t.dataset.cursor || (t.matches('[data-go]') ? 'go' : 'open')
  })

  // ---- Resize
  let rT = 0
  const onResize = () => { clearTimeout(rT); rT = setTimeout(() => { rT = 0; needSize = true; wakeLoop() }, 120) }
  addEventListener('resize', onResize)

  // ---- Tab hidden: the film, its drawing and its music all wait; back on the tab, they carry on.
  let hiddenWasPlaying = false
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenWasPlaying = P.playing; if (P.playing) pauseNow(true); sleepLoop() }
    else { if (hiddenWasPlaying) playNow(); else wakeLoop(); hiddenWasPlaying = false }
  })

  // ---- Loop
  // Field of view and the picture's offset follow each scene's values with a short, smooth lag (about an eighth of
  // a second), so a step in either becomes a glide. They snap on a true cut: a jump to another place or a scene that
  // was not on screen last frame.
  const steadyOn = !params.has('nosteady')
  let tick = 0
  const steady = (st, dt) => {
    const m = st._steady || (st._steady = { fov: st.fov, f: [0, 0], fp: [0, 0], seen: -9 })
    const cut = cutNext || m.seen !== tick - 1 || !steadyOn
    m.seen = tick
    if (cut) { m.fov = st.fov; m.f[0] = st.frame[0]; m.f[1] = st.frame[1]; m.fp[0] = st.framePortrait[0]; m.fp[1] = st.framePortrait[1] }
    else {
      const kf = 1 - Math.exp(-8 * dt)
      m.fov += (st.fov - m.fov) * kf
      m.f[0] += (st.frame[0] - m.f[0]) * kf; m.f[1] += (st.frame[1] - m.f[1]) * kf
      m.fp[0] += (st.framePortrait[0] - m.fp[0]) * kf; m.fp[1] += (st.framePortrait[1] - m.fp[1]) * kf
    }
    st._fov = m.fov; st._frame = m.f; st._framePortrait = m.fp // engine.frameCamera reads these when they are there
  }
  const center = new THREE.Vector2(), cA = new THREE.Vector2(), cB = new THREE.Vector2()
  const look = { ...S[0].look, rc: new THREE.Vector2(0.5, 0.5), lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1) }
  let startFade = 1

  /** Advance the playhead by this frame's real time. While the music plays, the playhead follows the audio clock:
   *  it runs a few per cent faster or slower until any drift between the two is gone, so a run of dropped frames can
   *  never leave the picture ahead of (or behind) the music. */
  const advance = (dtW, now) => {
    if (P.fade) {
      const k = (now - P.fade.t0) / 1000
      if (!P.fade.swapped && k >= 0.32) { P.fade.swapped = true; P.tau = P.fade.to; cutNext = true }
      P.fadeK = k < 0.32 ? smooth(0, 0.32, k) : 1 - smooth(0.4, 0.95, k)
      if (k >= 0.95) { P.fade = null; P.fadeK = 0 }
      if (P.fade && !P.fade.swapped) return
    }
    if (P.glide) {
      const g = P.glide, k = Math.min(1, (now - g.t0) / g.dur)
      P.tau = g.from + (g.to - g.from) * easeInOut(k)
      if (k >= 1) { P.glide = null; P.anchor = null }
      return
    }
    if (!P.playing || P.scrub) return
    let rate = 1
    const a = sound ? sound.clock() : null
    if (a !== null) {
      if (!P.anchor) P.anchor = { a, tau: P.tau }
      else {
        const drift = (a - P.anchor.a) - (P.tau - P.anchor.tau) // > 0: the music is ahead
        if (Math.abs(drift) > 1) P.anchor = { a, tau: P.tau } // a long stall (a phone call): start following afresh
        else rate = clamp(1 + drift * 0.6, 0.9, 1.1)
      }
    } else P.anchor = null
    P.tau += dtW * rate
    if (P.tau >= TL.end) { P.tau = TL.end; end() }
  }

  const frame = () => {
    if (!running) return
    const now = performance.now()
    // A resize clears the canvas, so it happens before this frame renders, never after.
    if ((innerWidth !== engine.w || innerHeight !== engine.h) && innerWidth > 0 && innerHeight > 0 && !rT) onResize()
    if (needSize && innerWidth > 0 && innerHeight > 0) { needSize = false; engine.setSize(innerWidth, innerHeight) }
    const dtW = Math.min(0.5, Math.max(0, (now - lastNow) / 1000)); lastNow = now
    const dt = Math.min(0.05, dtW || 0.016)
    time = freeze ? 3 : time + dt
    advance(dtW, now)
    const was = p
    p = clamp(TL.p(P.tau), 0, N - 0.0001)
    pvel = cutNext ? 0 : (p - was) / dt
    MM.p = p; MM.tau = P.tau
    pv = damp(pv, pvel, 6, dt)
    ptr.sx = damp(ptr.sx, ptr.x, 3, dt); ptr.sy = damp(ptr.sy, ptr.y, 3, dt)

    const i = Math.floor(p), t = p - i
    const A = S[i]
    A.update(i, t, time, dt)
    let B = null, mix = 0
    if (t > T0 && i < N - 1 && S[i + 1] !== A) { B = S[i + 1]; mix = smooth(T0, 1, t); B.update(i + 1, t - 1, time, dt) }
    // The camera is held, not bolted down: it breathes a little all the time (two slow, unrelated waves on each axis, a
    // fraction of a degree), and on a fast move (a glide to another chapter) the view opens by up to two degrees.
    engine.fovKick = Math.min(2, Math.abs(pv) * 1.3)
    const bx = (Math.sin(time * 0.23) + Math.sin(time * 0.37 + 1.7)) * 0.0013, by = (Math.sin(time * 0.19 + 0.6) + Math.sin(time * 0.31 + 2.9)) * 0.001, bz = Math.sin(time * 0.17 + 4.1) * 0.0007
    tick++
    for (const s of B ? [A, B] : [A]) {
      steady(s, dt)
      engine.frameCamera(s)
      if (s.parallax && !freeze) { s.camera.rotateY(bx * s.parallax); s.camera.rotateX(by * s.parallax); s.camera.rotateZ(bz * s.parallax) }
      if (fine && s.parallax) { s.camera.rotateY(-ptr.sx * 0.018 * s.parallax); s.camera.rotateX(ptr.sy * 0.012 * s.parallax) }
      s.sunToView()
      s.afterCamera?.()
    }
    cutNext = false
    if (B) {
      engine.project(A.focus, A.camera, cA); engine.project(B.focus, B.camera, cB)
      center.copy(cA).lerp(cB, smooth(0.2, 0.9, mix))
    }
    // Look: blend toward the incoming chapter during the iris.
    const L = A.look, L2 = B ? B.look : null, k = B ? smooth(0.3, 0.9, mix) : 0
    for (const key of ['bloom', 'threshold', 'bloomRadius', 'exposure', 'sat', 'vig', 'grain']) look[key] = L2 ? L[key] + (L2[key] - L[key]) * k : L[key]
    look.lift.copy(L.lift); look.gain.copy(L.gain)
    if (L2) { look.lift.lerp(L2.lift, k); look.gain.lerp(L2.gain, k) }
    look.radial = L.radial
    look.rc.copy(L.rc)
    look.ca = Math.min(0.006, L.ca + Math.abs(pv) * 0.0025 + (B ? Math.sin(mix * Math.PI) * 0.003 : 0))
    look.fade = Math.max(startFade, P.fadeK)
    engine.render(A, B, mix, center, time, look)
    tl.time(p)

    // HUD
    if (i !== lastI) {
      lastI = i
      railBtns.forEach((b, j) => { b.classList.toggle('is-on', j === i); b.classList.toggle('is-past', j < i); b.setAttribute('aria-current', j === i ? 'step' : 'false') })
      railName.textContent = CHAPTERS[i].name
      count.textContent = String(i).padStart(2, '0')
      const ink = CHAPTERS[i].ink
      if (ink !== lastInk) { html.classList.toggle('is-dark', ink === 'dark'); lastInk = ink }
      chEls.forEach((el, j) => el.classList.toggle('is-live', j === i || (j === i + 1 && t > 0.8)))
    }
    chEls.forEach((el, j) => { if (j === i + 1) el.classList.toggle('is-live', t > 0.8) })
    const d = fruitDay(i, t)
    day.classList.toggle('is-on', d !== null)
    if (d !== null) {
      const dd = Math.floor(d + 0.0001)
      if (dd !== lastDay) { lastDay = dd; dayNum.textContent = dd; daySub.textContent = dayWord(i, dd) }
    }
    if (yearOdo && (i === 2 || (i === 1 && t > 0.8) || (i === 3 && t < 0.2))) roll(yearOdo, 1976 + 50 * (i === 2 ? smooth(0.05, 0.85, t) : i === 3 ? 1 : 0))
    if (i === N - 1) numOdos.forEach((b) => { const n = Number(b.dataset.num); roll(b.querySelector('.odo'), n * smooth(0.6, 0.85, t)) })
    sound?.update(i, t, Boolean(P.glide || P.fade || P.scrub || !P.playing))
    S.forEach((s) => s.ui && s.uiUpdate?.(s === A || s === B, i, t, engine))
    ui.frame()

    // Cursor
    if (fine) {
      ptr.rx = damp(ptr.rx, ptr.cx, 12, dt); ptr.ry = damp(ptr.ry, ptr.cy, 12, dt)
      cDot.style.transform = `translate3d(${ptr.cx}px,${ptr.cy}px,0)`
      cRing.style.transform = `translate3d(${ptr.rx}px,${ptr.ry}px,0)`
      if (!cursor.classList.contains('is-big')) {
        const w = A.dragHit && A.dragHit(ptr.x, ptr.y, i, t) ? 'drag' : MM.state === 'playing' ? 'pause' : 'play'
        if (cWord.textContent !== w) cWord.textContent = w
      }
    }

    // Frame rate, and a quality budget that only ever steps down: when frames take longer than about 22 ms (under
    // 45 a second) for a whole second while the film plays, first draw fewer pixels, step by step; if that is not
    // enough, drop the two costliest effects (depth of field and light shafts). It never steps back up during the film.
    // A browser that holds every page to 30 frames a second (Chrome's and Brave's Energy Saver on battery, a 30 Hz
    // display) is not a slow device: frames then arrive like clockwork every 33 ms while each takes us only a few ms,
    // and the picture keeps its quality. (Frames arriving unevenly, or each costing us much, still count as slow.)
    fpsAcc += dtW; fpsN++
    fpsDt.push(dtW * 1000)
    fpsWork += performance.now() - now
    if (fpsAcc >= 1) {
      MM.fps = Math.round(fpsN / fpsAcc)
      const mean = fpsDt.reduce((a, b) => a + b, 0) / fpsDt.length, even = fpsDt.filter((d) => Math.abs(d - mean) < 3).length / fpsDt.length
      const capped = mean > 28 && mean < 36 && even > 0.85 && fpsWork / fpsN < 9
      MM.capped = capped
      fpsAcc = 0; fpsN = 0; fpsDt.length = 0; fpsWork = 0
      const want = 45, floor = touch ? 0.55 : 0.62
      if (MM.fps < want && !capped && !freeze && P.playing && time > 3) {
        slow = 0
        if (engine.dprScale > floor) { engine.dprScale = Math.max(floor, engine.dprScale * 0.86); needSize = true }
        else if (!engine.lite && MM.fps < want - 8) { engine.lite = true }
        MM.quality = { dprScale: +engine.dprScale.toFixed(2), lite: Boolean(engine.lite), dpr: +engine.dpr.toFixed(2) }
      }
    }
    if (parkAt && now > parkAt && !P.playing && !P.glide && !P.fade) sleepLoop()
  }

  // ---- Begin: the music (when asked for), the opening card leaves, the film plays.
  const pre = $('#pre')
  const leave = () => {
    gsap.to({ v: 1 }, { v: 0, duration: 1.6, delay: embed ? 0.2 : 0.5, ease: 'power2.inOut', onUpdate() { startFade = this.targets()[0].v } })
    if (!pre || !pre.isConnected) { setTimeout(() => intro.play(), embed ? 500 : 0); return }
    pre.classList.add('is-crack'); pre.classList.remove('is-gate')
    setTimeout(() => { pre.classList.add('is-done'); intro.play() }, 700)
    setTimeout(() => pre.remove(), 2000)
  }
  let autoT = 0
  const begin = ({ sound: withSound = false } = {}) => {
    if (MM.destroyed) return
    MM.parked = false
    if (begun) {
      // a second visit to the shop's Legacy page (the film was parked): from the top again
      clearTimeout(autoT)
      if (withSound) { sound?.start(); setTimeout(() => ui.sync(), 1600) }
      P.ended = false; P.glide = null; P.fade = null; P.tau = 0; cutNext = true
      startFade = 1
      gsap.to({ v: 1 }, { v: 0, duration: 1.4, delay: 0.2, ease: 'power2.inOut', onUpdate() { startFade = this.targets()[0].v } })
      intro.progress(0).pause(); setTimeout(() => intro.play(), 400)
      playNow()
      ui.show()
      return
    }
    begun = true
    clearTimeout(autoT)
    if (withSound) { sound?.start(); setTimeout(() => ui.sync(), 1600) }
    leave()
    html.classList.add('is-live')
    const startP = Number(params.get('p'))
    if (startP > 0) { P.tau = TL.tauOf(startP); startFade = 0; intro.progress(1); cutNext = true }
    playNow()
    ui.show()
  }
  MM.begin = begin
  // The shop's page was left: pause, stop drawing, hold the music; begin() starts it again from the top.
  MM.park = () => { MM.parked = true; hiddenWasPlaying = false; pauseNow(true); sleepLoop(); ui.hide() }
  MM.play = playNow; MM.pause = () => pauseNow(); MM.toggle = toggle; MM.next = next; MM.prev = prev
  MM.seek = (pp, how = 'cut') => toP(pp, how)
  MM.goto = (pp) => toP(pp, 'cut') // test tooling: straight to a place in the film
  MM.mute = (m) => (m ? soundOff() : soundOn())
  MM.destroy = () => {
    if (MM.destroyed) return
    MM.destroyed = true
    clearTimeout(autoT)
    sleepLoop()
    ui.destroy()
    gsap.globalTimeline.getChildren().forEach((c) => c.kill())
    sound?.close()
    try { engine.renderer.dispose(); engine.renderer.forceContextLoss() } catch { /* already gone */ }
  }
  MM.ready = true
  MM.stages = S

  if (embed) {
    // The shop's page shows the loading and the Begin button, and calls MM.begin() (it also starts the film by itself
    // if nobody presses Begin). Until then nothing is drawn: the frame is behind the shop's opening.
    setState('ready')
    tell({ ready: true })
  } else if (params.has('p') || params.has('autoplay')) begin({ sound: false })
  else {
    // The film opens on a "Begin" button. Browsers only let a page make sound once the visitor has clicked, tapped or
    // pressed a key, so this one press is what lets the music start with the first frame. Nobody pressing it: the film
    // starts by itself after a few seconds, muted, with a "Sound off · tap to turn on" switch in view.
    const go = $('[data-begin]')
    setState('gate')
    pre.classList.add('is-gate'); pre.removeAttribute('aria-hidden') // the button must be reachable by screen readers
    setTimeout(() => go.focus({ preventScroll: true }), 900) // once it is visible, so Enter or Space begins too
    go.addEventListener('click', () => begin({ sound: true }), { once: true })
    if (!reducedPref) autoT = setTimeout(() => begin({ sound: false }), AUTO_START)
  }
}
const reducedPref = matchMedia('(prefers-reduced-motion: reduce)').matches

boot().catch((e) => {
  console.error(e)
  MM.errors.push(String(e))
  tell({ failed: true })
  still(MM.shots || null)
})
