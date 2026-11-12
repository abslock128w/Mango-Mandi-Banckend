// One Mango: the director. Builds the page, the stage and the chapters; scroll → one master progress p (0…13) that
// drives every scene's state, the camera, the post look and a single paused GSAP timeline for the type.
import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { Engine, detectTier } from './engine.js'
import { CHAPTERS, fruitDay } from './chapters.js'
import { ICONS } from './icons.js'
import { Sound } from './sound.js'
import { buildStill } from './still.js'
import { clamp, damp, smooth } from './lib/util.js'

gsap.registerPlugin(ScrollTrigger)

const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const html = document.documentElement
const params = new URLSearchParams(location.search)
const N = CHAPTERS.length
const T0 = 0.86 // where a chapter's iris into the next one begins
const STAGE_OF = ['seed', 'seed', 'tree', 'blossom', 'fruit', 'fruit', 'crate', 'road', 'grade', 'pack', 'door', 'counter', 'finale']
const KEY_T = [0.3, 0.7, 0.85, 0.55, 0.55, 0.5, 0.5, 0.55, 0.45, 0.6, 0.7, 0.88]
const MM = (window.__mm = { ready: false, p: 0, fps: 0, tier: '', errors: [] })

// ---- Mode -----------------------------------------------------------------------------------------------------------

function webglOk() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2')) } catch { return false }
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still')
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
            <a class="btn is-gold" href="/" data-magnet data-cursor="open">Order this season <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
            <a class="btn is-line" href="/legacy" data-magnet data-cursor="open">Read our legacy</a>
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

// ---- Placeholder stage (for any chapter whose set fails to build: never a blank frame) -----------------------------

async function loadStages(engine, onStep) {
  const mods = {
    seed: () => import('./scenes/seed.js'), tree: () => import('./scenes/tree.js'), blossom: () => import('./scenes/blossom.js'),
    fruit: () => import('./scenes/fruit.js'), crate: () => import('./scenes/crate.js'), road: () => import('./scenes/road.js'),
    grade: () => import('./scenes/grade.js'), pack: () => import('./scenes/pack.js'), door: () => import('./scenes/door.js'),
    counter: () => import('./scenes/counter.js'), finale: () => import('./scenes/finale.js'),
  }
  const out = {}
  const keys = Object.keys(mods)
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]
    try {
      const m = await mods[key]()
      out[key] = new m.default(engine)
    } catch (e) {
      console.warn('stage', key, e)
      const m = await import('./scenes/placeholder.js')
      out[key] = new m.default(engine, key)
    }
    onStep((k + 1) / keys.length)
    await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

// ---- Boot -----------------------------------------------------------------------------------------------------------

async function boot() {
  const film = buildFilm()
  if (!hasGL) return still(null)

  const tier = detectTier()
  MM.tier = tier.name
  const engine = new Engine($('#gl'), tier)
  // If the browser takes the graphics context away (a phone under memory pressure, a long spell in the background),
  // ask for it back and start the film again cleanly, instead of leaving a frozen or black picture.
  $('#gl').addEventListener('webglcontextlost', (e) => { e.preventDefault(); MM.errors.push('context lost') })
  $('#gl').addEventListener('webglcontextrestored', () => location.reload())
  engine.setSize(innerWidth, innerHeight)
  const pre = $('#pre'), preNum = $('[data-pre-num]')
  let shown = 0
  const setLoad = (v) => {
    const target = Math.round(v * 100)
    gsap.to({ v: shown }, { v: target, duration: 0.5, ease: 'power2.out', onUpdate() { shown = this.targets()[0].v; preNum.textContent = Math.round(shown); pre.style.setProperty('--p', (shown / 100).toFixed(3)) } })
  }
  const stages = await loadStages(engine, (f) => setLoad(f * 0.7))
  const S = STAGE_OF.map((k) => stages[k])
  S.forEach((s, i) => s.mountUI && !s._mounted && (s._mounted = true, s.mountUI(film, i)))

  // Compile every set's shaders and grab one still of each chapter (for the finale's ribbon and the still version).
  const shots = []
  {
    const w0 = engine.w, h0 = engine.h
    engine.setSize(800, 500)
    const c2 = document.createElement('canvas')
    for (let i = 0; i < N - 1; i++) {
      const st = S[i]
      try {
        st.update(i, KEY_T[i], 3, 0.016)
        engine.frameCamera(st)
        st.sunToView()
        engine.renderer.compile(st.scene, st.camera)
        engine.render(st, null, 0, null, 0, { ...st.look, ca: 0, radial: 0, fade: 0, grain: 0 })
        c2.width = 800; c2.height = 500
        c2.getContext('2d').drawImage(engine.renderer.domElement, 0, 0, 800, 500)
        shots.push(c2.toDataURL('image/jpeg', 0.86))
      } catch (e) { console.warn('shot', i, e); shots.push(null) }
      setLoad(0.7 + 0.3 * (i + 1) / (N - 1))
      await new Promise((r) => setTimeout(r, 0))
    }
    engine.setSize(w0, h0)
    stages.finale.setShots?.(shots)
  }
  MM.shots = shots
  // Reduced motion: the long-form version, illustrated with stills rendered from the film itself.
  if (reduced) { engine.renderer.setAnimationLoop(null); MM.ready = true; return still(shots) }

  run(engine, S, film)
}

function still(shots) {
  html.classList.add('is-still')
  $('[data-still]').hidden = false
  buildStill($('[data-still-list]'), shots)
  $('#pre')?.remove()
}

// ---- The film -------------------------------------------------------------------------------------------------------

function run(engine, S, film) {
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
  if (fine) html.classList.add('is-fine')
  const lenis = fine && !params.has('nolenis') ? new Lenis({ lerp: 0.075, wheelMultiplier: 0.85, smoothWheel: true }) : null
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add((t) => lenis.raf(t * 1000))
  }
  gsap.ticker.lagSmoothing(0)
  ScrollTrigger.config({ ignoreMobileResize: true })

  // Scroll length: each chapter's weight in screen heights.
  const W = CHAPTERS.map((c) => c.weight), WSUM = W.reduce((a, b) => a + b, 0)
  const CUM = W.reduce((a, w, i) => (a.push(a[i] + w), a), [0])
  const scroller = $('[data-scroller]')
  let vh = innerHeight
  const sizeScroller = () => { scroller.style.height = `${Math.round(WSUM * vh * 1.0 + vh)}px` }
  sizeScroller()
  const sToP = (s) => { // 0…1 of the page → p (chapter + t)
    const x = s * WSUM
    let i = 0
    while (i < N - 1 && x >= CUM[i + 1]) i++
    return Math.min(N - 0.0001, i + (x - CUM[i]) / W[i])
  }
  const pToY = (p) => { const i = Math.floor(clamp(p, 0, N - 0.001)); const x = CUM[i] + (p - i) * W[i]; return (x / WSUM) * (document.documentElement.scrollHeight - innerHeight) }
  let target = 0
  const st = ScrollTrigger.create({ trigger: scroller, start: 'top top', end: 'bottom bottom', onUpdate: (self) => { target = sToP(self.progress) } })

  const goto = (i, frac = 0.42) => {
    const y = pToY(i + (i === N - 1 ? 0.9 : i === 0 ? 0 : frac))
    if (lenis) lenis.scrollTo(y, { duration: Math.min(4, 1.2 + Math.abs(i - p) * 0.35), easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) })
    else window.scrollTo({ top: y, behavior: 'smooth' })
  }
  MM.goto = (pp) => { const y = pToY(pp); if (lenis) lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y); target = pp; p = pp }
  buildRail(goto)
  $('[data-skip]').addEventListener('click', (e) => { e.preventDefault(); goto(N - 1) })
  $('[data-skip]').addEventListener('focus', (e) => e.target.classList.add('is-shown'))

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
      const exitAt = CHAPTERS[i].id === 'pick' ? 0.4 : CHAPTERS[i].id === 'begin' ? 0.32 : 0.7
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
  // Chapter 0's title arrives on load (time-based), not on scroll.
  const intro = gsap.timeline({ paused: true })
  {
    const el = chEls[0]
    intro.fromTo($$('.wi', el), { yPercent: 118, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 1.6, stagger: 0.12, ease: 'expo.out' }, 0.2)
      .fromTo($$('.ch-kick span', el), { yPercent: 120 }, { yPercent: 0, duration: 1.2, ease: 'expo.out' }, 0.1)
      .fromTo($$('.cli', el), { yPercent: 105, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, ease: 'expo.out' }, 0.7)
  }

  // ---- HUD
  const railBtns = $$('[data-rail] button'), railName = $('[data-rail-name]'), count = $('[data-count]')
  const day = $('[data-day]'), dayNum = $('[data-day-num]'), daySub = $('[data-day-sub]'), hint = $('[data-hint]')
  const yearOdo = $('.year .odo'), numOdos = $$('[data-num]')
  let lastI = -1, lastDay = -1, lastInk = ''
  const dayWord = (i, d) => i <= 6 ? 'Plucked' : i === 7 ? (d < 1 ? 'On the road' : 'At the warehouse') : i === 8 ? 'Graded by hand' : i === 9 ? (d < 4 ? 'Raw: days 1 to 3' : 'Semi-ripe: days 4 to 7') : i === 10 ? 'At your door' : 'On your counter'

  // ---- Pointer: parallax, cursor, magnetic buttons, drag-to-turn
  const ptr = { x: 0, y: 0, sx: 0, sy: 0, cx: innerWidth / 2, cy: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2, down: false, dragging: false, lx: 0, ly: 0 }
  const cursor = $('[data-cursor]'), cWord = $('[data-cursor-word]'), cDot = $('.cursor-dot'), cRing = $('.cursor-ring')
  addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = -((e.clientY / innerHeight) * 2 - 1)
    ptr.cx = e.clientX; ptr.cy = e.clientY
    if (e.pointerType === 'mouse') cursor.classList.add('is-on')
    if (ptr.dragging) { curStage()?.dragBy?.((e.clientX - ptr.lx) / innerWidth, (e.clientY - ptr.ly) / innerHeight); ptr.lx = e.clientX; ptr.ly = e.clientY }
  }, { passive: true })
  document.addEventListener('mouseleave', () => cursor.classList.remove('is-on'))
  const curStage = () => S[Math.floor(clamp(p, 0, N - 0.001))]
  const canDrag = (e) => { const s = curStage(); return s && s.dragHit && !e.target.closest('a,button') && s.dragHit((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1), Math.floor(p), p % 1) }
  addEventListener('pointerdown', (e) => { if (canDrag(e)) { ptr.dragging = true; ptr.lx = e.clientX; ptr.ly = e.clientY; cursor.classList.add('is-drag') } })
  addEventListener('pointerup', () => { ptr.dragging = false; cursor.classList.remove('is-drag') })
  addEventListener('pointercancel', () => { ptr.dragging = false })
  addEventListener('touchmove', (e) => { if (ptr.dragging) e.preventDefault() }, { passive: false })
  $$('[data-magnet]').forEach((b) => {
    b.addEventListener('pointermove', (e) => { if (!fine) return; const r = b.getBoundingClientRect(); gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.5, ease: 'power3.out' }) })
    b.addEventListener('pointerleave', () => gsap.to(b, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1,.4)' }))
  })
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('a,button')
    cursor.classList.toggle('is-big', Boolean(t))
    if (t) cWord.textContent = t.dataset.cursor || (t.matches('[data-go]') ? 'go' : 'open')
  })

  // ---- Keyboard: chapter to chapter
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea') || e.metaKey || e.ctrlKey || e.altKey) return
    const i = Math.round(p - 0.42)
    const next = ['ArrowDown', 'PageDown', 'ArrowRight'].includes(e.key) || (e.key === ' ' && !e.shiftKey)
    const prev = ['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key) || (e.key === ' ' && e.shiftKey)
    if (e.key === ' ' && e.target.closest('a,button')) return
    if (next) { e.preventDefault(); goto(Math.min(N - 1, i + 1)) }
    else if (prev) { e.preventDefault(); goto(Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); goto(0) }
    else if (e.key === 'End') { e.preventDefault(); goto(N - 1) }
  })

  // ---- Sound (quiet background music; plays by default, from the visitor's first click, tap or key)
  const sound = new Sound(); MM.sound = sound

  // ---- Resize
  let rT = 0
  const onResize = () => {
    clearTimeout(rT)
    rT = setTimeout(() => {
      needSize = true
      if (Math.abs(innerHeight - vh) > 140 || innerWidth !== lastW) { vh = innerHeight; sizeScroller(); ScrollTrigger.refresh() }
      lastW = innerWidth
    }, 120)
  }
  let lastW = innerWidth
  addEventListener('resize', onResize)

  // ---- Loop
  let p = 0, pv = 0, prevP = 0, time = 0, running = true, fpsAcc = 0, fpsN = 0, slow = 0, needSize = false
  const freeze = params.has('freeze')
  document.addEventListener('visibilitychange', () => { running = !document.hidden })
  const center = new THREE.Vector2(), cA = new THREE.Vector2(), cB = new THREE.Vector2()
  const look = { ...S[0].look, rc: new THREE.Vector2(0.5, 0.5), lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1) }
  let startFade = 1

  const frame = (tSec, dtMs) => {
    if (!running) return
    // A resize clears the canvas, so it happens before this frame renders, never after.
    if (needSize) { needSize = false; engine.setSize(innerWidth, innerHeight) }
    const dt = Math.min(0.05, (dtMs || 16) / 1000)
    time = freeze ? 3 : time + dt
    p = damp(p, target, lenis ? 14 : 7, dt)
    if (Math.abs(p - target) < 0.00005) p = target
    MM.p = p
    const vel = (p - prevP) / Math.max(dt, 1e-3); prevP = p
    pv = damp(pv, vel, 6, dt)
    ptr.sx = damp(ptr.sx, ptr.x, 3, dt); ptr.sy = damp(ptr.sy, ptr.y, 3, dt)

    const i = Math.floor(clamp(p, 0, N - 0.0001)), t = p - i
    const A = S[i]
    A.update(i, t, time, dt)
    let B = null, mix = 0
    if (t > T0 && i < N - 1 && S[i + 1] !== A) { B = S[i + 1]; mix = smooth(T0, 1, t); B.update(i + 1, t - 1, time, dt) }
    for (const s of B ? [A, B] : [A]) {
      engine.frameCamera(s)
      if (fine && s.parallax) { s.camera.rotateY(-ptr.sx * 0.018 * s.parallax); s.camera.rotateX(ptr.sy * 0.012 * s.parallax) }
      s.sunToView()
      s.afterCamera?.()
    }
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
    look.fade = startFade
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
      sound.chapter(i)
    }
    chEls.forEach((el, j) => { if (j === i + 1) el.classList.toggle('is-live', t > 0.8) })
    const d = fruitDay(i, t)
    day.classList.toggle('is-on', d !== null)
    if (d !== null) {
      const dd = Math.floor(d + 0.0001)
      if (dd !== lastDay) { lastDay = dd; dayNum.textContent = dd; daySub.textContent = dayWord(i, dd) }
    }
    hint.classList.toggle('is-away', p > 0.15)
    if (yearOdo && (i === 2 || (i === 1 && t > 0.8) || (i === 3 && t < 0.2))) roll(yearOdo, 1976 + 50 * (i === 2 ? smooth(0.05, 0.85, t) : i === 3 ? 1 : 0))
    if (i === N - 1) numOdos.forEach((b) => { const n = Number(b.dataset.num); roll(b.querySelector('.odo'), n * smooth(0.6, 0.85, t)) })
    sound.update(i, t, pv, time)
    S.forEach((s) => s.ui && s.uiUpdate?.(s === A || s === B, i, t, engine))

    // Cursor
    if (fine) {
      ptr.rx = damp(ptr.rx, ptr.cx, 12, dt); ptr.ry = damp(ptr.ry, ptr.cy, 12, dt)
      cDot.style.transform = `translate3d(${ptr.cx}px,${ptr.cy}px,0)`
      cRing.style.transform = `translate3d(${ptr.rx}px,${ptr.ry}px,0)`
      if (!cursor.classList.contains('is-big')) cWord.textContent = A.dragHit && A.dragHit(ptr.x, ptr.y, i, t) ? 'drag' : 'scroll'
    }

    // Frame rate and the adaptive pixel ratio.
    fpsAcc += dt; fpsN++
    if (fpsAcc > 1) {
      MM.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0
      if (MM.fps < 38 && engine.dprScale > 0.62 && !freeze) { if (++slow >= 2) { engine.dprScale *= 0.86; needSize = true; slow = 0 } } else slow = 0
    }
  }
  gsap.ticker.add(frame)

  // Leave the preloader: the root has drawn; the seed cracks; we drop into the soil.
  const pre = $('#pre')
  const leave = () => {
    pre.classList.add('is-crack')
    gsap.to({ v: 1 }, { v: 0, duration: 1.6, delay: 0.5, ease: 'power2.inOut', onUpdate() { startFade = this.targets()[0].v } })
    setTimeout(() => { pre.classList.add('is-done'); intro.play() }, 700)
    setTimeout(() => pre.remove(), 2000)
  }
  // The film opens on a "Begin" button. Browsers only let a page make sound once the visitor has clicked, tapped or
  // pressed a key (scrolling does not count), so this one click is what lets the music start with the first frame.
  // Test tooling (a ?p= jump, or a driven browser) goes straight in.
  const go = $('[data-begin]')
  if (!go || ((params.has('p') || navigator.webdriver) && !params.has('gate'))) leave()
  else {
    pre.classList.add('is-gate'); pre.removeAttribute('aria-hidden') // the button must be reachable by screen readers
    html.style.overflow = 'hidden'; lenis?.stop()
    setTimeout(() => go.focus({ preventScroll: true }), 900) // once it is visible, so Enter or Space begins too
    go.addEventListener('click', () => { sound.start(); html.style.overflow = ''; lenis?.start(); window.scrollTo(0, 0); pre.classList.remove('is-gate'); leave() }, { once: true })
  }
  const startP = params.get('p')
  if (startP) { requestAnimationFrame(() => { MM.goto(Number(startP)); startFade = 0; intro.progress(1) }) }
  MM.ready = true
  MM.engine = engine
  MM.stages = S
  ScrollTrigger.refresh()
  st.refresh()
}

boot().catch((e) => {
  console.error(e)
  MM.errors.push(String(e))
  still(MM.shots || null)
})
