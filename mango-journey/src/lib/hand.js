// A gloved hand: one skinned cotton glove (a cushioned palm with thenar and heel pads, four separate fingers with
// knuckles, creases and side seams, a thumb, three stitched "points" on the back, a knitted rib cuff with an overlocked
// gold edge), and, for the close-ups, the jacket sleeve: a tapered twill tube with a stitched cuff band, the mango-gold
// trim, cloth bunched above the cuff and soft folds. Palm faces +y, fingers point +z, the cuff sits at z ≈ -0.9 and the
// sleeve runs back along -z. `pose(curl, spread, thumb)` bends every joint (0 open … 1 closed around a fruit).
//
// Also exported for the rider (src/lib/character.js): SkinGeo, a small builder for skinned tubes and surfaces;
// addRim, a soft fresnel rim (and an optional warm subsurface glow for skin) on any standard material;
// fabric / bumpTex / knitTex / twillTex, procedural cloth textures; stitch, a line of thread stitches.
import * as THREE from 'three'
import { canvasTex, rng } from './util.js'

let fabricTex = null
export function fabric() {
  if (fabricTex) return fabricTex
  fabricTex = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#e9dfc6'; g.fillRect(0, 0, W, H)
    const r = rng(4)
    for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(120,100,70,${0.05 + r() * 0.06})`; g.fillRect(0, y, W, 1) }
    for (let x = 0; x < W; x += 2) { g.fillStyle = `rgba(255,255,240,${0.04 + r() * 0.05})`; g.fillRect(x, 0, 1, H) }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.08})`; g.fillRect(r() * W, r() * H, 2 + r() * 6, 1) }
  }, { repeat: true })
  fabricTex.repeat.set(3, 3)
  return fabricTex
}

/** Jersey knit (cotton gloves): columns of little V loops, soft mottling and fuzz. White, tinted by the material.
 *  One tile ≈ 0.45 units when the uv is scaled to world size (SkinGeo uScale / v1). */
const knits = {}
export function knitTex(bump = false) {
  const k = bump ? 'b' : 'c'
  if (knits[k]) return knits[k]
  knits[k] = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = bump ? '#808080' : '#f6f3ec'; g.fillRect(0, 0, W, H)
    const r = rng(bump ? 31 : 32)
    if (!bump) for (let i = 0; i < 70; i++) { const x = r() * W, y = r() * H, s = 10 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${r() < 0.5 ? '120,100,70' : '255,255,250'},${0.03 + r() * 0.04})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s) }
    // the wales: each loop a pair of slanted strokes, light on top, a dark gap between columns
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const j = (r() - 0.5) * 0.6
      g.strokeStyle = bump ? `rgba(255,255,255,${0.35 + r() * 0.2})` : `rgba(255,255,255,${0.22 + r() * 0.12})`; g.lineWidth = 1.3
      g.beginPath(); g.moveTo(x + 0.3, y + j); g.lineTo(x + 2, y + 3); g.lineTo(x + 3.7, y - j); g.stroke()
      g.fillStyle = bump ? `rgba(0,0,0,${0.35 + r() * 0.15})` : `rgba(90,75,55,${0.1 + r() * 0.06})`; g.fillRect(x + 3.6, y, 0.8, 4)
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = bump ? `rgba(255,255,255,${r() * 0.3})` : `rgba(255,255,255,${r() * 0.2})`; g.fillRect(r() * W, r() * H, 1, 1 + r() * 2) }
  }, { repeat: true, srgb: !bump })
  return knits[k]
}

/** Twill for jacket cloth: a fine diagonal weave, a little slub and mottling. White, tinted by the material. */
const twills = {}
export function twillTex(bump = false) {
  const k = bump ? 'b' : 'c'
  if (twills[k]) return twills[k]
  twills[k] = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = bump ? '#808080' : '#eef0ea'; g.fillRect(0, 0, W, H)
    const r = rng(bump ? 41 : 42)
    if (!bump) for (let i = 0; i < 60; i++) { const x = r() * W, y = r() * H, s = 12 + r() * 50, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.04})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s) }
    for (let k2 = -H; k2 < W; k2 += 4) { g.strokeStyle = bump ? `rgba(255,255,255,${0.32 + r() * 0.15})` : `rgba(255,255,255,${0.14 + r() * 0.08})`; g.lineWidth = 1.7; g.beginPath(); g.moveTo(k2, 0); g.lineTo(k2 + H, H); g.stroke() }
    for (let k2 = -H; k2 < W; k2 += 4) { g.strokeStyle = bump ? `rgba(0,0,0,${0.3 + r() * 0.15})` : `rgba(0,10,5,${0.1 + r() * 0.06})`; g.lineWidth = 0.9; g.beginPath(); g.moveTo(k2 + 2.2, 0); g.lineTo(k2 + 2.2 + H, H); g.stroke() }
    for (let i = 0; i < 260; i++) { g.fillStyle = bump ? `rgba(0,0,0,${r() * 0.25})` : `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * W, r() * H, 3 + r() * 12, 1) }
  }, { repeat: true, srgb: !bump })
  return twills[k]
}

const bumps = {}
/** A grey weave/grain bump texture: 'twill' (jacket), 'cotton' (trousers, glove), 'knit' (cuffs), 'skin', 'hair', 'leather'. */
export function bumpTex(kind = 'cotton') {
  if (bumps[kind]) return bumps[kind]
  const t = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, H)
    const r = rng(kind.length * 7 + 3)
    if (kind === 'twill') {
      for (let k = -H; k < W; k += 4) { g.strokeStyle = `rgba(255,255,255,${0.18 + r() * 0.1})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke() }
      for (let k = -H; k < W; k += 4) { g.strokeStyle = `rgba(0,0,0,${0.16 + r() * 0.1})`; g.lineWidth = 1; g.beginPath(); g.moveTo(k + 2, 0); g.lineTo(k + 2 + H, H); g.stroke() }
    } else if (kind === 'knit') {
      for (let x = 0; x < W; x += 4) { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, 0, 2, H); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 2, 0, 1, H) }
    } else if (kind === 'hair') {
      for (let i = 0; i < 2600; i++) { const x = r() * W, y = r() * H; g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.15 + r() * 0.25})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y + 6 + r() * 8); g.stroke() }
    } else if (kind === 'skin') {
      for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.08})`; g.beginPath(); g.arc(r() * W, r() * H, 0.6 + r() * 1.4, 0, 6.29); g.fill() }
    } else if (kind === 'leather') {
      for (let i = 0; i < 1400; i++) { g.strokeStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`; g.lineWidth = 0.7; const x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 10, y + (r() - 0.5) * 10); g.stroke() }
    } else {
      for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`; g.fillRect(0, y, W, 1) }
      for (let x = 0; x < W; x += 2) { g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.1})`; g.fillRect(x, 0, 1, H) }
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.15})`; g.fillRect(r() * W, r() * H, 3 + r() * 8, 1) }
    }
  }, { repeat: true, srgb: false })
  bumps[kind] = t
  return t
}

/** A soft fresnel rim on a standard/physical material, driven by shared uniforms { uRimCol, uRim }. With `sss`, skin
 *  also gets a warm glow in the shadowed, grazing and thin parts (a cheap stand-in for light scattered under the skin),
 *  scaled by the same rim strength so it follows each scene's light. */
export function addRim(mat, uni, { sss = 0 } = {}) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uRimCol = uni.uRimCol; s.uniforms.uRim = uni.uRim
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimCol; uniform float uRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float fr = 1. - clamp(dot(normal, normalize(vViewPosition)), 0., 1.); totalEmissiveRadiance += uRimCol * uRim * (pow(fr, 3.) * .9 + pow(fr, 8.) * .6) * diffuseColor.rgb * 2.2;' +
        (sss ? ` totalEmissiveRadiance += diffuseColor.rgb * vec3(1., .42, .26) * (${sss.toFixed(3)}) * (.35 + uRim) * (.55 + .9 * pow(fr, 1.6));` : '') + ' }')
  }
  mat.customProgramCacheKey = () => (sss ? 'mm-rim-sss' + sss : 'mm-rim')
  return mat
}
export const rimUniforms = (col = '#ffd9a8', k = 0.35) => ({ uRimCol: { value: new THREE.Color(col) }, uRim: { value: k } })

/** Superellipse cross-section: n = 2 round, higher is boxier. */
export const sup = (a, n) => { const c = Math.cos(a), s = Math.sin(a); return [Math.sign(c) * Math.pow(Math.abs(c), 2 / n), Math.sign(s) * Math.pow(Math.abs(s), 2 / n)] }

/**
 * A builder for one skinned BufferGeometry made of tubes (rings along a path) and grids.
 * Every vertex carries up to four bone weights, a uv and a colour (used as baked occlusion and tint).
 */
export class SkinGeo {
  constructor() { this.p = []; this.uv = []; this.si = []; this.sw = []; this.c = []; this.ix = []; this.seams = [] }
  vert(p, u, v, w, c = [1, 1, 1]) {
    const ws = (Array.isArray(w[0]) ? w : [[w, 1]]).filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4)
    let tot = 0; ws.forEach((e) => (tot += e[1]))
    for (let k = 0; k < 4; k++) { this.si.push(ws[k] ? ws[k][0] : 0); this.sw.push(ws[k] ? ws[k][1] / tot : 0) }
    this.p.push(p.x, p.y, p.z); this.uv.push(u, v); this.c.push(c[0], c[1], c[2])
    return this.p.length / 3 - 1
  }
  /**
   * rings: [{ c, x, y, n?, w }] centre, two radius axes (Vector3, length = radius), superellipse n, weights (or fn).
   * opt: seg (around), shape(a, ring, k) → radial multiplier, disp(p, a, ring, k) → mutate p, wfn(p, a, ring, k) → weights,
   * cfn(p, a, ring, k) → colour, capStart / capEnd (close with a pole), v0/v1 (uv along), uScale (uv around).
   */
  tube(rings, opt = {}) {
    const seg = opt.seg || 16, base = this.p.length / 3, N = rings.length
    const tmp = new THREE.Vector3()
    let len = 0; const lens = [0]
    for (let k = 1; k < N; k++) { len += rings[k].c.distanceTo(rings[k - 1].c); lens.push(len) }
    for (let k = 0; k < N; k++) {
      const R = rings[k], n = R.n || 2
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2
        const [cx, cy] = sup(a, n)
        const m = opt.shape ? opt.shape(a, R, k) : 1
        tmp.copy(R.c).addScaledVector(R.x, cx * m).addScaledVector(R.y, cy * m)
        if (opt.disp) opt.disp(tmp, a, R, k)
        const w = opt.wfn ? opt.wfn(tmp, a, R, k) : R.w
        const c = opt.cfn ? opt.cfn(tmp, a, R, k) : (R.col || [1, 1, 1])
        this.vert(tmp, (j / seg) * (opt.uScale || 1), (opt.v0 || 0) + (len ? lens[k] / len : 0) * ((opt.v1 ?? 1) - (opt.v0 || 0)), w, c)
      }
      this.seams.push([base + k * (seg + 1), base + k * (seg + 1) + seg])
    }
    const id = (k, j) => base + k * (seg + 1) + j
    for (let k = 0; k < N - 1; k++) for (let j = 0; j < seg; j++) this.tri(id(k, j), id(k, j + 1), id(k + 1, j), id(k, j + 1), id(k + 1, j + 1), id(k + 1, j))
    const cap = (k, end) => {
      const R = rings[k], d = rings[end ? N - 1 : 0].c.clone().sub(rings[end ? N - 2 : 1].c).normalize()
      const pc = R.c.clone().addScaledVector(d, opt.capBulge || 0)
      const w = opt.wfn ? opt.wfn(pc, 0, R, k) : R.w
      const c = opt.capCol || (opt.cfn ? opt.cfn(pc, 0, R, k) : (R.col || [1, 1, 1]))
      const pi = this.vert(pc, 0.5, end ? 1 : 0, w, c)
      for (let j = 0; j < seg; j++) end ? this.tri(id(k, j), id(k, j + 1), pi) : this.tri(id(k, j + 1), id(k, j), pi)
    }
    if (opt.capStart) cap(0, false)
    if (opt.capEnd) cap(N - 1, true)
    return this
  }
  /** A grid surface: fn(u, v) → { p, w, c } for u, v in 0…1; nu × nv quads, outward = (dp/du × dp/dv). */
  grid(nu, nv, fn, uvScale = null) {
    const base = this.p.length / 3
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const o = fn(i / nu, j / nv); this.vert(o.p, (i / nu) * (uvScale ? uvScale[0] : 1), (j / nv) * (uvScale ? uvScale[1] : 1), o.w, o.c || [1, 1, 1]) }
    const id = (i, j) => base + j * (nu + 1) + i
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) this.tri(id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1))
    return this
  }
  /** A rigid mesh (any BufferGeometry, transformed by matrix m) bound to one bone. */
  rigid(geo, m, bone, col = [1, 1, 1], cfn) {
    const g = geo
    const base = this.p.length / 3, P = g.attributes.position, U = g.attributes.uv, v = new THREE.Vector3()
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m)
      this.vert(v, U ? U.getX(i) : 0, U ? U.getY(i) : 0, Array.isArray(bone) ? bone : [[bone, 1]], cfn ? cfn(v) : col)
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.ix.push(base + g.index.getX(i))
    else for (let i = 0; i < P.count; i++) this.ix.push(base + i)
    return this
  }
  tri(...v) { this.ix.push(...v) }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4))
    g.setIndex(this.ix)
    g.computeVertexNormals()
    // Smooth the uv seams of the tubes.
    const N = g.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3()
    for (const [i, j] of this.seams) { a.fromBufferAttribute(N, i); b.fromBufferAttribute(N, j); a.add(b).normalize(); N.setXYZ(i, a.x, a.y, a.z); N.setXYZ(j, a.x, a.y, a.z) }
    return g
  }
}

/** Weights that hand over from bone a to bone b across [s0, s1] (smoothstep). */
export function blendW(a, b, s, s0, s1) {
  const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0))), k = t * t * (3 - 2 * t)
  return [[a, 1 - k], [b, k]]
}

/** A line of thread stitches along points: little beads of thread (a thin tube pinched between stitches). */
export function stitch(G, pts, { r = 0.02, wfn, col = [1, 1, 1], pitch = 0.09, seg = 4, lift = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts)
  const L = curve.getLength(), n = Math.max(2, Math.round(L / pitch))
  const rings = []
  for (let k = 0; k <= n * 3; k++) {
    const u = k / (n * 3), c = curve.getPointAt(u), t = curve.getTangentAt(u)
    if (lift) c.add(lift(c))
    const n0 = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const x = new THREE.Vector3().crossVectors(t, n0).normalize(), y = new THREE.Vector3().crossVectors(x, t).normalize()
    const rr = k % 3 === 0 ? r * 0.15 : r
    rings.push({ c, x: y.multiplyScalar(rr), y: x.multiplyScalar(rr) })
  }
  G.tube(rings, { seg, wfn: (p) => wfn(p), cfn: () => col })
}

const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (b - a === 0 ? 0 : (v - a) / (b - a)))); return t * t * (3 - 2 * t) }
const gauss = (x, w) => Math.exp(-(x * x) / w)

export class Hand extends THREE.Group {
  constructor({ glove = '#d8cdb2', sleeve = '#2c5a3c', scale = 1, left = false, arm = true, rim = null, skin = false, lod = 1 } = {}) {
    super()
    const N = (n) => Math.max(6, Math.round(n * lod))
    const rimU = rim || rimUniforms('#fff0d0', 0.22)
    const TILE = 0.42 // world size of one knit tile
    const mat = skin
      ? new THREE.MeshPhysicalMaterial({ color: glove, roughness: 0.5, bumpMap: bumpTex('skin'), bumpScale: 0.5, sheen: 0.35, sheenColor: new THREE.Color('#ffc8a0'), sheenRoughness: 0.45, clearcoat: 0.1, clearcoatRoughness: 0.55, vertexColors: true })
      : new THREE.MeshPhysicalMaterial({ color: glove, roughness: 0.9, map: knitTex(), bumpMap: knitTex(true), bumpScale: 1.6, sheen: 0.75, sheenColor: new THREE.Color('#fff8ea'), sheenRoughness: 0.55, vertexColors: true })
    addRim(mat, rimU, { sss: skin ? 0.1 : 0 })
    this.mat = mat
    const S = scale, side = left ? -1 : 1
    this.side = side

    // Bones: the palm, four three-jointed fingers, a two-jointed thumb.
    const palmB = new THREE.Bone(); this.add(palmB)
    const bones = [palmB]
    this.joints = []
    const fingers = [[-0.46, 0.97, 0.142], [-0.15, 1.1, 0.142], [0.16, 1.05, 0.138], [0.45, 0.86, 0.122]]
    const fData = []
    fingers.forEach(([x, len, r0], fi) => {
      const root = new THREE.Bone()
      root.position.set(x * side, 0.0, 0.66)
      root.rotation.y = -x * 0.12 * side
      palmB.add(root)
      const segs = [len * 0.46, len * 0.31, len * 0.27]
      const chain = []
      let parent = root
      segs.forEach((L, si) => {
        const j = new THREE.Bone()
        if (si > 0) j.position.z = segs[si - 1]
        parent.add(j); chain.push(j); bones.push(j); parent = j
      })
      bones.push(root)
      this.joints.push({ chain, fi })
      // finger thickness: a glove is plump but each finger stands apart; bare fingers are slimmer
      const rr = [0.124, 0.13, 0.124, 0.11][fi] * (skin ? 0.86 : 1)
      fData.push({ root, chain, segs, len, r0: rr, fi })
    })
    const tb = new THREE.Bone()
    tb.position.set(-0.6 * side, -0.04, -0.2)
    tb.rotation.set(0, -0.9 * side, 0.5 * side)
    palmB.add(tb)
    const t1 = new THREE.Bone(); tb.add(t1)
    const t2 = new THREE.Bone(); t2.position.z = 0.5; t1.add(t2)
    bones.push(tb, t1, t2)
    this.thumb = [tb, t1, t2]
    this.updateMatrixWorld(true)
    const bi = (b) => bones.indexOf(b)

    const G = new SkinGeo()
    const P = bi(palmB)
    const tint = (o, stain = 0) => [o * (1 - stain * 0.1), o * (1 - stain * 0.2), o * (1 - stain * 0.36)] // AO and a faint sap/dust stain
    // The palm: one tube along z, a rounded-rectangle section, domed on the back, cushioned on the palm side.
    const prof = skin
      ? [[-1.45, 0.47, 0.36, 2], [-1.1, 0.5, 0.36, 2.1], [-0.8, 0.53, 0.33, 2.2], [-0.6, 0.53, 0.3, 2.3], [-0.4, 0.57, 0.26, 2.6], [-0.15, 0.6, 0.24, 2.9], [0.1, 0.61, 0.23, 3.1], [0.35, 0.61, 0.215, 3.2], [0.55, 0.6, 0.2, 3.1], [0.7, 0.55, 0.17, 2.9], [0.8, 0.44, 0.13, 2.7], [0.86, 0.26, 0.07, 2.4]]
      : [[-0.78, 0.55, 0.37, 2.2], [-0.62, 0.55, 0.32, 2.3], [-0.42, 0.6, 0.285, 2.6], [-0.17, 0.635, 0.265, 2.9], [0.08, 0.65, 0.255, 3.1], [0.33, 0.655, 0.24, 3.2], [0.53, 0.64, 0.22, 3.1], [0.68, 0.6, 0.19, 2.9], [0.79, 0.5, 0.15, 2.7], [0.86, 0.3, 0.085, 2.4]]
    const rings = prof.map(([z, w, h, n]) => ({ c: new THREE.Vector3(0, z < -0.6 ? -0.03 : 0, z), x: new THREE.Vector3(w, 0, 0), y: new THREE.Vector3(0, h, 0), n }))
    const knX = fingers.map(([fx]) => fx * side)
    G.tube(rings, {
      seg: N(36), capStart: !skin, capEnd: true, uScale: 3.4 / TILE, v1: 1.7 / TILE,
      disp: (p, a, R) => {
        const z = R.c.z, w = R.x.x, u = p.x / w
        if (p.y < 0) p.y -= 0.045 * Math.cos(Math.min(1, Math.abs(u)) * Math.PI / 2) * sm(-0.7, -0.3, z) * (1 - sm(0.55, 0.85, z)) // the domed back
        if (p.y > 0) {
          // thenar pad (thumb side), the heel of the hand (pinky side), a shallow hollow in the middle, pads under the knuckles
          const th = gauss(p.x + side * 0.4, 0.07) * gauss(z + 0.25, 0.14), hy = gauss(p.x - side * 0.36, 0.06) * gauss(z + 0.4, 0.06)
          const hol = gauss(p.x + side * 0.05, 0.08) * gauss(z - 0.1, 0.06)
          let pads = 0; for (const fx of knX) pads += gauss(p.x - fx, 0.016) * gauss(z - 0.55, 0.012)
          p.y += th * 0.12 + hy * 0.06 - hol * 0.04 + pads * 0.03
        }
        // knuckles on the back
        if (p.y < 0 && z > 0.35) for (const fx of knX) p.y -= gauss(p.x - fx, 0.011) * gauss(z - 0.6, 0.014) * 0.05
        if (skin && p.y < 0) for (const fx of knX) p.y -= gauss(p.x - fx * 0.85, 0.004) * sm(-0.6, 0.0, z) * (1 - sm(0.3, 0.55, z)) * 0.012 // tendons
      },
      wfn: () => [[P, 1]],
      cfn: (p, a, R) => {
        const z = R.c.z
        let o = 1
        if (p.y > 0) {
          // palm creases (fabric folds on a glove): the long diagonal one and the one under the fingers
          const life = Math.abs((p.x + side * 0.15) - (z - 0.05) * 0.55 * side)
          if (Math.abs(z - 0.42 + p.x * side * 0.1) < 0.03) o *= skin ? 0.9 : 0.86
          if (life < 0.025 && z > -0.45 && z < 0.3) o *= skin ? 0.92 : 0.88
          o *= 1 - 0.08 * gauss(p.x + side * 0.05, 0.08) * gauss(z - 0.1, 0.06) // the hollow
        }
        if (p.y < 0 && z > 0.5) for (const fx of knX) { const gx = Math.abs(p.x - fx) - 0.16; if (gx > -0.03 && gx < 0.03) o *= 0.9 }
        if (!skin && z < -0.66) o *= 0.94
        o *= 1 - 0.15 * sm(0.6, 0.86, z) * (1 - Math.abs(p.x) / 0.7) * (p.y > 0 ? 1 : 0.4) // where the fingers join
        return tint(o, skin ? 0 : 0.25 * gauss(p.y - 0.25, 0.02) * sm(0, 0.6, z))
      },
    })
    if (!skin) {
      // the three "points" on the back of the glove: lines of stitching from between the knuckles towards the wrist
      for (const k of [-0.3, 0.0, 0.3]) {
        const pts = []
        for (let i = 0; i <= 6; i++) { const z = 0.5 - i * 0.13; pts.push(new THREE.Vector3((k + i * 0.012 * Math.sign(k)) * side, 0, z)) }
        pts.forEach((q) => { const zz = q.z; const r = prof.reduce((acc, e) => (Math.abs(e[0] - zz) < Math.abs(acc[0] - zz) ? e : acc)); q.y = -r[2] - 0.058 + Math.abs(q.x) * 0.03 })
        stitch(G, pts, { r: 0.012, pitch: 0.055, seg: 3, wfn: () => [[P, 1]], col: tint(0.72) })
      }
    }
    // Fingers: each a tube along its root's z, knuckle bulges and creases, a rounded tip, side seams on a glove.
    const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), O = new THREE.Vector3()
    for (const f of fData) {
      m.copy(f.root.matrixWorld); m.premultiply(new THREE.Matrix4().copy(this.matrixWorld).invert())
      m.extractBasis(X, Y, Z); O.setFromMatrixPosition(m)
      const b1 = f.segs[0], b2 = f.segs[0] + f.segs[1], L = f.len, r0 = f.r0
      const rs = []
      const ss = []
      for (let s = -0.34; s < L - r0; s += 0.045 / lod) ss.push(s)
      for (let k = 0; k <= 7; k++) ss.push(L - r0 + (r0 * 0.985) * Math.sin((k / 7) * Math.PI / 2))
      for (const s of ss) {
        let r = r0 * (1 - 0.14 * Math.max(0, s) / L)
        r *= 1 - 0.035 * gauss(s - (b1 + b2) / 2, 0.01) - 0.03 * gauss(s - b1 * 0.5, 0.012)
        if (s > L - r0) { const q = (s - (L - r0)) / r0; r *= Math.sqrt(Math.max(0.0004, 1 - q * q)) }
        if (s < 0) r *= 1 + Math.min(1, -s / 0.3) * 0.22
        const c = O.clone().addScaledVector(Z, s)
        rs.push({ c, x: X.clone().multiplyScalar(r * 1.06), y: Y.clone().multiplyScalar(r * 0.9), s, r, n: 2.15 })
      }
      const [c0, c1, c2] = f.chain.map(bi)
      G.tube(rs, {
        seg: N(18), capEnd: true, uScale: (2 * Math.PI * r0) / TILE, v1: (L + 0.34) / TILE,
        disp: (p, a, R) => {
          const s = R.s, sn = Math.sin(a), cs = Math.cos(a), d = new THREE.Vector3().subVectors(p, R.c)
          let k = 0
          k += 0.09 * Math.max(0, -sn) * (gauss(s - b1, 0.004) + 0.8 * gauss(s - b2, 0.003)) // knuckles on the back
          k -= 0.1 * Math.max(0, sn) * (gauss(s - b1, 0.0012) + gauss(s - b2, 0.001)) // creases on the palm side
          k += 0.05 * Math.max(0, sn) * (gauss(s - (b1 * 0.55), 0.01) + gauss(s - (b1 + b2) / 2, 0.006) + gauss(s - (b2 + L) / 2 - 0.02, 0.006)) // pads
          if (!skin) k += 0.06 * gauss(Math.abs(cs) - 1, 0.004) * sm(-0.1, 0.05, s) // the side seams (fourchettes)
          if (skin && sn < -0.3 && s > L - 0.32 && s < L - 0.02) k += 0.03 // the nail
          p.addScaledVector(d, k)
        },
        wfn: (p, a, R) => {
          const s = R.s
          if (s < 0.06) return blendW(P, c0, s, -0.12, 0.06)
          if (s < b1 + 0.08) return blendW(c0, c1, s, b1 - 0.07, b1 + 0.07)
          return blendW(c1, c2, s, b2 - 0.06, b2 + 0.06)
        },
        cfn: (p, a, R) => {
          const s = R.s, sn = Math.sin(a), cs = Math.cos(a)
          let o = 1
          if (s < 0.1) o *= 0.7 + 0.3 * Math.min(1, (s + 0.34) / 0.44) // the webbing between the fingers
          o *= 1 - 0.2 * Math.max(0, Math.abs(cs) - 0.55) * 2.2 * (1 - sm(0.1, 0.7, s)) // fingers shade each other near the base
          if (sn > 0.25 && (Math.abs(s - b1) < 0.03 || Math.abs(s - b2) < 0.026)) o *= 0.74 // palm-side creases
          if (sn < -0.4 && (Math.abs(Math.abs(s - b1) - 0.05) < 0.014 || Math.abs(Math.abs(s - b2) - 0.04) < 0.012)) o *= 0.86 // wrinkles over the knuckles
          if (!skin && Math.abs(cs) > 0.965 && s > -0.05) o *= 0.8 // seams
          if (skin && sn < -0.3 && s > L - 0.32 && s < L - 0.02) return [o * 1.12, o * 1.0, o * 0.95] // nail
          return tint(o, skin ? 0 : 0.5 * sm(L - 0.4, L, s) * (0.5 + 0.5 * Math.max(0, sn)))
        },
      })
    }
    // Thumb.
    {
      m.copy(tb.matrixWorld); m.premultiply(new THREE.Matrix4().copy(this.matrixWorld).invert())
      m.extractBasis(X, Y, Z); O.setFromMatrixPosition(m)
      const rs = [], L = 0.9, r0 = skin ? 0.135 : 0.155
      const ss = []
      for (let s = -0.42; s < L - r0; s += 0.045 / lod) ss.push(s)
      for (let k = 0; k <= 7; k++) ss.push(L - r0 + r0 * 0.985 * Math.sin((k / 7) * Math.PI / 2))
      for (const s of ss) {
        let r = r0 * (1 + 0.32 * Math.max(0, -s) / 0.42) * (1 - 0.1 * Math.max(0, s) / L)
        if (s > L - r0) { const q = (s - (L - r0)) / r0; r *= Math.sqrt(Math.max(0.0004, 1 - q * q)) }
        rs.push({ c: O.clone().addScaledVector(Z, s), x: X.clone().multiplyScalar(r * 1.06), y: Y.clone().multiplyScalar(r * 0.9), s, n: 2.15 })
      }
      const [a1, a2] = [t1, t2].map(bi)
      G.tube(rs, {
        seg: N(18), capEnd: true, uScale: (2 * Math.PI * r0) / TILE, v1: (L + 0.42) / TILE,
        disp: (p, a, R) => {
          const s = R.s, sn = Math.sin(a), d = new THREE.Vector3().subVectors(p, R.c)
          let k = 0.08 * Math.max(0, -sn) * gauss(s - 0.5, 0.004) - 0.08 * Math.max(0, sn) * gauss(s - 0.5, 0.0012) + 0.05 * Math.max(0, sn) * gauss(s - 0.72, 0.008)
          if (skin && sn < -0.3 && s > L - 0.3 && s < L - 0.02) k += 0.03
          p.addScaledVector(d, k)
        },
        wfn: (p, a, R) => { const s = R.s; if (s < 0.1) return blendW(P, a1, s, -0.15, 0.1); return blendW(a1, a2, s, 0.44, 0.56) },
        cfn: (p, a, R) => {
          const s = R.s, sn = Math.sin(a)
          let o = (R.s < 0 ? 0.9 : 1) * (Math.abs(R.s - 0.5) < 0.025 && sn > 0 ? 0.76 : 1)
          if (!skin && Math.abs(s + 0.05) < 0.025) o *= 0.82 // the seam round the thumb's base
          if (skin && sn < -0.3 && s > L - 0.3 && s < L - 0.02) return [o * 1.12, o, o * 0.95]
          return tint(o, skin ? 0 : 0.5 * sm(L - 0.4, L, s))
        },
      })
    }
    // The cuff: a knitted rib (glove) with an overlocked gold edge, or a bare wrist.
    if (!skin) {
      const CF = [[-0.6, 0.53, 0.34], [-0.66, 0.565, 0.37], [-0.74, 0.59, 0.4], [-0.9, 0.605, 0.42], [-1.06, 0.62, 0.435], [-1.2, 0.635, 0.45], [-1.28, 0.64, 0.455]]
      G.tube(CF.map(([z, w, h]) => ({ c: new THREE.Vector3(0, -0.03, z), x: new THREE.Vector3(w, 0, 0), y: new THREE.Vector3(0, -h, 0), z })), {
        seg: N(80), capEnd: true, capCol: tint(0.3), uScale: 3.4 / TILE, v1: 0.7 / TILE,
        shape: (a, R) => 1 + 0.035 * Math.pow(Math.abs(Math.cos(a * 18)), 1.5) * sm(-0.62, -0.7, R.z),
        wfn: () => [[P, 1]],
        cfn: (p, a, R) => { const o = (0.9 + 0.1 * Math.abs(Math.cos(a * 18))) * (R.z > -0.67 ? 0.85 : 1); return tint(o * 0.97) },
      })
      const edge = []
      for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; edge.push(new THREE.Vector3(Math.cos(a) * 0.645, -0.03 + Math.sin(a) * 0.46, -1.28)) }
      G.tube(edge.map((c, k) => { const a = (k / 48) * Math.PI * 2; return { c, x: new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.7, 0).multiplyScalar(0.03), y: new THREE.Vector3(0, 0, -0.03) } }), { seg: 5, wfn: () => [[P, 1]], cfn: () => [1.05, 0.72, 0.18] })
    }
    const geo = G.build()
    const glove3 = new THREE.SkinnedMesh(geo, mat)
    glove3.castShadow = true; glove3.receiveShadow = true; glove3.frustumCulled = false
    this.add(glove3)
    glove3.bind(new THREE.Skeleton(bones), glove3.matrixWorld)
    this.glove = glove3

    if (arm) {
      const base = new THREE.Color(sleeve)
      const sl = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.84, map: twillTex(), bumpMap: twillTex(true), bumpScale: 2.2, sheen: 0.8, sheenRoughness: 0.5, sheenColor: base.clone().lerp(new THREE.Color('#d8f0dc'), 0.55), vertexColors: true })
      addRim(sl, rimU)
      this.sleeve = new THREE.Mesh(this._sleeveGeo(), sl)
      this.add(this.sleeve)
      // The VMR Mangoes uniform: a mango-gold band at the sleeve's end.
      const tg = new SkinGeo()
      // a closed band (outer face, its rounded edges, an inner face) so it reads solid from any side
      const TR = [[-0.93, 0.0], [-0.945, 0.018], [-1.085, 0.018], [-1.1, 0.0], [-1.1, -0.035], [-0.93, -0.035], [-0.93, 0.0]]
      tg.tube(TR.map(([z, o]) => ({ c: new THREE.Vector3(0, -0.08, z), x: new THREE.Vector3(0.775 + o, 0, 0), y: new THREE.Vector3(0, -0.6 - o, 0) })), { seg: 64, uScale: 8, wfn: () => [[0, 1]], cfn: (p, a, R, k) => (k >= 4 ? [0.7, 0.7, 0.7] : [1, 1, 1]) })
      const trimM = new THREE.MeshPhysicalMaterial({ color: '#ffb81f', roughness: 0.55, map: twillTex(), bumpMap: twillTex(true), bumpScale: 1.2, sheen: 0.6, sheenColor: new THREE.Color('#fff0b0'), sheenRoughness: 0.4 })
      addRim(trimM, rimU)
      const trim = new THREE.Mesh(tg.build(), trimM)
      this.add(trim)
      this.trim = trim
    }
    this.scale.setScalar(S)
    this.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    this.pose(0.2, 0, 0.2)
  }

  /** The jacket sleeve for the close-ups: a stitched cuff band, cloth bunched above it, a forearm that widens towards
   *  the elbow, soft diagonal folds, a turned-in lining at the opening. */
  _sleeveGeo() {
    const G = new SkinGeo()
    const T = 1.1 // twill tile size
    const rad = (z) => {
      // half-width / half-height of the sleeve at z (z < 0 runs up the arm)
      const d = -z
      if (d < 1.0) return [0.775, 0.6]
      if (d < 1.55) return [0.775 - 0.012 * sm(1.42, 1.55, d), 0.6 - 0.01 * sm(1.42, 1.55, d)]
      const k = sm(1.55, 2.0, d), f = sm(2.0, 7.4, d)
      return [0.8 + 0.06 * k + 0.1 * f, 0.62 + 0.05 * k + 0.08 * f]
    }
    const zs = [-1.6, -1.25, -0.97, -0.925]
    for (let z = -0.93; z > -7.6; z -= z > -3 ? 0.07 : 0.16) zs.push(z)
    zs.push(-7.6)
    const rings = zs.map((z, k) => {
      const inner = k < 3
      const [rx, ry] = rad(z)
      const s = inner ? [0.9, 0.92, 0.955][k] : 1
      return { c: new THREE.Vector3(0, -0.08, z), x: new THREE.Vector3(rx * s, 0, 0), y: new THREE.Vector3(0, -ry * s, 0), z, inner, k } // (y flipped: the tube runs along -z)
    })
    G.tube(rings, {
      seg: 56, capEnd: true, uScale: (2 * Math.PI * 0.85) / T, v1: 7 / T, wfn: () => [[0, 1]],
      disp: (p, a, R) => {
        if (R.inner) return
        const d = -R.z, x = p.x, y = p.y + 0.08
        let k = 0
        // cloth bunched just above the cuff: rings of soft wrinkles that wander round the arm
        k += 0.06 * Math.sin(d * 11 + 1.6 * Math.sin(a * 2 + 0.5) + 0.8 * Math.sin(a * 5)) * gauss(d - 2.0, 0.18) * sm(1.6, 1.75, d)
        // long diagonal folds up the forearm, and a crease along the inside
        for (const [a0, tw, amp] of [[0.6, 0.25, 0.075], [2.5, -0.3, 0.065], [4.1, 0.2, 0.075], [5.4, -0.18, 0.05]]) {
          let da = a - a0 - (d - 2) * tw; da = Math.atan2(Math.sin(da), Math.cos(da))
          k += amp * gauss(da, 0.05) * sm(2.2, 3.0, d) * (1 - sm(5.5, 7.4, d))
        }
        if (d > 1.0 && d < 1.55) k += 0.01 // the cuff band stands a touch proud
        const r = Math.hypot(x, y) || 1
        p.x += (x / r) * k; p.y += (y / r) * k
      },
      cfn: (p, a, R) => {
        if (R.inner) return [0.22, 0.22, 0.22]
        const d = -R.z
        let o = 1
        if (d < 0.95) o = 0.75 // the turned edge
        if (Math.abs(d - 1.53) < 0.035) o *= 0.62 // the seam between cuff and sleeve
        o *= 1 - 0.2 * gauss(d - 1.62, 0.01) // the shadow under the bunching
        const n = Math.sin(d * 11 + 1.6 * Math.sin(a * 2 + 0.5) + 0.8 * Math.sin(a * 5)) * gauss(d - 2.0, 0.18) * sm(1.6, 1.75, d)
        o *= 1 + 0.12 * n
        for (const [a0, tw] of [[0.6, 0.25], [2.5, -0.3], [4.1, 0.2], [5.4, -0.18]]) {
          let da = a - a0 - (d - 2) * tw; da = Math.atan2(Math.sin(da), Math.cos(da))
          o *= 1 + 0.12 * gauss(da, 0.05) * sm(2.2, 3.0, d) - 0.1 * gauss(da - 0.32, 0.03) * sm(2.2, 3.0, d)
        }
        return [o, o, o]
      },
    })
    // tone-on-tone top-stitching: two rows round the cuff band
    const ring = (z, off) => { const [rx, ry] = rad(z); const pts = []; for (let k = 0; k <= 72; k++) { const a = (k / 72) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * (rx + off), -0.08 + Math.sin(a) * (ry + off), z)) } return pts }
    for (const z of [-1.17, -1.46]) stitch(G, ring(z, 0.008), { r: 0.011, pitch: 0.07, seg: 3, wfn: () => [[0, 1]], col: [1.45, 1.5, 1.35] })
    const g = G.build()
    g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight')
    return g
  }

  /** curl: 0 flat … 1 cupped round a mango. spread: fingers fan. thumb: 0 out … 1 in. */
  pose(curl, spread = 0, thumb = 0.5) {
    this.joints.forEach(({ chain, fi }) => {
      const k = [0.55, 0.75, 0.6]
      const f = 1.0 + (fi - 1.5) * 0.03 // the little finger curls a touch more than the index: a natural cascade
      const relax = [0.05, 0.07, 0.04]
      chain.forEach((j, si) => { j.rotation.x = -(curl * k[si] * f + relax[si] * (1 + fi * 0.15)) })
      chain[0].rotation.y = (fi - 1.5) * (spread * 0.18 + 0.02) * this.side
    })
    this.thumb[1].rotation.x = -thumb * 0.5
    this.thumb[1].rotation.y = thumb * 0.5 * this.side
    this.thumb[2].rotation.x = -thumb * 0.7 - 0.05
  }
}
