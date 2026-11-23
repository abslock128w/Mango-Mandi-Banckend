// The film's controls: small, quiet, out of the way. Play/Pause (Space), previous/next chapter (← →), a thin bar of
// the whole film with a tick at each chapter (click or drag to move), the time, sound on/off (M), Replay at the end, and
// Skip to shop. They fade away three seconds after the pointer last moved while the film plays, and come back on any
// pointer move, tap, key or wheel; they stay while the film is paused or over, and while they hold keyboard focus.
// The film plays by itself, so a wheel or a swipe up/down does not move it: it shows the controls and a short hint.
// On touch: a tap shows or hides the controls, a swipe left or right goes to the next or previous chapter.
// Markup: index.html [data-ctl]; styles: style.css "Controls".
import { clockText } from './player.js'

const $ = (s, r = document) => r.querySelector(s)
const IDLE = 3000

export function controls(api) {
  const root = $('[data-ctl]'), html = document.documentElement
  const playB = $('[data-ctl-play]', root), prevB = $('[data-ctl-prev]', root), nextB = $('[data-ctl-next]', root)
  const track = $('[data-ctl-track]', root), fill = $('[data-ctl-fill]', root), ticks = $('[data-ctl-ticks]', root), tip = $('[data-ctl-tip]', root)
  const timeEl = $('[data-ctl-time]', root), soundB = $('[data-ctl-sound]', root)
  const pill = $('[data-snd-pill]'), hintEl = $('[data-ctl-hint]')
  const { chapters, starts, duration: D } = api
  const N = chapters.length
  const off = []
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)) }

  ticks.innerHTML = chapters.map((c, i) => (i === 0 ? '' : `<i style="left:${(starts[i] / D * 100).toFixed(3)}%"></i>`)).join('')
  track.setAttribute('aria-valuemax', String(Math.round(D)))

  let shown = false, hideT = 0, hovering = false, scrubbing = false, hintT = 0, lastHint = 0
  const self = { dragging: false }
  const chapterAt = (tau) => { let i = 0; while (i < N - 1 && tau >= starts[i + 1]) i++; return i }
  const label = (i) => `${String(i).padStart(2, '0')} · ${chapters[i].name}`

  const canHide = () => api.state() === 'playing' && !hovering && !scrubbing && !root.contains(document.activeElement)
  const schedule = () => { clearTimeout(hideT); hideT = setTimeout(() => (canHide() ? hide() : schedule()), IDLE) }
  function show() {
    if (!['playing', 'paused', 'ended'].includes(api.state())) return
    if (!shown) { shown = true; html.classList.add('ui-on'); api.onUi(true) }
    schedule()
  }
  function hide() {
    clearTimeout(hideT)
    if (!shown) return
    shown = false; html.classList.remove('ui-on'); api.onUi(false)
  }
  function hint() {
    const now = performance.now()
    if (now - lastHint < 1200) return
    lastHint = now
    hintEl.textContent = api.touch ? 'The film plays by itself · tap the bar to move' : 'The film plays by itself · use ← → to move'
    hintEl.classList.add('is-on')
    clearTimeout(hintT); hintT = setTimeout(() => hintEl.classList.remove('is-on'), 2600)
  }
  function sync() {
    const st = api.state(), snd = api.sound()
    playB.dataset.mode = st === 'ended' ? 'again' : st === 'playing' ? 'pause' : 'play'
    playB.setAttribute('aria-label', st === 'ended' ? 'Watch again' : st === 'playing' ? 'Pause (Space)' : 'Play (Space)')
    soundB.setAttribute('aria-pressed', String(snd))
    soundB.setAttribute('aria-label', snd ? 'Sound is on: turn it off (M)' : 'Sound is off: turn it on (M)')
    soundB.dataset.on = String(snd)
    pill.hidden = snd || !['playing', 'paused', 'ended'].includes(st)
    if (st !== 'playing') { if (['paused', 'ended'].includes(st)) show(); clearTimeout(hideT) } else if (shown) schedule()
  }

  // ---- Buttons
  on(playB, 'click', () => { if (api.state() === 'ended') api.replay(); else api.toggle(); show() })
  on(prevB, 'click', () => { api.prev(); show() })
  on(nextB, 'click', () => { api.next(); show() })
  on(soundB, 'click', () => { api.soundToggle(); show() })
  on(pill, 'click', () => { api.soundOn(); show() })
  on(root, 'pointerenter', () => { hovering = true; show() })
  on(root, 'pointerleave', () => { hovering = false; schedule() })
  on(root, 'focusin', show)
  on(root, 'focusout', () => schedule())

  // ---- The bar: click to go there; drag to scrub (the picture follows the pointer exactly, as it is pure in time).
  const tauAt = (x) => { const r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)) * D }
  let downX = 0, moved = false
  on(track, 'pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    track.setPointerCapture(e.pointerId)
    scrubbing = true; moved = false; downX = e.clientX
    show()
  })
  on(track, 'pointermove', (e) => {
    const tau = tauAt(e.clientX), r = track.getBoundingClientRect()
    tip.textContent = label(chapterAt(tau))
    tip.style.left = `${Math.min(r.width - 8, Math.max(8, e.clientX - r.left))}px`
    if (!scrubbing) return
    if (!moved && Math.abs(e.clientX - downX) > 4) { moved = true; api.scrub(true) }
    if (moved) api.seek(tau, 'cut')
  })
  const up = (e) => {
    if (!scrubbing) return
    scrubbing = false
    if (moved) api.scrub(false)
    else api.seek(tauAt(e.clientX))
    schedule()
  }
  on(track, 'pointerup', up)
  on(track, 'pointercancel', up)
  on(track, 'pointerenter', () => track.classList.add('is-hover'))
  on(track, 'pointerleave', () => track.classList.remove('is-hover'))

  // ---- Keys (the frame, and the shop's page around it, which passes its keys on: self.key)
  const live = () => ['playing', 'paused', 'ended'].includes(api.state())
  const key = (k, target) => {
    if (!live()) return false
    const onControl = target && target.closest && target.closest('button, a')
    if (k === ' ' || k === 'k' || k === 'K') { if (onControl) return false; if (api.state() === 'ended') api.replay(); else api.toggle() }
    else if (k === 'ArrowRight') api.next()
    else if (k === 'ArrowLeft') api.prev()
    else if (k === 'm' || k === 'M') api.soundToggle()
    else if (k === 'Home') api.toChapter(0)
    else if (k === 'End') api.toChapter(N - 1)
    else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(k)) hint()
    else if (k === 'Escape') { hide(); return true }
    else { show(); return false }
    show()
    return true
  }
  self.key = key
  on(window, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (key(e.key, e.target)) e.preventDefault()
  })

  // ---- Wheel and touch: the film is not scrolled. A wheel shows the controls and the hint; nothing moves.
  on(window, 'wheel', (e) => { e.preventDefault(); if (!live()) return; show(); if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) hint() }, { passive: false })
  on(window, 'pointermove', (e) => { if (e.pointerType === 'mouse') show() }, { passive: true })
  let tDown = null
  on(window, 'pointerdown', (e) => { tDown = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType, target: e.target } }, { passive: true })
  on(window, 'pointerup', (e) => {
    const d = tDown; tDown = null
    if (!d || self.dragging) return
    const t = d.target instanceof Element ? d.target : null
    if (t && t.closest('[data-ctl], a, button, [data-snd-pill], [data-ctl-hint]')) return
    if (!live()) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y, dt = performance.now() - d.t
    if (d.type === 'touch' || d.type === 'pen') {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? api.next() : api.prev(); show() }
      else if (Math.abs(dy) > 40) { show(); hint() }
      else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 450) { if (shown) hide(); else show() }
    } else if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && e.button === 0) {
      // a click on the picture: pause or play, like a video
      if (api.state() === 'ended') return
      api.toggle(); show()
    }
  }, { passive: true })

  // ---- Every frame: the bar and the time.
  let lastFill = -1, lastSec = -1, lastCh = -1
  self.frame = () => {
    const tau = api.tau(), k = tau / D
    if (Math.abs(k - lastFill) > 0.0004) { lastFill = k; fill.style.transform = `scaleX(${k.toFixed(4)})` }
    const sec = Math.floor(tau)
    if (sec !== lastSec) {
      lastSec = sec
      timeEl.textContent = `${clockText(tau)} / ${clockText(D)}`
      track.setAttribute('aria-valuenow', String(sec))
      const i = chapterAt(tau)
      if (i !== lastCh) { lastCh = i; track.setAttribute('aria-valuetext', `${label(i)}, ${clockText(tau)} of ${clockText(D)}`) }
    }
  }
  self.show = show
  self.hide = hide
  self.sync = sync
  self.hint = hint
  self.destroy = () => { clearTimeout(hideT); clearTimeout(hintT); off.forEach((f) => f()) }
  root.hidden = false
  return self
}
