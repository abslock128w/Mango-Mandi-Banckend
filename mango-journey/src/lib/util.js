// Small shared helpers: maths, easing, seeded random, canvas textures.
import * as THREE from 'three'

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const inv = (a, b, v) => clamp((v - a) / (b - a))
export const smooth = (a, b, v) => { const t = inv(a, b, v); return t * t * (3 - 2 * t) }
export const smoother = (a, b, v) => { const t = inv(a, b, v); return t * t * t * (t * (t * 6 - 15) + 10) }
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3)
export const easeIn = (t) => Math.pow(clamp(t), 3)
export const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }
export const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)))
export const backOut = (t, s = 1.4) => { t = clamp(t) - 1; return t * t * ((s + 1) * t + s) + 1 }

/** Seeded random, the same on every visit. */
export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 7
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export const col = (hex) => new THREE.Color(hex)
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** A canvas texture made by a draw function. */
export function canvasTex(w, h, draw, { srgb = true, repeat = false, aniso = 4 } = {}) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = aniso
  t.needsUpdate = true
  return t
}

/** Noise in a canvas (for grain-like texture: wood, cardboard, fabric). */
export function noiseFill(g, w, h, amt, seed = 3, scaleX = 1, scaleY = 1) {
  const r = rng(seed), img = g.getImageData(0, 0, w, h), d = img.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, n = (r() - 0.5) * amt
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  g.putImageData(img, 0, 0)
}

/** Damped value toward a target, frame-rate independent. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt))

/** A text label texture (tray cards, box label, ribbon). */
export function labelTex(w, h, draw) {
  return canvasTex(w, h, (g) => { g.textBaseline = 'middle'; draw(g, w, h) }, { aniso: 8 })
}

export const SERIF = "'Young Serif', Georgia, serif"
export const SANS = "'Figtree', system-ui, sans-serif"
