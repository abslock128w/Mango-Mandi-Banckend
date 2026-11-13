// The people: our VMR Mangoes rider (who checks, packs and delivers our mango, and whose gloved hand picked it), and,
// with the same rig in home clothes, the customer at the door. Stylised, soft "vinyl figure" craft at real proportions,
// in the units of the mango (a mango ≈ 2 units ≈ 12 cm, so he stands ≈ 29 units tall).
//
// The body is one continuous skinned figure (no visible joints): a tailored jacket (chest, waist and hip taper, a ribbed
// hem band, a stand collar, a zip placket, a flapped chest pocket, welt pockets, gold piping, soft folds at the waist,
// armpits and elbows, knit cuffs, the wordmark on chest and back); cream trousers with a crease, folds at the knee and a
// break over real shoes with soles and laces; a neck; a sculpted head with a jaw, cheeks, a chin, a nose with a bridge
// and nostrils, lips with a smile, ears; eyes with iris, pupil and a catch-light under lids that blink, lashes and brows;
// short hair under a panelled gold cap, or a gold helmet with a visor, vents and a chin strap; cotton gloves
// (src/lib/hand.js). The customer: a block-printed kurta with gold borders, a dupatta over the shoulders, bangles,
// sandals, her hair in a bun with jasmine, a bindi. Skin has a warm subsurface glow, cloth a woven bump and a soft rim.
//
// Posing (unchanged):
//   person.j.<joint>.rotation           hips, spine, chest, neck, head, shoulderL/R, elbowL/R, wristL/R, hipL/R,
//                                       kneeL/R, ankleL/R (+ toeL/R, eyeL/R, lidL/R)  (faces +z; +x is his left)
//   person.pose({ joint: [x, y, z], …, curlL, curlR, thumbL, thumbR, spreadL, spreadR, smile, blink })
//   Person.lerpPose(a, b, k)
//   person.reach('L'|'R', palmWorld, handQuatWorld, poleWorld?)  arm IK; palm normal = local +y, fingers = local +z
//   person.palmBasis(normal, fingers)   → a quaternion for reach()
//   person.palmWorld(side)
//   person.setHelmet(bool), person.looseHelmet() → a static copy of the helmet
//   person.foot('L'|'R', ankleWorld, yaw, pitch, poleWorld?)  leg IK; the foot flat (pitch 0) and facing yaw (world)
//   person.lookAt(worldPoint, headK = 1, eyeK = 1)  turns neck and head (blended over the pose) and aims the eyes
//   Person.blinkAt(time, seed)          0…1, a natural blink rhythm
// Conventions: shoulder/hip rotation.x < 0 swings the limb forward; elbow.x < 0 bends the forearm forward/up;
// knee.x > 0 bends the shin back.
import * as THREE from 'three'
import { Hand, SkinGeo, addRim, rimUniforms, bumpTex, blendW, sup, twillTex, stitch } from './hand.js'
import { canvasTex, rng } from './util.js'

export const UNIFORM = { green: '#174631', gold: '#ffb81f', cream: '#efe6cf', skin: '#8d5b3d', hair: '#1b130d', shoe: '#2a1d14' }

let clothTex = null
function cloth() {
  if (clothTex) return clothTex
  clothTex = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
    const r = rng(12)
    for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H, s = 30 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.012 + r() * 0.012})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s) }
    for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.04})`; g.fillRect(0, y, W, 1) }
    for (let x = 0; x < W; x += 3) { g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.04})`; g.fillRect(x, 0, 1, H) }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * W, r() * H, 3 + r() * 8, 1) }
  }, { repeat: true })
  return clothTex
}
let printTex = null
/** A hand-block print for the customer's kurta: small cream and ochre motifs on white (tinted by vertex colour). */
function blockPrint() {
  if (printTex) return printTex
  printTex = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
    const r = rng(77)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const cx = (x + (y % 2) * 0.5) * 32 + 16, cy = y * 32 + 16
      g.fillStyle = 'rgba(255,236,190,.95)'
      for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283; g.beginPath(); g.ellipse(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, 4, 2, a, 0, 6.283); g.fill() }
      g.fillStyle = 'rgba(214,150,50,.95)'; g.beginPath(); g.arc(cx, cy, 2.6, 0, 6.283); g.fill()
      g.fillStyle = `rgba(120,40,30,${0.1 + r() * 0.08})`; g.fillRect(cx + 10, cy + 10, 2, 2)
    }
  }, { repeat: true })
  return printTex
}
const eyeTexs = {}
/** The eye: an off-white sclera warming to pink at the edge, an iris with fibres, a darker limbal ring and a lighter
 *  collarette, the pupil. Mapped flat onto the front of the eyeball (uv = 0.5 + xy / 2r). */
function eyeTexture(iris = '#4a2a14') {
  if (eyeTexs[iris]) return eyeTexs[iris]
  eyeTexs[iris] = canvasTex(256, 256, (g, W, H) => {
    const c = W / 2
    let gr = g.createRadialGradient(c, c, 40, c, c, 128)
    gr.addColorStop(0, '#f3ece3'); gr.addColorStop(0.55, '#ece2d6'); gr.addColorStop(1, '#d9bfb2')
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
    const r = rng(9)
    g.strokeStyle = 'rgba(190,90,80,.12)'; g.lineWidth = 0.8
    for (let i = 0; i < 14; i++) { const a = r() * 6.283; g.beginPath(); g.moveTo(c + Math.cos(a) * 125, c + Math.sin(a) * 125); g.quadraticCurveTo(c + Math.cos(a + 0.2) * 100, c + Math.sin(a + 0.2) * 100, c + Math.cos(a) * 82, c + Math.sin(a) * 82); g.stroke() }
    const ir = 64, col = new THREE.Color(iris)
    const hex = (k, a = 1) => `rgba(${Math.round(Math.min(255, col.r * 255 * k))},${Math.round(Math.min(255, col.g * 255 * k))},${Math.round(Math.min(255, col.b * 255 * k))},${a})`
    gr = g.createRadialGradient(c, c, 20, c, c, ir)
    gr.addColorStop(0, hex(1.9)); gr.addColorStop(0.45, hex(1.25)); gr.addColorStop(0.8, hex(0.9)); gr.addColorStop(0.93, hex(0.45)); gr.addColorStop(1, hex(0.25))
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, ir, 0, 6.283); g.fill()
    for (let i = 0; i < 160; i++) { const a = r() * 6.283, r0 = 24 + r() * 8, r1 = 44 + r() * 18; g.strokeStyle = r() < 0.5 ? hex(2.2, 0.25) : hex(0.4, 0.3); g.lineWidth = 0.7 + r() * 1.2; g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a + (r() - 0.5) * 0.1) * r1, c + Math.sin(a + (r() - 0.5) * 0.1) * r1); g.stroke() }
    g.strokeStyle = hex(2.4, 0.35); g.lineWidth = 3; g.beginPath(); g.arc(c, c, 31, 0, 6.283); g.stroke()
    g.strokeStyle = 'rgba(10,5,2,.6)'; g.lineWidth = 4; g.beginPath(); g.arc(c, c, ir - 1.5, 0, 6.283); g.stroke()
    g.fillStyle = '#060302'; g.beginPath(); g.arc(c, c, 25, 0, 6.283); g.fill()
  }, { repeat: false, aniso: 8 })
  return eyeTexs[iris]
}
let catchTex = null
/** Black, with a white corner: the emissive map that lights only the catch-light (its uv sits in the corner). */
function catchLight() {
  if (catchTex) return catchTex
  catchTex = canvasTex(32, 32, (g, W, H) => { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(W - 6, 0, 6, 6) }, { repeat: false })
  return catchTex
}

let markImg = null
/** The wordmark (brand-dark.webp: cream letters, a mango for the O) as a canvas texture; redrawn once the image loads. */
export function wordmarkTexture({ w = 1024, h = 512, bg = null, sub = '' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const draw = () => {
    g.clearRect(0, 0, w, h)
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h) }
    if (markImg && markImg.complete && markImg.naturalWidth) {
            const sw = markImg.naturalWidth, sh = markImg.naturalHeight
      // The mark's letters sit in the middle of the image; crop to them.
      const cx = sw * 0.04, cy = sh * 0.24, cw = sw * 0.92, ch = sh * 0.52
      const k = Math.min(w * 0.9 / cw, h * (sub ? 0.66 : 0.86) / ch)
      g.drawImage(markImg, cx, cy, cw, ch, (w - cw * k) / 2, (h - ch * k) / 2 - (sub ? h * 0.08 : 0), cw * k, ch * k)
    } else {
      g.fillStyle = '#f6efdc'; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.font = `700 ${h * 0.3}px Figtree, system-ui, sans-serif`
      g.fillText('VMR', w / 2, h * 0.32); g.fillText('MANGOES', w / 2, h * 0.64)
    }
    if (sub) {
      g.fillStyle = '#ffb81f'; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.font = `700 ${Math.round(h * 0.075)}px Figtree, system-ui, sans-serif`
      g.fillText(sub, w / 2, h * 0.88)
    }
    tex.needsUpdate = true
  }
  if (!markImg) { markImg = new Image(); markImg.src = import.meta.env.BASE_URL + 'brand-dark.webp' }
  draw()
  if (!markImg.complete) markImg.addEventListener('load', draw, { once: true })
  if (document.fonts) document.fonts.ready.then(draw)
  return tex
}

const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
const G = (x, w) => Math.exp(-(x * x) / w)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h) }
const lin = (c) => { const k = new THREE.Color(c); return [k.r, k.g, k.b] }
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
/** Piecewise-smooth lookup in a table of [y, ...values] (smoothstep between rows). */
function table(T, y, col) {
  if (y <= T[0][0]) return T[0][col]
  for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const k = sm(T[i - 1][0], T[i][0], y); return T[i - 1][col] + (T[i][col] - T[i - 1][col]) * k }
  return T[T.length - 1][col]
}
/** A smooth (cubic Hermite, finite-difference tangents) lookup in a table of rows sorted by column 0. */
function curve(T, y, col) {
  const n = T.length
  if (y <= T[0][0]) return T[0][col]
  if (y >= T[n - 1][0]) return T[n - 1][col]
  let i = 1; while (T[i][0] < y) i++
  const y0 = T[i - 1][0], y1 = T[i][0], v0 = T[i - 1][col], v1 = T[i][col], h = y1 - y0, t = (y - y0) / h
  const slope = (k) => (k <= 0 ? (T[1][col] - T[0][col]) / (T[1][0] - T[0][0]) : k >= n - 1 ? (T[n - 1][col] - T[n - 2][col]) / (T[n - 1][0] - T[n - 2][0]) : (T[k + 1][col] - T[k - 1][col]) / (T[k + 1][0] - T[k - 1][0]))
  const m0 = slope(i - 1) * h, m1 = slope(i) * h, t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1
}
/** Rows resampled every `step` along column 0 (from the first row to the last), with the other columns by `curve`. */
const resample = (T, step) => {
  const out = [], y0 = T[0][0], y1 = T[T.length - 1][0], n = Math.max(2, Math.ceil(Math.abs(y1 - y0) / step))
  for (let k = 0; k <= n; k++) { const y = y0 + ((y1 - y0) * k) / n; out.push(T[0].map((_, c) => (c === 0 ? y : curve(y1 > y0 ? T : [...T].reverse(), y, c)))) }
  return out
}

const OUTFITS = {
  rider: {
    jacket: UNIFORM.green, trim: UNIFORM.gold, trousers: '#d6c39b', skin: UNIFORM.skin, hair: UNIFORM.hair, shoe: '#2a1d14', sole: '#d9cdb0',
    glove: '#e3d7bb', hat: 'cap', long: false, scale: 1, lip: '#6e3826', iris: '#6a3c1c',
  },
  home: {
    jacket: '#b84a36', trim: '#e8b04a', trousers: '#efe2c6', skin: '#9a6444', hair: '#1c120b', shoe: '#7a2a2a', sole: '#c49a5a',
    glove: '#9a6444', hat: 'bun', long: true, scale: 0.94, lip: '#8a3a34', stole: '#5e2446', iris: '#7a4a22',
  },
}

export class Person extends THREE.Group {
  constructor({ helmet = false, outfit = 'rider', apron = false, lod = 1 } = {}) {
    super()
    const N = (n) => Math.max(6, Math.round(n * lod)) // segment counts scale with the tier
    const O = (this.outfit = OUTFITS[outfit] || OUTFITS.rider)
    const home = outfit === 'home'
    const rim = (this.rimU = rimUniforms(home ? '#ffd8b0' : '#ffe2b8', 0.32))
    const mk = (Cls, o, opt) => addRim(new Cls(o), rim, opt)
    const TW = home ? 2.6 : 0.75 // world size of one tile of the jacket (twill) or kurta (print) texture
    const jacketM = mk(THREE.MeshPhysicalMaterial, { color: '#ffffff', vertexColors: true, roughness: 0.8, map: home ? blockPrint() : twillTex(), bumpMap: twillTex(true), bumpScale: home ? 0.9 : 1.7, sheen: home ? 0.5 : 0.75, sheenRoughness: 0.55, sheenColor: new THREE.Color(home ? '#ffd0b0' : '#9fd0ae') })
    const trouserM = mk(THREE.MeshPhysicalMaterial, { color: '#ffffff', vertexColors: true, roughness: 0.86, map: cloth(), bumpMap: bumpTex('cotton'), bumpScale: 1.2, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color('#fff4dc') })
    const skinM = mk(THREE.MeshPhysicalMaterial, { color: '#ffffff', vertexColors: true, roughness: 0.5, bumpMap: bumpTex('skin'), bumpScale: 0.3, sheen: 0.4, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ffb48a'), clearcoat: 0.18, clearcoatRoughness: 0.5 }, { sss: 0.14 })
    const hairM = mk(THREE.MeshPhysicalMaterial, { side: THREE.DoubleSide, color: '#ffffff', vertexColors: true, roughness: 0.5, bumpMap: bumpTex('hair'), bumpScale: 2.2, sheen: 0.4, sheenRoughness: 0.35, sheenColor: new THREE.Color('#6a5040'), clearcoat: 0.2, clearcoatRoughness: 0.4 })
    const shoeM = mk(THREE.MeshPhysicalMaterial, { color: '#ffffff', vertexColors: true, roughness: 0.45, bumpMap: bumpTex('leather'), bumpScale: 0.8, clearcoat: 0.35, clearcoatRoughness: 0.4 })
    const eyeM = new THREE.MeshPhysicalMaterial({ map: eyeTexture(O.iris), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#fffaf0', emissiveIntensity: 1.1, emissiveMap: catchLight() })
    const capM = mk(THREE.MeshPhysicalMaterial, { side: THREE.DoubleSide, color: '#ffffff', vertexColors: true, roughness: 0.8, map: twillTex(), bumpMap: twillTex(true), bumpScale: 1.4, sheen: 0.5, sheenColor: new THREE.Color('#fff0c0') })
    const helmM = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: '#ffffff', vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 })
    const visorM = new THREE.MeshPhysicalMaterial({ color: '#3a2a14', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1 })
    this.mats = { jacket: jacketM, trousers: trouserM, skin: skinM, hair: hairM, shoe: shoeM, cap: capM, helmet: helmM }

    // ---- Skeleton (rest pose: arms hanging straight down) ----
    const J = (this.j = {}), bones = []
    const B = (name, parent, x = 0, y = 0, z = 0) => { const g = new THREE.Bone(); g.name = name; g.position.set(x, y, z); parent.add(g); J[name] = g; bones.push(g); return g }
    const hips = B('hips', this, 0, 15.45, 0)
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const hp = B('hip' + L, hips, 1.45 * s, -0.4, 0)
      const kn = B('knee' + L, hp, 0, -7.0, 0)
      const an = B('ankle' + L, kn, 0, -6.7, 0)
      B('toe' + L, an, 0, -1.0, 2.2)
    }
    const spine = B('spine', hips, 0, 1.2, 0)
    const chest = B('chest', spine, 0, 3.0, 0)
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const sh = B('shoulder' + L, chest, 2.75 * s, 2.45, 0)
      const el = B('elbow' + L, sh, 0, -5.0, 0)
      B('wrist' + L, el, 0, -4.15, 0)
    }
    const neck = B('neck', chest, 0, 3.5, 0.1)
    const head = B('head', neck, 0, 1.4, 0.15)
    const EYE = { x: 0.6, y: 1.98, z: 1.36, r: 0.335 }
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      B('eye' + L, head, EYE.x * s, EYE.y, EYE.z)
      B('lid' + L, head, EYE.x * s, EYE.y, EYE.z)
    }
    this.updateMatrixWorld(true)
    const skeleton = (this.skeleton = new THREE.Skeleton(bones))
    const I = (n) => bones.indexOf(J[n])
    const W = (pairs) => pairs.filter((p) => p[1] > 1e-4)
    const wp = (n) => J[n].getWorldPosition(new THREE.Vector3())

    // ---- The jacket (or kurta) torso surface ----
    const hemY = home ? 8.6 : 14.3
    const TT = home
      ? [
        // y, half-width, half-depth, centre z, superellipse n
        [hemY, 3.3, 2.2, 0.05, 2.4], [10.2, 3.08, 2.06, 0.05, 2.4], [11.6, 2.88, 1.96, 0.05, 2.4], [13.2, 2.66, 1.84, 0.04, 2.4],
        [14.6, 2.52, 1.72, 0.03, 2.45], [15.6, 2.36, 1.6, 0.02, 2.5], [16.4, 2.3, 1.56, 0.03, 2.5], [17.4, 2.44, 1.7, 0.08, 2.5],
        [18.6, 2.68, 1.92, 0.16, 2.5], [19.6, 2.82, 1.98, 0.14, 2.5], [20.7, 2.98, 1.84, 0.06, 2.6], [21.7, 3.0, 1.68, 0.0, 2.6],
        [22.35, 2.74, 1.5, 0.0, 2.5], [22.95, 2.06, 1.3, 0.05, 2.2], [23.35, 1.42, 1.15, 0.08, 2.0], [23.55, 1.2, 1.05, 0.1, 2.0],
      ]
      : [
        [hemY, 2.44, 1.64, 0.05, 2.4], [14.72, 2.5, 1.68, 0.05, 2.4], [14.85, 2.56, 1.73, 0.05, 2.45], [15.35, 2.58, 1.74, 0.04, 2.5],
        [16.2, 2.44, 1.62, 0.02, 2.5], [17.3, 2.54, 1.72, 0.06, 2.5], [18.6, 2.8, 1.92, 0.12, 2.5], [19.8, 2.98, 2.0, 0.12, 2.55],
        [20.9, 3.1, 1.9, 0.06, 2.65], [21.7, 3.1, 1.72, 0.0, 2.7], [22.35, 2.84, 1.52, 0.0, 2.6], [22.95, 2.14, 1.32, 0.05, 2.3],
        [23.35, 1.45, 1.16, 0.08, 2.0], [23.55, 1.22, 1.06, 0.1, 2.0],
      ]
    const torsoAt = (a, y, off = 0) => {
      const n = curve(TT, y, 4), [cz, cx] = sup(a, n)
      const w = curve(TT, y, 1) + off, d = curve(TT, y, 2) + off
      return new THREE.Vector3(cx * w, y, curve(TT, y, 3) + cz * d)
    }
    const torsoW = (p) => {
      const y = p.y
      let w = y < 15.4 ? [[I('hips'), 1]] : y < 17.4 ? blendW(I('hips'), I('spine'), y, 15.4, 17.4) : blendW(I('spine'), I('chest'), y, 17.4, 19.4)
      const sd = p.x > 0 ? 'L' : 'R'
      const s = sm(1.5, 2.8, Math.abs(p.x)) * sm(20.4, 22.2, y) * 0.5
      if (s > 0) { w = w.map(([b, k]) => [b, k * (1 - s)]); w.push([I('shoulder' + sd), s]) }
      const f = sm(15.6, home ? 11 : 14.4, y) * Math.max(sm(-0.2, 1.2, p.z), home ? sm(0.2, -1.2, p.z) * 0.6 : 0) * sm(0.2, 1.2, Math.abs(p.x)) * (home ? 0.7 : 0.55)
      if (f > 0) { w = w.map(([b, k]) => [b, k * (1 - f)]); w.push([I('hip' + sd), f]) }
      return W(w)
    }
    // soft folds: gathered over the hem band, ripples from the armpits, a little compression at the waist
    const torsoFold = (a, y, p) => {
      const ax = Math.abs(p.x)
      let k = 0
      if (!home) k += 0.04 * Math.sin(a * 13 + 0.8 * Math.sin(a * 3)) * G(y - 15.2, 0.05) * sm(14.8, 14.95, y)
      k += 0.028 * Math.sin((ax * 0.9 - (y - 20.2) * 1.1) * 6.5) * G(ax - 2.25, 0.3) * G(y - 20.2, 0.35) * (home ? 0.5 : 1)
      k += 0.018 * Math.sin(y * 8.5 + a) * G(ax - 2.3, 0.2) * G(y - 16.6, 0.4)
      if (p.z < 0) k += 0.02 * Math.sin(p.x * 3.2) * sm(21.3, 19.5, y) * sm(15, 17, y) // drape down the back
      return k
    }
    const C = { jacket: lin(O.jacket), trim: lin(O.trim), dark: mul3(lin(O.jacket), 0.55), zip: lin('#c9a650') }
    const jacket = new SkinGeo()
    const circ = 2 * Math.PI * 2.3
    {
      const rings = []
      const ys = []
      for (let y = hemY; y < 23.5; y += 0.25 / Math.max(0.6, lod)) ys.push(y)
      ys.push(23.5)
      for (const y of ys) rings.push({ c: new THREE.Vector3(0, y, 0), x: new THREE.Vector3(0, 0, 1), y: new THREE.Vector3(1, 0, 0), y0: y })
      jacket.tube(rings, {
        seg: N(52), capStart: false, uScale: circ / TW, v1: (23.5 - hemY) / TW,
        disp: (p, a, R) => {
          const q = torsoAt(a, R.y0); p.copy(q)
          const k = torsoFold(a, R.y0, p)
          if (k) { const nx = p.x, nz = p.z - curve(TT, R.y0, 3), l = Math.hypot(nx, nz) || 1; p.x += (nx / l) * k; p.z += (nz / l) * k }
        },
        wfn: torsoW,
        cfn: (p, a, R) => {
          const y = R.y0, ax = Math.abs(p.x)
          let o = 1
          o *= 0.8 + 0.2 * sm(hemY, hemY + 0.4, y) // hem shade
          if (!home && y < 14.78) o *= 0.86 + 0.08 * Math.cos(a * 30) // the ribbed hem band
          if (!home && Math.abs(y - 14.8) < 0.05) o *= 0.7 // its seam
          if (Math.abs(ax - 2.42) < 0.07 && Math.abs(p.z - 0.05) < 0.7) o *= 0.84 // side seams
          if (Math.abs(y - 21.2) < 0.06 && p.z < 0) o *= 0.8 // back yoke seam
          if (y > 22.2 && Math.abs(p.z - 0.05) < 0.08) o *= 0.82 // shoulder seams
          o *= 1 - 0.3 * sm(1.6, 2.9, ax) * sm(21.6, 20.2, y) * sm(19.2, 20.3, y) * sm(0.9, 0, Math.abs(p.z)) // under the arms
          o *= 1 + 2.2 * torsoFold(a, y, p) // folds catch the light on top, shade below
          o *= 1 - 0.12 * sm(22.6, 23.4, y) * sm(1.4, 0.6, ax) // under the collar
          let c = mul3(C.jacket, o)
          if (home) {
            // kurta borders: a gold band and a maroon one above the hem
            const h = y - hemY
            if (h < 0.18) c = mul3(C.trim, 0.95)
            else if (h < 0.62) c = mul3(lin('#6a1f2a'), 1 + 0.25 * Math.sin(a * 24))
            else if (h < 0.72) c = C.trim
          }
          return c
        },
      })
      // A row of rings closing the hem inward (so the inside never shows a hole).
      const inner = [hemY + 0.01, hemY + 0.6].map((y, i) => ({ c: new THREE.Vector3(0, y, 0), x: new THREE.Vector3(0, 0, -1), y: new THREE.Vector3(1, 0, 0), y0: y, k: i }))
      jacket.tube(inner, { seg: N(52), disp: (p, a, R) => { const aa = -a; p.copy(torsoAt(aa, R.y0, -0.06 - R.k * 0.25)) }, wfn: torsoW, cfn: () => mul3(C.jacket, 0.3) })
    }
    // Gold piping: hem, a gold line around the collar's top edge, along the placket edges.
    const pipe = (Gs, pts, r, wfn, col, seg = 5) => {
      const crv = new THREE.CatmullRomCurve3(pts)
      const Nn = Math.max(8, Math.round(pts.length * 1.15 * Math.min(1, lod + 0.2)))
      const rings = []
      for (let k = 0; k <= Nn; k++) {
        const u = k / Nn, c = crv.getPointAt(u), t = crv.getTangentAt(u)
        const n0 = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
        const x = new THREE.Vector3().crossVectors(t, n0).normalize(), y = new THREE.Vector3().crossVectors(x, t).normalize()
        rings.push({ c, x: y.multiplyScalar(r), y: x.multiplyScalar(r) })
      }
      Gs.tube(rings, { seg, capStart: true, capEnd: true, wfn: (p) => wfn(p), cfn: () => col })
    }
    const thread = home ? mul3(C.trim, 0.9) : mix3(C.jacket, [1, 1, 1], 0.28) // tone-on-tone top-stitching
    {
      const hem = []
      for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; hem.push(torsoAt(a, hemY + 0.12, 0.05)) }
      pipe(jacket, hem, 0.09, torsoW, C.trim)
      // placket: a raised band down the front, edged in gold, a zip (rider) or buttons (kurta)
      const yTop = 23.45, yBot = home ? 19.6 : hemY + 0.1
      const da = 0.12
      jacket.grid(2, 40, (u, v) => {
        const a = -da + u * 2 * da, y = yBot + v * (yTop - yBot)
        const p = torsoAt(a, y, 0.06)
        return { p, w: torsoW(p), c: mul3(C.jacket, 0.9) }
      }, [0.6 / TW, (yTop - yBot) / TW])
      for (const s of [-1, 1]) {
        const e = []
        for (let k = 0; k <= 24; k++) { const y = yBot + (k / 24) * (yTop - yBot); e.push(torsoAt(s * da, y, 0.08)) }
        pipe(jacket, e, 0.05, torsoW, C.trim)
        if (lod >= 0.7 && !home) { const st = []; for (let k = 0; k <= 16; k++) { const y = yBot + 0.4 + (k / 16) * (yTop - yBot - 0.8); st.push(torsoAt(s * (da + 0.1), y, 0.035)) } stitch(jacket, st, { r: 0.022, pitch: 0.2, seg: 3, wfn: torsoW, col: thread }) }
      }
      if (!home) {
        const z = []
        for (let k = 0; k <= 24; k++) { const y = yBot + 0.15 + (k / 24) * (yTop - yBot - 0.3); z.push(torsoAt(0, y, 0.11)) }
        pipe(jacket, z, 0.045, torsoW, C.zip, 4)
        // the zip's teeth: a row of little ridges either side of the slider track
        for (let k = 0; k < Math.round(40 * lod); k++) {
          const y = yBot + 0.3 + (k / Math.round(40 * lod)) * (yTop - yBot - 0.6), p = torsoAt(0, y, 0.12)
          jacket.rigid(new THREE.BoxGeometry(0.17, 0.06, 0.05), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z), torsoW(p), mul3(C.zip, 0.85))
        }
        // the zip pull
        const pull = new THREE.BoxGeometry(0.22, 0.5, 0.08)
        const pp = torsoAt(0, 22.6, 0.18)
        jacket.rigid(pull, new THREE.Matrix4().makeTranslation(pp.x, pp.y, pp.z), I('chest'), C.zip)
        // pockets: welt flaps low on each side
        for (const s of [1, -1]) {
          jacket.grid(8, 2, (u, v) => {
            const aa = s > 0 ? 0.45 + u * 0.55 : -(0.45 + (1 - u) * 0.55)
            const p = torsoAt(aa, 16.2 + v * 0.38, 0.05 + v * 0.03)
            return { p, w: torsoW(p), c: mul3(C.jacket, 0.74 + v * 0.2) }
          })
          const pe = []
          for (let k = 0; k <= 8; k++) pe.push(torsoAt(s * (0.45 + (k / 8) * 0.55), 16.2, 0.07))
          pipe(jacket, s > 0 ? pe : pe.reverse(), 0.035, torsoW, C.trim, 4)
        }
        // a chest pocket on his right with a flap, piped in gold
        const a0 = -0.95, a1 = -0.38, py0 = 18.85, py1 = 20.25
        jacket.grid(8, 8, (u, v) => {
          const p = torsoAt(a0 + u * (a1 - a0), py0 + v * (py1 - py0), 0.045 + 0.02 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI))
          const e = u < 0.08 || u > 0.92 || v < 0.08
          return { p, w: torsoW(p), c: mul3(C.jacket, e ? 0.82 : 0.97) }
        }, [0.9 / TW, 1.4 / TW])
        jacket.grid(8, 3, (u, v) => {
          const p = torsoAt(a0 - 0.02 + u * (a1 - a0 + 0.04), py1 + 0.12 - v * 0.55, 0.09 + 0.02 * v)
          return { p, w: torsoW(p), c: mul3(C.jacket, 1.04 - v * 0.22) }
        }, [0.9 / TW, 0.5 / TW])
        const fe = []
        for (let k = 0; k <= 8; k++) fe.push(torsoAt(a0 - 0.02 + (k / 8) * (a1 - a0 + 0.04), py1 - 0.43, 0.12))
        pipe(jacket, fe, 0.03, torsoW, C.trim, 4)
        const bp = torsoAt((a0 + a1) / 2, py1 - 0.3, 0.14)
        jacket.rigid(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z), torsoW(bp), C.zip)
      } else {
        for (let k = 0; k < 5; k++) {
          const p = torsoAt(0, 23.0 - k * 0.72, 0.14)
          jacket.rigid(new THREE.SphereGeometry(0.11, 8, 6), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z), I('chest'), C.trim)
        }
      }
      // Collar: a stand-up band (rider) or a low round neck with a gold edge (kurta).
      const colH = home ? 0.28 : 0.95
      const colR = (y) => 1.24 - (y - 23.35) * 0.16
      const colAt = (a, y, off) => new THREE.Vector3(Math.sin(a) * (colR(y) + off) * 1.04, y, 0.12 + Math.cos(a) * (colR(y) + off) * 0.95)
      const colW = (p) => W(blendW(I('chest'), I('neck'), p.y, 23.6, 24.6).map(([b, k]) => [b, b === I('neck') ? k * 0.55 : k]))
      const gap = home ? 0.0 : 0.16
      jacket.grid(48, 4, (u, v) => { const a = gap + u * (Math.PI * 2 - 2 * gap), y = 23.3 + v * colH; const p = colAt(a, y, 0.12); return { p, w: colW(p), c: mul3(C.jacket, 0.92 + 0.08 * v) } }, [8 / TW, 1 / TW])
      jacket.grid(48, 4, (u, v) => { const a = Math.PI * 2 - gap - u * (Math.PI * 2 - 2 * gap), y = 23.3 + v * colH; const p = colAt(a, y, 0.0); return { p, w: colW(p), c: mul3(C.jacket, 0.38) } })
      const ce = []
      for (let k = 0; k <= 48; k++) { const a = gap + (k / 48) * (Math.PI * 2 - 2 * gap); ce.push(colAt(a, 23.3 + colH, 0.06)) }
      pipe(jacket, ce, 0.075, colW, C.trim)
      if (!home && lod >= 0.7) { const cs = []; for (let k = 0; k <= 40; k++) { const a = gap + 0.1 + (k / 40) * (Math.PI * 2 - 2 * gap - 0.2); cs.push(colAt(a, 23.3 + colH - 0.22, 0.135)) } stitch(jacket, cs, { r: 0.02, pitch: 0.2, seg: 3, wfn: colW, col: thread }) }
    }
    // Sleeves: a tube from inside the shoulder to the cuff: a shaped sleeve cap, a tapering arm, soft folds at the armpit
    // and the inside of the elbow, cloth bunched over a knit cuff piped in gold.
    const SL = home
      ? [[22.62, 0.42, 0.42], [22.38, 0.88, 0.86], [21.95, 1.05, 1.0], [21.2, 1.06, 1.0], [20.3, 1.04, 0.98], [19.0, 1.0, 0.95], [17.8, 0.98, 0.94], [17.0, 1.0, 0.95], [16.2, 1.04, 0.98], [15.75, 1.06, 1.0]]
      : [[22.62, 0.42, 0.42], [22.38, 0.86, 0.84], [21.95, 1.02, 0.97], [21.2, 1.03, 0.98], [20.3, 0.99, 0.95], [19.0, 0.93, 0.9], [17.8, 0.9, 0.87], [17.1, 0.9, 0.87], [16.3, 0.88, 0.85], [15.3, 0.84, 0.81], [14.4, 0.82, 0.79], [13.85, 0.8, 0.77], [13.62, 0.76, 0.73]]
    const cuffTop = home ? 15.75 : 13.62
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const sx = 2.75 * s
      const armW = (p) => {
        const y = p.y
        let w = y > 21.8 ? blendW(I('chest'), I('shoulder' + L), y, 22.6, 21.8) : y > 16.6 ? blendW(I('shoulder' + L), I('elbow' + L), y, 17.7, 16.6) : [[I('elbow' + L), 1]]
        const inner = sm(0.0, -0.9, (p.x - sx) * s) * sm(20.6, 22.3, y) * 0.4
        if (inner > 0) { w = w.map(([b, k]) => [b, k * (1 - inner)]); w.push([I('chest'), inner]) }
        return W(w)
      }
      const rows = resample(SL, 0.27 / Math.max(0.6, lod))
      // the knit cuff (rider): a ribbed band below the sleeve; the kurta's three-quarter sleeve ends in a border
      if (!home) for (const [y, rx, rz] of [[13.45, 0.76, 0.73], [13.25, 0.75, 0.72], [13.05, 0.74, 0.71], [12.98, 0.69, 0.66], [13.15, 0.64, 0.61]]) rows.push([y, rx, rz])
      else rows.push([15.62, 0.92, 0.88], [15.75, 0.78, 0.74])
      const nr = rows.length
      const rings = rows.map(([y, rx, rz], k) => ({ c: new THREE.Vector3(sx + s * 0.08 * sm(20.8, 21.6, y), y, 0.05 * sm(21.6, 20.8, y)), x: new THREE.Vector3(rx, 0, 0), y: new THREE.Vector3(0, 0, rz), k, y0: y }))
      const seg = N(32)
      const knit = (a) => (Math.round((a / (Math.PI * 2)) * seg) % 2 === 0 ? 1 : 0)
      jacket.tube(rings, {
        seg, capStart: true, capEnd: true, uScale: (2 * Math.PI * 0.95) / TW, v1: 10 / TW,
        disp: (p, a, R) => {
          const y = R.y0, k = R.k
          if (k >= nr - 2) return
          let d = 0
          const front = Math.max(0, Math.sin(a)), inside = Math.max(0, -Math.cos(a) * s)
          d += 0.04 * Math.sin(y * 13 + a * 1.5) * G(y - 17.1, 0.2) * (0.3 + front) // the inside of the elbow
          d += 0.03 * Math.sin((y - a * 0.4) * 7) * G(y - 20.6, 0.5) * inside // from the armpit
          if (!home) d += 0.035 * Math.sin(y * 12 + 2 * Math.sin(a * 2 + s)) * G(y - 14.2, 0.12) * sm(13.6, 13.75, y) // bunching above the cuff
          if (!home && y < cuffTop + 0.01) d += 0.025 * knit(a) // the rib of the knit cuff
          if (home && y < 16.35) d += 0.02 * Math.sin(a * 9) * G(y - 16.1, 0.04)
          const dx = p.x - R.c.x, dz = p.z - R.c.z, l = Math.hypot(dx, dz) || 1
          p.x += (dx / l) * d; p.z += (dz / l) * d
        },
        wfn: armW,
        cfn: (p, a, R) => {
          const y = R.y0
          if (R.k >= nr - 2) return mul3(C.jacket, 0.62)
          let o = 1
          if (!home && y < cuffTop + 0.01) o *= 0.8 + 0.12 * knit(a)
          if (!home && Math.abs(y - (cuffTop + 0.02)) < 0.05) o *= 0.75
          o *= 1 - 0.2 * sm(16.5, 17.1, y) * sm(17.7, 17.1, y) * Math.max(0, Math.sin(a))
          o *= 1 + 1.6 * (0.04 * Math.sin(y * 13 + a * 1.5) * G(y - 17.1, 0.2) * (0.3 + Math.max(0, Math.sin(a))))
          if (!home) o *= 1 + 2 * 0.035 * Math.sin(y * 12 + 2 * Math.sin(a * 2 + s)) * G(y - 14.2, 0.12) * sm(13.6, 13.75, y)
          o *= 1 - 0.18 * Math.max(0, -Math.cos(a) * s) * sm(18.5, 20.5, y) // the inside of the arm, by the body
          let c = mul3(C.jacket, o)
          if (home && y < 16.25) c = y < 15.85 ? mul3(lin('#6a1f2a'), o) : C.trim // the sleeve border
          return c
        },
      })
      const cuffY = home ? 15.72 : cuffTop
      const cuffR = home ? [1.08, 1.02] : [0.8, 0.77]
      const ring = []
      for (let k = 0; k <= 32; k++) { const a = (k / 32) * Math.PI * 2; ring.push(new THREE.Vector3(sx + Math.cos(a) * cuffR[0], cuffY, 0.05 + Math.sin(a) * cuffR[1])) }
      pipe(jacket, ring, 0.07, armW, C.trim)
    }
    // Dupatta (customer): over both shoulders, two soft panels hanging in front, plum with a gold border.
    if (home) {
      const st = lin(O.stole)
      for (const s of [1, -1]) {
        jacket.grid(10, 34, (u, v) => {
          const y = 13.2 + v * (23.4 - 13.2)
          const a0 = s * (0.62 + 0.12 * v), a = a0 + (u - 0.5) * (0.5 - 0.1 * v)
          const p = torsoAt(a, Math.max(y, 14.6), 0.16 + 0.12 * (1 - v) + 0.06 * Math.sin(u * Math.PI * 3) * (1 - v))
          if (y < 14.6) { p.y = y; p.z += (14.6 - y) * 0.1 }
          if (v > 0.9) { p.y += (v - 0.9) * 2; p.z -= (v - 0.9) * 4 }
          const edge = u < 0.1 || u > 0.9 || v < 0.035
          const fold = 0.88 + 0.16 * Math.sin(u * Math.PI * 3) * (1 - v)
          return { p, w: torsoW(p), c: edge ? mul3(C.trim, fold) : mul3(st, fold) }
        }, [1.4 / TW, 10 / TW])
      }
      // round the back of the neck
      jacket.grid(24, 3, (u, v) => {
        const a = Math.PI * 0.32 + u * Math.PI * 1.36, p = torsoAt(a, 22.7 + v * 0.7, 0.2 + 0.05 * Math.sin(v * Math.PI))
        return { p, w: torsoW(p), c: v < 0.2 || v > 0.8 ? C.trim : mul3(st, 0.85) }
      })
    }
    // Apron (grading): a canvas bib apron over the jacket and the thighs, a stitched patch pocket, neck strap and ties.
    if (apron) {
      const can = lin('#7a5636'), edge = lin('#4e3520'), gold = C.trim
      const apW = (p) => {
        if (p.y > 16.6) return torsoW(p)
        if (p.y > 14.6) return [[I('hips'), 1]]
        const kL = sm(-0.8, 0.8, p.x)
        const d = sm(14.6, 12.6, p.y) * 0.85
        return W([[I('hips'), 1 - d], [I('hipL'), d * kL], [I('hipR'), d * (1 - kL)]])
      }
      const apAt = (x, y, off = 0) => {
        let z
        if (y > 15.4) {
          const tw = curve(TT, y, 1), td = curve(TT, y, 2), n = curve(TT, y, 4)
          const q = Math.min(0.999, Math.abs(x) / (tw + 0.15))
          z = curve(TT, y, 3) + (td + 0.12) * Math.pow(1 - Math.pow(q, n), 1 / n)
        } else z = 1.9 - (x * x) * 0.06 + (15.4 - y) * 0.02
        if (y < 15.4 && y > 14.6) z = Math.max(z, 1.9)
        return new THREE.Vector3(x, y, z + off)
      }
      const hwAt = (y) => (y > 17.5 ? 1.55 + (21.4 - y) * 0.05 : y > 15.5 ? 1.75 + (17.5 - y) * 0.42 : 2.6)
      jacket.grid(N(18), N(38), (u, v) => {
        const y = 9.2 + v * (21.4 - 9.2)
        const hw = hwAt(y)
        const x = (u - 0.5) * 2 * hw
        const p = apAt(x, y, y < 15 ? 0.03 * Math.sin(u * Math.PI * 4 + v * 3) * (1 - v) : 0)
        const e = u < 0.03 || u > 0.97 || v < 0.015 || v > 0.985
        let c = e ? edge : mul3(can, 0.92 + 0.08 * Math.sin(v * 37 + u * 5) * 0.4)
        if (y < 15) c = mul3(c, 1 + 0.6 * 0.03 * Math.sin(u * Math.PI * 4 + v * 3) * 8)
        return { p, w: apW(p), c }
      }, [5 / 0.9, 12 / 0.9])
      // back side (darker) so it never shows a hole from below
      jacket.grid(2, 2, (u, v) => { const p = new THREE.Vector3((0.5 - u) * 5.0, 9.25 + v * 0.1, 1.88); return { p, w: apW(p), c: edge } })
      // the patch pocket, divided down the middle, and stitched edges
      jacket.grid(12, 6, (u, v) => {
        const x = (u - 0.5) * 3.2, y = 11.3 + v * 2.3
        const p = apAt(x, y, 0.05 + 0.03 * Math.sin(u * Math.PI))
        const e = v > 0.9 || Math.abs(u - 0.5) < 0.025
        return { p, w: apW(p), c: mul3(can, e ? 0.75 : 0.95 - 0.1 * (1 - v)) }
      }, [3.2 / 0.9, 2.3 / 0.9])
      const sline = (pts) => stitch(jacket, pts, { r: 0.028, pitch: 0.26, seg: 3, wfn: apW, col: lin('#e8d6b0') })
      if (lod >= 0.65) {
        const L1 = [], L2 = [], L3 = []
        for (let k = 0; k <= 12; k++) { const t = k / 12; L1.push(apAt(-1.5 + 3.0 * t, 13.48, 0.085)); L2.push(apAt(-1.5, 11.35 + 2.1 * t, 0.085)); L3.push(apAt(1.5, 11.35 + 2.1 * t, 0.085)) }
        sline(L1); sline(L2); sline(L3)
        for (const s of [-1, 1]) { const e = []; for (let k = 0; k <= 24; k++) { const y = 9.4 + (k / 24) * 11.8; e.push(apAt(s * (hwAt(y) - 0.14), y, 0.035)) } sline(e) }
      }
      // ties
      const tie = []
      for (let k = 0; k <= 40; k++) { const a = Math.PI * 0.15 + (k / 40) * Math.PI * 1.7; tie.push(torsoAt(a, 16.4, 0.12)) }
      pipe(jacket, tie, 0.1, torsoW, edge)
      for (const s of [1, -1]) {
        const p0 = new THREE.Vector3(s * 1.45, 21.35, 1.98), p1 = torsoAt(s * 0.9, 23.2, 0.16), p2 = torsoAt(s * 1.6, 23.6, 0.1), p3 = torsoAt(Math.PI - s * 0.4, 23.5, 0.08)
        pipe(jacket, [p0, p1, p2, p3], 0.09, torsoW, edge)
        // a bow at the back
        const bk = torsoAt(Math.PI, 16.4, 0.2)
        jacket.rigid(new THREE.SphereGeometry(0.32, 10, 8).scale(1.4, 0.7, 0.5), new THREE.Matrix4().makeTranslation(bk.x + s * 0.4, bk.y, bk.z).multiply(new THREE.Matrix4().makeRotationZ(s * 0.3)), [[I('hips'), 1]], edge)
        jacket.rigid(new THREE.CylinderGeometry(0.09, 0.07, 1.5, 6), new THREE.Matrix4().makeTranslation(bk.x + s * 0.3, bk.y - 0.8, bk.z + 0.05).multiply(new THREE.Matrix4().makeRotationZ(s * 0.25)), [[I('hips'), 1]], edge)
      }
      // a small gold leaf mark on the bib
      jacket.rigid(new THREE.CircleGeometry(0.28, 12), new THREE.Matrix4().makeTranslation(0.6, 20.2, curve(TT, 20.2, 3) + curve(TT, 20.2, 2) + 0.16), I('chest'), gold)
    }
    this._mesh(jacket, jacketM, skeleton)
    // The wordmark, printed on the chest (his left) and across the back, following the cloth.
    if (!home) {
      const mark = new SkinGeo()
      const patch = (a0, a1, y0, y1) => mark.grid(16, 6, (u, v) => { const p = torsoAt(a0 + u * (a1 - a0), y0 + v * (y1 - y0), 0.045); return { p, w: torsoW(p) } })
      patch(0.34, 0.98, 20.05, 20.85)
      patch(Math.PI - 0.78, Math.PI + 0.78, 18.5, 20.5)
      const markM = new THREE.MeshStandardMaterial({ map: wordmarkTexture(), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
      const mm = this._mesh(mark, markM, skeleton); mm.castShadow = false
    }

    // ---- Trousers ----
    const tr = new SkinGeo()
    const TC = lin(O.trousers)
    {
      const PEL = [[16.7, 2.3, 1.56], [15.6, 2.38, 1.62], [14.6, 2.32, 1.6], [13.8, 1.9, 1.36], [13.25, 1.05, 0.9], [13.05, 0.4, 0.4]]
      const rings = PEL.map(([y, w, d]) => ({ c: new THREE.Vector3(0, y, 0), x: new THREE.Vector3(w, 0, 0), y: new THREE.Vector3(0, 0, d), n: 2.4 }))
      tr.tube(rings, {
        seg: N(40), capStart: true, capEnd: true,
        wfn: (p) => { const d = sm(15.2, 13.6, p.y) * sm(0.3, 1.4, Math.abs(p.x)) * 0.5; return W([[I('hips'), 1 - d], [I(p.x > 0 ? 'hipL' : 'hipR'), d]]) },
        cfn: (p) => mul3(TC, (0.94 - 0.08 * sm(14.2, 13.2, p.y)) * (Math.abs(p.x) < 0.05 && p.z > 0.8 && p.y > 13.8 ? 0.82 : 1)),
      })
      // y, rx, rz, centre x (the thigh tops tuck in under the hips)
      const loose = home ? 1.1 : 1
      const LEG = [[16.3, 1.15, 1.25, 1.0], [15.2, 1.3, 1.42, 1.08], [13.6, 1.4, 1.42, 1.2], [11.6, 1.32, 1.3, 1.32], [9.6, 1.18, 1.16, 1.42], [8.6, 1.1, 1.1, 1.45], [8.0, 1.08, 1.08, 1.45], [7.0, 1.07, 1.06, 1.45], [5.5, 1.03, 1.01, 1.45], [4.0, 0.99, 0.97, 1.45], [2.8, home ? 0.86 : 0.97, home ? 0.86 : 0.97, 1.45], [2.0, home ? 0.74 : 1.0, home ? 0.74 : 1.03, 1.45], [1.45, home ? 0.7 : 1.04, home ? 0.7 : 1.08, 1.45]]
        .map(([y, rx, rz, cx]) => [y, rx * (y > 3 ? loose : 1), rz * (y > 3 ? loose : 1), cx])
      const rows = resample(LEG, 0.32 / Math.max(0.6, lod))
      rows.push([1.3, home ? 0.7 : 1.04, home ? 0.7 : 1.08, 1.45], [1.42, 0.62, 0.64, 1.45], [1.8, 0.5, 0.5, 1.45])
      const nr = rows.length
      for (const s of [1, -1]) {
        const L = s > 0 ? 'L' : 'R'
        const rings2 = rows.map(([y, rx, rz, cx], k) => ({ c: new THREE.Vector3(cx * s, y, k >= nr - 3 ? 0.08 : 0), x: new THREE.Vector3(rx, 0, 0), y: new THREE.Vector3(0, 0, rz), k }))
        const fold = (a, y) => {
          let d = 0
          d += 0.05 * Math.sin(y * 9 + Math.sin(a * 2) * 1.2) * G(y - 7.9, 0.25) * Math.max(0, -Math.sin(a)) // behind the knee
          d += 0.025 * Math.sin(y * 7 + a) * G(y - 8.4, 0.5) * Math.max(0, Math.sin(a)) * 0.6
          if (home) d += 0.05 * Math.sin(y * 10 + a * 2) * sm(3.6, 2.2, y) // a churidar gathers at the ankle
          d += 0.02 * Math.sin(a * 3 + y * 2) * G(y - 13.6, 0.6) * Math.max(0, Math.sin(a)) // across the lap
          return d
        }
        tr.tube(rings2, {
          seg: N(24), capEnd: true, capStart: true, uScale: 2 * Math.PI * 1.1 / 1.4, v1: 15 / 1.4,
          shape: (a, R) => 1 + 0.035 * (Math.exp(-((a - Math.PI / 2) ** 2) / 0.012) + Math.exp(-((a - 1.5 * Math.PI) ** 2) / 0.012)) * sm(14, 10, R.c.y) * (home ? 0.3 : 1),
          disp: (p, a, R) => {
            const y = R.c.y
            if (R.k >= nr - 2) return
            if (!home && y < 2.9 && y > 1.6) { const b = Math.sin((2.9 - y) / 1.3 * Math.PI); p.x += Math.cos(a * 3 + s) * 0.05 * b; p.z += Math.sin(a * 2) * 0.04 * b }
            if (y < 1.5 && R.k < nr - 2) p.y -= Math.max(0, Math.sin(a)) * (home ? 0.06 : 0.22) // the hem drops a little at the front over the shoe
            const d = fold(a, y), dx = p.x - R.c.x, dz = p.z - R.c.z, l = Math.hypot(dx, dz) || 1
            p.x += (dx / l) * d; p.z += (dz / l) * d
          },
          wfn: (p) => {
            const y = p.y
            let w = y > 14.6 ? blendW(I('hips'), I('hip' + L), y, 16.0, 14.6) : y > 7.2 ? blendW(I('hip' + L), I('knee' + L), y, 8.8, 7.3) : [[I('knee' + L), 1]]
            if (y > 14.6) { const inner = sm(0.4, -0.6, p.x * s - 1.45) * 0.3; w = w.map(([b, k]) => [b, k * (1 - inner)]); w.push([I('hips'), inner]) }
            return W(w)
          },
          cfn: (p, a, R) => {
            let o = 1
            if (R.k >= nr - 2) o = 0.35
            const y = R.c.y
            o *= 1 - 0.08 * sm(14.8, 13.2, y) * sm(0.6, -0.4, (p.x * s - 1.45)) // inner thigh
            o *= 1 - 0.1 * Math.max(0, -Math.sin(a)) * sm(9.2, 8.1, y) * sm(7.0, 8.1, y) // back of the knee
            o *= 1 + 2.4 * fold(a, y)
            if (!home && Math.abs(Math.cos(a) * s + 1) < 0.02 && y > 2) o *= 0.85 // inseam
            if (!home && Math.abs(Math.cos(a) * s - 1) < 0.02 && y > 2) o *= 0.88 // outseam
            if (!home && y < 1.75 && R.k < nr - 2) o *= 0.9
            return mul3(TC, o)
          },
        })
      }
    }
    this._mesh(tr, trouserM, skeleton)

    // ---- Shoes: a leather upper with laces and a toe cap, a cream sole; heel-to-toe on the ankle and toe bones.
    //      The customer: bare feet in sandals (the feet go with the skin) ----
    const sh = new SkinGeo()
    const skin = new SkinGeo()
    const SK = lin(O.skin)
    {
      const up = lin(O.shoe), so = lin(O.sole), lace = home ? lin('#e8b04a') : lin('#e9dfc6')
      const UP = [[-1.35, 0.55, 0.42, 0.9], [-1.15, 0.82, 0.78, 1.05], [-0.55, 0.9, 0.92, 1.18], [0.4, 0.95, 0.78, 1.0], [1.3, 1.0, 0.6, 0.82], [2.2, 1.03, 0.5, 0.66], [2.9, 0.94, 0.44, 0.6], [3.35, 0.7, 0.36, 0.55], [3.55, 0.35, 0.2, 0.5]]
      const FOOT = [[-1.25, 0.5, 0.38, 0.86], [-1.05, 0.7, 0.7, 1.0], [-0.5, 0.76, 0.86, 1.14], [0.4, 0.8, 0.66, 0.96], [1.3, 0.86, 0.46, 0.76], [2.2, 0.9, 0.36, 0.62], [2.85, 0.84, 0.3, 0.56], [3.25, 0.62, 0.25, 0.52], [3.42, 0.3, 0.14, 0.48]]
      for (const s of [1, -1]) {
        const L = s > 0 ? 'L' : 'R'
        const ax = 1.45 * s
        const fw = (p) => W(blendW(I('ankle' + L), I('toe' + L), p.z, 1.75, 2.45))
        if (!home) {
          const rings = UP.map(([z, w, h, y]) => ({ c: new THREE.Vector3(ax, y, z), x: new THREE.Vector3(w, 0, 0), y: new THREE.Vector3(0, h, 0), n: 2.6, z }))
          sh.tube(rings, {
            seg: N(28), capStart: true, capEnd: true,
            disp: (p) => { if (p.y < 0.36) p.y = 0.36 },
            wfn: fw,
            cfn: (p, a, R) => {
              let c = up
              if (R.z > 2.5 && Math.abs(R.z - 2.6) < 0.06) c = mul3(up, 0.6) // toe-cap stitch
              if (Math.abs(R.z + 0.55) < 0.05) c = mul3(up, 0.65) // the heel counter's seam
              if (p.y < 0.45) c = mul3(up, 0.7)
              if (p.y > 1.0 && Math.abs(p.x - ax) < 0.4 && R.z > -0.4 && R.z < 1.6) c = mul3(up, 1.25) // the tongue
              return c
            },
          })
          // laces across the instep, eyelets either side
          for (let k = 0; k < 4; k++) {
            const z = 0.0 + k * 0.42, y = 1.62 - k * 0.2
            sh.rigid(new THREE.CapsuleGeometry(0.05, 0.8, 3, 6).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(ax, y, z), [[I('ankle' + L), 1]], lace)
            for (const e of [-1, 1]) sh.rigid(new THREE.TorusGeometry(0.06, 0.02, 4, 8).rotateX(-0.6), new THREE.Matrix4().makeTranslation(ax + e * 0.44, y - 0.04, z), [[I('ankle' + L), 1]], lin('#c9a650'))
          }
          sh.rigid(new THREE.TorusGeometry(0.16, 0.04, 4, 10).scale(1, 0.6, 1), new THREE.Matrix4().makeTranslation(ax + 0.1 * s, 1.66, -0.15).multiply(new THREE.Matrix4().makeRotationY(0.4)), [[I('ankle' + L), 1]], lace) // the bow
        } else {
          // the foot, a toe ring strap and an instep strap
          skin.tube(FOOT.map(([z, w, h, y]) => ({ c: new THREE.Vector3(ax, y, z), x: new THREE.Vector3(w, 0, 0), y: new THREE.Vector3(0, h, 0), n: 2.3, z })), {
            seg: N(22), capStart: true, capEnd: true,
            disp: (p, a, R) => { if (p.y < 0.42) p.y = 0.42; if (R.z > 2.6 && p.y > 0.55) p.y += 0.03 * Math.sin((p.x - ax) * 14) },
            wfn: fw,
            cfn: (p, a, R) => (R.z > 3.0 && p.y > 0.55 ? mix3(SK, lin('#c24a3a'), 0.35) : mul3(SK, 0.92 + 0.08 * sm(0.4, 1.1, p.y))), // painted toenails
          })
          for (const [z, y, w] of [[0.75, 0.98, 0.98], [2.75, 0.74, 0.5]]) {
            const st = new THREE.TorusGeometry(w, 0.07, 5, 20, Math.PI).scale(1, 0.75, 1).rotateY(0)
            sh.rigid(st, new THREE.Matrix4().makeTranslation(ax, 0.42, z).multiply(new THREE.Matrix4().makeScale(1, y / w, 1)), fw(new THREE.Vector3(0, 0, z)), lin('#d9a441'))
          }
        }
        // sole
        const SO = [[-1.45, 0.62], [-1.3, 0.9], [-0.6, 0.98], [0.6, 0.98], [1.6, 1.08], [2.6, 1.1], [3.3, 0.9], [3.7, 0.45]]
        sh.tube(SO.map(([z, w]) => ({ c: new THREE.Vector3(ax, home ? 0.2 : 0.2, z), x: new THREE.Vector3(w * (home ? 0.94 : 1), 0, 0), y: new THREE.Vector3(0, home ? 0.12 : 0.2, 0), n: 4, z })), {
          seg: N(22), capStart: true, capEnd: true, wfn: fw, cfn: (p) => (p.y < 0.06 ? mul3(so, 0.5) : Math.abs(p.y - 0.3) < 0.04 ? mul3(so, 0.8) : so),
        })
      }
    }
    this._mesh(sh, shoeM, skeleton)

    // ---- The head ----
    // A loft of cross-sections from the crown to the chin (half-width, centre z, front and back depth by height), the
    // cranium an ellipsoid, then features: brow ridge, cheeks, muzzle, chin, philtrum, temples, and eye sockets carved
    // to fit the eyeballs and lids. All in head-local space (head bone at the origin, +z forward).
    const headP = wp('head')
    const H = (x, y, z) => new THREE.Vector3(x, y, z).add(headP) // head-local → rest space
    const HL = home
      ? [[-0.06, 0.72, 0.44, 1.2, 0.6], [0.26, 0.72, 0.44, 1.2, 0.6], [0.5, 0.98, 0.28, 1.42, 0.8], [0.85, 1.28, 0.1, 1.64, 1.04], [1.3, 1.5, -0.02, 1.8, 1.48], [1.75, 1.58, -0.08, 1.82, 1.72], [2.2, 1.6, -0.12, 1.82, 1.84]]
      : [[-0.06, 0.78, 0.4, 1.26, 0.6], [0.26, 0.78, 0.4, 1.26, 0.6], [0.5, 1.04, 0.25, 1.48, 0.82], [0.85, 1.32, 0.08, 1.7, 1.08], [1.3, 1.52, -0.02, 1.82, 1.5], [1.75, 1.62, -0.08, 1.86, 1.74], [2.2, 1.66, -0.12, 1.86, 1.86]]
    const CR = { top: 3.78, w: HL[HL.length - 1][1], f: HL[HL.length - 1][3], b: HL[HL.length - 1][4] }
    const yOf = (d) => 1.86 + 1.92 * clamp(d.y, -1, 1)
    const LID = { hU: home ? 0.48 : 0.41, hL: home ? 0.37 : 0.34, tilt: home ? 0.08 : 0.05 }
    const eUp = (q) => LID.tilt * q + 0.04 + LID.hU * Math.pow(Math.max(0, 1 - q * q), 0.8)
    const eLo = (q) => LID.tilt * q + 0.04 - LID.hL * Math.pow(Math.max(0, 1 - q * q), 0.9)
    const skull = (d, socket = true) => {
      const y = yOf(d), ph = Math.atan2(d.x, d.z)
      let Wd, cz, F, Bk
      if (y >= 2.2) {
        const e = (y - 2.2) / (CR.top - 2.2), k = Math.sqrt(Math.max(0, 1 - e * e))
        Wd = CR.w * k; F = CR.f * k * (1 - 0.06 * e); Bk = CR.b * k; cz = -0.12
      } else {
        const yy = Math.max(y, 0.26), k = y < 0.26 ? Math.sqrt(Math.max(0, (y + 0.06) / 0.32)) : 1
        Wd = curve(HL, yy, 1) * k; cz = curve(HL, yy, 2); F = curve(HL, yy, 3) * k; Bk = curve(HL, yy, 4) * k
        if (y < 0.26) cz += (0.26 - y) * 0.6
      }
      const front = Math.cos(ph) > 0
      const [cc, ss] = sup(ph, front ? 2.3 : 2.0)
      const p = new THREE.Vector3(Wd * ss, y, cz + (front ? F : Bk) * cc)
      // features
      const f = sm(0.25, 0.9, Math.cos(ph)), ax = Math.abs(p.x), sx = Math.sign(p.x) || 1
      p.z += f * (
        (home ? 0.045 : 0.07) * G(p.y - 2.45, 0.02) * G(ax - 0.62, 0.16) +
        0.035 * G(p.y - 2.22, 0.03) * G(p.x, 0.05) +
        0.07 * G(p.x, 0.04) * G(p.y - 2.0, 0.06) + // the bridge between the eyes
        (home ? 0.12 : 0.09) * G(ax - 0.86, 0.07) * G(p.y - 1.4, 0.07) +
        0.035 * G(p.x, 0.28) * G(p.y - 0.95, 0.07) -
        0.014 * G(p.x, 0.004) * G(p.y - 1.0, 0.006) +
        (home ? 0.09 : 0.11) * G(p.x, 0.16) * G(p.y - 0.3, 0.04) -
        0.03 * G(p.x, 0.22) * G(p.y - 0.55, 0.004) -
        0.025 * G(ax - 0.75, 0.04) * G(p.y - 1.05, 0.05) * 0 // (nasolabial: by colour)
      )
      p.x -= sx * 0.06 * G(p.y - 2.4, 0.09) * G(p.z - 0.9, 0.2) // temples
      p.x += sx * (home ? 0.03 : 0.05) * G(ax - 1.3, 0.08) * G(p.y - 0.85, 0.06) * f // the jaw's corner
      if (socket && p.z > EYE.z - 0.1) {
        // the eye opening (between the lid edges) is carved back behind the eyeball; outside it the face is left
        // whole, and the lid shells push out through it, so the lids grow out of the skin along a soft crease
        for (const s of [1, -1]) {
          const vx = p.x - s * EYE.x, vy = p.y - EYE.y, vz = p.z - EYE.z
          const dd = Math.hypot(vx, vy)
          if (dd > 0.6) continue
          const a = Math.atan2(vx, vz), e = Math.atan2(vy, Math.hypot(vx, vz)), q = (a * s) / 1.25
          const m = Math.min(e - eLo(clamp(q, -1, 1)) + 0.03, eUp(clamp(q, -1, 1)) + 0.03 - e, (1.06 - Math.abs(q)) * 0.4)
          const w = sm(-0.01, 0.05, m) * sm(EYE.r + 0.05, EYE.r - 0.005, dd)
          if (w <= 0) continue
          const R0 = EYE.r - 0.03
          const t = EYE.z + (dd < R0 ? Math.sqrt(R0 * R0 - dd * dd) : 0)
          p.z = p.z + (Math.min(p.z, t) - p.z) * w
        }
      }
      return p
    }
    // The face as a height field z(x, y) (for laying the nose, lips, brows and bindi onto it).
    const FZ = { x0: -1.6, y0: -0.3, d: 0.025, nx: 129, ny: 145 }
    const fzT = new Float32Array(FZ.nx * FZ.ny).fill(-9)
    {
      const dv = new THREE.Vector3()
      for (let j = 0; j <= 200; j++) for (let i = 0; i <= 260; i++) {
        const th = 0.12 * Math.PI + (j / 200) * 0.86 * Math.PI, ph = -1.45 + (i / 260) * 2.9
        dv.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph))
        const p = skull(dv)
        const ix = Math.round((p.x - FZ.x0) / FZ.d), iy = Math.round((p.y - FZ.y0) / FZ.d)
        if (ix >= 0 && iy >= 0 && ix < FZ.nx && iy < FZ.ny) fzT[iy * FZ.nx + ix] = Math.max(fzT[iy * FZ.nx + ix], p.z)
      }
      for (let pass = 0; pass < 2; pass++) for (let iy = 1; iy < FZ.ny - 1; iy++) for (let ix = 1; ix < FZ.nx - 1; ix++) {
        const i = iy * FZ.nx + ix
        if (fzT[i] > -9) continue
        let s = 0, n = 0
        for (const o of [-1, 1, -FZ.nx, FZ.nx]) if (fzT[i + o] > -9) { s += fzT[i + o]; n++ }
        if (n) fzT[i] = s / n
      }
    }
    const faceZ = (x, y) => {
      const fx = clamp((x - FZ.x0) / FZ.d, 0, FZ.nx - 1.001), fy = clamp((y - FZ.y0) / FZ.d, 0, FZ.ny - 1.001)
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy
      const a = fzT[iy * FZ.nx + ix], b = fzT[iy * FZ.nx + ix + 1], c = fzT[(iy + 1) * FZ.nx + ix], d = fzT[(iy + 1) * FZ.nx + ix + 1]
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    }
    this._faceZ = faceZ
    const headCol = (p) => {
      // p in rest space → head-local
      const q = p.clone().sub(headP)
      const ax = Math.abs(q.x), fr = sm(0.4, 1.3, q.z)
      let c = SK
      c = mix3(c, mul3(lin('#c0604a'), 0.95), (G(ax - 0.9, 0.12) * G(q.y - 1.35, 0.12) * fr) * (home ? 0.32 : 0.22)) // cheeks
      c = mix3(c, lin('#b4604a'), G(q.x, 0.05) * G(q.y - 1.35, 0.06) * fr * 0.25) // the nose
      c = mul3(c, 1 + 0.06 * G(q.y - 2.85, 0.25) * fr) // forehead
      const sock = Math.max(...[1, -1].map((s) => G(q.x - s * EYE.x, 0.09) * G(q.y - EYE.y + 0.05, 0.06))) * fr
      c = mix3(c, mul3(mix3(SK, lin('#6a3a40'), 0.3), 0.85), sock * 0.18) // the eyes sit in soft shadow
      c = mul3(c, 1 - 0.1 * G(ax - 0.62, 0.03) * G(q.y - 1.0, 0.08) * fr) // nasolabial
      c = mul3(c, 1 - 0.3 * sm(0.7, -0.1, q.y) * sm(0.6, -0.6, q.z)) // under the jaw
      if (!home) c = mix3(c, mul3(mix3(SK, lin('#3a3438'), 0.4), 0.9), 0.2 * sm(0.6, 0.25, q.y) * sm(-0.6, 0.4, q.z)) // a shadow of stubble on the chin and jaw
      return c
    }
    {
      // a grid over the head, warped so its rows and columns crowd onto the face and thin out over the back and crown
      const d = new THREE.Vector3()
      skin.grid(N(88), N(66), (u, v) => {
        const t = 1 - 2 * u, ph = Math.PI * t - 0.62 * Math.sin(Math.PI * t)
        const s0 = 0.56, c = 0.55, th = Math.PI * (v - (c / (2 * Math.PI)) * (Math.sin(2 * Math.PI * (v - s0)) + Math.sin(2 * Math.PI * s0)))
        d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph))
        const p = skull(d).add(headP)
        return { p, w: [[I('head'), 1]], c: headCol(p) }
      })
      // the nose: a height field over the face from the root between the eyes to the tip and under it
      const NP = home
        ? [[2.3, -0.06, 0.1], [2.05, 0.05, 0.085], [1.85, 0.14, 0.085], [1.6, 0.26, 0.1], [1.42, 0.36, 0.14], [1.32, 0.39, 0.16], [1.24, 0.33, 0.15], [1.17, 0.16, 0.11], [1.12, 0.0, 0.12]]
        : [[2.32, -0.06, 0.11], [2.07, 0.06, 0.09], [1.87, 0.15, 0.09], [1.6, 0.29, 0.11], [1.42, 0.41, 0.16], [1.31, 0.44, 0.18], [1.22, 0.36, 0.17], [1.14, 0.17, 0.12], [1.08, 0.0, 0.13]]
      const nose = new SkinGeo()
      const nseg = 24, nrow = 30
      for (let j = 0; j <= nrow; j++) for (let i = 0; i <= nseg; i++) {
        const v = j / nrow, u = (i / nseg) * 2 - 1
        const y = curve(NP.map((r, k) => [k / (NP.length - 1), r[0]]), v, 1)
        const hgt = curve(NP.map((r, k) => [k / (NP.length - 1), r[1]]), v, 1)
        const hw = curve(NP.map((r, k) => [k / (NP.length - 1), r[2]]), v, 1) * 1.45
        const x = u * hw
        const prof = Math.pow(Math.max(0, 1 - u * u), 0.85)
        const z = faceZ(x, y) + hgt * prof - 0.02 * Math.pow(1 - prof, 2)
        const p = H(x, y, z)
        const nost = v > 0.8 ? G(Math.abs(u) - 0.42, 0.02) * sm(0.8, 0.9, v) : 0
        let c = mul3(headCol(p), 1 - 0.06 * (1 - prof) * sm(0.2, 0.6, v))
        c = mix3(c, lin('#c07058'), 0.18 * G(v - 0.6, 0.02) * prof) // the tip catches warm light
        c = mix3(c, mul3(SK, 0.3), nost * 0.85)
        nose.vert(p, u, v, [[I('head'), 1]], c)
      }
      for (let j = 0; j < nrow; j++) for (let i = 0; i < nseg; i++) { const a = j * (nseg + 1) + i, b = a + 1, c = a + nseg + 1, dd = c + 1; nose.tri(a, c, b, b, c, dd) }
      // copy into the skin builder
      {
        const base = skin.p.length / 3
        skin.p.push(...nose.p); skin.uv.push(...nose.uv); skin.c.push(...nose.c); skin.si.push(...nose.si); skin.sw.push(...nose.sw)
        for (const i of nose.ix) skin.ix.push(i + base)
      }
      // nostril wings
      for (const s of [1, -1]) {
        const ny = home ? 1.22 : 1.19, nxp = (home ? 0.17 : 0.2) * s
        const wing = new THREE.SphereGeometry(home ? 0.085 : 0.1, 14, 10).scale(1.25, 0.85, 1.1)
        skin.rigid(wing, new THREE.Matrix4().makeTranslation(headP.x + nxp, headP.y + ny, headP.z + faceZ(nxp, ny) + 0.035), I('head'), null, (p) => { const q = p.clone().sub(headP); return mul3(headCol(p), q.y < ny - 0.03 && Math.abs(q.x) < Math.abs(nxp) + 0.02 ? 0.5 : 0.95) })
      }
      // ears: a rim (helix), the antihelix ridge, a hollow bowl and the lobe, set behind the jaw and tilted out
      for (const s of [1, -1]) {
        const ear = new SkinGeo()
        const ez = -0.12, ey = 1.68, ex = 1.5
        const outline = (t) => { const sn = Math.sin(t); return [0.52 * sn * (sn < 0 ? 0.92 : 1), 0.31 * Math.cos(t) * (sn < -0.3 ? 0.78 : 1)] }
        const NU = 28, NV = 9
        const earAt = (t, v, back) => {
          const [oy, oz] = outline(t)
          const k = 1 - v * 0.9
          const y = -0.06 + oy * k + 0.06 * v, z = -0.02 + oz * k
          let hgt
          if (!back) {
            hgt = 0.12 * G(v - 0.1, 0.006) * (Math.cos(t) > 0.6 && Math.sin(t) < 0.2 ? 0.3 : 1) + 0.07 * G(v - 0.48, 0.012) - 0.05 * sm(0.62, 0.86, v)
            hgt += 0.07 * G(t - 0.15, 0.06) * G(v - 0.72, 0.01) // tragus
            hgt += 0.05
          } else hgt = 0.04 * (1 - v)
          const out = 0.2 * Math.max(0, -z) / 0.31 + 0.04
          return new THREE.Vector3(ex + (back ? out * (1 - v) * 0.8 : out + hgt), ey + y, ez + z)
        }
        for (const back of [false, true]) {
          const base = ear.p.length / 3
          for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
            const t = (i / NU) * Math.PI * 2, v = j / NV
            const q = earAt(back ? -t : t, v, back)
            q.x *= s
            const p = q.clone().add(headP)
            const deep = back ? 0.8 : 1 - 0.3 * sm(0.6, 0.95, v) - 0.12 * G(v - 0.3, 0.01)
            const c = mix3(mul3(SK, deep), lin('#c4604a'), back ? 0.1 : 0.22 * G(v - 0.1, 0.02))
            ear.vert(p, i / NU, v, [[I('head'), 1]], c)
          }
          for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
            const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, dd = c + 1
            if (s > 0) ear.tri(a, c, b, b, c, dd); else ear.tri(a, b, c, b, dd, c)
          }
        }
        const base = skin.p.length / 3
        skin.p.push(...ear.p); skin.uv.push(...ear.uv); skin.c.push(...ear.c); skin.si.push(...ear.si); skin.sw.push(...ear.sw)
        for (const i of ear.ix) skin.ix.push(i + base)
      }
      // the eyelids: the upper one on the lid bone (it blinks), the lower on the head; each a shell over the eyeball
      // whose edge follows an almond line, with a rolled margin, a crease above the upper lid
      this._lidEdge = { eUp, eLo }
      const sph = (r, a, e) => new THREE.Vector3(r * Math.cos(e) * Math.sin(a), r * Math.sin(e), r * Math.cos(e) * Math.cos(a))
      for (const s of [1, -1]) {
        const L = s > 0 ? 'L' : 'R'
        const lp = wp('lid' + L)
        const rU = EYE.r + 0.032, rL = EYE.r + 0.018
        const NA = N(26)
        // upper lid
        skin.grid(NA, 12, (u, v) => {
          const a = (s > 0 ? -1.3 : -1.38) + u * 2.68, q = clamp((a * s) / 1.25, -1, 1), e0 = eUp(q)
          let p, c
          if (v < 0.17) { const k = v / 0.17; p = sph(EYE.r + 0.004 + k * (rU - EYE.r - 0.004), a, e0 + 0.01 * k); c = home ? mul3(SK, 0.3) : mix3(mul3(SK, 0.82), lin('#9a5048'), 0.3) }
          else { const k = (v - 0.17) / 0.83, e = e0 + 0.02 + k * 2.3; p = sph(rU + 0.02 * Math.sin(Math.min(1, k * 3) * Math.PI) * (1 - k), a, e); const crease = G(e - e0 - 0.36, 0.004); c = mul3(SK, (0.86 + 0.1 * k) * (1 - 0.25 * crease)); if (home) c = mix3(c, mul3(lin('#5a3a3a'), 0.7), 0.25 * sm(0.5, 0.0, k)) }
          return { p: p.add(lp), w: [[I('lid' + L), 1]], c }
        })
        // lower lid
        skin.grid(NA, 7, (u, v) => {
          const a = (s > 0 ? 1.38 : 1.3) - u * 2.68, q = clamp((a * s) / 1.25, -1, 1), e0 = eLo(q)
          let p, c
          if (v < 0.2) { const k = v / 0.2; p = sph(EYE.r + 0.004 + k * (rL - EYE.r - 0.004), a, e0 - 0.01 * k); c = mix3(mul3(SK, 0.85), lin('#a85a50'), 0.25) }
          else { const k = (v - 0.2) / 0.8; p = sph(rL + 0.006 * Math.sin(Math.min(1, k * 3) * Math.PI) * (1 - k), a, e0 - 0.02 - k * 1.3); c = mul3(SK, 0.94 + 0.04 * k) }
          return { p: p.add(lp), w: [[I('head'), 1]], c }
        })
      }
      // the neck
      const NK = home ? [[22.5, 0.94, 0.92], [23.4, 0.87, 0.85], [24.2, 0.83, 0.81], [25.0, 0.85, 0.88], [25.7, 0.93, 1.0], [26.3, 0.85, 0.9]] : [[22.5, 1.04, 1.0], [23.4, 0.99, 0.95], [24.2, 0.94, 0.92], [25.0, 0.94, 0.96], [25.7, 0.98, 1.06], [26.3, 0.9, 0.95]]
      skin.tube(NK.map(([y, rx, rz]) => ({ c: new THREE.Vector3(0, y, 0.12 + (y - 22.5) * 0.06), x: new THREE.Vector3(0, 0, rz), y: new THREE.Vector3(rx, 0, 0) })), {
        seg: 24, capStart: true,
        wfn: (p) => W(p.y < 24 ? blendW(I('chest'), I('neck'), p.y, 23.0, 24.0) : blendW(I('neck'), I('head'), p.y, 24.4, 25.2)),
        cfn: (p) => mul3(SK, 0.72 + 0.1 * sm(23.2, 24.6, p.y) - 0.12 * sm(25.0, 25.6, p.y) * sm(-0.2, 0.6, p.z) - 0.1 * sm(0, -0.8, p.z)),
      })
      if (home) {
        // forearms below the three-quarter sleeves, with gold and glass bangles
        for (const s of [1, -1]) {
          const L = s > 0 ? 'L' : 'R'
          const FA = [[16.2, 0.84, 0.8], [15.2, 0.78, 0.74], [14.0, 0.64, 0.6], [13.2, 0.54, 0.46], [12.6, 0.47, 0.36], [12.2, 0.44, 0.33]]
          skin.tube(FA.map(([y, rx, rz]) => ({ c: new THREE.Vector3(2.75 * s, y, 0.05), x: new THREE.Vector3(rx, 0, 0), y: new THREE.Vector3(0, 0, rz) })), {
            seg: 20, capStart: true, capEnd: true, wfn: (p) => W(p.y < 13.3 ? blendW(I('elbow' + L), I('wrist' + L), p.y, 13.4, 12.7) : [[I('elbow' + L), 1]]), cfn: (p) => mul3(SK, 0.92 + 0.06 * sm(13, 15, p.y)),
          })
          const bang = [[13.1, 0.6, '#e0a43a'], [13.26, 0.62, '#9a1f2e'], [13.4, 0.63, '#e0a43a'], [13.54, 0.65, '#1f5a3a'], [13.68, 0.66, '#e0a43a']]
          for (const [y, r, col] of s > 0 ? bang : bang.slice(0, 3)) {
            const ring = new THREE.TorusGeometry(r, 0.045, 4, 22).rotateX(Math.PI / 2)
            skin.rigid(ring, new THREE.Matrix4().makeTranslation(2.75 * s, y, 0.05), [[I('elbow' + L), 1]], lin(col))
          }
        }
        // jhumka earrings: a stud, a little gold bell and beads
        for (const s of [1, -1]) {
          const e = H(s * 1.6, 1.2, -0.12)
          skin.rigid(new THREE.SphereGeometry(0.08, 8, 6), new THREE.Matrix4().makeTranslation(e.x, e.y, e.z), I('head'), lin('#e8b040'))
          const bell = new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 1)
          skin.rigid(bell, new THREE.Matrix4().makeTranslation(e.x, e.y - 0.32, e.z), I('head'), lin('#d9a032'))
          for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; skin.rigid(new THREE.SphereGeometry(0.035, 5, 4), new THREE.Matrix4().makeTranslation(e.x + Math.cos(a) * 0.15, e.y - 0.42, e.z + Math.sin(a) * 0.15), I('head'), lin('#f0c060')) }
        }
        // a bindi, and a small stud on the left nostril
        { const by = 2.36, bz = faceZ(0, by); skin.rigid(new THREE.CircleGeometry(0.06, 16), new THREE.Matrix4().makeTranslation(headP.x, headP.y + by, headP.z + bz + 0.012), I('head'), lin('#b0102a')) }
        { const nx = 0.25, ny = 1.24; skin.rigid(new THREE.SphereGeometry(0.035, 8, 6), new THREE.Matrix4().makeTranslation(headP.x + nx, headP.y + ny, headP.z + faceZ(nx, ny) + 0.13), I('head'), lin('#ffd070')) }
      }
    }
    this._mesh(skin, skinM, skeleton)

    // ---- Eyes (on the eye bones): sclera, iris and pupil, the cornea bulging a little; the catch-light on the head ----
    const eyes = new SkinGeo()
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const ep = wp('eye' + L)
      const eg = new THREE.SphereGeometry(EYE.r, N(26), N(18))
      const Pp = eg.attributes.position, U = eg.attributes.uv
      for (let i = 0; i < Pp.count; i++) {
        let x = Pp.getX(i), y = Pp.getY(i), z = Pp.getZ(i)
        const rr = Math.hypot(x, y) / EYE.r
        if (z > 0 && rr < 0.52) z += 0.03 * (1 - (rr / 0.52) ** 2)
        Pp.setXYZ(i, x, y, z)
        if (z > 0) U.setXY(i, 0.5 + x / (2 * EYE.r), 0.5 + y / (2 * EYE.r)); else U.setXY(i, 0.5 + Math.sign(x) * 0.48, 0.5)
      }
      eyes.rigid(eg, new THREE.Matrix4().makeTranslation(ep.x, ep.y, ep.z), I('eye' + L))
      // the catch-light: a small disc floating just over the cornea, up and to the side, fixed to the head
      const dir = new THREE.Vector3(-0.3, 0.36, 0.88).normalize()
      const cl = new THREE.CircleGeometry(0.045, 12).scale(1.25, 1, 1)
      const Uc = cl.attributes.uv; for (let i = 0; i < Uc.count; i++) Uc.setXY(i, 0.95, 0.95)
      const m = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
      m.setPosition(ep.clone().addScaledVector(dir, EYE.r + 0.016))
      eyes.rigid(cl, m, I('head'))
    }
    this._mesh(eyes, eyeM, skeleton)

    // ---- Hair, brows, lashes ----
    const hair = new SkinGeo()
    const HC = lin(O.hair)
    {
      // hairline: a soft line at the forehead, above the ears at the sides, sideburns in front of each ear, low at the nape
      const lim = (ph) => {
        const f = Math.cos(ph), a = Math.abs(Math.atan2(Math.sin(ph), Math.cos(ph)))
        if (home) return (f > 0 ? 0.29 + 0.21 * (1 - f) ** 1.1 : 0.5 + 0.14 * Math.pow(-f, 0.8)) * Math.PI
        let l = f > 0 ? 0.28 + 0.14 * (1 - f) ** 1.3 : 0.42 + 0.24 * Math.pow(-f, 0.7)
        l += 0.06 * Math.exp(-((a - 1.2) ** 2) / 0.03)
        return l * Math.PI
      }
      const NU = N(64), NV = N(20)
      hair.grid(NU, NV, (u, v) => {
        const ph = u * Math.PI * 2, th = v * lim(ph)
        const d = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph))
        const p = skull(d, false)
        const n = p.clone().sub(new THREE.Vector3(0, 1.8, 0)).normalize()
        const edge = sm(0.72, 1, v)
        let thick = home ? (0.1 + 0.08 * Math.sin(Math.min(1, v * 1.6) * Math.PI / 2) + 0.16 * G(v - 0.62, 0.05) * Math.max(0, Math.cos(ph)) ** 1.5) * (1 - edge * 0.8) : (0.06 + 0.07 * sm(0.3, 0.6, v) * (1 - Math.max(0, -Math.cos(ph)) * 0.5)) * (1 - edge * 0.8)
        const clump = Math.sin(u * NU * Math.PI * 0.5 + Math.sin(u * 23) * 2)
        if (home) thick += 0.035 * clump * sm(0.08, 0.3, v) * (1 - edge)
        if (home) { const part = G(Math.atan2(Math.sin(ph), Math.cos(ph)), 0.0015) * sm(0.05, 0.25, v) * (1 - sm(0.5, 0.7, v)); thick -= part * 0.06 }
        p.addScaledVector(n, thick)
        const strand = 0.84 + 0.2 * Math.sin(u * NU * Math.PI * 0.5 + Math.sin(u * 23) * 2) * (0.6 + 0.4 * Math.sin(u * 61))
        let c = mul3(HC, strand * (1 + 0.5 * sm(0.0, 0.3, v) * (1 - v)))
        if (home) c = mix3(mul3(c, 0.8 + 0.25 * clump), lin('#5a3626'), 0.4 * Math.max(0, clump) * sm(0.15, 0.5, v) * (1 - edge)) // clumps of strands with warm brown lights
        if (home && Math.abs(Math.sin(ph)) < 0.025 && Math.cos(ph) > 0 && v < 0.55) c = mix3(mul3(SK, 0.75), lin('#9a1020'), 0.35) // the parting (a touch of sindoor)
        if (!home) c = mix3(c, mul3(SK, 0.45), sm(0.6, 0.9, v) * 0.3 * Math.abs(Math.sin(ph))) // a short fade at the sides
        c = mix3(c, mul3(SK, 0.75), edge * 0.7) // a soft hairline
        return { p: p.add(headP), w: [[I('head'), 1]], c }
      }, [NU / 6, 3])
      if (home) {
        // a low bun with a twist, ringed by a string of jasmine
        const bun = new THREE.SphereGeometry(0.88, N(28), N(18))
        const Bp = bun.attributes.position
        for (let i = 0; i < Bp.count; i++) {
          const x = Bp.getX(i), y = Bp.getY(i), z = Bp.getZ(i), a = Math.atan2(y, x)
          const k = 1 + 0.06 * Math.sin(a * 2 + z * 7)
          Bp.setXYZ(i, x * k, y * 0.85 * k, z * 0.75)
        }
        const bc = new THREE.Vector3(headP.x, headP.y + 1.1, headP.z - 2.02)
        hair.rigid(bun, new THREE.Matrix4().makeTranslation(bc.x, bc.y, bc.z), I('head'), null, (p) => { const q = p.clone().sub(bc); const tw = Math.sin(Math.atan2(q.y, q.x) * 2 + q.z * 7); return mix3(mul3(HC, 0.85 + 0.25 * Math.max(0, tw)), lin('#5a3626'), 0.4 * Math.max(0, Math.sin(Math.atan2(q.y, q.x) * 9 + q.z * 5))) })
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2
          hair.rigid(new THREE.SphereGeometry(0.085, 6, 5), new THREE.Matrix4().makeTranslation(bc.x + Math.cos(a) * 0.86, bc.y + Math.sin(a) * 0.74, bc.z + 0.22), I('head'), lin('#fbf6e8'))
        }
      }
      // brows: tapered ribbons of hair lying on the brow ridge, a gentle arch, the inner ends a little raised (kind)
      for (const s of [1, -1]) {
        const BR = home ? { y0: 2.42, arch: 0.11, w0: 0.065, len: 0.82, x0: 0.27, lift: 0.03 } : { y0: 2.43, arch: 0.09, w0: 0.062, len: 0.78, x0: 0.27, lift: 0.075 } // slimmer, with the inner ends raised: an open, kind look
        const nu = 14
        const base = hair.p.length / 3
        for (let j = 0; j <= 2; j++) for (let i = 0; i <= nu; i++) {
          const t = i / nu, x = s * (BR.x0 + t * BR.len)
          const yc = BR.y0 + BR.arch * Math.sin(Math.min(1, t / 0.62) * Math.PI / 2) - BR.arch * 2.2 * sm(0.62, 1, t) * (t - 0.62) + BR.lift * (1 - t) ** 2.5
          const w = BR.w0 * (1 - 0.65 * sm(0.4, 1, t)) * (0.85 + 0.15 * sm(0, 0.15, t))
          const v = j / 2 - 0.5, y = yc + v * w * 2
          const z = faceZ(x, y) + 0.018 + 0.016 * (1 - 4 * v * v)
          const c = mul3(HC, (0.8 + 0.4 * (i % 2)) * (0.9 + 0.2 * (1 - Math.abs(v))))
          hair.vert(H(x, y, z), t * 4, j / 2, [[I('head'), 1]], c)
        }
        for (let j = 0; j < 2; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; s > 0 ? hair.tri(a, b, c, b, d, c) : hair.tri(a, c, b, b, c, d) }
        // lashes along the upper lid edge, curling up and out, on the lid bone
        const lp = wp('lid' + (s > 0 ? 'L' : 'R'))
        const nl = 14, lb = hair.p.length / 3
        for (let j = 0; j <= 2; j++) for (let i = 0; i <= nl; i++) {
          const q = -0.92 + (i / nl) * 1.98, a = (q * 1.25) * s, e0 = this._lidEdge.eUp(clamp(q, -1, 1))
          const root = new THREE.Vector3(Math.cos(e0) * Math.sin(a), Math.sin(e0), Math.cos(e0) * Math.cos(a))
          const len = (home ? 0.11 : 0.05) * (0.6 + 0.6 * sm(-0.6, 0.9, q)) * (1 - 0.5 * sm(0.9, 1.06, q))
          const k = j / 2
          const p = root.clone().multiplyScalar(EYE.r + 0.035 + k * len * 0.55)
          p.y += k * k * len * 0.75; p.x += s * k * len * 0.25 * sm(0.2, 1, q)
          hair.vert(p.add(lp), i / nl, k, [[I('lid' + (s > 0 ? 'L' : 'R')), 1]], mul3(HC, home ? 0.55 : 0.9))
        }
        for (let j = 0; j < 2; j++) for (let i = 0; i < nl; i++) { const a = lb + j * (nl + 1) + i, b = a + 1, c = a + nl + 1, d = c + 1; hair.tri(a, b, c, b, d, c) }
      }
    }
    this._mesh(hair, hairM, skeleton)

    // ---- The mouth: lips over the face, an upper with a cupid's bow, a fuller lower, meeting in a soft line that
    //      curves up into a smile (rebuilt only when the smile changes) ----
    {
      const NU = 22, NV = 6
      const g = new THREE.BufferGeometry()
      const n = 2 * (NU + 1) * (NV + 1)
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
      const idx = []
      for (let L2 = 0; L2 < 2; L2++) for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const a = L2 * (NU + 1) * (NV + 1) + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1
        if (L2 === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d)
      }
      g.setIndex(idx)
      this.mouthGeo = g
      this._mouthDims = { NU, NV }
      const mouth = new THREE.Mesh(g, skinM)
      mouth.castShadow = false; mouth.receiveShadow = true
      head.add(mouth)
      this.mouth = mouth
      this._lipCol = lin(O.lip); this._skinCol = SK
      this._smile = -1
    }

    // ---- Cap (rider): six panels with seams and eyelets, a button, a green band, a curved brim worn up off the eyes ----
    if (O.hat === 'cap') {
      const cap = new SkinGeo()
      const gold = lin('#d8951a'), band = lin(UNIFORM.green)
      const capLim = (ph) => { const f = Math.cos(ph); return (f > 0 ? 0.3 + 0.08 * (1 - f) : 0.38 + 0.1 * -f) * Math.PI }
      // worn a little back: the whole cap tips up at the front about a point behind the crown
      const TB = new THREE.Matrix4().makeTranslation(0, 1.2, -0.9).multiply(new THREE.Matrix4().makeRotationX(-0.24)).multiply(new THREE.Matrix4().makeTranslation(0, -1.2, 0.9))
      const wb = (p) => p.applyMatrix4(TB)
      const crownAt = (ph, v, extra = 0) => {
        const th = v * capLim(ph)
        const d = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph))
        const p = skull(d, false)
        const n = p.clone().sub(new THREE.Vector3(0, 1.8, 0)).normalize()
        p.addScaledVector(n, 0.16 + 0.06 * Math.cos(th * 1.2) * (1 - v * 0.6) + extra)
        p.y = 1.8 + (p.y - 1.8) * 0.95 + 0.1
        return p
      }
      cap.grid(N(60), N(14), (u, v) => {
        const ph = u * Math.PI * 2
        const seamD = Math.abs(Math.sin(ph * 3))
        const p = crownAt(ph, v, -0.025 * G(seamD, 0.002) * sm(0.05, 0.2, v) + 0.015 * Math.sin(Math.PI * Math.min(1, v * 1.1)) * (1 - G(seamD, 0.05)))
        let c = mul3(gold, 0.96 + 0.06 * (1 - seamD))
        if (seamD < 0.05 && v > 0.06) c = mul3(gold, 0.7)
        if (Math.abs(seamD - 0.09) < 0.025 && v > 0.1 && v < 0.88) c = mul3(gold, 0.82) // top-stitching beside each seam
        // an embroidered eyelet on each side panel
        for (const ea of [1.05, -1.05, 2.1, -2.1]) if (G(ph - ea, 0.004) * G(v - 0.42, 0.002) > 0.4) c = mul3(gold, 0.35)
        if (v > 0.86) c = mul3(band, v > 0.97 ? 0.8 : 1)
        return { p: wb(p).add(headP), w: [[I('head'), 1]], c }
      }, [12, 2.5])
      // inner sweatband
      cap.grid(64, 1, (u, v) => {
        const ph = (1 - u) * Math.PI * 2, th = capLim(ph) * (0.98 + v * 0.02)
        const d = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph))
        const p = skull(d, false); const n = p.clone().sub(new THREE.Vector3(0, 1.8, 0)).normalize(); p.addScaledVector(n, 0.06 + v * 0.08); p.y = 1.8 + (p.y - 1.8) * 0.95 + 0.1
        return { p: wb(p).add(headP), w: [[I('head'), 1]], c: mul3(band, 0.45) }
      })
      // the brim: a curved bill, thicker at the root, with rows of stitching
      const crownEdge = (ph) => wb(crownAt(ph, 1, -0.03))
      const brimTop = (u, v, off) => {
        const ph = (u - 0.5) * 1.7
        const root = crownEdge(ph)
        const L = 1.05 * Math.pow(Math.max(0, Math.cos(ph * 1.0)), 1.2) + 0.04
        const out = new THREE.Vector3(Math.sin(ph) * 0.35, 0.28, Math.cos(ph)).normalize()
        const p = root.addScaledVector(out, v * L)
        p.y += -v * v * 0.05 - Math.abs(Math.sin(ph)) * v * 0.14 + off * (1 - v * 0.4)
        return p.add(headP)
      }
      cap.grid(28, 10, (u, v) => {
        const st = [0.35, 0.55, 0.75].some((k) => Math.abs(v - k) < 0.03) && u > 0.06 && u < 0.94
        return { p: brimTop(u, v, 0.07), w: [[I('head'), 1]], c: v > 0.94 ? mul3(gold, 0.8) : mul3(gold, st ? 0.78 : 0.97) }
      })
      cap.grid(28, 10, (u, v) => ({ p: brimTop(1 - u, v, -0.04), w: [[I('head'), 1]], c: mul3(band, 0.7) }))
      cap.grid(28, 1, (u, v) => ({ p: brimTop(u, 1, 0.07 - v * 0.11), w: [[I('head'), 1]], c: mul3(gold, 0.7) }))
      cap.rigid(new THREE.SphereGeometry(0.22, 14, 8).scale(1, 0.55, 1), new THREE.Matrix4().makeTranslation(headP.x, headP.y, headP.z).multiply(TB).multiply(new THREE.Matrix4().makeTranslation(0, crownAt(0, 0).y + 0.02, crownAt(0, 0).z)), I('head'), mul3(gold, 0.9))
      this.cap = this._mesh(cap, capM, skeleton); this.cap.castShadow = false
    } else this.cap = new THREE.Group()

    // ---- Helmet (rider): a static group on the head bone (so it can also sit loose on the handlebar) ----
    this.helmet = this._helmet((d) => skull(d, false), helmM, visorM)
    head.add(this.helmet)

    // ---- Gloves ----
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const mount = new THREE.Group(); mount.rotation.x = Math.PI / 2; mount.position.y = -0.95; J['wrist' + L].add(mount)
      const hand = new Hand({ glove: O.glove, left: s > 0, arm: false, rim, skin: home, lod: lod * 0.55 })
      if (home) hand.scale.setScalar(0.92)
      mount.add(hand)
      this['hand' + L] = hand
      this['mount' + L] = mount
    }

    if (O.scale !== 1) this.scale.setScalar(O.scale)
    this.setHelmet(helmet)
    this.pose(Person.STAND)
    this._mountQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
  }

  _mesh(Gs, mat, skeleton) {
    const m = new THREE.SkinnedMesh(Gs.build(), mat)
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false
    this.add(m)
    m.updateMatrixWorld(true)
    m.bind(skeleton, new THREE.Matrix4())
    return m
  }

  _helmet(skull, helmM, visorM) {
    const g = new THREE.Group()
    const Gm = new THREE.BufferGeometry()
    const pos = [], col = [], idx = []
    const gold = lin(UNIFORM.gold), green = lin(UNIFORM.green), pad = lin('#2a1d14'), strap = lin('#1e1a16'), metal = lin('#d8d0bc'), rubber = lin('#24201c')
    const push = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1 }
    const grid = (nu, nv, fn) => {
      const base = pos.length / 3
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const o = fn(i / nu, j / nv); push(o.p, o.c) }
      const id = (i, j) => base + j * (nu + 1) + i
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) idx.push(id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1))
    }
    const lim = (ph) => { const f = Math.cos(ph); return (f > 0 ? 0.37 + 0.2 * (1 - f) ** 1.5 : 0.57 + 0.06 * -f) * Math.PI }
    const shellAt = (ph, th, off) => {
      const d = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph))
      const p = skull(d), n = p.clone().sub(new THREE.Vector3(0, 1.8, 0)).normalize()
      return p.addScaledVector(n, 0.5 + off + 0.1 * Math.cos(th)).add(new THREE.Vector3(0, 0.12, 0))
    }
    // vents: three slots each side of the stripe on top, recessed and dark
    const vent = (ph, v) => {
      let k = 0
      for (const [a0, v0] of [[0.42, 0.32], [-0.42, 0.32], [0.95, 0.42], [-0.95, 0.42], [2.6, 0.5], [-2.6, 0.5]]) k = Math.max(k, G(Math.atan2(Math.sin(ph - a0), Math.cos(ph - a0)), 0.006) * G(v - v0, 0.012))
      return k
    }
    grid(80, 24, (u, v) => {
      const ph = u * Math.PI * 2, th = v * lim(ph)
      const vk = vent(ph, v)
      const p = shellAt(ph, th, -0.08 * sm(0.3, 0.7, vk) + 0.03 * sm(0.04, 0.0, Math.abs(Math.abs(Math.sin(ph)) - 0.17)) * (v < 0.9 ? 1 : 0))
      let c = gold
      if (Math.abs(p.x) < 0.28 && v < 0.96) c = green
      if (Math.abs(Math.abs(p.x) - 0.36) < 0.05 && v < 0.96) c = mul3(gold, 0.6)
      if (vk > 0.4) c = mul3(pad, 0.6)
      if (v > 0.95) c = rubber // the rubber edge trim
      return { p, c }
    })
    grid(72, 3, (u, v) => { const ph = (1 - u) * Math.PI * 2, th = lim(ph); return { p: shellAt(ph, th, -0.28 * v), c: rubber } })
    grid(48, 10, (u, v) => { const ph = (1 - u) * Math.PI * 2, th = v * lim(ph); return { p: shellAt(ph, th, -0.28), c: mul3(pad, 0.6) } })
    // chin strap: from in front of each ear down under the chin, a buckle on one side
    const tube = (pts, r, c) => {
      const crv = new THREE.CatmullRomCurve3(pts), tg = new THREE.TubeGeometry(crv, 24, r, 6, false)
      const base = pos.length / 3, P = tg.attributes.position
      for (let i = 0; i < P.count; i++) push(new THREE.Vector3().fromBufferAttribute(P, i), c)
      for (let i = 0; i < tg.index.count; i++) idx.push(base + tg.index.getX(i))
    }
    const sideP = (s) => new THREE.Vector3(s * 1.84, 1.55, 0.3)
    tube([sideP(1), new THREE.Vector3(1.62, 0.7, 0.82), new THREE.Vector3(0.95, 0.0, 1.18), new THREE.Vector3(0, -0.22, 1.26), new THREE.Vector3(-0.95, 0.0, 1.18), new THREE.Vector3(-1.62, 0.7, 0.82), sideP(-1)], 0.07, strap)
    const bk = new THREE.BoxGeometry(0.28, 0.22, 0.1), BP = bk.attributes.position
    const bm = new THREE.Matrix4().makeTranslation(1.3, 0.35, 1.04).multiply(new THREE.Matrix4().makeRotationZ(0.7))
    const base = pos.length / 3
    for (let i = 0; i < BP.count; i++) push(new THREE.Vector3().fromBufferAttribute(BP, i).applyMatrix4(bm), metal)
    for (let i = 0; i < bk.index.count; i++) idx.push(base + bk.index.getX(i))
    Gm.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    Gm.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    Gm.setIndex(idx); Gm.computeVertexNormals()
    const shell = new THREE.Mesh(Gm, helmM); shell.castShadow = true; shell.receiveShadow = true
    g.add(shell)
    // the visor: a smoked shield, flipped up a little so the face stays readable, with a dark edge
    const vg = new THREE.BufferGeometry(), vp = [], vi = []
    const nu = 28, nv = 8
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const ph = (i / nu - 0.5) * 2.3, th = (0.2 + (j / nv) * 0.18) * Math.PI
      const p = shellAt(ph, th, 0.12); vp.push(p.x, p.y + 0.05, p.z + 0.05)
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const id = (a, b) => b * (nu + 1) + a; vi.push(id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)) }
    vg.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3)); vg.setIndex(vi); vg.computeVertexNormals()
    const visor = new THREE.Mesh(vg, visorM)
    g.add(visor)
    const edge = []
    for (let i = 0; i <= nu; i++) { const ph = (i / nu - 0.5) * 2.3; const p = shellAt(ph, 0.38 * Math.PI, 0.12); edge.push(new THREE.Vector3(p.x, p.y + 0.05, p.z + 0.05)) }
    const em = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 40, 0.04, 5, false), new THREE.MeshStandardMaterial({ color: '#1e1a16', roughness: 0.6 }))
    g.add(em)
    // visor hinges
    for (const s of [1, -1]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14).rotateZ(Math.PI / 2), helmM); const hp = shellAt(s * Math.PI / 2, 0.42 * Math.PI, 0.1); h.position.copy(hp); g.add(h) }
    return g
  }

  setHelmet(on) { this.helmet.visible = on; this.cap.visible = !on }
  /** A static copy of the helmet (for the handlebar). */
  looseHelmet() { const h = this.helmet.clone(); h.visible = true; return h }

  pose(p) {
    for (const k in p) {
      const v = p[k]
      if (this.j[k] && Array.isArray(v)) this.j[k].rotation.set(v[0], v[1], v[2])
    }
    const hand = (Hd, c, th, sp) => Hd.pose(c ?? 0.25, sp ?? 0.1, th ?? 0.4)
    if ('curlL' in p || 'thumbL' in p) hand(this.handL, p.curlL, p.thumbL, p.spreadL)
    if ('curlR' in p || 'thumbR' in p) hand(this.handR, p.curlR, p.thumbR, p.spreadR)
    if ('smile' in p) this._setSmile(p.smile)
    if ('blink' in p || !this._lidSet) this._lids(p.blink ?? 0)
    return this
  }

  _setSmile(s) {
    s = Math.round(Math.max(0, Math.min(1.5, s)) * 40) / 40
    if (s === this._smile) return
    this._smile = s
    const home = this.outfit.hat === 'bun'
    const { NU, NV } = this._mouthDims, fz = this._faceZ
    const P = this.mouthGeo.attributes.position, Cc = this.mouthGeo.attributes.color, Uv = this.mouthGeo.attributes.uv
    const lip = this._lipCol, skin = this._skinCol, dark = mul3(lip, 0.35)
    const hw = (home ? 0.37 : 0.4) + 0.07 * s, y0 = home ? 0.8 : 0.78
    const yP = (u) => y0 + (0.03 + 0.11 * s) * u * u * (1 + 0.6 * u * u) - 0.015 * s
    const up = (u) => (home ? 0.15 : 0.12) * Math.pow(Math.max(0, 1 - u * u), 0.75) + 0.025 * G(Math.abs(u) - 0.24, 0.012) - 0.02 * G(u, 0.006)
    const lo = (u) => (home ? 0.19 : 0.15) * Math.pow(Math.max(0, 1 - u * u), 0.7)
    let i = 0
    for (let L2 = 0; L2 < 2; L2++) for (let j = 0; j <= NV; j++) for (let k = 0; k <= NU; k++) {
      const u = (k / NU) * 2 - 1, v = j / NV
      const x = u * hw * (1 - 0.06 * v)
      const y = L2 === 0 ? yP(u) + up(u) * v : yP(u) - lo(u) * v
      const env = Math.pow(Math.max(0, 1 - u * u), 0.6)
      const bulge = (L2 === 0 ? (home ? 0.075 : 0.06) : (home ? 0.095 : 0.075)) * env * Math.sin(Math.PI * (0.18 + 0.82 * v)) + 0.012 * (1 - v) * env
      const z = fz(x, y) + bulge + 0.008
      P.setXYZ(i, x, y, z)
      let c = mul3(lip, (L2 === 0 ? 0.92 : 1.05) * (0.85 + 0.15 * Math.sin(Math.PI * v)))
      c = mix3(c, dark, sm(0.2, 0.0, v) * 0.85 + sm(0.75, 1, Math.abs(u)) * 0.3)
      c = mix3(c, skin, sm(0.7, 1, v) * 0.9 + sm(0.85, 1, Math.abs(u)) * 0.5)
      Cc.setXYZ(i, c[0], c[1], c[2]); Uv.setXY(i, u, v)
      i++
    }
    P.needsUpdate = true; Cc.needsUpdate = true; Uv.needsUpdate = true
    this.mouthGeo.computeVertexNormals()
    this.mouthGeo.computeBoundingSphere()
  }

  _lids(blink) {
    this._lidSet = true
    this._blink = blink
    for (const L of ['L', 'R']) {
      const e = this.j['eye' + L]
      const look = e.rotation.x > 0 ? e.rotation.x * 0.5 : e.rotation.x * 0.4 // the upper lid follows the eye, most when it looks down
      this.j['lid' + L].rotation.set(look + blink * (1.02 - Math.max(0, look) * 0.9), e.rotation.y * 0.25, 0)
    }
  }

  static lerpPose(a, b, k) {
    const o = {}
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[key] ?? b[key], y = b[key] ?? a[key]
      o[key] = Array.isArray(x) ? x.map((v, i) => v + (y[i] - v) * k) : x + (y - x) * k
    }
    return o
  }

  /** A natural blink: 0 open … 1 shut, about every 3–5 s. */
  static blinkAt(time, seed = 0) {
    const period = 3.9 + Math.sin(seed * 3.1) * 0.8
    const ph = ((time + seed * 1.7) % period + period) % period
    const k = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0
    const ph2 = ((time + seed * 1.7 + 1.9) % (period * 2.3) + period * 2.3) % (period * 2.3)
    return Math.max(k, ph2 < 0.14 ? Math.sin((ph2 / 0.14) * Math.PI) : 0)
  }

  /** Turn neck and head toward a world point (blended over the current pose by headK) and aim the eyes (eyeK). */
  lookAt(target, headK = 1, eyeK = 1) {
    const J = this.j
    if (headK > 0) {
      this.updateMatrixWorld(true)
      const from = J.head.localToWorld(new THREE.Vector3(0, 1.98, 1.0))
      const inv = J.chest.getWorldQuaternion(new THREE.Quaternion()).invert()
      const d = target.clone().sub(from).applyQuaternion(inv)
      const yaw = Math.max(-1.25, Math.min(1.25, Math.atan2(d.x, d.z)))
      const pitch = Math.max(-0.7, Math.min(0.9, Math.atan2(-d.y, Math.hypot(d.x, d.z))))
      const k = headK
      J.neck.rotation.x += (pitch * 0.35 - J.neck.rotation.x) * k; J.neck.rotation.y += (yaw * 0.4 - J.neck.rotation.y) * k
      J.head.rotation.x += (pitch * 0.65 - J.head.rotation.x) * k; J.head.rotation.y += (yaw * 0.6 - J.head.rotation.y) * k
    }
    this.updateMatrixWorld(true)
    for (const L of ['L', 'R']) {
      const e = J['eye' + L]
      const hq = J.head.getWorldQuaternion(new THREE.Quaternion()).invert()
      const d = target.clone().sub(e.getWorldPosition(new THREE.Vector3())).applyQuaternion(hq)
      const yaw = Math.max(-0.5, Math.min(0.5, Math.atan2(d.x, d.z)))
      const pitch = Math.max(-0.35, Math.min(0.55, Math.atan2(-d.y, Math.hypot(d.x, d.z))))
      e.rotation.set(pitch * eyeK, yaw * eyeK, 0)
    }
    this._lids(this._blink || 0)
    return this
  }

  /** A quaternion for a glove whose palm faces `normal` and whose fingers point along `fingers` (world). */
  palmBasis(normal, fingers) {
    const f = fingers.clone().normalize()
    const n = normal.clone().sub(f.clone().multiplyScalar(normal.dot(f))).normalize()
    const x = new THREE.Vector3().crossVectors(n, f)
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, f))
  }

  /** Two-bone solve: puts `end` (child of mid, child of upper) at world point T, the middle joint toward `pole`. */
  _twoBone(upper, mid, a, b, T, pole) {
    const S = upper.getWorldPosition(new THREE.Vector3())
    const k = this.scale.x
    const A = a * k, Bl = b * k
    const d = THREE.MathUtils.clamp(T.distanceTo(S), Math.abs(A - Bl) + 0.05 * k, A + Bl - 0.02 * k)
    const dir = T.clone().sub(S).normalize()
    const pd = pole.clone().sub(S); pd.sub(dir.clone().multiplyScalar(pd.dot(dir))).normalize()
    const cosA = (A * A + d * d - Bl * Bl) / (2 * A * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
    const E = S.clone().add(dir.clone().multiplyScalar(A * cosA)).add(pd.multiplyScalar(A * sinA))
    const Tt = S.clone().add(dir.clone().multiplyScalar(d))
    const parentQ = upper.parent.getWorldQuaternion(new THREE.Quaternion())
    const toE = E.clone().sub(S).normalize().applyQuaternion(parentQ.clone().invert())
    upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toE)
    upper.updateMatrixWorld(true)
    const uQ = upper.getWorldQuaternion(new THREE.Quaternion())
    const toW = Tt.clone().sub(E).normalize().applyQuaternion(uQ.clone().invert())
    mid.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toW)
    mid.updateMatrixWorld(true)
    return mid.getWorldQuaternion(new THREE.Quaternion())
  }

  /** Arm IK: the glove's origin (palm) to `palm` (world) with orientation `q` (world); the elbow bends toward `pole`. */
  reach(side, palm, q, pole) {
    const sh = this.j['shoulder' + side], el = this.j['elbow' + side], wr = this.j['wrist' + side]
    this.updateMatrixWorld(true)
    const fingers = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    const wristW = palm.clone().sub(fingers.multiplyScalar(0.95 * this.scale.x))
    const S = sh.getWorldPosition(new THREE.Vector3())
    const poleW = pole || S.clone().add(new THREE.Vector3(side === 'L' ? 3 : -3, -6, -6).applyQuaternion(this.getWorldQuaternion(new THREE.Quaternion())))
    const elQ = this._twoBone(sh, el, 5.0, 4.15, wristW, poleW)
    wr.quaternion.copy(elQ.invert()).multiply(q).multiply(this._mountQ.clone().invert())
    wr.updateMatrixWorld(true)
  }

  /** Leg IK: the ankle to `ankle` (world), the foot facing `yaw` (world) and pitched by `pitch` (+ toes down), the
   *  knee toward `pole` (default: in front). `toe` bends the toes up (heel-off). */
  foot(side, ankle, yaw, pitch = 0, pole, toe = 0) {
    const hp = this.j['hip' + side], kn = this.j['knee' + side], an = this.j['ankle' + side]
    this.updateMatrixWorld(true)
    const S = hp.getWorldPosition(new THREE.Vector3())
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const poleW = pole || S.clone().addScaledVector(fwd, 20).add(new THREE.Vector3(0, -6, 0))
    const knQ = this._twoBone(hp, kn, 7.0, 6.7, ankle, poleW)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
    an.quaternion.copy(knQ.invert()).multiply(q)
    an.updateMatrixWorld(true)
    this.j['toe' + side].rotation.set(-toe, 0, 0)
  }

  /** Where a glove's palm is (world). */
  palmWorld(side, out = new THREE.Vector3()) {
    return this['hand' + side].getWorldPosition(out)
  }
}

// A few base poses.
Person.STAND = {
  hips: [0, 0, 0], spine: [0.02, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  shoulderL: [0.05, 0, 0.12], shoulderR: [0.05, 0, -0.12], elbowL: [-0.18, 0, 0], elbowR: [-0.18, 0, 0],
  wristL: [0, -Math.PI / 2, 0], wristR: [0, Math.PI / 2, 0],
  hipL: [0, 0, 0.02], hipR: [0, 0, -0.02], kneeL: [0.04, 0, 0], kneeR: [0.04, 0, 0], ankleL: [-0.04, 0, 0], ankleR: [-0.04, 0, 0],
  toeL: [0, 0, 0], toeR: [0, 0, 0], eyeL: [0, 0, 0], eyeR: [0, 0, 0],
  curlL: 0.35, curlR: 0.35, thumbL: 0.4, thumbR: 0.4, smile: 0.5, blink: 0,
}
Person.SIT = {
  ...Person.STAND,
  hips: [0, 0, 0], spine: [0.08, 0, 0], hipL: [-1.45, 0, 0.12], hipR: [-1.45, 0, -0.12], kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0], ankleL: [-0.1, 0, 0], ankleR: [-0.1, 0, 0],
}
