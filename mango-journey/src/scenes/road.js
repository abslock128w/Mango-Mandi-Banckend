// Chapter 7 "It reaches us the next day." One long tracking shot. A small VMR Mangoes goods truck carrying crates of
// mangoes leaves the orchard at dusk, drives through a moonlit night and arrives at the warehouse at sunrise. The land
// is smooth rolling farmland: patchwork fields with crop rows, orchards of round-crowned mango trees, a village with
// lit windows, power lines, milestones, a culvert over a stream and a pond that catches the sky, all under one shared
// atmosphere (distance haze, sun glow, valley mist at dawn). A gold route line draws itself behind the truck. The shot
// ends close on the truck's headlight: the circle the grading chapter opens from.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Stage, aim, skyDome } from './stage.js'
import { rng, smooth, smoother, lerp, clamp, canvasTex } from '../lib/util.js'
import { NOISE, BUMP } from '../lib/glsl.js'
import { woodTexture, drawWordmark, mangoCrowd, strawMesh } from './crate-kit.js'
import { paintSky } from './tree.js'

// ---- Seeded value noise for the terrain ------------------------------------------------------------------------------
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v)
}
const fbm = (x, y) => { let a = 0.5, s = 0; for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17; y = y * 2.03 + 9; a *= 0.5 } return s }
const hillH = (x, z) => (fbm(x * 0.012, z * 0.012) - 0.45) * 26 + (fbm(x * 0.05 + 40, z * 0.05) - 0.5) * 3

// ---- Geometry helpers -------------------------------------------------------------------------------------------------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler()
function xf(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]))
  return geo.applyMatrix4(_m4.compose(V(p[0], p[1], p[2]), _q, V(s[0], s[1], s[2])))
}
const rbox = (w, h, d, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
/** A cylinder from a to b. */
function rod(a, b, r, seg = 6, r2 = r) {
  const d = b.clone().sub(a), L = d.length()
  const g = new THREE.CylinderGeometry(r2, r, L, seg, 1)
  g.translate(0, L / 2, 0)
  g.applyQuaternion(_q.setFromUnitVectors(V(0, 1, 0), d.normalize()))
  return g.translate(a.x, a.y, a.z)
}
/** Make a geometry mergeable with any other: non-indexed, position/normal/uv only. */
function norm(g) {
  const o = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'uv'].includes(k)) o.deleteAttribute(k)
  if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2))
  o.clearGroups()
  return o
}
/** Collects geometry by material and merges it into one mesh per material. */
class Kit {
  constructor() { this.m = new Map() }
  add(mat, geo) { if (!this.m.has(mat)) this.m.set(mat, []); this.m.get(mat).push(norm(geo)); return geo }
  build(parent, cast = true, receive = true) {
    const out = []
    for (const [mat, gs] of this.m) {
      const mesh = new THREE.Mesh(mergeGeometries(gs), mat)
      mesh.castShadow = cast && !mat.transparent; mesh.receiveShadow = receive
      parent.add(mesh); out.push(mesh)
    }
    return out
  }
}

// ---- One atmosphere for every material in the set: distance haze, warm glow toward the sun, valley mist ---------------
const ATM_PARS = /* glsl */ `
uniform vec3 uFogCol, uSunFogCol, uSunW; uniform float uFogDen, uFogStart, uMist, uMistH, uATime;
varying vec3 vAtmW;
vec3 mmAtm(vec3 col, vec3 wp){
  vec3 dv = wp - cameraPosition; float dist = length(dv); vec3 dir = dv / max(dist, 1e-3);
  float f = 1. - exp(-max(dist - uFogStart, 0.) * uFogDen);
  f *= mix(.75, 1.2, exp(-max(wp.y + 4., 0.) * .05));
  float sunA = pow(max(dot(dir, uSunW), 0.), 6.);
  vec3 fc = mix(uFogCol, uSunFogCol, sunA);
  float mist = uMist * (1. - smoothstep(uMistH - 4., uMistH + 3., wp.y)) * smoothstep(28., 110., dist)
    * (.5 + .5 * mmNoise2(wp.xz * .035 + vec2(uATime * .03, uATime * .01)));
  f = clamp(max(f, mist * .85), 0., 1.);
  return mix(col, fc, f);
}
`
function enhance(mat, key, atmU, o = {}) {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, atmU, o.uniforms || {})
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmW;\n' + (o.vPars || ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 aw = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          aw = instanceMatrix * aw;
        #endif
          vAtmW = (modelMatrix * aw).xyz; }
        ${o.vMain || ''}`)
    if (o.vProject) s.vertexShader = s.vertexShader.replace('#include <project_vertex>', o.vProject)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE + BUMP + ATM_PARS + (o.fPars || ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (o.fColor || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (o.fNormal || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (o.fEmissive || ''))
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = mmAtm(gl_FragColor.rgb, vAtmW);')
  }
  mat.customProgramCacheKey = () => 'road7-' + key
  return mat
}

// The land's colour: wild grass on slopes and crests, a patchwork of fields with crop rows and bunds on the flats, a
// dusty verge along the road. Also returns a height for the bump (rows, bunds, clods), so low sun rakes across them.
const LAND = /* glsl */ `
varying float vRoad; varying float vNy; float gH; float gField; float gRow;
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 landColor(vec3 w, float dRoad, float ny){
  vec2 p = w.xz; gField = 0.; gRow = 0.;
  float n1 = mmNoise2(p * .045), n2 = mmNoise2(p * .33 + 7.), n3 = mmNoise2(p * 1.9 + 3.), n4 = mmNoise2(p * 5.3 + 1.);
  vec3 c = mix(lin(vec3(.30,.44,.17)), lin(vec3(.46,.56,.22)), n1);
  float dryK = smoothstep(.5, .85, mmNoise2(p * .018 + 30.)) * .55 + (1. - smoothstep(.88, .975, ny)) * .55;
  c = mix(c, lin(vec3(.60,.53,.30)), clamp(dryK, 0., .8));
  c *= .8 + .32 * n2 + .18 * (n3 - .5) + .1 * (n4 - .5);
  gH = n2 * .08 + n3 * .03 + n4 * .012;
  // Fields on gentle ground away from the road.
  float fieldK = smoothstep(9., 14., dRoad) * smoothstep(.94, .975, ny) * smoothstep(.16, .3, mmNoise2(p * .009 + 11.));
  float ang = .32; mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec2 q = R * p; vec2 cs = vec2(30., 21.);
  vec2 cell = floor(q / cs), f = fract(q / cs);
  float split = .32 + .36 * mmHash2(cell + 3.1);
  float side = step(split, f.x);
  float id = mmHash2(cell + side * 7.7 + 1.3);
  float lx = side > .5 ? (f.x - split) / (1. - split) : f.x / split;
  float wx = (side > .5 ? 1. - split : split) * cs.x;
  float edge = min(min(lx, 1. - lx) * wx, min(f.y, 1. - f.y) * cs.y);
  float bund = 1. - smoothstep(.3, .85, edge);
  float dirR = step(.5, mmHash2(cell + side + 9.));
  float rc = (dirR > .5 ? q.x : q.y) / .8;
  float rowF = 1. - smoothstep(.18, .5, fwidth(rc));
  float row = mix(.5, .5 + .5 * sin(rc * 6.2831), rowF);
  vec3 fc;
  if (id < .26) fc = mix(lin(vec3(.22,.33,.09)), lin(vec3(.50,.68,.22)), row);
  else if (id < .46) fc = mix(lin(vec3(.52,.40,.17)), lin(vec3(.86,.70,.36)), row);
  else if (id < .58) fc = mix(lin(vec3(.38,.48,.13)), lin(vec3(.95,.80,.20)), row * row);
  else if (id < .74) fc = mix(lin(vec3(.27,.17,.09)), lin(vec3(.50,.36,.22)), row);
  else fc = mix(lin(vec3(.36,.47,.19)), lin(vec3(.52,.60,.26)), n2);
  fc *= .86 + .26 * n2 + .1 * (n4 - .5);
  fc = mix(fc, lin(vec3(.36,.45,.2)) * (.8 + .35 * n3), bund);
  c = mix(c, fc, fieldK);
  gField = fieldK * step(id, .74); gRow = row;
  gH += fieldK * ((id < .74 ? row * .11 : 0.) + bund * .14);
  // A dusty verge beside the road.
  c = mix(lin(vec3(.56,.47,.34)) * (.82 + .3 * n3 + .1 * n4), c, smoothstep(4.4, 7.5, dRoad + (n2 - .5) * 3.));
  return c;
}
`

// ---- Textures -----------------------------------------------------------------------------------------------------------
function brandTex(w, h, draw, opts) {
  const tex = canvasTex(w, h, draw, opts)
  if (document.fonts) document.fonts.load('800 40px Figtree').then(() => { const g = tex.image.getContext('2d'); g.clearRect(0, 0, w, h); draw(g, w, h); tex.needsUpdate = true }).catch(() => {})
  return tex
}
function roadTextures() {
  // Along the road = canvas x (1024 px = 12 m), across = canvas y (256 px = the road's 5.8 m).
  const W = 1024, H = 256, r = rng(31)
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = '#45423e'; g.fillRect(0, 0, W, H)
    // Tyre-polished bands in each lane, a darker oily strip between.
    for (const [y, a] of [[0.2, 0.1], [0.38, 0.08], [0.62, 0.08], [0.8, 0.1]]) { const grd = g.createLinearGradient(0, (y - 0.06) * H, 0, (y + 0.06) * H); grd.addColorStop(0, 'rgba(20,18,16,0)'); grd.addColorStop(0.5, `rgba(20,18,16,${a})`); grd.addColorStop(1, 'rgba(20,18,16,0)'); g.fillStyle = grd; g.fillRect(0, (y - 0.06) * H, W, 0.12 * H) }
    // Patches of newer and older tar.
    for (let i = 0; i < 7; i++) { g.fillStyle = r() < 0.5 ? 'rgba(30,28,26,.35)' : 'rgba(120,112,100,.16)'; const x = r() * W, y = r() * H, w = 40 + r() * 160, h = 20 + r() * 60; g.fillRect(x, y, w, h) }
    // Aggregate.
    for (let i = 0; i < 26000; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${r() * 0.28})` : `rgba(220,210,190,${r() * 0.22})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.6, 1 + r() * 1.6) }
    // Cracks.
    g.strokeStyle = 'rgba(15,14,12,.55)'; g.lineWidth = 1
    for (let i = 0; i < 14; i++) { let x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.3) * 22; y += (r() - 0.5) * 14; g.lineTo(x, y) } g.stroke() }
    // Edge lines (solid, worn) and a dashed centre line.
    const paint = (x, y, w, h) => { g.fillStyle = '#e9e3d2'; g.fillRect(x, y, w, h); for (let i = 0; i < w * h / 30; i++) { g.fillStyle = 'rgba(60,58,54,.6)'; g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5) } }
    paint(0, 0.045 * H, W, 6); paint(0, H - 0.045 * H - 6, W, 6)
    paint(80, H / 2 - 3, 260, 6); paint(592, H / 2 - 3, 260, 6)
    // Ragged tar edge.
    g.fillStyle = 'rgba(80,70,56,.8)'
    for (let x = 0; x < W; x += 4) { g.fillRect(x, 0, 4, 1 + r() * 5); g.fillRect(x, H - 1 - r() * 5, 4, 6) }
  }, { repeat: true, aniso: 8 })
  const rough = canvasTex(W, H, (g) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, W, H)
    for (const y of [0.2, 0.38, 0.62, 0.8]) { g.fillStyle = 'rgba(150,150,150,.4)'; g.fillRect(0, (y - 0.04) * H, W, 0.08 * H) }
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},.12)`; g.fillRect(r() * W, r() * H, 2, 2) }
  }, { repeat: true, srgb: false })
  const gravel = canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    g.fillStyle = '#8a7c66'; g.fillRect(0, 10, w, h - 20)
    for (let i = 0; i < 5200; i++) { const t = r(); g.fillStyle = t < 0.33 ? '#6e624f' : t < 0.66 ? '#a69780' : '#5a5246'; g.beginPath(); g.ellipse(r() * w, 6 + r() * (h - 12), 0.8 + r() * 2.2, 0.8 + r() * 1.6, r() * 3, 0, 7); g.fill() }
    // Ragged outer edges (alpha-tested).
    g.globalCompositeOperation = 'destination-out'
    let a1 = 10, a2 = 10
    for (let x = 0; x < w; x += 2) { a1 = clamp(a1 + (r() - 0.5) * 3, 5, 18); a2 = clamp(a2 + (r() - 0.5) * 3, 5, 18); g.fillRect(x, 0, 2, a1); g.fillRect(x, h - a2, 2, a2) }
    g.globalCompositeOperation = 'source-over'
  }, { repeat: true, aniso: 8 })
  return { map, rough, gravel }
}
function radialTex(inner = 'rgba(0,0,0,1)', outer = 'rgba(0,0,0,0)') {
  return canvasTex(128, 128, (g, w, h) => { const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); grd.addColorStop(0, inner); grd.addColorStop(1, outer); g.fillStyle = grd; g.fillRect(0, 0, w, h) })
}

// ---- Mango tree: a broad, dense, low dome of a crown on a short trunk that forks ---------------------------------------
// The crown is built from separate clumps (a tall one in the middle, others round it with sky between them), each
// shaded as its own rounded mass, so the sun side of every clump lights up and the far side falls into cool shadow.
const CLUMPS = [[0, 0.42, 0.05, 0.56], [0.72, 0.08, 0.18, 0.48], [-0.5, 0.12, 0.58, 0.46], [-0.42, 0.02, -0.62, 0.47], [0.38, 0.22, -0.55, 0.42]]
function crownGeometry(detail, seed, n = 5) {
  const r = rng(seed), parts = []
  for (let k = 0; k < n; k++) {
    const [cx, cy, cz, cr] = CLUMPS[k]
    const g = new THREE.IcosahedronGeometry(1, detail)
    const p = g.attributes.position, v = V(), ao = []
    const lumps = []
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, y = -0.2 + r() * 1.1; lumps.push(V(Math.cos(a) * Math.sqrt(Math.max(0, 1 - y * y)), y, Math.sin(a) * Math.sqrt(Math.max(0, 1 - y * y)))) }
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize()
      let d = 0.92 + (vnoise(v.x * 2.6 + k * 3, v.z * 2.6 + v.y * 1.9) - 0.5) * 0.3
      for (const l of lumps) d += Math.pow(Math.max(0, v.dot(l) - 0.7) / 0.3, 1.5) * 0.22
      let y = v.y * d * 0.72
      if (y < -0.3) y = -0.3 + (y + 0.3) * 0.3 // flat-bottomed, like a real mango clump
      p.setXYZ(i, cx + v.x * d * cr * 1.25, cy + y * cr * 1.25, cz + v.z * d * cr * 1.25)
      // darker towards the underside and the crown's core
      const wy = cy + y * cr * 1.25, out = Math.hypot(cx + v.x * cr, cz + v.z * cr)
      ao.push(clamp(0.38 + 0.5 * smooth(-0.4, 0.75, wy) + 0.25 * smooth(0.3, 1.1, out) + (d - 1) * 0.6, 0.28, 1.15))
    }
    g.computeVertexNormals()
    const c = new Float32Array(p.count * 3)
    ao.forEach((q, i) => { c[i * 3] = q; c[i * 3 + 1] = q; c[i * 3 + 2] = q })
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    parts.push(g)
  }
  return mergeGeometries(parts)
}
function trunkGeometry() {
  // a short trunk that forks into limbs, one to the heart of each clump (visible in the gaps and under the crown)
  const gs = [rod(V(0, -0.05, 0), V(0.05, 0.85, 0), 0.17, 7, 0.13)]
  const lift = 1.32 // the crown sits at 1.32 × size; the trunk is scaled (0.75, 0.68, 0.75)
  for (const [cx, cy, cz] of CLUMPS) {
    const end = V(cx * 0.8 / 0.75, (lift + cy - 0.18) / 0.68, cz * 0.8 / 0.75), m = V(end.x * 0.45, 1.25, end.z * 0.45)
    for (const [a, b, r0, r1] of [[V(0.04, 0.78, 0), m, 0.1, 0.07], [m, end, 0.07, 0.035]]) {
      const d = b.clone().sub(a), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L * 1.04, 4, 1, true)
      g.translate(0, L / 2, 0); g.applyQuaternion(_q.setFromUnitVectors(V(0, 1, 0), d.normalize())); gs.push(g.translate(a.x, a.y, a.z))
    }
  }
  return mergeGeometries(gs.map(norm))
}

// ---- The set --------------------------------------------------------------------------------------------------------------
const LANE = -1.3 // the truck keeps to its lane (left of the centre line)

export default class Road extends Stage {
  constructor(engine) {
    super(engine, { far: 1100 })
    const sc = this.scene, T = this.tier, hi = T.name === 'high', lo = T.name === 'low'
    this.fov = 34
    this.frame = [0.08, 0.1]
    this.framePortrait = [0, 0.15]
    this.parallax = 0.5
    const R = rng(77)

    // Shared atmosphere uniforms.
    this.atmU = {
      uFogCol: { value: new THREE.Color() }, uSunFogCol: { value: new THREE.Color() }, uSunW: { value: V(0, 0.1, -1) },
      uFogDen: { value: 0.0026 }, uFogStart: { value: 35 }, uMist: { value: 0 }, uMistH: { value: -1 }, uATime: { value: 0 },
    }
    this.sunViewU = { uSunView: { value: this.sunView }, uKeyCol: { value: new THREE.Color(1, 0.8, 0.6) } }
    const atm = (mat, key = 'atm') => enhance(mat, key, this.atmU)

    // ---- The road: a winding spline over the land, from the orchard (west) to the warehouse (east).
    const ctrl = [[-210, 70], [-150, 40], [-95, 52], [-40, 18], [10, 30], [60, -6], [115, 10], [170, -22], [212, -46], [236, -86], [244, -124]]
    const flat = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.5)
    const NS = 600, samples = flat.getSpacedPoints(NS)
    const raw = samples.map((p) => hillH(p.x, p.z))
    const rh = raw.map((_, i) => { let s = 0, n = 0; for (let k = -14; k <= 14; k++) { const j = clamp(i + k, 0, NS); s += raw[j]; n++ } return s / n })
    samples.forEach((p, i) => { p.y = rh[i] + 0.25 })
    this.curve = new THREE.CatmullRomCurve3(samples.filter((_, i) => i % 5 === 0 || i === NS), false, 'catmullrom', 0.5)
    const pts = this.curve.getSpacedPoints(NS)
    this.pts = pts
    this.roadLen = this.curve.getLength()
    const tng = pts.map((_, i) => this.curve.getTangentAt(i / NS))
    const sideAt = (i) => V(-tng[i].z, 0, tng[i].x).normalize()
    const nearest = (x, z) => { let best = 1e9, bi = 0; for (let i = 0; i <= NS; i += 2) { const dx = pts[i].x - x, dz = pts[i].z - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i } } return [Math.sqrt(best), bi] }
    const at = (u, lat = 0, out = V()) => { const i = Math.round(clamp(u) * NS); return out.copy(pts[i]).addScaledVector(sideAt(i), lat) }

    // A stream crosses under the road through a culvert, from a pond that catches the sky.
    const uCulvert = 0.5
    const cP = at(uCulvert), cS = sideAt(Math.round(uCulvert * NS)), cT = tng[Math.round(uCulvert * NS)]
    const pond = at(uCulvert, -46).addScaledVector(cT, 10)
    pond.y = hillH(pond.x, pond.z)
    this.waterY = Math.min(pond.y, cP.y - 0.25) - 1.6
    const streamPts = []
    for (let k = -18; k <= 9; k++) { const p = cP.clone().addScaledVector(cS, k * 6).addScaledVector(cT, Math.sin(k * 0.6) * 2.5 + (k < 0 ? k * -0.35 : 0)); streamPts.push(p) }
    const streamD = (x, z) => { let b = 1e9; for (const p of streamPts) { const dx = p.x - x, dz = p.z - z; b = Math.min(b, dx * dx + dz * dz) } return Math.sqrt(b) }
    const pond2 = at(0.17, -44); pond2.y = hillH(pond2.x, pond2.z)
    this.pond2 = pond2
    const pondD = (x, z) => Math.min(Math.hypot((x - pond.x) / 1.6, (z - pond.z)), Math.hypot((x - pond2.x) / 1.3, (z - pond2.z) / 0.9) * 1.25)
    const lift = (x, z, d) => smooth(70, 240, d) * (8 + 18 * fbm(x * 0.008 + 5, z * 0.008))
    const carve = (x, z, d) => {
      const pd = pondD(x, z), sd = streamD(x, z)
      const pc = (1 - smooth(10, 22, pd)) * 4.2, scv = (1 - smooth(1.5, 6, sd)) * 2.6 * smooth(4.5, 9, d)
      return Math.max(pc, scv)
    }
    const groundAt = (x, z, nd = nearest(x, z)) => {
      const [d, bi] = nd
      const k = smooth(7.2, 22, d)
      const hill = hillH(x, z) + lift(x, z, d)
      let h = lerp(pts[bi].y - 0.08, hill, k)
      const c = carve(x, z, d)
      if (c > 0) h = Math.min(h, Math.max(h - c, this.waterY - 1.2))
      return h
    }
    this.groundAt = groundAt
    this.nearest = nearest

    // ---- Terrain: smooth-shaded, coloured and bumped in the shader.
    const segX = hi ? 260 : T.name === 'mid' ? 170 : 130
    const geo = new THREE.PlaneGeometry(860, 600, segX, Math.round(segX * 0.7))
    geo.rotateX(-Math.PI / 2); geo.translate(10, 0, -40)
    const pos = geo.attributes.position, aRoad = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), nd = nearest(x, z)
      pos.setY(i, groundAt(x, z, nd)); aRoad[i] = nd[0]
    }
    // The land is a coarse grid and the road a fine ribbon: where the road dips between two grid points the straight
    // edge between them stood proud of the asphalt (a brown wedge across the lane). Walk the road and press the land
    // down wherever it rises to within a finger of the ribbon above it.
    {
      const nx = segX, nz = Math.round(segX * 0.7), dx = 860 / nx, dz = 600 / nz, x0 = 10 - 430, z0 = -40 - 300, row = nx + 1
      const press = (x, z, limit) => {
        const gx = (x - x0) / dx, gz = (z - z0) / dz, ix = Math.floor(gx), iz = Math.floor(gz)
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return 0
        const fx = gx - ix, fz = gz - iz, A = ix + row * iz, B = ix + row * (iz + 1), C = ix + 1 + row * (iz + 1), D = ix + 1 + row * iz
        const tri = fx + fz <= 1 ? [A, B, D] : [B, C, D]
        const h = fx + fz <= 1 ? pos.getY(A) + (pos.getY(D) - pos.getY(A)) * fx + (pos.getY(B) - pos.getY(A)) * fz : pos.getY(C) + (pos.getY(B) - pos.getY(C)) * (1 - fx) + (pos.getY(D) - pos.getY(C)) * (1 - fz)
        if (h <= limit) return 0
        for (const v of tri) pos.setY(v, pos.getY(v) - (h - limit))
        return 1
      }
      for (let pass = 0; pass < 4; pass++) {
        let n = 0
        for (let i = 0; i <= NS; i++) { const sd = sideAt(i), q = pts[i]; for (let lat = -4.4; lat <= 4.41; lat += 1.1) n += press(q.x + sd.x * lat, q.z + sd.z * lat, q.y - 0.075) }
        if (!n) break
      }
    }
    geo.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 1))
    geo.computeVertexNormals()
    const landMat = enhance(new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 }), 'land', this.atmU, {
      vPars: 'attribute float aRoad; varying float vRoad; varying float vNy;',
      vMain: 'vRoad = aRoad; vNy = normalize(objectNormal).y;',
      fPars: LAND,
      fColor: 'diffuseColor.rgb = landColor(vAtmW, vRoad, vNy);',
      fNormal: 'normal = mmBump(-vViewPosition, normal, gH, 1.);',
      fEmissive: `{ vec3 dv = normalize(vAtmW - cameraPosition); float toSun = pow(max(dot(dv, uSunW), 0.), 5.);
        float sh = .55 + .45 * sin(vAtmW.x * .9 + vAtmW.z * .7 + uATime * 1.7) * sin(vAtmW.z * 1.3 - uATime * 1.1);
        totalEmissiveRadiance += diffuseColor.rgb * uSunFogCol * toSun * (gField * (.35 + .65 * gRow) * sh * 1.6 + .15); }`,
    })
    this.land = new THREE.Mesh(geo, landMat)
    this.land.receiveShadow = true
    sc.add(this.land)

    // ---- Distant ridgelines in three layers, fading into the haze.
    this.ridgeU = []
    for (let L = 0; L < 3; L++) {
      const rx = 470 + L * 130, rz = 330 + L * 110, SEG = 220, v = [], uv = [], idx = []
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2, x = 10 + Math.cos(a) * rx, z = -40 + Math.sin(a) * rz
        const top = 8 + L * 13 + (fbm(Math.cos(a) * 3 + L * 7, Math.sin(a) * 3) - 0.35) * (24 + L * 26) + Math.pow(vnoise(a * 9 + L, 3), 2) * 7
        v.push(x, -30, z, x, top, z); uv.push(j / SEG, 0, j / SEG, 1)
        if (j < SEG) { const b = j * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3) }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx)
      const u = { uC: { value: new THREE.Color() }, uF: { value: new THREE.Color() }, uMistK: { value: 0 }, uRim: { value: 0 }, uSunW: this.atmU.uSunW, uSunFogCol: this.atmU.uSunFogCol }
      this.ridgeU.push(u)
      const m = new THREE.ShaderMaterial({
        uniforms: u, side: THREE.DoubleSide, fog: false,
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */ `uniform vec3 uC, uF, uSunW, uSunFogCol; uniform float uMistK, uRim; varying vec2 vUv; varying vec3 vW;
          void main(){
            vec3 dir = normalize(vW - cameraPosition);
            float sunA = pow(max(dot(dir, uSunW), 0.), 4.);
            vec3 col = uC * (.86 + .22 * vUv.y);
            col = mix(col, uSunFogCol, sunA * .35);
            float base = 1. - smoothstep(.0, .55 + uMistK * .3, vUv.y);
            col = mix(col, mix(uF, uSunFogCol, sunA), base * (.75 + uMistK * .25));
            col = mix(col, uSunFogCol * 1.1, smoothstep(.978, 1., vUv.y) * uRim * min(sunA * 2.5, .7));
            gl_FragColor = vec4(col, 1.);
          }`,
      })
      const mesh = new THREE.Mesh(g, m)
      mesh.renderOrder = -5; mesh.frustumCulled = false
      sc.add(mesh)
    }

    // ---- Road: gravel shoulders, asphalt with markings, the gold route line and its glow.
    const ribbon = (width, lift, off = 0, u0 = 0, u1 = 1) => {
      const g = new THREE.BufferGeometry(), v = [], uv = [], idx = []
      const i0 = Math.round(u0 * NS), i1 = Math.round(u1 * NS)
      for (let i = i0; i <= i1; i++) {
        const s = sideAt(i), p = pts[i]
        v.push(p.x + s.x * (off + width / 2), p.y + lift, p.z + s.z * (off + width / 2), p.x + s.x * (off - width / 2), p.y + lift, p.z + s.z * (off - width / 2))
        uv.push(i / NS, 0, i / NS, 1)
        if (i < i1) { const a = (i - i0) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals()
      return g
    }
    const RT = roadTextures()
    RT.map.repeat.set(this.roadLen / 12, 1); RT.rough.repeat.copy(RT.map.repeat)
    RT.gravel.repeat.set(this.roadLen / 12, 1)
    const roadMat = atm(new THREE.MeshStandardMaterial({ map: RT.map, roughnessMap: RT.rough, roughness: 1, bumpMap: RT.rough, bumpScale: 0.6, metalness: 0, envMapIntensity: 0.35 }), 'road')
    const road = new THREE.Mesh(ribbon(5.8, 0), roadMat); road.receiveShadow = true; sc.add(road)
    const shoulder = new THREE.Mesh(ribbon(8.6, -0.035), atm(new THREE.MeshStandardMaterial({ map: RT.gravel, alphaTest: 0.5, roughness: 0.95 }), 'gravel'))
    shoulder.receiveShadow = true; sc.add(shoulder)
    this.routeU = { uProg: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.62, 0.1) }, uGlow: { value: 1 } }
    const routeMat = (halo) => new THREE.ShaderMaterial({
      uniforms: this.routeU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: /* glsl */ `uniform float uProg, uTime, uGlow; uniform vec3 uCol; varying vec2 vUv;
        void main(){
          float across = 1. - abs(vUv.y - .5) * 2.;
          float done = smoothstep(uProg + .0004, uProg - .0004, vUv.x);
          float head = exp(-pow((vUv.x - uProg) * 160., 2.));
          ${halo
            ? 'float a = (done * .55 + head * 1.6) * pow(across, 2.2) * uGlow; gl_FragColor = vec4(uCol * a * .32, 1.);'
            : `float ahead = (1. - done) * step(.55, fract(vUv.x * 220. - uTime * .5)) * .22 * smoothstep(uProg + .12, uProg, vUv.x);
               float a = (done * (.95 + .25 * sin(vUv.x * 400. - uTime * 3.)) + head * 3. + ahead) * smoothstep(0., .5, across);
               gl_FragColor = vec4(uCol * a * (.35 + .6 * uGlow), 1.);`}
        }`,
    })
    sc.add(new THREE.Mesh(ribbon(0.26, 0.03, LANE), routeMat(false)))
    sc.add(new THREE.Mesh(ribbon(2.2, 0.025, LANE), routeMat(true)))

    // ---- Roadside furniture: milestones counting down to the warehouse, power poles with sagging wires, the culvert.
    const props = new Kit()
    const whitewash = atm(new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.85 }))
    const goldPaint = atm(new THREE.MeshStandardMaterial({ color: '#f2ad1c', roughness: 0.55 }))
    const concrete = atm(new THREE.MeshStandardMaterial({ color: '#a7a399', roughness: 0.9 }))
    const wireMat = atm(new THREE.MeshStandardMaterial({ color: '#242424', roughness: 0.6 }))
    const ceramic = atm(new THREE.MeshStandardMaterial({ color: '#6f8a7e', roughness: 0.3 }))
    const msTex = canvasTex(1024, 128, (g) => {
      g.fillStyle = '#ece6da'; g.fillRect(0, 0, 1024, 128)
      g.textAlign = 'center'; g.textBaseline = 'middle'
      for (let k = 0; k < 8; k++) {
        g.fillStyle = '#2b2a28'; g.font = '700 22px system-ui, sans-serif'; g.fillText('MANDI', k * 128 + 64, 40)
        g.font = '800 44px system-ui, sans-serif'; g.fillText(String(8 - k), k * 128 + 64, 84)
      }
    }, { aniso: 8 })
    const msFace = atm(new THREE.MeshStandardMaterial({ map: msTex, roughness: 0.8 }))
    const nMs = 8
    for (let k = 0; k < nMs; k++) {
      const u = 0.06 + (k / nMs) * 0.86, i = Math.round(u * NS), s = sideAt(i), t = tng[i]
      const p = pts[i].clone().addScaledVector(s, 4.6); p.y = groundAt(p.x, p.z) - 0.05
      const yaw = Math.atan2(-t.z, t.x)
      const place = (g) => { g.rotateY(yaw); g.translate(p.x, p.y, p.z); return g }
      props.add(whitewash, place(xf(rbox(0.2, 0.55, 0.46, 0.03), [0, 0.28, 0])))
      props.add(goldPaint, place(xf(new THREE.CylinderGeometry(0.23, 0.23, 0.2, 16, 1, false, 0, Math.PI), [0, 0.55, 0], [0, 0, Math.PI / 2])))
      const face = new THREE.PlaneGeometry(0.4, 0.36); const uvA = face.attributes.uv
      for (let j = 0; j < uvA.count; j++) uvA.setX(j, (uvA.getX(j) + k) / 8)
      props.add(msFace, place(xf(face, [-0.101, 0.3, 0], [0, -Math.PI / 2, 0])))
    }
    // Poles on the far side, every 34 m, with three wires sagging between them.
    const poleTops = []
    for (let k = 0; ; k++) {
      const u = 0.01 + k * (34 / this.roadLen); if (u > 0.99) break
      const i = Math.round(u * NS), s = sideAt(i), t = tng[i]
      const p = pts[i].clone().addScaledVector(s, -7.4); p.y = groundAt(p.x, p.z) - 0.2
      const lean = (hash(k, 3) - 0.5) * 0.04
      props.add(concrete, rod(p, p.clone().add(V(lean, 8.6, 0)), 0.13, 6, 0.08))
      const top = p.clone().add(V(lean * 0.95, 8.1, 0))
      props.add(concrete, xf(new THREE.BoxGeometry(0.1, 0.1, 1.8), [top.x, top.y, top.z], [0, Math.atan2(-t.z, t.x), 0]))
      const arm = V(-t.z, 0, t.x).normalize() // across the road
      const tops = [-0.75, 0, 0.75].map((o) => top.clone().addScaledVector(arm, o).add(V(0, o === 0 ? 0.35 : 0.12, 0)))
      for (const q of tops) props.add(ceramic, xf(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 8), [q.x, q.y - 0.06, q.z]))
      poleTops.push(tops)
    }
    for (let k = 0; k + 1 < poleTops.length; k++) for (let w = 0; w < 3; w++) {
      const a = poleTops[k][w], b = poleTops[k + 1][w], cp = []
      for (let j = 0; j <= 14; j++) { const s = j / 14; cp.push(a.clone().lerp(b, s).add(V(0, -Math.sin(s * Math.PI) * 0.75 - 0.02, 0))) }
      props.add(wireMat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 18, 0.018, 4))
    }
    // The culvert: two low parapet walls with black and white bands, where the stream passes under.
    const parTex = canvasTex(256, 32, (g) => { g.fillStyle = '#a39d8f'; g.fillRect(0, 0, 256, 32); g.fillStyle = '#2c2c2a'; for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 32, 32) })
    const parMat = atm(new THREE.MeshStandardMaterial({ map: parTex, roughness: 0.85 }))
    {
      const yaw = Math.atan2(-cT.z, cT.x)
      for (const sgn of [-1, 1]) {
        const p = cP.clone().addScaledVector(cS, sgn * 3.55)
        props.add(parMat, xf(rbox(6.4, 0.62, 0.3, 0.05), [p.x, p.y + 0.22, p.z], [0, yaw, 0]))
      }
    }
    this.props = props.build(sc)

    // ---- Water: the pond and the stream, mirroring the sky.
    this.waterU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunW: this.atmU.uSunW, uSunC: { value: new THREE.Color() }, uMoonW: { value: V(0, 0.2, -1) }, uMoonK: { value: 0 }, uTime: { value: 0 } }
    {
      const wg = []
      const pg = new THREE.CircleGeometry(1, 48); pg.rotateX(-Math.PI / 2); pg.scale(28, 1, 18); pg.translate(pond.x, this.waterY, pond.z); wg.push(norm(pg))
      this.waterY2 = groundAt(pond2.x, pond2.z) + 4.2 - 1.3
      const pg2 = new THREE.CircleGeometry(1, 40); pg2.rotateX(-Math.PI / 2); pg2.scale(17, 1, 11); pg2.translate(pond2.x, 0, pond2.z)
      { const pp = pg2.attributes.position; for (let j = 0; j < pp.count; j++) pp.setY(j, this.waterY2) }
      wg.push(norm(pg2))
      const sv = [], si = [], suv = []
      streamPts.forEach((p, k) => {
        const n = streamPts[Math.min(k + 1, streamPts.length - 1)].clone().sub(streamPts[Math.max(k - 1, 0)]).normalize(), s = V(-n.z, 0, n.x)
        const w = 2.2 + Math.sin(k * 1.3) * 0.5
        sv.push(p.x + s.x * w, this.waterY, p.z + s.z * w, p.x - s.x * w, this.waterY, p.z - s.z * w); suv.push(k, 0, k, 1)
        if (k < streamPts.length - 1) { const b = k * 2; si.push(b, b + 2, b + 1, b + 1, b + 2, b + 3) }
      })
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2)); sg.setIndex(si); sg.computeVertexNormals()
      wg.push(norm(sg))
      const wm = new THREE.ShaderMaterial({
        uniforms: { ...this.waterU, ...this.atmU },
        vertexShader: 'varying vec3 vAtmW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vAtmW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: NOISE + ATM_PARS + /* glsl */ `uniform vec3 uTop, uHor, uSunC, uMoonW; uniform float uMoonK, uTime;
          void main(){
            vec2 p = vAtmW.xz;
            float e = .35;
            float h0 = mmNoise2(p * .9 + uTime * .25) + mmNoise2(p * 2.3 - uTime * .4) * .5;
            float hx = mmNoise2((p + vec2(e, 0.)) * .9 + uTime * .25) + mmNoise2((p + vec2(e, 0.)) * 2.3 - uTime * .4) * .5;
            float hz = mmNoise2((p + vec2(0., e)) * .9 + uTime * .25) + mmNoise2((p + vec2(0., e)) * 2.3 - uTime * .4) * .5;
            vec3 n = normalize(vec3((h0 - hx) * .35, 1., (h0 - hz) * .35));
            vec3 v = normalize(vAtmW - cameraPosition);
            vec3 r = reflect(v, n);
            float fres = .08 + .92 * pow(1. - max(dot(-v, n), 0.), 4.);
            vec3 sky = mix(uHor, uTop, pow(clamp(r.y, 0., 1.), .5));
            vec3 col = mix(vec3(.01, .02, .02), sky, fres);
            col += uSunC * pow(max(dot(r, uSunW), 0.), 300.) * 18. + uSunC * pow(max(dot(r, uSunW), 0.), 20.) * .4;
            col += vec3(.8, .85, 1.) * pow(max(dot(r, normalize(uMoonW)), 0.), 500.) * 14. * uMoonK;
            gl_FragColor = vec4(mmAtm(col, vAtmW), 1.);
          }`,
      })
      this.water = new THREE.Mesh(mergeGeometries(wg), wm)
      sc.add(this.water)
    }

    // ---- Trees: orchards in rows, shade trees along the road, scattered trees on the hills.
    const trees = []
    const lateral = (x, z) => { const [, bi] = nearest(x, z), s = sideAt(bi); return (x - pts[bi].x) * s.x + (z - pts[bi].z) * s.z }
    const okAt = (x, z, d) => d > 7.5 && pondD(x, z) > 24 && streamD(x, z) > 4 && (d > 26 || lateral(x, z) < 0)
    const orchards = [[0.02, 1, 34], [0.04, -1, 30], [0.13, 1, 28], [0.22, -1, 40], [0.31, 1, 30], [0.42, 1, 26], [0.6, -1, 32], [0.66, 1, 24], [0.78, -1, 30], [0.86, 1, 28]]
    const dens = 0.45 + T.leaves * 0.55
    for (const [u, sgn, off] of orchards) {
      const i = Math.round(u * NS), t = tng[i], s = sideAt(i)
      const c = pts[i].clone().addScaledVector(s, sgn * off)
      const ax = V(t.x, 0, t.z).normalize(), az = V(-ax.z, 0, ax.x)
      const L = 44 + R() * 30, Wd = 26 + R() * 18
      for (let a = -L / 2; a <= L / 2; a += 7) for (let b = -Wd / 2; b <= Wd / 2; b += 7) {
        if (R() > dens) continue
        const x = c.x + ax.x * a + az.x * b + (R() - 0.5) * 0.8, z = c.z + ax.z * a + az.z * b + (R() - 0.5) * 0.8
        const nd = nearest(x, z); if (!okAt(x, z, nd[0])) continue
        trees.push({ x, z, s: 1.45 + R() * 0.45, d: nd[0], tint: 0 })
      }
    }
    for (let i = 0; i <= NS; i += 9) {
      if (R() < 0.45) continue
      const s = sideAt(i), sgn = R() < 0.5 ? -1 : 1, off = sgn * (13 + R() * 6)
      const x = pts[i].x + s.x * off, z = pts[i].z + s.z * off, nd = nearest(x, z)
      if (!okAt(x, z, nd[0])) continue
      trees.push({ x, z, s: 1.6 + R() * 0.6, d: nd[0], tint: 1 })
    }
    for (let k = 0; k < 520 * dens; k++) {
      const x = -380 + R() * 780, z = -300 + R() * 520, nd = nearest(x, z)
      if (nd[0] < 20 || !okAt(x, z, nd[0])) continue
      if (fbm(x * 0.02, z * 0.02 + 50) < 0.45) continue
      trees.push({ x, z, s: 1.6 + R() * 1.4, d: nd[0], tint: 2 })
    }
    trees.forEach((t) => { t.y = groundAt(t.x, t.z) - 0.1 })
    this.buildTrees(trees, hi)

    // ---- Grass tufts along both verges.
    {
      const blades = []
      const br = rng(5)
      for (let b = 0; b < 9; b++) {
        const a = br() * 6.28, rad = br() * 0.12, h = 0.25 + br() * 0.35, lean = 0.08 + br() * 0.18, w = 0.025 + br() * 0.02
        const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad, dx = Math.cos(a) * lean, dz = Math.sin(a) * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w
        blades.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + dx * 0.5 + px * 0.6, h * 0.55, bz + dz * 0.5 + pz * 0.6,
          bx - px, 0, bz - pz, bx + dx * 0.5 + px * 0.6, h * 0.55, bz + dz * 0.5 + pz * 0.6, bx + dx * 0.5 - px * 0.6, h * 0.55, bz + dz * 0.5 - pz * 0.6,
          bx + dx * 0.5 - px * 0.6, h * 0.55, bz + dz * 0.5 - pz * 0.6, bx + dx * 0.5 + px * 0.6, h * 0.55, bz + dz * 0.5 + pz * 0.6, bx + dx, h, bz + dz)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3)); g.computeVertexNormals()
      const cols = new Float32Array(blades.length); for (let i = 0; i < blades.length / 3; i++) { const y = blades[i * 3 + 1] / 0.5; cols[i * 3] = 0.3 + y * 0.8; cols[i * 3 + 1] = 0.35 + y * 0.75; cols[i * 3 + 2] = 0.25 + y * 0.45 }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      // Normals pointing up read better than blade normals for thin grass.
      const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0)
      const gm = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }), 'grass', this.atmU, {
        vProject: `vec4 mvPosition = instanceMatrix * vec4(transformed, 1.); vec4 wp = modelMatrix * mvPosition;
          float ph = wp.x * .3 + wp.z * .23; float hk = position.y * position.y * 4.;
          wp.x += sin(uATime * 1.7 + ph) * .05 * hk; wp.z += cos(uATime * 1.3 + ph) * .04 * hk;
          mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`,
        vPars: 'uniform float uATime;',
      })
      const n = hi ? 4200 : T.name === 'mid' ? 1600 : 1000
      const tufts = new THREE.InstancedMesh(g, gm, n)
      const tones = ['#7a9a3c', '#9aa246', '#6a8a34', '#b0a456', '#87923e']
      const M = new THREE.Matrix4(), c = new THREE.Color()
      for (let k = 0; k < n; k++) {
        const i = Math.floor(R() * NS), s = sideAt(i), sgn = R() < 0.5 ? -1 : 1
        const off = sgn * (4.1 + Math.pow(R(), 1.8) * 8)
        const x = pts[i].x + s.x * off + (R() - 0.5), z = pts[i].z + s.z * off + (R() - 0.5)
        if (streamD(x, z) < 3) { M.makeScale(0, 0, 0); tufts.setMatrixAt(k, M); continue }
        const sc2 = 0.7 + R() * 0.9
        _q.setFromEuler(_e.set((R() - 0.5) * 0.2, R() * 6.28, (R() - 0.5) * 0.2))
        tufts.setMatrixAt(k, M.compose(V(x, groundAt(x, z) - 0.04, z), _q, V(sc2, sc2 * (0.7 + R() * 0.7), sc2)))
        tufts.setColorAt(k, c.set(tones[Math.floor(R() * tones.length)]))
      }
      tufts.receiveShadow = true; tufts.frustumCulled = false
      sc.add(tufts)
    }

    // ---- A village on the far hillside, scattered farmhouses, and the VMR Mangoes warehouse at the end of the road.
    this.buildVillage(R, nearest, groundAt, okAt)
    this.buildWarehouse(at, sideAt, tng, NS, groundAt)

    // ---- Fireflies over the verges at night.
    {
      const n = Math.round(420 * T.particles), p = new Float32Array(n * 3), ph = new Float32Array(n)
      for (let k = 0; k < n; k++) {
        const i = Math.floor(R() * NS), s = sideAt(i), off = (R() < 0.5 ? -1 : 1) * (4.3 + Math.pow(R(), 1.6) * 22)
        const x = pts[i].x + s.x * off, z = pts[i].z + s.z * off
        p.set([x, groundAt(x, z) + 0.3 + R() * 1.8, z], k * 3); ph[k] = R() * 100
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aP', new THREE.BufferAttribute(ph, 1))
      this.flyU = { uTime: { value: 0 }, uOp: { value: 0 }, uPx: { value: 1 } }
      const m = new THREE.ShaderMaterial({
        uniforms: this.flyU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aP; uniform float uTime, uPx; varying float vB;
          void main(){ vec3 q = position + vec3(sin(uTime * .4 + aP), sin(uTime * .3 + aP * 1.7) * .4, cos(uTime * .35 + aP * 1.3)) * .6;
            vec4 mv = modelViewMatrix * vec4(q, 1.); gl_Position = projectionMatrix * mv;
            vB = pow(max(sin(uTime * 1.3 + aP * 3.), 0.), 5.); gl_PointSize = (2. + 60. / -mv.z) * uPx; }`,
        fragmentShader: 'uniform float uOp; varying float vB; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); gl_FragColor = vec4(vec3(.85, 1., .45) * a * a * vB * uOp * 2.5, 1.); }',
      })
      this.flies = new THREE.Points(g, m); this.flies.frustumCulled = false
      sc.add(this.flies)
    }

    // ---- Birds crossing the sunrise.
    {
      const bg = new THREE.BufferGeometry()
      bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.05, 0, -0.1, -0.75, 0.05, 0.05, 0, 0, 0.12, -0.05, 0, -0.1, 0.75, 0.05, 0.05].map((v, j) => (j % 3 === 0 ? v : v)), 3))
      // (x across the wings, z along the body)
      const pa = bg.attributes.position
      for (let j = 0; j < pa.count; j++) { const x = pa.getX(j), z = pa.getZ(j); pa.setXYZ(j, z, pa.getY(j), x) }
      bg.computeVertexNormals()
      const bm = new THREE.MeshBasicMaterial({ color: '#1d1a20', side: THREE.DoubleSide })
      bm.onBeforeCompile = (s) => {
        s.uniforms.uTime = this.flyU.uTime
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n float wing = abs(position.z); transformed.y += sin(uTime * 11. + float(gl_InstanceID) * 1.7) * wing * .7;')
      }
      bm.customProgramCacheKey = () => 'road7-bird'
      this.birds = new THREE.InstancedMesh(bg, bm, 14)
      this.birds.frustumCulled = false
      this.birdOff = Array.from({ length: 14 }, (_, k) => V((R() - 0.5) * 22, (R() - 0.5) * 6, (R() - 0.5) * 14 + k * 0.3))
      sc.add(this.birds)
    }

    // ---- The truck.
    this.truck = this.makeTruck()
    sc.add(this.truck)
    const shadowDisc = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.4), atm(new THREE.MeshBasicMaterial({ map: radialTex('rgba(0,0,0,.75)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 'disc'))
    shadowDisc.rotation.x = -Math.PI / 2; shadowDisc.position.set(0.2, 0.03, 0); this.truck.add(shadowDisc)
    // the tail lights' red pool on the road behind the truck
    this.tailGlowMat = new THREE.MeshBasicMaterial({ map: radialTex('rgba(255,255,255,1)'), color: new THREE.Color(0, 0, 0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5, fog: false })
    const tailGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.0), this.tailGlowMat)
    tailGlow.rotation.x = -Math.PI / 2; tailGlow.position.set(-4.6, 0.05, 0); this.truck.add(tailGlow)
    // the evening star, low over the afterglow
    {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
      this.starU = { uOp: { value: 0 }, uPx: { value: 1 }, uTime: { value: 0 } }
      this.eveStar = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: this.starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        vertexShader: 'uniform float uPx; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w * .9999; gl_PointSize = 26. * uPx; }',
        fragmentShader: `uniform float uOp, uTime; void main(){ vec2 q = gl_PointCoord - .5; float d = length(q);
          float core = exp(-d * d * 900.), halo = exp(-d * d * 60.) * .25, spike = (exp(-abs(q.x) * 90.) + exp(-abs(q.y) * 90.)) * smoothstep(.5, 0., d) * .35;
          gl_FragColor = vec4(vec3(1., .96, .88) * (core * 3. + halo + spike) * uOp * (.85 + .15 * sin(uTime * 3.1)), 1.); }`,
      }))
      this.eveStar.frustumCulled = false; this.eveStar.renderOrder = -4
      sc.add(this.eveStar)
    }

    // ---- Sky, moon, light.
    this.sky = paintSky(900); sc.add(this.sky)
    const su = this.sky.userData.u
    su.uClouds.value = 0.32; su.uHaze.value = 0.55; su.uSunSize.value = 0.04; su.uCloudSpeed.value = 0.002; su.uCloudScale.value = 0.7
    su.uMilkyAxis.value.set(0.557, 0.822, 0.125).normalize()
    su.uMetA.value.set(0.56, 0.24, -0.88).normalize(); su.uMetB.value.set(0.17, 0.06, -0.99).normalize()
    const moonTex = canvasTex(256, 256, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      grd.addColorStop(0, '#fffaf0'); grd.addColorStop(0.36, '#f4f0e6'); grd.addColorStop(0.39, 'rgba(240,236,228,0.2)'); grd.addColorStop(0.5, 'rgba(180,200,255,0.05)'); grd.addColorStop(1, 'rgba(160,190,255,0)')
      g.fillStyle = grd; g.fillRect(0, 0, w, h)
      const r = rng(9); g.save(); g.beginPath(); g.arc(w / 2, h / 2, w * 0.37, 0, 7); g.clip()
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(150,150,170,${0.08 + r() * 0.16})`; g.beginPath(); g.arc(w / 2 + (r() - 0.5) * w * 0.6, h / 2 + (r() - 0.5) * h * 0.6, 4 + r() * 22, 0, 7); g.fill() }
      g.restore()
    })
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1.5, 1.5, 1.65) }))
    this.moon.renderOrder = -6
    sc.add(this.moon)
    { // The moon hangs in the sky behind the truck in the night tracking shot.
      const un = this.uAt(0.46), Tm = this.curve.getTangentAt(un), Sm = V(-Tm.z, 0, Tm.x).normalize()
      this.moonDir = Sm.clone().multiplyScalar(-0.93).addScaledVector(V(Tm.x, 0, Tm.z).normalize(), 0.12).add(V(0, 0.2, 0)).normalize()
    }

    this.sunL = new THREE.DirectionalLight('#ffb070', 2)
    this.sunL.castShadow = true
    this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    this.sunL.shadow.bias = -0.0004; this.sunL.shadow.normalBias = 0.04
    sc.add(this.sunL, this.sunL.target)
    this.hemi = new THREE.HemisphereLight('#ffc9a0', '#202838', 0.8); sc.add(this.hemi)
    this.envDusk = engine.env({ top: '#3a5590', mid: '#ff9a5a', bottom: '#2a2420', sun: '#ff9050', sunDir: V(-0.9, 0.1, -0.4), sunPower: 3 })
    this.envNight = engine.env({ top: '#0a1430', mid: '#2a3e6e', bottom: '#06080c', sun: '#c8d4ff', sunDir: this.moonDir, sunPower: 1.2 })
    this.envDawn = engine.env({ top: '#5a80c0', mid: '#ffc08a', bottom: '#2a2420', sun: '#ffd0a0', sunDir: V(0.85, 0.1, -0.5), sunPower: 4 })

    // Time-of-day palettes (sRGB hex, converted to linear once).
    const P = (o) => { const r = {}; for (const k in o) r[k] = typeof o[k] === 'string' ? new THREE.Color(o[k]) : o[k]; return r }
    this.states = [
      [-0.2, P({ top: '#4a78b8', hor: '#ffc474', fog: '#e2ac6c', sunFog: '#ffdc94', hemiS: '#a6b2d0', hemiG: '#4a3420', hemiI: 0.85, keyI: 4.0, keyC: '#ffb868', exp: 1.0, cloud: '#ffdcaa', cloudSh: '#9a6c6c', stars: 0, ridge: '#9a8478' })],
      [0.12, P({ top: '#3d66aa', hor: '#ffac52', fog: '#dc985a', sunFog: '#ffc672', hemiS: '#98a4c8', hemiG: '#40301e', hemiI: 0.85, keyI: 3.8, keyC: '#ffa452', exp: 1.02, cloud: '#ffc592', cloudSh: '#80506a', stars: 0, ridge: '#8a7476' })],
      [0.255, P({ top: '#1f4a80', hor: '#ff8a4c', fog: '#8a5a5c', sunFog: '#ff9850', hemiS: '#6c7cb8', hemiG: '#1e1a20', hemiI: 0.95, keyI: 1.7, keyC: '#ff9a5c', exp: 1.12, cloud: '#ff9c72', cloudSh: '#4a3050', stars: 0.12, ridge: '#24192c' })],
      [0.32, P({ top: '#0a2050', hor: '#d8644a', fog: '#2c3656', sunFog: '#ff7c3c', hemiS: '#3e68a4', hemiG: '#10121a', hemiI: 1.05, keyI: 0.8, keyC: '#c4a2c4', exp: 1.24, cloud: '#c86c6a', cloudSh: '#1c1a34', stars: 0.65, ridge: '#0c0c1c' })],
      [0.38, P({ top: '#06102c', hor: '#1f3866', fog: '#172a50', sunFog: '#24406e', hemiS: '#4a6ab8', hemiG: '#0e1422', hemiI: 1.25, keyI: 1.5, keyC: '#a8c0ff', exp: 1.32, cloud: '#2a3a62', cloudSh: '#0a1228', stars: 1, ridge: '#0d1830' })],
      [0.56, P({ top: '#06102c', hor: '#21396a', fog: '#182b52', sunFog: '#26426e', hemiS: '#4a6ab8', hemiG: '#0e1422', hemiI: 1.25, keyI: 1.5, keyC: '#a8c0ff', exp: 1.32, cloud: '#2a3a62', cloudSh: '#0a1228', stars: 1, ridge: '#0d1830' })],
      [0.68, P({ top: '#2a3c78', hor: '#f4a08e', fog: '#8a7c98', sunFog: '#ffb08e', hemiS: '#9aa2d4', hemiG: '#2a2430', hemiI: 1.05, keyI: 1.3, keyC: '#ffb4a0', exp: 1.12, cloud: '#ffb0a0', cloudSh: '#5a4870', stars: 0.2, ridge: '#5c5c84' })],
      [0.82, P({ top: '#5684c4', hor: '#ffc290', fog: '#f0bc9c', sunFog: '#ffd49c', hemiS: '#b8c6ee', hemiG: '#3a3022', hemiI: 0.95, keyI: 3.6, keyC: '#ffbe80', exp: 1.0, cloud: '#ffdcc4', cloudSh: '#b0808e', stars: 0, ridge: '#9690b0' })],
      [1.0, P({ top: '#5e8ccc', hor: '#ffcc96', fog: '#eebea0', sunFog: '#ffd8a4', hemiS: '#c6d4f0', hemiG: '#3c3224', hemiI: 0.95, keyI: 3.6, keyC: '#ffc890', exp: 1.0, cloud: '#ffeed6', cloudSh: '#a88a8a', stars: 0, ridge: '#9a98b0' })],
    ]
    this.st = P({ top: '#000', hor: '#000', fog: '#000', sunFog: '#000', hemiS: '#000', hemiG: '#000', hemiI: 0, keyI: 0, keyC: '#000', exp: 1, cloud: '#000', cloudSh: '#000', stars: 0, ridge: '#000' })

    this.tmp = V(); this.tng = V(); this.side = V(); this.F = V(); this.S = V()
    this._a = V(); this._b = V(); this._c = V(); this._d = V()
    this.camPos = V(); this.camTgt = V(); this.head = V()
    // The camera: angle around the truck (0 behind, 90 its right, 180 in front), distance, height, target ahead, target height.
    this.camKeys = [
      //  t      a     d     h     ft    th    ts
      [-0.2, 88, 4.4, 7.4, -1.3, 1.5, 0],
      [0.0, 100, 8.0, 8.4, -1.0, 1.4, 0],
      [0.1, 128, 20, 9.5, -9, 4.0, 2.5],
      [0.21, 150, 36, 10, -20, 7.5, 4],
      [0.31, 128, 22, 5.0, -6, 4.0, 1.5],
      [0.42, 100, 16, 2.8, -0.6, 2.4, 0],
      [0.58, 72, 14, 3.0, 1.0, 1.9, 0],
      [0.72, 28, 12, 3.4, 12, 1.4, -10],
      [0.865, 160, 6.7, 1.4, 0, 1.2, 0],
      [1.0, 166, 5.3, 1.32, 0, 1.2, 0],
    ]
  }

  // ---------------------------------------------------------------------------------------------------------------------
  buildTrees(trees, hi) {
    const sc = this.scene, r = rng(12)
    const crownHi = crownGeometry(1, 3, hi ? 5 : 4), crownLo = crownGeometry(0, 3, 3), trunk = trunkGeometry()
    const crownMat = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }), 'crown', this.atmU, {
      uniforms: this.sunViewU,
      fPars: 'float gH; uniform vec3 uSunView, uKeyCol;',
      fColor: `{ float a = mmNoise(vAtmW * 1.1), b = mmNoise(vAtmW * 4.2 + 3.), c = mmNoise(vAtmW * 11. + 7.), lf = mmNoise(vAtmW * 26. + 1.);
        // the rim of the crown breaks up into leaves (sky shows through), seen against the light or edge-on
        float camD = length(vAtmW - cameraPosition);
        float rimF = 1. - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float rag = smoothstep(.3, .9, rimF) * (1. - smoothstep(70., 180., camD));
        float cl2 = mmNoise(vAtmW * 3.2 + 5.) * .65 + mmNoise(vAtmW * 8.5) * .35;
        if (cl2 < rag * .95 - .12) discard;
        gH = a * .32 + b * .1 + c * .05 + lf * .02;
        // leaf clusters with dark gaps between them; a few sun-bleached clumps
        float gap = smoothstep(.25, .5, c * .6 + lf * .4);
        diffuseColor.rgb *= mix(.45, 1.1, gap) * (.75 + .5 * a);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.3, 1.2, .6), smoothstep(.6, .9, b) * .45); }`,
      fNormal: 'normal = mmBump(-vViewPosition, normal, gH, 1.);',
      fEmissive: `{ vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 4.);
        float rim = pow(1. - clamp(dot(normal, Vd), 0., 1.), 3.);
        float lit = clamp(dot(normal, normalize(uSunView)), 0., 1.);
        totalEmissiveRadiance += diffuseColor.rgb * uKeyCol * (back * (1.2 + rim * 1.6) + rim * .3 + lit * .25); }`,
    })
    const trunkMat = enhance(new THREE.MeshStandardMaterial({ color: '#4a3828', roughness: 0.95 }), 'atm', this.atmU)
    const discMat = enhance(new THREE.MeshBasicMaterial({ map: radialTex('rgba(0,0,0,.6)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 'disc', this.atmU)
    const tints = [['#2f5a22', '#3a6a28', '#29501f', '#44702c'], ['#2c5520', '#365f26', '#3f6b2c'], ['#3a5e2a', '#4a6a30', '#33562a', '#55703a']]
    // Chunk by x so each chunk is culled (in the camera and in the shadow pass) on its own.
    const bins = new Map()
    for (const t of trees) { const key = Math.floor((t.x + 400) / 120) + (t.d < 34 ? 'n' : 'f'); if (!bins.has(key)) bins.set(key, []); bins.get(key).push(t) }
    const M = new THREE.Matrix4(), c = new THREE.Color(), up = V(0, 1, 0)
    const disc = new THREE.PlaneGeometry(1, 1); disc.rotateX(-Math.PI / 2)
    const discs = new THREE.InstancedMesh(disc, discMat, trees.length)
    let di = 0
    for (const [key, list] of bins) {
      const near = key.endsWith('n')
      const cm = new THREE.InstancedMesh(near ? crownHi : crownLo, crownMat, list.length)
      const tm = new THREE.InstancedMesh(trunk, trunkMat, list.length)
      list.forEach((t, k) => {
        const s = t.s
        _q.setFromAxisAngle(up, r() * 6.28)
        // some trees spread into a flatter umbrella; the rest are rounder
        const umb = r() < 0.35, sy = (0.85 + r() * 0.3) * (umb ? 0.72 : 1), sw = umb ? 1.16 : 1
        cm.setMatrixAt(k, M.compose(V(t.x, t.y + s * (umb ? 1.24 : 1.32), t.z), _q, V(s * sw * (0.95 + r() * 0.15), s * sy, s * sw * (0.95 + r() * 0.15))))
        const pal = tints[t.tint]
        cm.setColorAt(k, c.set(pal[Math.floor(r() * pal.length)]).multiplyScalar(0.9 + r() * 0.2))
        tm.setMatrixAt(k, M.compose(V(t.x, t.y, t.z), _q, V(s * 0.75, s * 0.68, s * 0.75)))
        discs.setMatrixAt(di++, M.compose(V(t.x, t.y + 0.14, t.z), _q, V(s * 3.4, 1, s * 3.4)))
      })
      cm.castShadow = near; cm.receiveShadow = true; tm.castShadow = near; tm.receiveShadow = true
      cm.computeBoundingSphere(); tm.computeBoundingSphere()
      sc.add(cm, tm)
    }
    discs.count = di
    sc.add(discs)
  }

  buildVillage(R, nearest, groundAt, okAt) {
    const sc = this.scene, houses = []
    const clusters = [[40, -165, 26, 22], [-150, -150, 12, 14], [150, -120, 10, 12], [-60, 150, 8, 10], [110, 95, 6, 8]]
    for (const [cx, cz, n, rad] of clusters) for (let k = 0; k < n; k++) {
      const a = R() * 6.28, d = Math.sqrt(R()) * rad, x = cx + Math.cos(a) * d * 1.4, z = cz + Math.sin(a) * d
      const nd = nearest(x, z); if (!okAt(x, z, nd[0]) || nd[0] < 14) continue
      houses.push({ x, z, y: groundAt(x, z), rot: Math.round(R() * 4) * (Math.PI / 2) + (R() - 0.5) * 0.3, w: 4 + R() * 4, d: 4 + R() * 3, h: 2.8 + R() * 2.4, pitched: R() < 0.4, tint: R() })
    }
    for (let k = 0; k < 10; k++) { // lone farmhouses near the road
      const u = 0.05 + R() * 0.9, i = Math.round(u * 600), p = this.pts[i]
      const off = (R() < 0.5 ? -1 : 1) * (22 + R() * 30), t = this.curve.getTangentAt(u), x = p.x - t.z * off, z = p.z + t.x * off
      const nd = nearest(x, z); if (!okAt(x, z, nd[0])) continue
      houses.push({ x, z, y: groundAt(x, z), rot: Math.atan2(-t.z, t.x), w: 5 + R() * 2, d: 4 + R() * 1.5, h: 2.8 + R(), pitched: R() < 0.6, tint: R() })
    }
    const wallM = enhance(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 'atm', this.atmU)
    const roofM = enhance(new THREE.MeshStandardMaterial({ roughness: 0.8 }), 'atm', this.atmU)
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0)
    const prism = new THREE.CylinderGeometry(0.62, 0.62, 1, 3, 1); prism.rotateZ(Math.PI / 2); prism.rotateX(Math.PI / 6); prism.scale(1.08, 0.5, 1.6); prism.translate(0, 0.16, 0)
    const n = houses.length
    const walls = new THREE.InstancedMesh(box, wallM, n), roofs = new THREE.InstancedMesh(prism, roofM, n), slabs = new THREE.InstancedMesh(box, roofM, n)
    const winG = new THREE.PlaneGeometry(0.55, 0.75)
    this.winMat = enhance(new THREE.MeshBasicMaterial({ color: '#ffffff' }), 'basic', this.atmU)
    const wins = new THREE.InstancedMesh(winG, this.winMat, n * 3)
    this.winOn = []
    const M = new THREE.Matrix4(), c = new THREE.Color(), up = V(0, 1, 0), wallTones = ['#efe6d6', '#e6d2b0', '#cfdde0', '#e8c8b8', '#f2ece0', '#d8c79a']
    let wi = 0, si = 0, ri = 0
    houses.forEach((h, k) => {
      _q.setFromAxisAngle(up, h.rot)
      walls.setMatrixAt(k, M.compose(V(h.x, h.y - 0.4, h.z), _q, V(h.w, h.h + 0.4, h.d)))
      walls.setColorAt(k, c.set(wallTones[Math.floor(h.tint * wallTones.length)]))
      if (h.pitched) { roofs.setMatrixAt(ri, M.compose(V(h.x, h.y + h.h, h.z), _q, V(h.w * 1.08, h.d * 0.9, h.d * 0.75))); roofs.setColorAt(ri++, c.set(h.tint < 0.5 ? '#9a4a30' : '#7a5a4a')) }
      else { slabs.setMatrixAt(si, M.compose(V(h.x, h.y + h.h, h.z), _q, V(h.w + 0.3, 0.22, h.d + 0.3))); slabs.setColorAt(si++, c.set('#cfc6b4')) }
      for (let j = 0; j < 2; j++) {
        const lit = R() < 0.7, off = (j - 0.5) * h.w * 0.45
        const fwd = V(0, 0, h.d / 2 + 0.03).applyQuaternion(_q), sideV = V(off, 0, 0).applyQuaternion(_q)
        wins.setMatrixAt(wi, M.compose(V(h.x, h.y + h.h * 0.45, h.z).add(fwd).add(sideV), _q, V(1, 1, 1)))
        wins.setColorAt(wi, c.setScalar(lit ? 0.6 + R() * 0.6 : 0.04))
        this.winOn.push(0.2 + R() * 0.16)
        wi++
      }
    })
    roofs.count = ri; slabs.count = si; wins.count = wi
    {
      const gp = [], go = [], c2 = new THREE.Color(), m2 = new THREE.Matrix4(), pv = V(), qv = new THREE.Quaternion(), sv2 = V()
      this.winBase = []
      for (let j = 0; j < wi; j++) { wins.getColorAt(j, c2); this.winBase.push(c2.r); if (c2.r < 0.3) continue; wins.getMatrixAt(j, m2); m2.decompose(pv, qv, sv2); gp.push(pv.x, pv.y, pv.z); go.push(this.winOn[j]) }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); g.setAttribute('aOn', new THREE.Float32BufferAttribute(go, 1))
      this.glowU = { uOp: { value: 0 }, uPx: { value: 1 }, uT: { value: 0 } }
      const m = new THREE.ShaderMaterial({
        uniforms: this.glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'attribute float aOn; uniform float uPx, uT; varying float vOn; void main(){ vOn = smoothstep(aOn, aOn + .012, uT) + step(.6, uT); vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(2600. / -mv.z, 3., 60.) * uPx; }',
        fragmentShader: 'uniform float uOp; varying float vOn; void main(){ if (vOn < .01) discard; float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); gl_FragColor = vec4(vec3(1., .62, .28) * a * a * a * uOp * min(vOn, 1.), 1.); }',
      })
      this.winGlow = new THREE.Points(g, m); this.winGlow.frustumCulled = false
      sc.add(this.winGlow)
    }
    for (const m of [walls, roofs, slabs]) { m.castShadow = true; m.receiveShadow = true; sc.add(m) }
    this.wins = wins
    sc.add(wins)
    // A small white temple and a water tank on the big village's hill.
    const tk = new Kit()
    const white = enhance(new THREE.MeshStandardMaterial({ color: '#f2ede2', roughness: 0.7 }), 'atm', this.atmU)
    const saffron = enhance(new THREE.MeshStandardMaterial({ color: '#f08a24', roughness: 0.7, side: THREE.DoubleSide }), 'atm', this.atmU)
    {
      const x = 58, z = -178, y = groundAt(x, z)
      tk.add(white, xf(new THREE.BoxGeometry(5, 3, 5), [x, y + 1.3, z]))
      const prof = []; for (let i = 0; i <= 12; i++) { const s = i / 12; prof.push(new THREE.Vector2(2.2 * Math.pow(1 - s, 0.8) * (1 + 0.06 * Math.sin(s * 40)), s * 7)) }
      tk.add(white, xf(new THREE.LatheGeometry(prof, 8), [x, y + 2.8, z]))
      tk.add(saffron, xf(new THREE.PlaneGeometry(1.2, 0.7), [x + 0.6, y + 10.2, z], [0, 0.4, 0]))
      tk.add(white, rod(V(x, y + 9.6, z), V(x, y + 10.6, z), 0.04))
      const wx = 22, wz = -150, wy = groundAt(wx, wz)
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tk.add(white, rod(V(wx + a * 1.6, wy - 0.5, wz + b * 1.6), V(wx + a * 1.2, wy + 9, wz + b * 1.2), 0.18))
      tk.add(white, xf(new THREE.CylinderGeometry(2.6, 2.4, 3.4, 16), [wx, wy + 10.6, wz]))
    }
    tk.build(sc)
  }

  buildWarehouse(at, sideAt, tng, NS, groundAt) {
    const sc = this.scene, k = new Kit()
    // At the end of the road, its doors facing the truck as it comes up the last stretch.
    const i = NS, t = tng[i], p = at(1).addScaledVector(V(t.x, 0, t.z).normalize(), 22)
    const yaw = Math.atan2(-t.x, -t.z)
    const y = groundAt(p.x, p.z)
    const cream = enhance(new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.8 }), 'atm', this.atmU)
    const green = enhance(new THREE.MeshStandardMaterial({ color: '#174631', roughness: 0.6, metalness: 0.2 }), 'atm', this.atmU)
    const gold = enhance(new THREE.MeshStandardMaterial({ color: '#ffb81f', roughness: 0.4, metalness: 0.4 }), 'atm', this.atmU)
    const place = (g) => { g.rotateY(yaw); g.translate(p.x, y, p.z); return g }
    k.add(cream, place(xf(new THREE.BoxGeometry(34, 7, 14), [0, 3.3, 0])))
    k.add(green, place(xf(new THREE.BoxGeometry(34.2, 1.4, 14.2), [0, 0.5, 0])))
    k.add(gold, place(xf(new THREE.BoxGeometry(34.4, 0.35, 14.4), [0, 6.95, 0])))
    const roof = new THREE.CylinderGeometry(1, 1, 35, 3, 1); roof.rotateZ(Math.PI / 2); roof.rotateX(Math.PI / 6); roof.scale(1, 2.2, 8.4)
    k.add(green, place(xf(roof, [0, 8.2, 0])))
    for (let j = -2; j <= 2; j++) k.add(green, place(xf(new THREE.BoxGeometry(4.2, 4.6, 0.2), [j * 6.4, 2.3, 7.05])))
    const signTex = brandTex(1024, 256, (g, w, h) => { g.fillStyle = '#174631'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffb81f'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28); drawWordmark(g, w / 2, h * 0.47, 92, '#f6efdc') })
    const sign = new THREE.Mesh(place(xf(new THREE.PlaneGeometry(12, 3), [0, 9.8, 7.3])), enhance(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.15 }), 'atm-sign', this.atmU))
    sc.add(sign)
    k.add(green, place(xf(new THREE.BoxGeometry(12.4, 3.4, 0.3), [0, 9.8, 7.1])))
    const apron = place(xf(new THREE.PlaneGeometry(40, 16), [0, 0.06, 15], [-Math.PI / 2, 0, 0]))
    k.add(enhance(new THREE.MeshStandardMaterial({ color: '#8a857c', roughness: 0.9 }), 'atm', this.atmU), apron)
    this.whMeshes = k.build(sc)
    // Its yard lamps.
    this.yardLamps = []
    const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2) })
    for (const x of [-12, 0, 12]) {
      const q = place(xf(new THREE.SphereGeometry(0.28, 10, 8), [x, 6.2, 7.6]))
      const m = new THREE.Mesh(q, lampM); sc.add(m); this.yardLamps.push(m)
    }
    this.lampMat = lampM
  }

  // ---------------------------------------------------------------------------------------------------------------------
  makeTruck() {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body)
    this.body = body
    const A = this.atmU
    const paint = enhance(new THREE.MeshPhysicalMaterial({ color: '#174631', roughness: 0.72, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.7 }), 'paint', A) // a soft sheen: with a mirror-like coat the low sun glanced off the cab roof as a white bar
    const paintDark = enhance(new THREE.MeshStandardMaterial({ color: '#0e2c1f', roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }), 'atm', A)
    const gold = enhance(new THREE.MeshStandardMaterial({ color: '#ffb81f', roughness: 0.28, metalness: 0.7 }), 'atm', A)
    const cream = enhance(new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.45 }), 'atm', A)
    const chrome = enhance(new THREE.MeshStandardMaterial({ color: '#e4e0d8', roughness: 0.14, metalness: 1 }), 'atm', A)
    const dark = enhance(new THREE.MeshStandardMaterial({ color: '#1c1b1a', roughness: 0.75, metalness: 0.2 }), 'atm', A)
    const wood = enhance(new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#e8cfa6', roughness: 0.85 }), 'atm', A)
    const skin = enhance(new THREE.MeshStandardMaterial({ color: '#8a5a3c', roughness: 0.6 }), 'atm', A)
    const tarpTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#8f8256'; g.fillRect(0, 0, w, h); const r = rng(4)
      for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '90,70,40' : '255,245,220'},${r() * 0.1})`; g.fillRect(r() * w, r() * h, 2, 2) }
      g.strokeStyle = 'rgba(80,60,30,.35)'; g.lineWidth = 2; for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke() }
    }, { repeat: true })
    const tarp = enhance(new THREE.MeshStandardMaterial({ map: tarpTex, roughness: 0.95, side: THREE.DoubleSide }), 'atm', A)
    const rope = enhance(new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.9 }), 'atm', A)
    this.glassSide = enhance(new THREE.MeshStandardMaterial({ color: '#7d969c', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 2, side: THREE.DoubleSide, emissive: '#ffb060', emissiveIntensity: 0 }), 'glass', A)
    this.glassFront = enhance(new THREE.MeshStandardMaterial({ color: '#1a2a30', roughness: 0.05, metalness: 0.3, envMapIntensity: 1.8, emissive: '#ffae58', emissiveIntensity: 0 }), 'atm', A)
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#5a0a06', emissive: '#ff2a10', emissiveIntensity: 1, roughness: 0.3 })
    this.amberMat = new THREE.MeshStandardMaterial({ color: '#8a4a08', emissive: '#ff9a20', emissiveIntensity: 0.6, roughness: 0.3 })
    const K = new Kit()

    // Cab: a side profile extruded across the truck, rounded at the edges, with an arch over the front wheel and
    // window openings (so the driver and the warm cab light can be seen inside).
    const S = new THREE.Shape()
    S.moveTo(1.28, 0.8); S.lineTo(1.825, 0.8)
    S.absarc(2.35, 0.47, 0.62, 2.58, 0.561, true)
    S.lineTo(3.62, 0.8); S.lineTo(3.62, 1.42); S.quadraticCurveTo(3.62, 1.64, 3.42, 1.67)
    S.lineTo(2.95, 1.76); S.lineTo(2.55, 2.5); S.quadraticCurveTo(2.48, 2.62, 2.32, 2.62)
    S.lineTo(1.42, 2.62); S.quadraticCurveTo(1.28, 2.62, 1.28, 2.48); S.lineTo(1.28, 0.8)
    const win = new THREE.Path()
    win.moveTo(1.5, 1.84); win.lineTo(2.72, 1.84); win.quadraticCurveTo(2.78, 1.84, 2.75, 1.9); win.lineTo(2.44, 2.42); win.quadraticCurveTo(2.41, 2.46, 2.36, 2.46); win.lineTo(1.54, 2.46); win.quadraticCurveTo(1.5, 2.46, 1.5, 2.42); win.lineTo(1.5, 1.84)
    S.holes.push(win)
    const cab = new THREE.ExtrudeGeometry(S, { depth: 1.74, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 3, curveSegments: 12 })
    cab.translate(0, 0, -0.87)
    K.add(paint, cab)
    // Side glass in the openings, the driver (right-hand drive, our side), a seat and the wheel.
    const winShape = new THREE.Shape(win.getPoints(6))
    for (const z of [0.9, -0.9]) K.add(this.glassSide, xf(new THREE.ShapeGeometry(winShape), [0, 0, z]))
    K.add(dark, xf(rbox(0.12, 0.7, 1.5, 0.04), [1.5, 1.95, 0]))
    K.add(skin, xf(new THREE.SphereGeometry(0.115, 16, 12), [1.92, 2.12, 0.42]))
    K.add(gold, xf(new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, 1.3), [1.92, 2.17, 0.42]))
    K.add(gold, xf(new THREE.CylinderGeometry(0.03, 0.12, 0.02, 12), [2.03, 2.19, 0.42], [0, 0, -0.5]))
    K.add(cream, xf(rbox(0.3, 0.5, 0.42, 0.1), [1.86, 1.78, 0.42]))
    K.add(dark, xf(new THREE.TorusGeometry(0.17, 0.018, 6, 24), [2.3, 1.92, 0.42], [0, Math.PI / 2, 0.55]))
    K.add(dark, xf(rbox(0.3, 0.12, 1.7, 0.04), [2.66, 1.8, 0]))
    // Windscreen (dark, reflective) and wipers.
    const d = V(-0.4, 0.74, 0).normalize(), nrm = V(0.74, 0.4, 0).normalize()
    const ws0 = V(2.95 - 0.03 * 0.54, 1.79, 0).addScaledVector(nrm, 0.056)
    const wsc = ws0.clone().addScaledVector(d, 0.38)
    // rbox: x along the slant, y across the truck, z its thickness → basis (d, +z, normal), right-handed.
    const wsGeo = rbox(0.76, 1.66, 0.012, 0.005)
    wsGeo.applyMatrix4(new THREE.Matrix4().makeBasis(d, V(0, 0, 1), nrm))
    wsGeo.translate(wsc.x, wsc.y, wsc.z)
    K.add(this.glassFront, wsGeo)
    for (const z of [-0.38, 0.32]) { const a0 = ws0.clone().add(V(0.025, 0.02, z)), a1 = ws0.clone().addScaledVector(d, 0.52).add(V(0.025, 0.02, z - 0.14)); K.add(dark, rod(a0, a1, 0.016, 5)); K.add(dark, rod(a0.clone().addScaledVector(d, 0.06).add(V(0.012, 0, 0.02)), a1.clone().add(V(0.012, 0, -0.03)), 0.01, 4)) }
    // Gold belt stripe, door wordmarks, handles, steps.
    for (const z of [0.957, -0.957]) K.add(gold, xf(new THREE.BoxGeometry(2.3, 0.05, 0.012), [2.45, 1.19, z]))
    const doorTex = brandTex(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.strokeStyle = 'rgba(5,20,12,.75)'; g.lineWidth = 4
      g.beginPath(); g.moveTo(6, 0); g.lineTo(6, h - 8); g.quadraticCurveTo(6, h - 4, 14, h - 4); g.lineTo(w - 14, h - 4); g.quadraticCurveTo(w - 6, h - 4, w - 6, h - 8); g.lineTo(w - 6, 0); g.stroke()
      drawWordmark(g, w / 2, h * 0.42, 78, '#f4ecd6')
    })
    this.decalMat = enhance(new THREE.MeshStandardMaterial({ map: doorTex, transparent: true, roughness: 0.4, emissive: '#ffffff', emissiveMap: doorTex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2 }), 'decal', A)
    for (const sgn of [1, -1]) {
      const g = xf(new THREE.PlaneGeometry(1.24, 0.6), [1.98, 1.53, sgn * 0.958], [0, sgn > 0 ? 0 : Math.PI, 0])
      K.add(this.decalMat, g)
      K.add(chrome, xf(rbox(0.035, 0.16, 0.03, 0.012), [1.42, 1.62, sgn * 0.97]))
      K.add(chrome, xf(new THREE.BoxGeometry(0.34, 0.035, 0.18), [1.56, 0.62, sgn * 0.95]))
      // Mirror on an arm.
      const a0 = V(2.82, 1.95, sgn * 0.96), a1 = V(2.9, 2.06, sgn * 1.3)
      K.add(dark, rod(a0, a1, 0.014, 5))
      K.add(paint, xf(rbox(0.07, 0.34, 0.2, 0.03), [2.9, 2.12, sgn * 1.33]))
      K.add(chrome, xf(new THREE.PlaneGeometry(0.17, 0.3), [2.862, 2.12, sgn * 1.33], [0, -Math.PI / 2, 0]))
    }
    // Front: grille with a gold surround and a mango badge, headlamps with chrome bezels and lenses, indicators, bumper,
    // a blank plate.
    const grilleTex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#ffb81f'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#0b120e'; g.fillRect(8, 8, w - 16, h - 16)
      for (let x = 16; x < w - 16; x += 12) { const grd = g.createLinearGradient(x, 0, x + 7, 0); grd.addColorStop(0, '#5a5a56'); grd.addColorStop(0.5, '#d8d4c8'); grd.addColorStop(1, '#4a4a46'); g.fillStyle = grd; g.fillRect(x, 12, 7, h - 24) }
    })
    K.add(enhance(new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.3, metalness: 0.6 }), 'atm', A), xf(new THREE.PlaneGeometry(1.0, 0.46), [3.672, 1.17, 0], [0, Math.PI / 2, 0]))
    K.add(gold, xf(new THREE.SphereGeometry(0.06, 14, 10), [3.68, 1.47, 0], [0, 0, -0.35], [0.35, 1.2, 0.9]))
    const lensTex = canvasTex(256, 256, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, '#fff4dc'); grd.addColorStop(0.7, '#ffd9a0'); grd.addColorStop(1, '#c08a50')
      g.fillStyle = grd; g.fillRect(0, 0, w, h)
      g.strokeStyle = 'rgba(120,80,40,.35)'; for (let rr = 18; rr < w / 2; rr += 14) { g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h / 2, rr, 0, 7); g.stroke() }
      g.strokeStyle = 'rgba(255,255,255,.4)'; for (let x = 0; x < w; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke() }
    })
    this.lensMat = new THREE.MeshStandardMaterial({ color: '#fff8ea', emissive: '#ffe6b8', emissiveMap: lensTex, map: lensTex, emissiveIntensity: 1, roughness: 0.08, metalness: 0 })
    const Rl = 0.281, th = 0.605
    for (const z of [0.69, -0.69]) {
      K.add(chrome, xf(new THREE.CylinderGeometry(0.2, 0.19, 0.14, 28), [3.69, 1.2, z], [0, 0, Math.PI / 2]))
      K.add(chrome, xf(new THREE.TorusGeometry(0.182, 0.026, 10, 36), [3.765, 1.2, z], [0, Math.PI / 2, 0]))
      const lens = new THREE.SphereGeometry(Rl, 36, 8, 0, Math.PI * 2, 0, th)
      // Planar UV across the lens face for the ring texture.
      const lp = lens.attributes.position, luv = lens.attributes.uv
      for (let j = 0; j < lp.count; j++) luv.setXY(j, 0.5 + lp.getX(j) / 0.34, 0.5 + lp.getZ(j) / 0.34)
      K.add(this.lensMat, xf(lens, [3.78 - Rl, 1.2, z], [0, 0, -Math.PI / 2]))
      K.add(this.amberMat, xf(rbox(0.05, 0.08, 0.16, 0.02), [3.66, 1.5, z]))
    }
    // the grille in relief: a gold surround standing proud of the face, chrome slats over a dark recess
    K.add(dark, xf(rbox(0.05, 0.44, 0.96, 0.02), [3.66, 1.17, 0]))
    for (const y of [0.935, 1.405]) K.add(gold, xf(rbox(0.07, 0.06, 1.1, 0.025), [3.69, y, 0]))
    for (const z of [-0.52, 0.52]) K.add(gold, xf(rbox(0.07, 0.52, 0.06, 0.025), [3.69, 1.17, z]))
    for (let k = 0; k < 9; k++) K.add(chrome, xf(rbox(0.03, 0.42, 0.035, 0.012), [3.705, 1.17, -0.4 + k * 0.1]))
    K.add(chrome, xf(rbox(0.03, 0.03, 0.96, 0.012), [3.71, 1.17, 0]))
    // headlamp pods: painted cowls with a visor over each lamp
    for (const z of [0.69, -0.69]) {
      K.add(paint, xf(new THREE.CylinderGeometry(0.245, 0.245, 0.2, 28, 1, true), [3.64, 1.2, z], [0, 0, Math.PI / 2]))
      K.add(paint, xf(new THREE.CylinderGeometry(0.262, 0.262, 0.1, 28, 1, true, -Math.PI / 2, Math.PI), [3.78, 1.2, z], [Math.PI / 2, 0, Math.PI / 2]))
    }
    // fender flares over the front wheels
    for (const z of [0.93, -0.93]) K.add(paintDark, xf(new THREE.TorusGeometry(0.64, 0.045, 6, 22, Math.PI * 0.86), [2.35, 0.47, z], [0, 0, Math.PI * 0.07]))
    // a chrome trim line across the face, below the bonnet
    K.add(chrome, xf(rbox(0.02, 0.025, 1.78, 0.01), [3.63, 1.47, 0]))
    // the bumper: chrome bar, a black rubber strip, overriders, a dark valance and a tow hook
    K.add(chrome, xf(rbox(0.22, 0.24, 2.04, 0.08, 3), [3.78, 0.84, 0]))
    K.add(dark, xf(rbox(0.04, 0.06, 1.96, 0.02), [3.895, 0.88, 0]))
    for (const z of [-0.42, 0.42]) K.add(chrome, xf(rbox(0.08, 0.34, 0.08, 0.035), [3.86, 0.86, z]))
    K.add(dark, xf(rbox(0.12, 0.12, 1.8, 0.03), [3.66, 0.66, 0]))

    K.add(cream, xf(rbox(0.02, 0.15, 0.52, 0.01), [3.9, 0.84, 0]))
    K.add(dark, xf(rbox(0.025, 0.17, 0.54, 0.01), [3.893, 0.84, 0]))
    // Roof: a sun visor and three amber marker lights.
    K.add(paintDark, xf(rbox(0.3, 0.05, 1.86, 0.02), [2.6, 2.6, 0], [0, 0, -0.25])) // matte: the glossy paint mirrored the sky here as a white bar
    for (const z of [-0.35, 0, 0.35]) K.add(this.amberMat, xf(rbox(0.07, 0.06, 0.12, 0.02), [2.3, 2.7, z]))

    // Chassis, fuel tank, toolbox, fenders, mudflaps.
    for (const z of [0.45, -0.45]) K.add(dark, xf(new THREE.BoxGeometry(6.3, 0.18, 0.1), [0.05, 0.72, z]))
    K.add(paintDark, xf(new THREE.CylinderGeometry(0.17, 0.17, 0.6, 16), [0.1, 0.66, -0.7], [0, 0, Math.PI / 2]))
    K.add(dark, xf(rbox(0.55, 0.3, 0.28, 0.03), [0.1, 0.66, 0.7]))
    K.add(gold, xf(new THREE.BoxGeometry(0.06, 0.05, 0.02), [0.1, 0.72, 0.845]))
    for (const z of [0.82, -0.82]) {
      K.add(paintDark, xf(new THREE.CylinderGeometry(0.58, 0.58, 0.36, 18, 1, true, Math.PI / 2, Math.PI), [-1.6, 0.47, z], [Math.PI / 2, 0, 0]))
      for (const x of [-2.18, 1.66]) {
        K.add(dark, xf(rbox(0.025, 0.42, 0.36, 0.01), [x, 0.5, z]))
        K.add(gold, xf(new THREE.BoxGeometry(0.03, 0.04, 0.36), [x, 0.31, z]))
      }
    }
    // The bed: wooden deck, green dropsides of planks with a gold top rail, posts, a tall headboard, the tailboard with
    // the wordmark, rear lights and a blank plate.
    K.add(wood, xf(new THREE.BoxGeometry(4.3, 0.1, 1.96), [-1.02, 1.05, 0]))
    K.add(dark, xf(new THREE.BoxGeometry(4.3, 0.12, 1.9), [-1.02, 0.94, 0]))
    for (const z of [0.955, -0.955]) {
      for (const y of [1.19, 1.37]) K.add(paint, xf(rbox(4.24, 0.16, 0.05, 0.015), [-1.02, y, z]))
      K.add(gold, xf(rbox(4.3, 0.05, 0.07, 0.02), [-1.02, 1.475, z]))
      for (const x of [-3.12, -2.05, -1.0, 0.05, 1.08]) K.add(paintDark, xf(rbox(0.07, 0.42, 0.075, 0.02), [x, 1.28, z]))
    }
    for (const y of [1.19, 1.37]) K.add(paint, xf(rbox(0.05, 0.16, 1.9, 0.015), [-3.14, y, 0]))
    K.add(gold, xf(rbox(0.07, 0.05, 1.98, 0.02), [-3.14, 1.475, 0]))
    for (const y of [1.19, 1.37, 1.55, 1.73]) K.add(paint, xf(rbox(0.05, 0.16, 1.9, 0.015), [1.12, y, 0]))
    K.add(gold, xf(rbox(0.07, 0.05, 1.98, 0.02), [1.12, 1.83, 0]))
    const tailTex = brandTex(512, 160, (g, w, h) => { g.clearRect(0, 0, w, h); drawWordmark(g, w / 2, h * 0.42, 62, '#f4ecd6') })
    const tailDecal = enhance(new THREE.MeshStandardMaterial({ map: tailTex, transparent: true, roughness: 0.4, emissive: '#ffffff', emissiveMap: tailTex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2 }), 'decal', A)
    this.tailDecal = tailDecal
    K.add(tailDecal, xf(new THREE.PlaneGeometry(1.1, 0.34), [-3.168, 1.28, 0], [0, -Math.PI / 2, 0]))
    K.add(dark, xf(new THREE.BoxGeometry(0.1, 0.16, 1.92), [-3.12, 0.82, 0]))
    for (const z of [0.78, -0.78]) {
      K.add(this.tailMat, xf(rbox(0.05, 0.12, 0.22, 0.03), [-3.18, 0.83, z]))
      K.add(this.amberMat, xf(rbox(0.05, 0.1, 0.1, 0.025), [-3.18, 0.83, z * 0.72]))
    }
    K.add(cream, xf(rbox(0.02, 0.14, 0.48, 0.01), [-3.18, 0.82, 0]))
    // Crates of mangoes: two layers, the front of the load under a tarp, the rest held with rope.
    const crate = []
    {
      const L = 0.74, Wc = 0.5, H = 0.34
      for (const z of [-Wc / 2, Wc / 2]) for (const y of [0.07, 0.24]) crate.push(xf(new THREE.BoxGeometry(L, 0.11, 0.022), [0, y, z]))
      for (const x of [-L / 2, L / 2]) for (const y of [0.07, 0.24]) crate.push(xf(new THREE.BoxGeometry(0.022, 0.11, Wc), [x, y, 0]))
      for (const x of [-L / 2, L / 2]) for (const z of [-Wc / 2, Wc / 2]) crate.push(xf(new THREE.BoxGeometry(0.045, H, 0.045), [x, H / 2, z]))
      crate.push(xf(new THREE.BoxGeometry(L, 0.02, Wc), [0, 0.01, 0]))
    }
    const crateGeo = mergeGeometries(crate.map(norm))
    const cx = [-2.75, -1.97, -1.19, -0.41, 0.37], cz = [-0.56, 0, 0.56]
    const mangoes = []
    const mr = rng(6)
    for (let l = 0; l < 2; l++) for (let a = 0; a < 5; a++) for (let b = 0; b < 3; b++) {
      const y0 = 1.1 + l * 0.35
      const g = crateGeo.clone(); g.rotateY((hash(a, b + l * 3) - 0.5) * 0.05)
      g.translate(cx[a] + (hash(b, a) - 0.5) * 0.03, y0, cz[b] + (hash(a + 3, b) - 0.5) * 0.02)
      K.add(wood, g)
      if (l === 1 && a < 3) for (let m = 0; m < 5; m++) for (let n = 0; n < 4; n++) {
        mangoes.push({ x: cx[a] - 0.29 + m * 0.145 + (mr() - 0.5) * 0.02, y: y0 + 0.27 + mr() * 0.02, z: cz[b] - 0.18 + n * 0.12 + (mr() - 0.5) * 0.02, yaw: Math.PI / 2 + (mr() - 0.5) * 0.5, roll: (mr() - 0.5) * 0.4, ripe: 0.15 + mr() * 0.8, s: 0.088 + mr() * 0.012 })
      }
    }
    // Tarp over the front two columns, draped down the sides, with a rolled edge.
    {
      const x0 = -0.84, x1 = 0.8, top = 1.82, half = 0.86, drop = 0.48
      const g = new THREE.PlaneGeometry(1, 1, 18, 30)
      const p = g.attributes.position
      const pathLen = drop * 2 + half * 2
      for (let j = 0; j < p.count; j++) {
        const u = p.getX(j) + 0.5, v = p.getY(j) + 0.5
        const s = v * pathLen
        let y, z
        if (s < drop) { z = -half - 0.06; y = top - drop + s } else if (s < drop + half * 2) { z = -half + (s - drop); y = top + 0.03 * Math.sin(((s - drop) / (half * 2)) * Math.PI) } else { z = half + 0.06; y = top - (s - drop - half * 2) }
        const x = lerp(x0, x1, u)
        const sag = Math.sin(u * Math.PI * 2) * 0.02 + Math.sin(v * 31 + u * 7) * 0.012
        p.setXYZ(j, x, y + sag - (Math.abs(z) > half ? 0 : 0.02 * Math.sin(u * 9)), z + (Math.abs(z) > half ? Math.sign(z) * sag : 0))
      }
      g.computeVertexNormals()
      K.add(tarp, g)
      K.add(tarp, xf(new THREE.CylinderGeometry(0.1, 0.1, 1.86, 14), [x0 - 0.04, top + 0.06, 0], [Math.PI / 2, 0, 0]))
      for (const x of [-0.4, 0.4]) K.add(rope, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(x, 1.42, -0.99), V(x, top + 0.02, -0.9), V(x, top + 0.06, 0), V(x, top + 0.02, 0.9), V(x, 1.42, 0.99)]), 20, 0.016, 5))
    }
    // Ropes across the open crates.
    for (const x of [-2.75, -1.97, -1.19]) K.add(rope, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(x, 1.42, -0.99), V(x, 1.8, -0.84), V(x, 1.84, 0), V(x, 1.8, 0.84), V(x, 1.42, 0.99)]), 20, 0.015, 5))
    for (const s of [1, -1]) K.add(rope, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-3.15, 1.45, s * 0.8), V(-3.0, 1.82, s * 0.6), V(-2.0, 1.84, 0), V(-1.0, 1.84, -s * 0.55), V(-0.85, 1.83, -s * 0.8)]), 30, 0.014, 5))
    this.truckMeshes = K.build(body)
    for (const m of this.truckMeshes) if (m.material === this.glassSide || m.material === this.decalMat) m.castShadow = false
    const mc = mangoCrowd(mangoes, this.tier.name === 'high' ? 0.14 : 0.11)
    mc.castShadow = false; body.add(mc)
    const ss = 0.16, straw = strawMesh(Math.round(220 * this.tier.particles + 40), -3.1 / ss, -0.84 / ss, -0.8 / ss, 0.8 / ss, 1.7 / ss, 9, 0.06 / ss)
    straw.scale.setScalar(ss); straw.castShadow = false; body.add(straw)

    // Wheels: instanced (tyres, cream rims, gold hubs), so all four cost three draws; front pair steers.
    const tread = canvasTex(512, 64, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.fillStyle = '#202020'; for (let x = 0; x < w; x += 16) { g.fillRect(x, 0, 5, h * 0.45); g.fillRect(x + 8, h * 0.55, 5, h * 0.45) } }, { repeat: true, srgb: false })
    tread.repeat.set(2, 1)
    const rubber = enhance(new THREE.MeshStandardMaterial({ color: '#1b1a19', roughness: 0.92, bumpMap: tread, bumpScale: 2 }), 'atm', A)
    const tyre = new THREE.TorusGeometry(0.33, 0.14, 14, 40); tyre.scale(1, 1, 1.05)
    const rim = mergeGeometries([norm(xf(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 28), [0, 0, 0], [Math.PI / 2, 0, 0])), norm(xf(new THREE.CylinderGeometry(0.2, 0.25, 0.04, 28), [0, 0, 0.11], [Math.PI / 2, 0, 0])), norm(xf(new THREE.CylinderGeometry(0.2, 0.25, 0.04, 28), [0, 0, -0.11], [-Math.PI / 2, 0, 0]))])
    const hubParts = [norm(xf(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 18), [0, 0, 0], [Math.PI / 2, 0, 0]))]
    for (const zz of [0.13, -0.13]) {
      hubParts.push(norm(xf(new THREE.TorusGeometry(0.215, 0.014, 6, 32), [0, 0, zz])))
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; hubParts.push(norm(xf(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6), [Math.cos(a) * 0.15, Math.sin(a) * 0.15, zz], [Math.PI / 2, 0, 0]))) }
    }
    const hub = mergeGeometries(hubParts)
    this.wheelMeshes = [new THREE.InstancedMesh(tyre, rubber, 4), new THREE.InstancedMesh(rim, cream, 4), new THREE.InstancedMesh(hub, gold, 4)]
    for (const m of this.wheelMeshes) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; root.add(m) }
    this.wheelPos = [[2.35, 0.47, 0.82, 1], [2.35, 0.47, -0.82, 1], [-1.6, 0.47, 0.82, 0], [-1.6, 0.47, -0.82, 0]]

    // Lights: the headlamp beams (a spot light for the road and soft volumetric cones in the haze), dust in the beams,
    // the cab's warm interior light, a cool fill from our side for the night, the route's gold glow.
    this.heads = [V(3.78, 1.2, 0.69), V(3.78, 1.2, -0.69)]
    this.coneU = { uOp: { value: 0 }, uTime: { value: 0 }, uDist: { value: 0 } }
    const coneG = new THREE.ConeGeometry(2.4, 17, 32, 1, true); coneG.rotateZ(Math.PI / 2); coneG.translate(8.5, 0, 0)
    const coneM = new THREE.ShaderMaterial({
      uniforms: this.coneU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: NOISE + /* glsl */ `uniform float uOp, uTime, uDist; varying vec3 vL; varying vec3 vN; varying vec3 vV;
        void main(){
          float k = clamp(vL.x / 17., 0., 1.);
          float f = abs(dot(normalize(vN), normalize(vV)));
          float n = mmNoise(vec3((vL.x + uDist) * .35, vL.y * 1.2 + uTime * .15, vL.z * 1.2));
          float a = pow(1. - k, 1.7) * smoothstep(0., .05, k) * pow(f, 2.2) * (.45 + .9 * n);
          gl_FragColor = vec4(vec3(1., .86, .62) * a * .075 * uOp, 1.);
        }`,
    })
    for (const h of this.heads) { const cone = new THREE.Mesh(coneG, coneM); cone.position.copy(h); cone.rotation.z = -0.035; cone.renderOrder = 5; body.add(cone) }
    this.spot = new THREE.SpotLight('#ffe2b0', 0, 70, 0.52, 0.65, 1.3)
    this.spot.position.set(3.85, 1.2, 0); this.spot.target.position.set(22, -0.6, 0)
    body.add(this.spot, this.spot.target)
    this.cabLight = new THREE.PointLight('#ffb468', 0, 2.6, 2); this.cabLight.position.set(1.95, 2.35, 0.1); body.add(this.cabLight)
    this.fill = new THREE.PointLight('#8ea8ff', 0, 12, 1.5); this.fill.position.set(0.2, 4.2, 5.2); root.add(this.fill)
    this.routeLight = new THREE.PointLight('#ffb02a', 0, 7, 1.6); this.routeLight.position.set(-4.2, 0.4, 0); root.add(this.routeLight)
    // Dust motes drifting through the beams (stationary in the world, so they stream past as the truck drives).
    {
      const n = Math.round(160 * this.tier.particles), p = new Float32Array(n * 3), r = rng(17)
      for (let k = 0; k < n; k++) p.set([r() * 16, 0.15 + r() * 2.3, (r() - 0.5) * 4.4], k * 3)
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      const m = new THREE.ShaderMaterial({
        uniforms: { ...this.coneU, uPx: this.flyU ? this.flyU.uPx : { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `uniform float uDist, uTime, uPx; varying float vB;
          void main(){ vec3 q = position; q.x = 3.9 + mod(position.x - uDist, 16.); q.y += sin(uTime * .7 + position.z * 3.) * .08;
            vec4 mv = modelViewMatrix * vec4(q, 1.); gl_Position = projectionMatrix * mv;
            float rad = .25 + q.x * .13; vec2 off = vec2(q.y - 1.2 + q.x * .03, abs(q.z) - .69);
            vB = exp(-dot(off, off) / (rad * rad)) * (1. - smoothstep(10., 19., q.x)) * smoothstep(3.9, 5., q.x);
            gl_PointSize = (1.5 + 26. / -mv.z) * uPx; }`,
        fragmentShader: 'uniform float uOp; varying float vB; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); gl_FragColor = vec4(vec3(1., .9, .7) * a * vB * uOp * 1.4, 1.); }',
      })
      const dust = new THREE.Points(g, m); dust.frustumCulled = false; body.add(dust)
    }
    // Road dust lifting off the rear wheels and hanging behind: lit gold against a low sun, red in the tail lights.
    {
      const n = Math.round(220 * this.tier.particles + 30), sd = new Float32Array(n * 4), r = rng(29)
      for (let k = 0; k < n * 4; k++) sd[k] = r()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4))
      this.dustU = { uTime: { value: 0 }, uOp: { value: 0 }, uCol: { value: new THREE.Color() }, uPx: { value: 1 }, uNear: { value: 0 } }
      const m = new THREE.ShaderMaterial({
        uniforms: this.dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute vec4 aSeed; uniform float uTime, uPx, uNear; varying float vA;
          void main(){ float a = fract(uTime * (.22 + aSeed.w * .1) + aSeed.x);
            float side = aSeed.y < .5 ? -1. : 1.;
            vec3 q = vec3(-3.0 - a * (9. + aSeed.z * 5.), .15 + a * (1.1 + aSeed.w * 1.6), side * (.5 + a * (1.2 + aSeed.z * 2.6)) + (aSeed.z - .5) * .6);
            vec4 mv = modelViewMatrix * vec4(q, 1.); gl_Position = projectionMatrix * mv;
            vA = smoothstep(0., .18, a) * (1. - a);
            gl_PointSize = min((300. + a * 1500.) * uPx / -mv.z, 220. * uPx) * (1. - uNear * .45); }`,
        fragmentShader: 'uniform vec3 uCol; uniform float uOp; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); a = exp(-d * d * 14.); gl_FragColor = vec4(uCol * a * vA * uOp * .12, 1.); }',
      })
      const dust = new THREE.Points(g, m); dust.frustumCulled = false; dust.renderOrder = 4; body.add(dust)
    }
    return root
  }

  // ---------------------------------------------------------------------------------------------------------------------
  /** Where the truck is along the road (0..1) at chapter time t. */
  uAt(t) { return lerp(0.03, 0.94, smoother(-0.2, 1.0, t) * 0.25 + clamp((t + 0.2) / 1.2) * 0.75) }

  palette(t) {
    const S = this.states, o = this.st
    let k = 0; while (k < S.length - 2 && t > S[k + 1][0]) k++
    const [t0, a] = S[k], [t1, b] = S[k + 1], f = smooth(t0, t1, t)
    for (const key in o) { if (o[key].isColor) o[key].copy(a[key]).lerp(b[key], f); else o[key] = lerp(a[key], b[key], f) }
    return o
  }

  camKey(t) {
    // A cubic through the keys whose slope at each key is taken from its two neighbours AND the time between them, so
    // the camera's speed is the same on both sides of every key. (The old blend assumed the keys were evenly spaced in
    // time; they are not, so the speed stepped at each one, by the ratio of the two gaps.)
    const K = this.camKeys, n = K.length
    let k = 0; while (k < n - 2 && t > K[k + 1][0]) k++
    const t1 = K[k][0], t2 = K[k + 1][0], h = t2 - t1, s = clamp((t - t1) / h)
    const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2
    const out = []
    for (let c = 1; c < 7; c++) {
      const p1 = K[k][c], p2 = K[k + 1][c]
      const m1 = k > 0 ? (p2 - K[k - 1][c]) / (t2 - K[k - 1][0]) : (p2 - p1) / h
      const m2 = k + 2 < n ? (K[k + 2][c] - p1) / (K[k + 2][0] - t1) : (p2 - p1) / h
      out.push(h00 * p1 + h10 * h * m1 + h01 * p2 + h11 * h * m2)
    }
    return out
  }

  update(i, tt, time) {
    const t = clamp(tt, -0.2, 1)
    const st = this.palette(t)
    const night = smooth(0.2, 0.38, t) * (1 - smooth(0.6, 0.76, t))
    const dawn = smooth(0.62, 0.9, t)

    // ---- Sun, moon and sky.
    const eDusk = lerp(0.13, -0.06, smooth(0.1, 0.4, t)), eDawn = lerp(-0.1, 0.15, smooth(0.58, 0.98, t))
    // after sunset the afterglow swings into the frame of the blue-hour shot
    const azD = Math.atan2(-0.37, -0.93) - 0.53 + 0.62 * smooth(0.25, 0.34, t)
    this.azD = azD
    const sunDusk = this._a.set(Math.cos(azD) * Math.cos(eDusk), Math.sin(eDusk), Math.sin(azD) * Math.cos(eDusk)).normalize()
    const sunDawn = this._b.set(0.88 * Math.cos(eDawn), Math.sin(eDawn), -0.47 * Math.cos(eDawn)).normalize()
    const isDawn = t > 0.45
    this.sun.copy(isDawn ? sunDawn : sunDusk)
    const su = this.sky.userData.u
    const blueK = smooth(0.2, 0.27, t) * (1 - smooth(0.36, 0.42, t))
    su.uTop.value.copy(st.top); su.uHor.value.copy(st.hor); su.uBot.value.copy(st.fog).multiplyScalar(0.5)
    su.uStars.value = st.stars; su.uTime.value = time
    su.uSunDir.value.copy(this.sun)
    const sunUp = isDawn ? smooth(-0.1, 0.02, eDawn) : smooth(-0.1, 0.02, eDusk)
    su.uSunCol.value.setRGB(1, isDawn ? lerp(0.6, 0.78, dawn) : 0.6, isDawn ? lerp(0.32, 0.48, dawn) : 0.32).multiplyScalar(Math.max(sunUp, blueK * 0.85))
    // blue hour: the afterglow stays as a deep orange band low over the sunset
    su.uSunGlow.value = Math.max(sunUp * 0.6, 0.3 * (1 - night), blueK * 1.1)
    su.uCloudCol.value.copy(st.cloud); su.uCloudShade.value.copy(st.cloudSh)

    // Atmosphere.
    const A = this.atmU
    A.uFogCol.value.copy(st.fog); A.uSunFogCol.value.copy(st.sunFog).lerp(st.fog, night)
    A.uSunW.value.copy(this.sun); A.uATime.value = time
    A.uFogDen.value = lerp(0.0026, 0.0034, night) + dawn * 0.0004
    A.uMist.value = smooth(0.58, 0.72, t) * (1 - smooth(0.92, 1.0, t) * 0.5) * 0.9 + night * 0.55
    A.uMistH.value = lerp(lerp(-1, -3.5, night), 1.5, smooth(0.56, 0.8, t))
    const blue = smooth(0.24, 0.3, t) * (1 - smooth(0.36, 0.42, t)) // blue hour
    this.ridgeU.forEach((u, L) => { u.uC.value.copy(st.ridge).lerp(st.fog, lerp([0.25, 0.5, 0.72][L], [0.06, 0.16, 0.28][L], blue)); u.uF.value.copy(st.fog); u.uMistK.value = A.uMist.value; u.uRim.value = blue * [1, 0.45, 0.2][L] })
    // Water mirrors the sky.
    this.waterU.uTop.value.copy(st.top); this.waterU.uHor.value.copy(st.hor); this.waterU.uTime.value = time
    this.waterU.uSunC.value.copy(su.uSunCol.value)
    this.waterU.uMoonW.value.copy(this.moonDir)

    // Key light: the sun at either end, the moon in between.
    const L = this.sunL
    const wMoon = smooth(0.2, 0.36, t) * (1 - smooth(0.62, 0.74, t))
    const sunLit = this._c.copy(this.sun); sunLit.y = Math.max(isDawn ? 0.16 : 0.13, sunLit.y); sunLit.normalize()
    const keyDir = this._d.copy(sunLit).lerp(this.moonDir, wMoon).normalize()
    L.color.copy(st.keyC); L.intensity = st.keyI
    this.sunViewU.uKeyCol.value.copy(st.keyC).multiplyScalar(lerp(0.9, 0.5, night))
    this.hemi.color.copy(st.hemiS); this.hemi.groundColor.copy(st.hemiG); this.hemi.intensity = st.hemiI
    this.scene.environment = night > 0.5 ? this.envNight : t < 0.45 ? this.envDusk : this.envDawn
    this.scene.environmentIntensity = lerp(1, 0.8, night)
    const moonVis = smooth(0.2, 0.34, t) * (1 - smooth(0.66, 0.8, t))
    this.moon.visible = moonVis > 0.01
    this.moon.material.opacity = moonVis
    this.waterU.uMoonK.value = moonVis

    // ---- The truck along the road.
    const u = this.uAt(t), dist = u * this.roadLen
    const P = this.curve.getPointAt(u, this.tmp)
    const Tn = this.curve.getTangentAt(u, this.tng)
    const side0 = this.side.set(-Tn.z, 0, Tn.x).normalize()
    P.addScaledVector(side0, LANE)
    const du = 0.006
    const ta = this.curve.getTangentAt(clamp(u - du), this._a), tb = this.curve.getTangentAt(clamp(u + du), this._b)
    const yawA = Math.atan2(-ta.z, ta.x), yawB = Math.atan2(-tb.z, tb.x)
    let dyaw = yawB - yawA; if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2
    const curv = dyaw / (2 * du * this.roadLen)
    const tr = this.truck
    tr.position.copy(P)
    const yaw = Math.atan2(-Tn.z, Tn.x), pitch = Math.asin(clamp(Tn.y, -0.5, 0.5))
    tr.rotation.order = 'YZX'
    tr.rotation.set(0, yaw, pitch)
    // Suspension: bounce over the road, a little pitch, roll outward in the bends; the engine's idle shiver.
    const b = this.body
    b.position.y = 0.022 * Math.sin(dist * 1.3) + 0.01 * Math.sin(dist * 3.7 + 2) + 0.003 * Math.sin(time * 37)
    b.rotation.z = 0.006 * Math.sin(dist * 1.1 + 1)
    b.rotation.x = clamp(curv * 1.6, -0.045, 0.045) + 0.004 * Math.sin(dist * 2.3)
    const steer = clamp(Math.atan(curv * 3.95), -0.35, 0.35)
    const M = this._m || (this._m = new THREE.Matrix4()), q = this._q || (this._q = new THREE.Quaternion()), one = V(1, 1, 1)
    const qs = this._qs || (this._qs = new THREE.Quaternion())
    this.wheelPos.forEach(([x, y, z, front], k) => {
      q.setFromAxisAngle(V(0, 1, 0), front ? steer : 0)
      qs.setFromAxisAngle(V(0, 0, 1), -dist / 0.47)
      q.multiply(qs)
      M.compose(V(x, y, z), q, one)
      for (const m of this.wheelMeshes) m.setMatrixAt(k, M)
    })
    for (const m of this.wheelMeshes) m.instanceMatrix.needsUpdate = true
    this.routeU.uProg.value = u; this.routeU.uTime.value = time
    this.routeU.uGlow.value = 0.35 + night * 1.1

    // Lights on the truck.
    const lightsOn = smooth(-0.08, 0.1, t)
    const dark = night
    this.coneU.uOp.value = lightsOn * lerp(0.35, 1, Math.max(dark, smooth(0.22, 0.3, t) * 0.7)) * (1 - dawn * 0.55)
    this.coneU.uTime.value = time; this.coneU.uDist.value = dist
    this.lensMat.emissiveIntensity = 0.6 + lightsOn * lerp(2.2, 4.5, dark)
    this.spot.intensity = lightsOn * lerp(80, 900, Math.max(dark, smooth(0.22, 0.3, t) * 0.75))
    this.cabLight.intensity = 0.3 + dark * 1.0 // a soft glow in the cab, not a white bar on the visor
    this.glassSide.emissiveIntensity = dark * 0.12
    this.glassFront.emissiveIntensity = dark * 0.05
    this.fill.intensity = dark * 16
    this.routeLight.intensity = 0.5 + dark * 5
    this.tailMat.emissiveIntensity = 0.8 + lightsOn * 2.2
    this.tailGlowMat.color.setRGB(1, 0.1, 0.05).multiplyScalar(lightsOn * lerp(0.15, 0.55, Math.max(dark, smooth(0.22, 0.32, t))) * (1 - dawn * 0.7))
    this.amberMat.emissiveIntensity = 0.25 + dark * 0.45 // three small amber lamps, not one white bar of bloom
    this.decalMat.emissiveIntensity = dark * 0.16; this.tailDecal.emissiveIntensity = dark * 0.16
    this.flyU.uTime.value = time; this.flyU.uOp.value = night * 2.2; this.flyU.uPx.value = this.engine.dpr || 1
    this.glowU.uOp.value = lerp(0.15, 1.3, night) * (1 - dawn * 0.8) * smooth(-0.1, 0.2, t); this.glowU.uPx.value = this.engine.dpr || 1
    // dust behind the truck: gold when we look into the low sun, red in the tail lights at night
    {
      const dv = this._d2 || (this._d2 = V()); this.camera.getWorldDirection(dv)
      const into = Math.pow(Math.max(0, dv.dot(this.sun)), 2)
      this.dustU.uTime.value = time; this.dustU.uPx.value = this.engine.dpr || 1
      this.dustU.uCol.value.copy(st.keyC).multiplyScalar(0.3 + into * 1.0).lerp(this._cc || (this._cc = new THREE.Color(0.5, 0.06, 0.03)), night * 0.8)
      this.dustU.uOp.value = lerp(1, 0.55, night) * (1 - smooth(0.62, 0.8, t) * 0.6)
    }
    // the night sky: a milky band, crisp stars, one shooting star
    su.uMilky.value = night; su.uStarK.value = 1.2
    su.uMeteor.value = clamp((t - 0.468) / 0.018)
    su.uCloudSun.value = 1 - night * 0.7
    this.winMat.color.setRGB(1, 0.62, 0.3).multiplyScalar(lerp(0.12, 3.2, Math.max(night, 1 - smooth(-0.2, 0.1, t) * 0.7) * (1 - dawn * 0.75)))
    // village windows come on one by one at dusk (and stay on until dawn dims them all)
    if (this.winBase) {
      const cw = this._cw || (this._cw = new THREE.Color())
      for (let j = 0; j < this.winBase.length; j++) {
        const b0 = this.winBase[j]; if (b0 < 0.3) continue
        const on = t > 0.6 ? 1 : smooth(this.winOn[j], this.winOn[j] + 0.012, t)
        this.wins.setColorAt(j, cw.setScalar(b0 * (0.06 + 0.94 * on)))
      }
      this.wins.instanceColor.needsUpdate = true
    }
    this.glowU.uT.value = t
    this.lampMat.color.setRGB(3, 2.2, 1.2).multiplyScalar((0.06 + smooth(0.3, 0.315, t) * 1.24) * (1 - dawn * 0.6))

    // ---- The camera: one continuous move around the truck. A smoothed heading keeps it steady through the bends.
    const ua = clamp(u - 0.05), ub = clamp(u + 0.05)
    const F = this.F.copy(this.curve.getPointAt(ub, this._a)).sub(this.curve.getPointAt(ua, this._b)); F.y = 0; F.normalize()
    const Sd = this.S.set(-F.z, 0, F.x)
    let [ang, d, h, ft, th, ts] = this.camKey(t)
    // On a tall screen keep the truck in the middle of the frame (above the type) and stand back a little.
    const hw0 = smoother(0.74, 0.87, t)
    if (this.camera.aspect < 1) { ft *= 0.3; ts *= 0.2; d *= lerp(1.3, 1, hw0); h *= lerp(1.15, 1, hw0) }
    const ar = THREE.MathUtils.degToRad(ang)
    tr.updateMatrixWorld(true)
    // Where the driver's head is with the truck's body at rest. The body rocks and bounces on its springs with every
    // metre of road; aiming a close camera at a point on it made the whole picture twitch with the suspension. Aimed at
    // the still point, the camera holds steady and the driver moves a little inside the frame, as he would.
    const head = this.head.copy(this.heads[0])
    { const by = b.position.y, bx = b.rotation.x, bz = b.rotation.z; b.position.y = 0; b.rotation.x = 0; b.rotation.z = 0; b.updateMatrixWorld(true); b.localToWorld(head); b.position.y = by; b.rotation.x = bx; b.rotation.z = bz; b.updateMatrixWorld(true) }
    const cam = this.camPos.copy(P).addScaledVector(F, -Math.cos(ar) * d).addScaledVector(Sd, Math.sin(ar) * d)
    cam.y = P.y + h
    // Clear of the ground, eased: the camera rises to stay above a bank before it reaches it and settles after, instead
    // of following the ground's exact outline the moment it touches it.
    const gnd = this.groundAt(cam.x, cam.z) + 0.7
    cam.y = 0.5 * (cam.y + gnd + Math.sqrt((cam.y - gnd) * (cam.y - gnd) + 0.36))
    const hw = smoother(0.74, 0.87, t)
    const tgt = this.camTgt.copy(P).addScaledVector(F, ft).addScaledVector(Sd, ts).add(V(0, th, 0)).lerp(head, hw)
    aim(this.camera, cam, tgt, 0)
    this.camera.updateMatrixWorld()
    // Birds over the sunrise.
    const bvD = smooth(-0.02, 0.04, t) * (1 - smooth(0.26, 0.3, t))
    const bv = Math.max(smooth(0.74, 0.82, t), bvD)
    this.birds.visible = bv > 0
    if (bv > 0) {
      const fc = this._c
      if (bvD > 0) {
        // a flock crossing in front of the sun, a long way off, heading home
        const hz = this._e2 || (this._e2 = V()); hz.set(this.sun.x, 0, this.sun.z).normalize()
        const lat = this._f2 || (this._f2 = V()); lat.set(-hz.z, 0, hz.x)
        fc.copy(this.camera.position).addScaledVector(hz, 130).addScaledVector(lat, lerp(-90, 70, (t + 0.02) / 0.3)).add(V(0, 14 + t * 20, 0))
      } else fc.copy(this.curve.getPointAt(0.97)).add(V(-60 + (t - 0.74) * 400, 22 + Math.sin(time * 0.3) * 2, -40))
      this.birdOff.forEach((o, k) => {
        q.setFromAxisAngle(V(0, 1, 0), 0.3 + Math.sin(time * 0.5 + k) * 0.15)
        M.compose(fc.clone().add(o).add(V(Math.sin(time * 0.9 + k) * 1.2, Math.sin(time * 1.3 + k * 2) * 0.6, 0)), q, V(1.3, 1.3, 1.3))
        this.birds.setMatrixAt(k, M)
      })
      this.birds.instanceMatrix.needsUpdate = true
    }

    this.sky.position.copy(cam)
    // The moon: a disc far away in its direction, always facing us.
    this.moon.position.copy(cam).addScaledVector(this.moonDir, 800)
    {
      const az = this.azD + 0.3, el = 0.085
      this.eveStar.position.copy(cam).add(this._e2 ? this._e2.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(700) : V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(700))
      this.starU.uOp.value = smooth(0.24, 0.29, t) * (1 - smooth(0.42, 0.5, t)); this.starU.uPx.value = this.engine.dpr || 1; this.starU.uTime.value = time
      this.eveStar.visible = this.starU.uOp.value > 0.01
    }
    this.moon.scale.setScalar(95)
    this.moon.lookAt(cam)

    // Shadows follow the truck; the frustum widens for the high wide shot.
    const camDist = cam.distanceTo(P)
    // the dust trail only shows once the camera has pulled back; close overhead it is a faint wisp
    this.dustU.uOp.value *= lerp(0.18, 1, smooth(11, 24, camDist)); this.dustU.uNear.value = 1 - smooth(11, 24, camDist)
    const half = clamp(camDist * 2.0, 16, 95)
    const sc2 = L.shadow.camera
    if (sc2.right !== half) { sc2.left = -half; sc2.right = half; sc2.top = half; sc2.bottom = -half; sc2.near = 1; sc2.far = 500; sc2.updateProjectionMatrix() }
    L.target.position.copy(P).addScaledVector(F, camDist > 30 ? -camDist * 0.4 : 0)
    L.position.copy(L.target.position).addScaledVector(keyDir, 220)

    // Depth of field, focus point for the iris, look.
    const focusPt = hw > 0.5 ? head : P
    this.post.focus = cam.distanceTo(focusPt)
    this.post.range = lerp(lerp(26, 14, smooth(0.15, 0.4, t)), 2.2, hw)
    this.post.dof = lerp(lerp(3, 1.1, night), 10, hw)
    if (t < 0.3) { this.focus.set(-1.6, 1.8, 0); this.body.localToWorld(this.focus) } else this.focus.copy(head)

    this.look.bloom = lerp(0.5, 0.95, night) + hw * 0.15
    // shafts from the low sun through the trees and poles at either end; the headlamps at night
    const golden = 1 - smooth(0.22, 0.32, t), dawnRays = smooth(0.74, 0.86, t)
    this.look.rays = Math.max(golden * 0.42, dawnRays * 0.4)
    // on tall screens the low sun sits in the top corner, right behind the logo: hold its flare down there
    if (this.camera.aspect < 1) { this.look.rays *= 0.45; this.look.bloom *= 1 - 0.35 * golden; su.uSunGlow.value *= 1 - 0.45 * golden }
    this.look.rayThreshold = 1.5
    this.look.rayTint.copy(st.keyC).lerp(this._w || (this._w = new THREE.Color(1, 0.9, 0.75)), 0.4)
    this.rayFrom = null
    this.look.threshold = lerp(0.92, 0.72, night)
    this.look.exposure = st.exp
    this.look.vig = lerp(0.45, 0.65, night)
    const coolLift = 1 - smooth(0.2, 0.32, t) * (1 - smooth(0.7, 0.85, t))
    this.grade([lerp(0.012, 0.004, night) - coolLift * 0.008, lerp(0.006, 0.01, night) + coolLift * 0.004, lerp(0.0, 0.03, night) + coolLift * 0.016], [1.03, 1.0, lerp(0.94, 1.04, night)], lerp(1.06, 0.95, night))
  }
}
