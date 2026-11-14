// The film's music: one slow, quiet piece in D major that follows the film chapter by chapter.
//   - keys: a soft, bell-like keyboard carries the melody. Its notes are rendered once, with their room already on
//     them, when sound starts; playing one is then just playing a short recording, which is easy work for a phone.
//   - a pad: a few held tones under the melody, changing with the chords.
//   - a bird phrase now and then, far away, in the daytime outdoor chapters only.
// Composed, not random: every chapter has its own phrase (melody, chords, and where the film travels a gentle running
// figure), written out below. The piece keeps time (60 beats a minute); a new chapter takes over at the next half bar,
// and the film's moments (the shoot, the pick, the stamp, the door) are answered by a few notes on the next beat.
// Everything is voiced between about 220 Hz and 2 kHz, where a phone's small speaker still speaks, and mixed low.
// It plays by default and there is no switch. Browsers only let a page make sound after the visitor has clicked,
// tapped or pressed a key, so it starts at the film's Begin button.

const BPM = 60, STEP = 60 / BPM / 2 // the grid is eighth notes: half a second each
const D4 = 293.66
const hz = (semi) => D4 * 2 ** (semi / 12)
const rnd = (a, b) => a + Math.random() * (b - a)

const LEVEL = 0.62 // the whole mix; phones and tablets get a little more, since their speakers are small
const NOTE_LEN = 3.2 // seconds of each rendered note, room included
// Notes rendered (semitones from D4): D3 E3 F#3 G3 A3 B3 C#4 D4 E4 F#4 G4 A4 B4 C#5 D5. Higher ones are these, an octave up.
const RENDERED = [-12, -10, -8, -7, -5, -3, -1, 0, 2, 4, 5, 7, 9, 11, 12]

// Chords: pad tones (semitones from D4), the bass note, and the running figure used where the film travels.
const CHORD = {
  D: { pad: [-5, 0, 4], bass: -12, run: [0, 7, 4, 7] },
  Bm: { pad: [-3, 0, 4], bass: -3, run: [-3, 4, 0, 4] },
  G: { pad: [-7, -3, 0], bass: -7, run: [5, 12, 9, 12] },
  A: { pad: [-5, -1, 2], bass: -5, run: [7, 14, 11, 14] },
  Em: { pad: [-7, -3, 2], bass: -10, run: [2, 9, 5, 9] },
  As: { pad: [-5, 0, 2], bass: -5, run: [7, 14, 12, 14] }, // A with the fourth held: waiting to resolve
}
// Phrases: four bars, sixteen beats. [beat, note, strength]
const THEME = [[0, 16, 0.9], [1.5, 14, 0.55], [2, 12, 0.75], [4, 9, 0.8], [6, 12, 0.55], [7, 14, 0.6], [8, 12, 0.85], [9.5, 9, 0.55], [10, 7, 0.7], [12, 14, 0.8], [14, 11, 0.6]]
const ANSWER = [[0, 16, 0.9], [1.5, 14, 0.55], [2, 12, 0.75], [4, 9, 0.8], [6, 7, 0.6], [8, 9, 0.8], [9, 12, 0.7], [10, 9, 0.55], [12, 14, 0.7], [13, 12, 0.9]]
const CALM = [[0, 7, 0.7], [2, 12, 0.7], [4, 9, 0.7], [8, 5, 0.6], [10, 9, 0.6], [12, 7, 0.7], [14, 2, 0.5]]
const CALM2 = [[0, 12, 0.7], [2, 7, 0.6], [4, 9, 0.7], [6, 12, 0.5], [8, 9, 0.6], [10, 5, 0.6], [12, 4, 0.7], [14, 0, 0.6]]
const DARK = [[0, 0, 0.5], [6, 7, 0.4], [10, 4, 0.4]]
const RISE = [[0, 0, 0.6], [1, 4, 0.6], [2, 7, 0.65], [3, 12, 0.75], [8, 4, 0.6], [9, 7, 0.6], [10, 12, 0.7], [11, 16, 0.8]]
const NIGHT = [[0, 4, 0.6], [3, 2, 0.4], [4, 0, 0.6], [7, -3, 0.4], [8, 2, 0.6], [10, 5, 0.5], [12, 2, 0.6], [14, -1, 0.5]]
const HOLD = [[0, 14, 0.5], [8, 12, 0.4]]
const BLOOM = [[0, 16, 0.8], [1, 19, 0.5], [2, 16, 0.6], [4, 12, 0.7], [5, 14, 0.5], [6, 16, 0.6], [8, 12, 0.8], [9, 14, 0.5], [10, 16, 0.6], [12, 14, 0.8], [14, 19, 0.6]]
const CLOSE = [[0, 16, 0.9], [0, 12, 0.5], [1.5, 14, 0.55], [2, 12, 0.75], [2, 7, 0.4], [4, 9, 0.8], [4, 4, 0.45], [6, 12, 0.55], [7, 14, 0.6], [8, 12, 0.85], [8, 9, 0.45], [9.5, 9, 0.55], [10, 7, 0.7], [12, 14, 0.8], [12, 11, 0.45], [13, 12, 0.6], [14, 12, 0.9], [14, 4, 0.5]]
// What each part of the film plays. run: the travelling figure ({ every: steps between notes, vel, up: octaves }).
const SECTIONS = {
  dark: { chords: ['D', 'D', 'D', 'D'], mel: [DARK], pad: 0.7, lp: 900 },
  rise: { chords: ['D', 'G', 'D', 'A'], mel: [RISE], pad: 0.9, lp: 1600, bass: true },
  theme: { chords: ['D', 'Bm', 'G', 'A'], mel: [THEME, ANSWER], pad: 1, lp: 2000, bass: true, birds: true },
  bloom: { chords: ['D', 'Bm', 'G', 'A'], mel: [BLOOM, THEME], pad: 0.9, lp: 2400, birds: true },
  calm: { chords: ['D', 'G', 'Em', 'As'], mel: [CALM, CALM2], pad: 1, lp: 1900, birds: true },
  hold: { chords: ['As', 'As', 'As', 'As'], mel: [HOLD], pad: 1, lp: 1700 },
  night: { chords: ['Bm', 'G', 'Em', 'A'], mel: [NIGHT], pad: 0.9, lp: 1300 },
  travel: { chords: ['D', 'G', 'Bm', 'A'], mel: [CALM, CALM2], pad: 0.8, lp: 2000, bass: true, run: { every: 1, vel: 0.26, up: 0 }, birds: true },
  nightTravel: { chords: ['Bm', 'G', 'Em', 'A'], mel: [NIGHT], pad: 0.8, lp: 1300, run: { every: 2, vel: 0.24, up: 0 } },
  work: { chords: ['D', 'G', 'Em', 'As'], mel: [CALM2, CALM], pad: 0.9, lp: 1800, run: { every: 2, vel: 0.2, up: 0 } },
  inside: { chords: ['D', 'G', 'Em', 'As'], mel: [CALM, CALM2], pad: 1, lp: 1700, bass: true },
  home: { chords: ['D', 'Bm', 'G', 'A'], mel: [THEME, ANSWER], pad: 1, lp: 2200, bass: true, birds: true },
  finale: { chords: ['D', 'Bm', 'G', 'A'], mel: [CLOSE, ANSWER], pad: 1.1, lp: 2400, bass: true, run: { every: 2, vel: 0.18, up: 0 } },
}
/** Which section the film is in: i = chapter, t = progress through it. */
export function sectionAt(i, t) {
  if (i <= 0) return 'dark'
  if (i === 1) return t < 0.55 ? 'dark' : 'rise'
  if (i === 2) return t > 0.4 && t < 0.66 ? 'night' : 'theme'
  if (i === 3) return 'bloom'
  if (i === 4) return 'calm'
  if (i === 5) return t < 0.6 ? 'hold' : 'theme'
  if (i === 6) return 'theme'
  if (i === 7) return t > 0.24 && t < 0.72 ? 'nightTravel' : 'travel'
  if (i === 8) return 'inside'
  if (i === 9) return 'work'
  if (i === 10) return t < 0.62 ? 'travel' : 'calm'
  if (i === 11) return 'home'
  return 'finale'
}
// The film's moments, answered in notes: [steps after the cue, note, strength].
const CUE = {
  rise: [[0, 0, 0.6], [1, 4, 0.6], [2, 7, 0.65], [3, 12, 0.75], [4, 16, 0.85]], // the shoot reaches the light
  snap: [[0, 12, 0.8], [1, 16, 0.8], [2, 19, 0.85], [4, 24, 0.7]], // the stem lets go
  stamp: [[0, -12, 0.8], [0, 7, 0.7], [2, 16, 0.6]],
  door: [[0, 16, 0.85], [2, 12, 0.85]], // a two-note doorbell
  one: [[0, 19, 0.7]],
}
const CUES = [[1.62, 'rise'], [2.7, 'rise'], [5.6, 'snap'], [9.805, 'stamp'], [10.77, 'door'], [11.83, 'one'], [12.03, 'rise']]

/** A small dark hall: decaying noise whose top end dies first. */
function hall(ctx, sec) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let y = 0
    for (let i = 0; i < n; i++) { const t = i / n, a = 0.1 + 0.5 * (1 - t) * (1 - t); y += a * ((Math.random() * 2 - 1) - y); d[i] = y * Math.exp(-t * 5) * (i < 500 ? i / 500 : 1) * 2 }
  }
  return b
}
/** One key: six partials that start together, softly, and die away, the upper ones sooner. Two slightly detuned copies, left and right. */
function keyNote(ctx, dest, f, t0) {
  const AMP = [1, 0.42, 0.2, 0.1, 0.05, 0.025]
  for (const det of [-3, 3]) {
    const pan = ctx.createStereoPanner(); pan.pan.value = det < 0 ? -0.35 : 0.35; pan.connect(dest)
    AMP.forEach((a0, i) => {
      const n = i + 1, o = ctx.createOscillator(), g = ctx.createGain()
      const a = a0 * (f > 500 ? Math.pow(500 / f, 0.5 * i) : 1) * 0.16 // high notes carry fewer overtones, so they never ring sharp
      o.frequency.value = f * n * (1 + 0.0005 * n * n); o.detune.value = det
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.012)
      g.gain.setTargetAtTime(0, t0 + 0.012, 0.9 * Math.pow(300 / f, 0.35) / (1 + 0.55 * i))
      o.connect(g).connect(pan); o.start(t0); o.stop(t0 + NOTE_LEN - 0.05)
    })
  }
}
/** A far-off bird: a few soft whistled notes. segs = [fromHz, toHz, seconds]. */
function birdPhrase(ctx, dest, t0, segs, gap) {
  const o = ctx.createOscillator(), g = ctx.createGain(); let t = t0
  g.gain.setValueAtTime(0, t0)
  for (const [a, b, d] of segs) {
    o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + d)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + d * 0.3); g.gain.setValueAtTime(0.05, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d)
    t += d + gap
  }
  o.connect(g).connect(dest); o.start(t0); o.stop(t + 0.05)
}
/** Render the instrument once: every note the piece uses, and two bird phrases, each with its room on it. */
async function renderKit(sr) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const N = RENDERED.length, slots = N + 2, len = Math.floor(NOTE_LEN * sr)
  const off = new C(2, len * slots, sr)
  const dry = off.createGain(), lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.3
  const rev = off.createConvolver(); rev.buffer = hall(off, 2.2)
  const wet = off.createGain(); wet.gain.value = 0.3
  dry.connect(lp); lp.connect(off.destination); lp.connect(rev); rev.connect(wet); wet.connect(off.destination)
  RENDERED.forEach((s, k) => keyNote(off, dry, hz(s), k * NOTE_LEN + 0.02))
  // birds: mostly room, so they sit far away
  const far = off.createGain(), farLP = off.createBiquadFilter(); farLP.type = 'lowpass'; farLP.frequency.value = 3600
  const farWet = off.createGain(); farWet.gain.value = 1.4
  far.connect(farLP); farLP.connect(off.destination); farLP.connect(rev); farLP.connect(farWet); farWet.connect(rev)
  birdPhrase(off, far, N * NOTE_LEN + 0.05, [[2700, 2300, 0.12], [2500, 2050, 0.15], [2700, 2300, 0.12], [2500, 2050, 0.16]], 0.09)
  birdPhrase(off, far, (N + 1) * NOTE_LEN + 0.05, [[2100, 2600, 0.14], [2600, 2300, 0.1], [2000, 2700, 0.2]], 0.05)
  const all = await off.startRendering()
  const cut = (k) => {
    const b = off.createBuffer(2, len, sr)
    for (let c = 0; c < 2; c++) { const d = all.getChannelData(c).slice(k * len, (k + 1) * len), f = Math.floor(sr * 0.25); for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f; b.copyToChannel(d, c) }
    return b
  }
  const notes = new Map(RENDERED.map((s, k) => [s, cut(k)]))
  return { notes, birds: [cut(N), cut(N + 1)] }
}

/** The piece itself, on any AudioContext (the page's live one, or an offline one for measuring). */
export class Ambient {
  constructor(ctx, { touch = false } = {}) {
    this.ctx = ctx
    const out = this.out = ctx.createGain(); out.gain.value = LEVEL * (touch ? 1.5 : 1)
    const lim = ctx.createDynamicsCompressor()
    lim.threshold.value = -10; lim.knee.value = 8; lim.ratio.value = 8; lim.attack.value = 0.005; lim.release.value = 0.3
    this.master = ctx.createGain(); this.master.gain.value = 1
    out.connect(lim); lim.connect(this.master); this.master.connect(ctx.destination)
    this.keys = ctx.createGain(); this.keys.connect(out)
    this.padLP = ctx.createBiquadFilter(); this.padLP.type = 'lowpass'; this.padLP.frequency.value = 1200; this.padLP.Q.value = 0.3
    this.padG = ctx.createGain(); this.padG.gain.value = 0; this.padLP.connect(this.padG); this.padG.connect(out)
    this.want = 'dark'; this.sec = null; this.chord = null
    this.pos = 0; this.rep = 0; this.at = null; this.voices = []; this.queue = []; this.nextBird = 0
    this.ready = renderKit(ctx.sampleRate).then((kit) => { this.kit = kit })
  }
  /** Play a rendered note. A note above the rendered range is the one an octave below, played twice as fast. */
  note(semi, t, vel) {
    let s = semi, rate = 1
    while (!this.kit.notes.has(s) && s > 12) { s -= 12; rate *= 2 }
    const buf = this.kit.notes.get(s); if (!buf) return
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain()
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vel * (semi > 14 ? 0.85 : 1)
    src.connect(g); g.connect(this.keys); src.start(Math.max(t, ctx.currentTime))
    src.onended = () => { src.disconnect(); g.disconnect() }
  }
  /** The pad moves to a chord: the old tones fade as the new ones come in. */
  setChord(name, t) {
    if (name === this.chord) return
    this.chord = name
    const ctx = this.ctx
    this.voices.forEach((v) => { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.9); v.os.forEach((o) => o.stop(t + 6)) })
    this.voices = CHORD[name].pad.map((s) => {
      const f = hz(s), g = ctx.createGain(); g.gain.value = 0
      // the octave carries as much as the note itself: a phone speaker drops the bottom
      const os = [[f, 0.55], [f * 2.001, 0.5], [f * 3, 0.12], [f * 4.002, 0.05]].map(([fr, a]) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = fr; og.gain.value = a; o.connect(og); og.connect(g); o.start(t); return o })
      g.connect(this.padLP); g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(0.022, t, 0.8)
      os[0].onended = () => { os.forEach((o) => o.disconnect()); g.disconnect() }
      return { g, os }
    })
  }
  setSection(name) { this.want = name }
  /** A moment in the film: its notes start on the next step of the grid. */
  cue(kind) { if (CUE[kind] && !this.queue.some((q) => q.kind === kind)) this.queue.push({ kind, k: 0 }) }
  /** Schedule every step that starts before `until` (seconds on the context's clock). */
  pump(until) {
    if (!this.kit) return
    const now = this.ctx.currentTime
    if (this.at == null || this.at < now - 1) this.at = now + 0.15 // first run, or back from a long pause
    while (this.at < until) { this.step(this.at); this.at += STEP }
  }
  step(t) {
    // a new part of the film takes over at the next half bar, from the top of its phrase
    if (this.want !== this.sec && this.pos % 4 === 0) { this.sec = this.want; this.pos = 0; this.rep = 0 }
    const S = SECTIONS[this.sec], pos = this.pos, beat = pos / 2, bar = Math.floor(beat / 4)
    const chord = S.chords[bar]
    if (pos % 8 === 0) {
      this.setChord(chord, t)
      this.padG.gain.setTargetAtTime(S.pad, t, 1.2); this.padLP.frequency.setTargetAtTime(S.lp * 0.8, t, 1.2)
      if (S.bass) this.note(CHORD[chord].bass, t, 0.5)
    }
    const quiet = this.queue.length > 0 // while a moment is being answered, the phrase steps back
    if (!quiet) for (const [b, s, v] of S.mel[this.rep % S.mel.length]) if (b === beat) this.note(s, t + rnd(0, 0.012), v * rnd(0.88, 1))
    if (S.run && pos % S.run.every === 0 && !quiet) this.note(CHORD[chord].run[(pos / S.run.every) % 4] + 12 * S.run.up, t + rnd(0, 0.01), S.run.vel * (pos % 4 === 0 ? 1.15 : 0.9))
    this.queue = this.queue.filter((q) => { for (const [k, s, v] of CUE[q.kind]) if (k === q.k) this.note(s, t, v); q.k++; return q.k <= CUE[q.kind][CUE[q.kind].length - 1][0] + 2 })
    if (S.birds && t >= this.nextBird) { if (this.nextBird) { const src = this.ctx.createBufferSource(), g = this.ctx.createGain(); src.buffer = this.kit.birds[Math.random() < 0.5 ? 0 : 1]; g.gain.value = rnd(0.35, 0.6); src.connect(g); g.connect(this.keys); src.start(t + rnd(0.1, 0.4)); src.onended = () => { src.disconnect(); g.disconnect() } } this.nextBird = t + rnd(14, 28) }
    this.pos++
    if (this.pos >= 32) { this.pos = 0; this.rep++ }
  }
}

const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'click', 'keydown']

export class Sound {
  constructor() {
    this.i = 0; this.t = 0; this.p = 0
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
      this.a = new Ambient(this.ctx, { touch: matchMedia('(pointer: coarse)').matches })
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
    this.a.setSection(sectionAt(this.i, this.t))
    this.a.pump(this.ctx.currentTime + 0.6)
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
  /** Every frame, from main.js: the chapter and its progress. Passing one of the film's moments, going forward, cues its notes. */
  update(i, t) {
    const p = i + t, was = this.p
    this.i = i; this.t = t; this.p = p
    if (this.live && p > was && p - was < 0.2) for (const [at, kind] of CUES) if (was < at && p >= at) this.a.cue(kind)
  }
}
