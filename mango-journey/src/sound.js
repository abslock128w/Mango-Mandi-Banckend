// The film's sound: quiet background music, and a few distant birds by day. Nothing else.
//   - a pad: long, slowly changing chords in D major, each fading in and out over several seconds
//   - bells: a few soft notes of the D pentatonic, each on its own loop of a different length, so the pattern never
//     repeats and never clashes (every note of the scale sits well on every chord used)
//   - birds: now and then, far away, in the daytime chapters only
// It is all soft sine tones behind a low-pass filter, mixed low: background, not a soundtrack to listen to.
// It plays by default and there is no switch. Browsers only let a page make sound after the visitor has clicked,
// tapped or pressed a key, so it starts at the first of those (or at once where the browser already allows it).

const D3 = 146.83
const hz = (semi) => D3 * 2 ** (semi / 12)
const rnd = (a, b) => a + Math.random() * (b - a)

const LEVEL = 0.3 // the whole mix; this is the one number that sets how loud the film is

// Chords as semitones above D3: a low root, then an open voicing.
const CH = {
  I: [-12, 0, 7, 14, 16], // D A E F#
  IV: [-7, 5, 12, 16, 21], // G D F# B
  vi: [-3, 4, 12, 14, 19], // B F# D E A
  V: [-5, 2, 7, 12, 14], // A E A D E
  ii: [-10, 2, 9, 12, 16], // E B D F#
  deep: [-12, 0, 7, 12], // D D A D, for underground
}
const PROG = {
  under: ['deep'],
  day: ['I', 'IV', 'I', 'vi', 'IV', 'V'],
  night: ['vi', 'IV', 'ii', 'vi', 'ii', 'IV'],
}
// Bell loops: a note of the pentatonic and how often it comes round (seconds). Lengths share no common beat.
const LOOPS = [[19, 23.7], [24, 29.3], [28, 37.1], [21, 43.9], [16, 31.3]]
const CHORD_LEN = 18

const bump = (t, a, b, edge = 0.05) => Math.min(1, Math.max(0, (t - a) / edge)) * Math.min(1, Math.max(0, (b - t) / edge))

/** What the sound should be at a point in the film: i = chapter, t = progress through it. */
export function moodAt(i, t) {
  const m = { prog: 'day', lp: 2300, bells: 0.6, birds: 0 }
  if (i <= 0) Object.assign(m, { prog: 'under', lp: 700, bells: 0.2 })
  else if (i === 1) { const up = Math.min(1, Math.max(0, (t - 0.55) / 0.3)); Object.assign(m, { prog: up > 0.3 ? 'day' : 'under', lp: 700 + 1400 * up, bells: 0.2 + 0.4 * up, birds: 0.5 * up }) }
  else if (i === 2) { const dark = bump(t, 0.38, 0.66); Object.assign(m, { prog: dark > 0.5 ? 'night' : 'day', lp: 2300 - 600 * dark, birds: 0.7 * (1 - dark) }) }
  else if (i >= 3 && i <= 6) Object.assign(m, { lp: 2500, bells: 0.8, birds: i === 3 ? 0.8 : 0.5 })
  else if (i === 7) { const night = bump(t, 0.24, 0.72, 0.08); Object.assign(m, { prog: night > 0.5 ? 'night' : 'day', lp: 2200 - 500 * night, birds: 0.4 * (1 - night) }) }
  else if (i === 8 || i === 9) Object.assign(m, { lp: 2000, bells: 0.5 })
  else if (i === 10) Object.assign(m, { prog: t > 0.2 && t < 0.62 ? 'night' : 'day', lp: 2100, bells: 0.5 })
  else if (i === 11) Object.assign(m, { lp: 2400, bells: 0.7, birds: 0.3 })
  else Object.assign(m, { lp: 2800, bells: 1 })
  return m
}

/** The sound itself, on any AudioContext (the page's live one, or an offline one for measuring). */
export class Ambient {
  constructor(ctx) {
    this.ctx = ctx
    const out = this.out = ctx.createGain(); out.gain.value = LEVEL
    const lim = ctx.createDynamicsCompressor()
    lim.threshold.value = -12; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.004; lim.release.value = 0.3
    this.master = ctx.createGain(); this.master.gain.value = 1
    out.connect(lim).connect(this.master).connect(ctx.destination)
    // a long, dark hall: decaying noise whose top end dies first
    const rev = ctx.createConvolver(); rev.buffer = this.hall(4.5)
    const revOut = ctx.createGain(); revOut.gain.value = 0.85
    rev.connect(revOut).connect(out)
    // everything musical passes one gentle low-pass, which is what keeps it mellow
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 2300; this.musicLP.Q.value = 0.3
    this.music = ctx.createGain(); this.music.connect(this.musicLP); this.musicLP.connect(out)
    const mSend = ctx.createGain(); mSend.gain.value = 0.55; this.musicLP.connect(mSend).connect(rev)
    // birds: far away, top end rolled off, mostly reverb
    this.amb = ctx.createGain()
    const aLP = ctx.createBiquadFilter(); aLP.type = 'lowpass'; aLP.frequency.value = 4800
    this.amb.connect(aLP); aLP.connect(out)
    const aSend = ctx.createGain(); aSend.gain.value = 0.7; aLP.connect(aSend).connect(rev)
    this.mood = moodAt(0, 0)
    this.prog = this.mood.prog
    this.voices = []
    this.step = 0
    this.next = { chord: 0.05, loops: LOOPS.map((l, k) => 3 + k * 5.3 + rnd(0, 5)), bird: 6 }
  }
  hall(sec) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * sec), b = this.ctx.createBuffer(2, n, sr)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let y = 0
      for (let i = 0; i < n; i++) { const t = i / n, a = 0.08 + 0.5 * (1 - t) * (1 - t); y += a * ((Math.random() * 2 - 1) - y); d[i] = y * Math.exp(-t * 5.2) * (i < 600 ? i / 600 : 1) * 2.2 }
    }
    return b
  }
  /** One pad note: a sine, a slightly detuned soft triangle and a whisper of the octave. */
  padNote(semi, t0, level) {
    const ctx = this.ctx, f = hz(semi), g = ctx.createGain(); g.gain.value = 0
    const parts = [['sine', f, 1], ['triangle', f * 1.0032, 0.3], ['sine', f * 2 * 0.9985, 0.22]].map(([type, fr, a]) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(g); o.start(t0); return o })
    const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.5, 0.5)
    g.connect(pan).connect(this.music)
    g.gain.setValueAtTime(0, t0); g.gain.setTargetAtTime(level, t0, 2.2)
    return { g, parts, pan }
  }
  release(v, t, tau = 2.8) {
    v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, tau)
    v.parts.forEach((o) => o.stop(t + tau * 6))
    v.parts[0].onended = () => { v.parts.forEach((o) => o.disconnect()); v.g.disconnect(); v.pan.disconnect() }
  }
  chord(name, t0) {
    this.voices.forEach((v) => this.release(v, t0 + 0.4))
    this.voices = CH[name].map((s, k) => this.padNote(s, t0 + k * 0.35, 0.055 * (s < 0 ? 0.6 : s > 18 ? 0.8 : 1.1)))
  }
  /** One bell: a sine with two soft overtones, a quick soft start and a long fall. */
  note(semi, t0, level) {
    const ctx = this.ctx, f = hz(semi), g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = rnd(-0.6, 0.6)
    const os = [[f, 1], [f * 2, 0.16], [f * 3.01, 0.04]].map(([fr, a]) => { const o = ctx.createOscillator(); o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(g); o.start(t0); o.stop(t0 + 9.1); return o })
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + 0.04); g.gain.setTargetAtTime(0, t0 + 0.04, 1.5)
    g.connect(p).connect(this.music)
    os[0].onended = () => { os.forEach((o) => o.disconnect()); g.disconnect(); p.disconnect() }
  }
  /** A bird: a soft sine whistle that follows a pitch path. segs = [[fromHz, toHz, seconds, level]], gap between. */
  whistle(t0, segs, gap, pan, level) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan
    let t = t0; g.gain.setValueAtTime(0, t0)
    for (const [a, b, d, l = 1] of segs) {
      o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + d)
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * l, t + Math.min(0.03, d * 0.3)); g.gain.setValueAtTime(level * l, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d)
      t += d + gap
    }
    o.connect(g).connect(p).connect(this.amb); o.start(t0); o.stop(t + 0.05)
    o.onended = () => { o.disconnect(); g.disconnect(); p.disconnect() }
  }
  bird(t0) {
    const pan = rnd(-0.9, 0.9), L = 0.05 * rnd(0.35, 1), kind = Math.random()
    if (kind < 0.4) { const f = rnd(2500, 3200); this.whistle(t0, [[f * 1.18, f, 0.11], [f * 1.02, f * 0.82, 0.14, 0.8]], 0.07, pan, L) } // two sweet falling notes
    else if (kind < 0.7) { const f = rnd(2800, 3500), n = 3 + Math.floor(rnd(0, 3)); this.whistle(t0, Array.from({ length: n }, (_, k) => [f * (1 - k * 0.025), f * 1.12 * (1 - k * 0.025), 0.045, 1 - k * 0.12]), 0.05, pan, L * 0.8) } // a small trill
    else { const f = rnd(2000, 2500); this.whistle(t0, [[f, f * 1.25, 0.16], [f * 1.25, f * 1.1, 0.1, 0.8], [f * 0.95, f * 1.3, 0.2, 0.9]], 0.04, pan, L) } // a liquid three-note phrase
  }
  /** Move towards a mood: slow glides only. */
  setMood(m, t = this.ctx.currentTime) {
    this.mood = m
    this.musicLP.frequency.setTargetAtTime(m.lp, t, 1.5)
    if (m.prog !== this.prog) { this.prog = m.prog; this.step = 0; this.next.chord = Math.min(this.next.chord, t + 0.3) } // a new place: move the harmony now, not at the end of the bar
  }
  /** Schedule everything that starts before `until` (seconds on the context's clock). */
  pump(until) {
    const N = this.next, m = this.mood, now = this.ctx.currentTime, at = (t) => Math.max(t, now + 0.03)
    while (N.chord < until) { const list = PROG[this.prog]; this.chord(list[this.step++ % list.length], at(N.chord)); N.chord = at(N.chord) + CHORD_LEN }
    const voices = Math.round(1 + m.bells * (LOOPS.length - 1))
    LOOPS.forEach(([semi, len], k) => { while (N.loops[k] < until) { if (k < voices) this.note(this.prog === 'under' ? semi - 12 : semi, at(N.loops[k]), 0.07 * rnd(0.6, 1)); N.loops[k] = at(N.loops[k]) + len * rnd(0.97, 1.03) } })
    while (N.bird < until) { if (m.birds > 0.02) this.bird(at(N.bird)); N.bird = at(N.bird) + rnd(5, 13) / Math.max(0.2, m.birds) }
  }
}

const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'click', 'keydown']

export class Sound {
  constructor() {
    this.i = 0; this.t = 0
    this.live = false
    this.wake = () => { this.start(); if (this.live && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {}) }
    GESTURES.forEach((ev) => addEventListener(ev, this.wake, { capture: true, passive: true }))
    document.addEventListener('visibilitychange', () => this.visibility())
    this.start() // plays at once where the browser already allows this page to make sound
  }
  fade(to, sec) { const g = this.a.master.gain, now = this.ctx.currentTime; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(to, now + sec) }
  start() {
    if (this.live) return
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext
      if (!C) return
      this.ctx = new C()
      this.a = new Ambient(this.ctx)
      this.a.master.gain.value = 0
      this.timer = setInterval(() => this.tick(), 120)
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {})
    this.loud()
    this.tick()
  }
  tick() {
    if (this.ctx.state !== 'running' || document.hidden) return
    if (!this.live) { this.live = true; this.fade(1, 3) } // the gesture listeners stay: a phone can interrupt the sound (a call, another app) and the next touch brings it back
    this.a.setMood(moodAt(this.i, this.t))
    this.a.pump(this.ctx.currentTime + 0.5)
  }
  /** iPhones play web audio through the ringer channel, so the silent switch mutes it. Ask for the media channel
   *  instead (Safari 16.4 and later); on older ones, a silent looping audio element does the same. */
  loud() {
    if (this.asked) return
    this.asked = true
    try {
      if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return }
      if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return
      const a = this.hush = new Audio(import.meta.env.BASE_URL + 'silence.wav')
      a.loop = true; a.setAttribute('playsinline', ''); a.volume = 0.001
      a.play().catch(() => { this.asked = false })
    } catch { /* sound simply follows the ringer switch */ }
  }
  visibility() {
    if (!this.live) return
    clearTimeout(this.sleep)
    if (document.hidden) { this.fade(0, 0.15); this.hush?.pause(); this.sleep = setTimeout(() => document.hidden && this.ctx.suspend(), 250) }
    else { this.hush?.play().catch(() => {}); this.ctx.resume().then(() => this.fade(1, 1)).catch(() => {}) }
  }
  chapter() {}
  /** Every frame, from main.js: the chapter and its progress. */
  update(i, t) { this.i = i; this.t = t }
}
