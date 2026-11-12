// Shared props for the crate, road and packing sets: wood and kraft textures, instanced straw, instanced mangoes of
// varied ripeness, low-poly orchard trees, and a helper that orients a Hand from a finger direction and a palm normal.
import * as THREE from 'three'
import { canvasTex, rng, lerp, SERIF, SANS } from '../lib/util.js'
import { mangoGeometry, mangoMaterial, barkTexture } from '../lib/mango.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

let woodCache = null
export function woodTexture() {
  if (woodCache) return woodCache
  woodCache = canvasTex(512, 128, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H)
    grd.addColorStop(0, '#c58b52'); grd.addColorStop(0.5, '#b07940'); grd.addColorStop(1, '#9a6534')
    g.fillStyle = grd; g.fillRect(0, 0, W, H)
    const r = rng(21)
    for (let i = 0; i < 70; i++) {
      const y = r() * H, a = 0.05 + r() * 0.16
      g.strokeStyle = r() < 0.7 ? `rgba(70,38,14,${a})` : `rgba(255,220,170,${a * 0.8})`
      g.lineWidth = 0.6 + r() * 1.8
      g.beginPath(); g.moveTo(0, y)
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * (2 + r() * 3))
      g.stroke()
    }
    for (let i = 0; i < 4; i++) { const x = r() * W, y = r() * H; g.fillStyle = 'rgba(60,30,10,.35)'; g.beginPath(); g.ellipse(x, y, 7 + r() * 6, 3 + r() * 2, 0, 0, 7); g.fill() }
    const img = g.getImageData(0, 0, W, H), d = img.data
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n }
    g.putImageData(img, 0, 0)
  }, { repeat: true })
  return woodCache
}

/** Kraft cardboard with fibres; optional draw callback for printing on top. */
export function kraftTexture(w = 1024, h = 512, print = null, seed = 5) {
  const tex = canvasTex(w, h, (g, W, H) => drawKraft(g, W, H, print, seed), { aniso: 8 })
  // Redraw once the brand fonts are ready, so the wordmark is in Young Serif / Figtree.
  if (print && document.fonts) {
    Promise.all([document.fonts.load(`700 40px Figtree`), document.fonts.load(`400 40px 'Young Serif'`)]).then(() => {
      const g = tex.image.getContext('2d'); drawKraft(g, tex.image.width, tex.image.height, print, seed); tex.needsUpdate = true
    }).catch(() => {})
  }
  return tex
}
function drawKraft(g, W, H, print, seed) {
  g.fillStyle = '#c49a64'; g.fillRect(0, 0, W, H)
  const r = rng(seed)
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = r() < 0.5 ? `rgba(120,80,40,${0.05 + r() * 0.12})` : `rgba(235,200,150,${0.05 + r() * 0.1})`
    g.lineWidth = 0.6 + r()
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 4 + r() * 14
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke()
  }
  const grd = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7)
  grd.addColorStop(0, 'rgba(255,230,190,.08)'); grd.addColorStop(1, 'rgba(80,50,20,.18)')
  g.fillStyle = grd; g.fillRect(0, 0, W, H)
  if (print) print(g, W, H)
}

/** "VMR Mangoes" wordmark: two stacked lines, the O of MANGOES a little mango. */
export function drawWordmark(g, cx, cy, size, color = '#174631') {
  g.save()
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  g.font = `800 ${size}px ${SANS}`
  g.fillText('VMR', cx, cy - size * 0.08)
  const t2 = 'MANGOES', w2 = g.measureText(t2).width
  g.fillText(t2, cx, cy + size * 0.86)
  // A small gold mango over the O.
  const ox = cx - w2 / 2 + g.measureText('MANG').width + g.measureText('O').width / 2, oy = cy + size * 0.52
  g.fillStyle = '#ffb81f'
  g.beginPath(); g.ellipse(ox, oy, size * 0.27, size * 0.36, -0.35, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#3d7a2a'; g.beginPath(); g.ellipse(ox + size * 0.2, oy - size * 0.42, size * 0.15, size * 0.06, -0.6, 0, Math.PI * 2); g.fill()
  g.restore()
}

/** Instanced straw strands over a rectangle (x0..x1, z0..z1) around height y, plus optional drape over edges. */
export function strawMesh(n, x0, x1, z0, z1, y, seed = 3, spread = 0.35) {
  const geo = new THREE.CylinderGeometry(0.022, 0.016, 1, 5, 1)
  geo.rotateZ(Math.PI / 2) // along x
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0, envMapIntensity: 0.6 })
  const m = new THREE.InstancedMesh(geo, mat, n)
  const r = rng(seed), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color()
  const tones = ['#e9c66a', '#cf9f40', '#f6df98', '#b98a34', '#ddb357']
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(x0 + r() * (x1 - x0), y + Math.pow(r(), 1.6) * spread, z0 + r() * (z1 - z0))
    q.setFromEuler(e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.6))
    const L = 0.6 + r() * 1.4
    M.compose(p, q, new THREE.Vector3(L, 1 + r() * 0.6, 1 + r() * 0.6))
    m.setMatrixAt(i, M)
    m.setColorAt(i, c.set(tones[Math.floor(r() * tones.length)]).multiplyScalar(0.85 + r() * 0.3))
  }
  m.castShadow = true; m.receiveShadow = true
  return m
}

/** A flat straw bed texture (seen through gaps between strands). */
export function strawBedTexture() {
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#9a7432'; g.fillRect(0, 0, W, H)
    const r = rng(8), tones = ['#e9c66a', '#cf9f40', '#f6df98', '#a97a2c', '#7a5a22']
    for (let i = 0; i < 2600; i++) {
      g.strokeStyle = tones[Math.floor(r() * tones.length)]; g.globalAlpha = 0.5 + r() * 0.5; g.lineWidth = 1 + r() * 2.5
      const x = r() * W, y = r() * H, a = r() * Math.PI * 2, l = 20 + r() * 60
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 10, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 10, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke()
    }
    g.globalAlpha = 1
  }, { repeat: true })
}

/** Mangoes lying on their sides, varied ripeness (instanced, aRipe per instance). items: [{x,y,z,yaw,ripe,s}] */
export function mangoCrowd(items, detail = 0.6) {
  const geo = mangoGeometry(detail)
  const ripe = new Float32Array(items.length)
  items.forEach((it, i) => { ripe[i] = it.ripe })
  geo.setAttribute('aRipe', new THREE.InstancedBufferAttribute(ripe, 1))
  const mat = mangoMaterial({ instanced: true })
  mat.sheen = 0.2
  const m = new THREE.InstancedMesh(geo, mat, items.length)
  m.castShadow = true; m.receiveShadow = true
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
  items.forEach((it, i) => {
    q.setFromEuler(e.set(it.rx ?? Math.PI / 2, it.yaw, it.roll ?? 0, 'YXZ'))
    m.setMatrixAt(i, M.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3().setScalar(it.s || 1)))
  })
  return m
}

/** Low-poly trees: lumpy flat-shaded canopies on short trunks. items: [{x,y,z,s}] */
export function treeCrowd(items, { canopy = '#2e5a24', trunk = '#4a3422', seed = 4, lumpy = 0.22 } = {}) {
  const g = new THREE.IcosahedronGeometry(1, 2)
  const p = g.attributes.position, r = rng(seed), v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = 1 + (Math.sin(v.x * 5.3 + v.y * 2.1) * Math.cos(v.z * 4.7 - v.y * 3.3)) * lumpy
    p.setXYZ(i, v.x * n * 1.25, v.y * n * 0.82 + 0.1, v.z * n * 1.25)
  }
  g.computeVertexNormals()
  const cm = new THREE.MeshStandardMaterial({ color: canopy, roughness: 0.9, flatShading: true })
  const tg = new THREE.CylinderGeometry(0.12, 0.2, 1, 6); tg.translate(0, 0.5, 0)
  const tm = new THREE.MeshStandardMaterial({ color: trunk, roughness: 1 })
  const can = new THREE.InstancedMesh(g, cm, items.length), tr = new THREE.InstancedMesh(tg, tm, items.length)
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color()
  items.forEach((it, i) => {
    const s = it.s || 1
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28)
    can.setMatrixAt(i, M.compose(new THREE.Vector3(it.x, it.y + s * 1.55, it.z), q, new THREE.Vector3(s, s * (0.85 + r() * 0.3), s)))
    can.setColorAt(i, c.setRGB(0.8 + r() * 0.4, 0.85 + r() * 0.3, 0.75 + r() * 0.3))
    tr.setMatrixAt(i, M.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(s * 1.2, s * 1.1, s * 1.2)))
  })
  can.castShadow = true; can.receiveShadow = true; tr.castShadow = true
  const grp = new THREE.Group(); grp.add(can, tr)
  grp.userData.canopy = can
  return grp
}

/** A Hand's orientation from a finger direction and an approximate palm normal (both world). */
export function handQuat(finger, palm) {
  const f = finger.clone().normalize()
  const n = palm.clone(); n.sub(f.clone().multiplyScalar(n.dot(f))).normalize()
  const x = new THREE.Vector3().crossVectors(n, f)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, f))
}

/** Bouncy settle: 0 → 1 with a small rebound. */
export const settle = (t) => {
  t = Math.min(1, Math.max(0, t))
  if (t < 0.6) { const k = t / 0.6; return k * k }
  const k = (t - 0.6) / 0.4
  return 1 - Math.sin(k * Math.PI) * 0.06 * (1 - k)
}

// ---- The orchard at golden hour (chapter 6) -------------------------------------------------------------------------
// Real-sized mango trees (the crate's units: a mango is about 1.7 tall, so a tree is a hundred and more): a buttressed
// trunk splitting low into heavy limbs, a dense dome made of rounded clumps, each clump a handful of cupped cards painted
// with whorls of long drooping leaves; fruit hanging under the skirt. Lit like the tree chapter: each card takes its
// clump's rounded normal blended with the dome's, inner cards are darker, the rim glows yellow-green with the sun behind.

let whorlCache = null
/** One whorl of long, narrow, drooping mango leaves, as data: R = shade, G = leaf id, A = cut-out. */
export function whorlTexture() {
  if (whorlCache) return whorlCache
  whorlCache = canvasTex(512, 512, (g) => {
    const r = rng(77)
    const leaf = (cx, cy, a, L, id, front) => {
      const d = [Math.sin(a), Math.cos(a)]
      const c1 = [cx + d[0] * L * 0.55, cy + d[1] * L * 0.55]
      const bd = [d[0], d[1] + 1.1]; const bl = Math.hypot(bd[0], bd[1])
      const e = [c1[0] + (bd[0] / bl) * L * 0.5, c1[1] + (bd[1] / bl) * L * 0.5]
      const P = (s) => [(1 - s) * (1 - s) * cx + 2 * (1 - s) * s * c1[0] + s * s * e[0], (1 - s) * (1 - s) * cy + 2 * (1 - s) * s * c1[1] + s * s * e[1]]
      const Tn = (s) => { const x = 2 * (1 - s) * (c1[0] - cx) + 2 * s * (e[0] - c1[0]), y = 2 * (1 - s) * (c1[1] - cy) + 2 * s * (e[1] - c1[1]); const l = Math.hypot(x, y) || 1; return [x / l, y / l] }
      const wh = L * (0.1 + r() * 0.03), N = 22, base = 0.16 + front * 0.14
      const w = (s) => wh * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 0.85) * (1 - 0.2 * s)
      for (const side of [1, -1]) {
        g.beginPath()
        for (let i = 0; i <= N; i++) { const p = P(i / N); g.lineTo(p[0], p[1]) }
        for (let i = N; i >= 0; i--) { const s = i / N, p = P(s), t = Tn(s), ww = w(s) * side; g.lineTo(p[0] - t[1] * ww, p[1] + t[0] * ww) }
        g.closePath()
        const k = side > 0 ? 0.1 : -0.08
        const gr = g.createLinearGradient(cx, cy, e[0], e[1])
        const col = (v) => `rgb(${Math.round(Math.min(1, Math.max(0, v + k)) * 255)},${id},0)`
        gr.addColorStop(0, col(base)); gr.addColorStop(0.45, col(base + 0.48)); gr.addColorStop(1, col(base + 0.34))
        g.fillStyle = gr; g.fill()
        g.strokeStyle = `rgb(${Math.round(base * 0.6 * 255)},${id},0)`; g.lineWidth = 1.2; g.stroke()
      }
    }
    const whorl = (cx, cy, n, sc, front) => {
      const W = []
      for (let k = 0; k < n; k++) { const a = (k / n - 0.5) * Math.PI * 2 * 0.78 + (r() - 0.5) * 0.35; W.push({ a, len: (78 + r() * 40) * sc, id: Math.round(20 + r() * 230), down: Math.cos(a) }) }
      W.sort((A, B) => A.down - B.down)
      for (const l of W) leaf(cx, cy, l.a, Math.min(l.len, l.down < 0 ? 70 * sc : 125 * sc), l.id, Math.min(1, Math.max(0, front + 0.35 * l.down)))
    }
    whorl(150, 190, 8, 0.85, 0.15); whorl(362, 200, 8, 0.85, 0.2); whorl(256, 120, 12, 1.15, 0.55); whorl(256, 300, 7, 0.75, 0.05)
  }, { srgb: false, aniso: 8 })
  return whorlCache
}

/** Foliage: cupped cards lit with their clump's and the dome's rounded normals, translucent against the sun. */
export function foliageMaterial() {
  const U = { uTime: { value: 0 }, uWind: { value: 0.35 }, uCrownR: { value: new THREE.Vector3(62, 30, 62) }, uSunView: { value: new THREE.Vector3(0, 0, -1) }, uSunCol: { value: new THREE.Color(1, 0.7, 0.4) }, uTint: { value: new THREE.Color(1, 1, 1) } }
  const m = new THREE.MeshStandardMaterial({ map: whorlTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, envMapIntensity: 0.5 })
  m.userData.u = U
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aClump; attribute vec4 aCrown; uniform float uTime; uniform float uWind; uniform vec3 uCrownR; varying vec3 vF; varying vec3 vGN;`)
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        vec3 cwp = (modelMatrix * instanceMatrix * vec4(position, 1.)).xyz;
        vec3 cN = normalize(cwp - aClump.xyz + vec3(0., .0001, 0.));
        vec3 kq = (cwp - aCrown.xyz) / (uCrownR * aCrown.w);
        vec3 kN = normalize(kq + vec3(0., .0001, 0.));
        vec3 Nw = normalize(mix(cN, kN, .5));
        vec3 gN = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));
        gN *= dot(gN, Nw) < 0. ? -1. : 1.;
        vGN = normalize((viewMatrix * vec4(gN, 0.)).xyz);
        Nw = normalize(Nw + gN * .16);
        vec3 objectNormal = transpose(mat3(instanceMatrix)) * (transpose(mat3(modelMatrix)) * Nw);
        float cd = length(cwp - aClump.xyz) / max(aClump.w, .01);
        vF.x = mix(.3, 1., smoothstep(.1, .95, cd)) * mix(.4, 1., .5 + .5 * cN.y) * mix(.45, 1., smoothstep(.55, 1., length(kq)));
        vF.y = smoothstep(.62, 1.02, length(kq));
        vF.z = fract(aClump.x * .137 + aClump.z * .071);`)
      .replace('#include <project_vertex>', /* glsl */ `
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.);
        vec4 wp = modelMatrix * mvPosition;
        float wph = dot(wp.xyz, vec3(.05, .03, .07));
        wp.xyz += vec3(sin(uTime * 1.1 + wph), sin(uTime * 1.7 + wph) * .3, cos(uTime * .9 + wph)) * uWind * (.5 + vF.y);
        mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = wp;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol; uniform vec3 uTint; varying vec3 vF; varying vec3 vGN;')
      .replace('#include <map_fragment>', /* glsl */ `
        vec4 tx = texture2D(map, vMapUv);
        diffuseColor.a *= tx.a;
        float lsh = tx.r, lid = tx.g;
        vec3 gD = vec3(.010, .030, .008), gM = vec3(.034, .10, .018), gL = vec3(.15, .25, .035);
        vec3 alb = lsh < .5 ? mix(gD, gM, lsh * 2.) : mix(gM, gL, lsh * 2. - 1.);
        float jit = fract(lid * 17.31);
        alb *= .8 + .4 * jit;
        alb = mix(alb, vec3(.16, .2, .03) * (.5 + lsh), step(.9, fract(lid * 5.13)) * .7);
        alb = mix(alb, vec3(.2, .08, .03) * (.5 + lsh), step(.96, fract(lid * 3.7 + vF.z)) * .8);
        alb *= uTint;
        diffuseColor.rgb *= alb * mix(1., vF.x, .8);`)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = gl_FrontFacing ? 1. : -1.; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(.1));')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 Vd = normalize(vViewPosition), Ls = normalize(uSunView);
          float rim = pow(1. - clamp(dot(normal, Vd), 0., 1.), 2.);
          float back = pow(clamp(dot(-Vd, Ls), 0., 1.), 2.2);
          totalEmissiveRadiance += alb * vec3(1.5, 1.6, .4) * uSunCol * back * (.25 + rim * 1.6) * (.2 + .8 * vF.y) * vF.x * 2.2;
          vec3 gn = normalize(normalize(vGN) + vec3(fract(lid * 13.7) - .5, fract(lid * 29.3) - .5, 0.) * .7);
          float spec = pow(clamp(dot(gn, normalize(Vd + Ls)), 0., 1.), 120.) * step(0., dot(gn, Ls));
          totalEmissiveRadiance += uSunCol * spec * .5 * (.4 + lsh) * vF.x * tx.a;
        }`)
  }
  m.customProgramCacheKey = () => 'orchardFoliage'
  return m
}

function cardGeo(seg = 2) {
  const g = new THREE.PlaneGeometry(1, 1, seg, seg), p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -(x * x + y * y) * 0.35) }
  g.computeVertexNormals()
  return g
}
/** An orthonormal frame whose +z faces n and whose +y is as close to world-up as it can be. */
function faceQuat(n, roll = 0) {
  const z = n.clone().normalize()
  let up = new THREE.Vector3(0, 1, 0)
  if (Math.abs(z.y) > 0.92) up = new THREE.Vector3(1, 0, 0)
  const x = new THREE.Vector3().crossVectors(up, z).normalize()
  const y = new THREE.Vector3().crossVectors(z, x)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll))
}
/** A tapering tube along points (uv kept: u along, v around). */
export function taperTube(pts, r0, r1, segs = 12, rad = 7) {
  const c = new THREE.CatmullRomCurve3(pts)
  const g = new THREE.TubeGeometry(c, segs, 1, rad, false)
  const pp = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv, pt = new THREE.Vector3()
  for (let i = 0; i < pp.count; i++) { const t = uv.getX(i); c.getPointAt(Math.min(1, t), pt); const rr = r0 + (r1 - r0) * Math.pow(t, 0.8); pp.setXYZ(i, pt.x + nn.getX(i) * rr, pt.y + nn.getY(i) * rr, pt.z + nn.getZ(i) * rr) }
  g.computeVertexNormals()
  const len = c.getLength() / 24
  for (let i = 0; i < uv.count; i++) { const u0 = uv.getX(i), v0 = uv.getY(i); uv.setXY(i, v0 * Math.max(1, Math.round(r0)), u0 * len) }
  g.userData.curve = c
  return g
}

const CROWN_C = new THREE.Vector3(0, 64, 0), CROWN_R = new THREE.Vector3(62, 30, 62)
/** One tree's skeleton (merged tubes), its clumps and where its fruit hangs, in tree space. */
function protoTree(seed, lite = false) {
  const q = lite ? 0.55 : 1, sg = (n) => Math.max(3, Math.round(n * q))
  const r = rng(seed), V = (x, y, z) => new THREE.Vector3(x, y, z)
  const tubes = [], clumps = [], fruit = []
  const fork = V((r() - 0.5) * 6, 17 + r() * 6, (r() - 0.5) * 6)
  tubes.push(taperTube([V(0, -3, 0), V(fork.x * 0.25, 7, fork.z * 0.25), fork], 5.2, 3.4, sg(10), sg(9)))
  for (let k = 0; k < 5; k++) { const a = k * 1.3 + r(); tubes.push(taperTube([V(0, 4, 0), V(Math.cos(a) * 5.5, 0.6, Math.sin(a) * 5.5), V(Math.cos(a) * 9, -1.5, Math.sin(a) * 9)], 2.2, 0.4, sg(5), sg(6))) }
  const nL = 4 + (r() < 0.5 ? 1 : 0)
  for (let k = 0; k < nL; k++) {
    const a = (k / nL) * Math.PI * 2 + r() * 0.6, out = 24 + r() * 16, up = 24 + r() * 14
    const end = fork.clone().add(V(Math.cos(a) * out, up, Math.sin(a) * out))
    const mid = fork.clone().lerp(end, 0.45).add(V(0, -4 + r() * 2, 0))
    const lg = taperTube([fork.clone().add(V(0, -1, 0)), mid, end], 3.0, 1.2, sg(12), sg(7))
    tubes.push(lg)
    const c = lg.userData.curve
    for (let j = 0; j < 3; j++) {
      const at = c.getPointAt(0.45 + j * 0.2), aa = a + (r() - 0.5) * 1.8
      const d = V(Math.cos(aa), 0.15 + r() * 0.7, Math.sin(aa)).normalize()
      const tgt = CROWN_C.clone().add(d.clone().multiply(CROWN_R).multiplyScalar(0.82))
      const m2 = at.clone().lerp(tgt, 0.5).add(V(0, -2 + r() * 3, 0))
      tubes.push(taperTube([at, m2, tgt], 1.2, 0.35, sg(8), sg(5)))
    }
  }
  const N = 46
  for (let i = 0; i < N; i++) {
    const y = 1 - ((i + 0.5) / N) * 1.62, rad = Math.sqrt(Math.max(0, 1 - y * y)), ph = i * 2.39996 + r() * 0.4
    const d = V(Math.cos(ph) * rad, y, Math.sin(ph) * rad)
    const sh = 0.8 + r() * 0.22
    const p = CROWN_C.clone().add(d.clone().multiply(CROWN_R).multiplyScalar(sh))
    p.y += Math.max(0, -d.y) * -6 // the skirt droops
    clumps.push({ p, rad: 15 + r() * 7, d })
    if (d.y < 0.05 && r() < 0.55) {
      const n = 1 + Math.floor(r() * 2.4)
      for (let k = 0; k < n; k++) fruit.push({ p: p.clone().add(V((r() - 0.5) * 12, -9 - r() * 6, (r() - 0.5) * 12)), ripe: 0.3 + r() * 0.55, yaw: r() * 6.28, roll: (r() - 0.5) * 0.3 })
    }
  }
  for (let i = 0; i < 9; i++) { const ph = r() * 6.28; clumps.push({ p: CROWN_C.clone().add(V(Math.cos(ph) * 28, (r() - 0.3) * 14, Math.sin(ph) * 28)), rad: 16, d: V(Math.cos(ph), 0, Math.sin(ph)) }) }
  return { geo: mergeGeometries(tubes), clumps, fruit }
}

/** An orchard of trees: items [{x, z, s, rot}] (s ≈ 1). Returns a group; group.userData.foliage is the card material. */
export function orchardTrees(items, { cards = 9, fruit = true, seed = 3, bark = '#8a7a66', shadow = true } = {}) {
  const grp = new THREE.Group()
  const protos = [protoTree(seed, !shadow), protoTree(seed + 11, !shadow), protoTree(seed + 23, !shadow)]
  const barkMat = new THREE.MeshStandardMaterial({ color: bark, roughness: 0.92, map: barkTexture() })
  const M = new THREE.Matrix4(), T = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0)
  const r = rng(seed + 5)
  const byProto = protos.map(() => [])
  items.forEach((it, i) => byProto[i % 3].push(it))
  protos.forEach((P, k) => {
    if (!byProto[k].length) return
    const tm = new THREE.InstancedMesh(P.geo, barkMat, byProto[k].length)
    byProto[k].forEach((it, j) => tm.setMatrixAt(j, M.compose(sv.set(it.x, 0, it.z), q.setFromAxisAngle(Y, it.rot || 0), new THREE.Vector3().setScalar(it.s || 1))))
    tm.castShadow = shadow; tm.receiveShadow = true
    grp.add(tm)
  })
  // Cards.
  const L = []
  items.forEach((it, i) => {
    const P = protos[i % 3], s = it.s || 1
    T.compose(sv.set(it.x, 0, it.z), q.setFromAxisAngle(Y, it.rot || 0), new THREE.Vector3().setScalar(s))
    const nc = Math.max(3, Math.round(cards * (it.lod ?? 1)))
    for (const c of P.clumps) {
      const cw = c.p.clone().applyMatrix4(T), kw = CROWN_C.clone().applyMatrix4(T)
      for (let k = 0; k < nc; k++) {
        const off = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(c.rad * 0.9)
        const p = c.p.clone().add(off)
        const n = off.clone().normalize().multiplyScalar(0.6).add(c.d).add(new THREE.Vector3(0, 0.35, 0)).normalize()
        const size = c.rad * (1.15 + r() * 0.4) * (nc < cards ? Math.sqrt(cards / nc) * 0.85 : 1)
        const lm = new THREE.Matrix4().compose(p, faceQuat(n, (r() - 0.5) * 1.2 + (r() < 0.5 ? Math.PI : 0) * 0), new THREE.Vector3(size * (r() < 0.5 ? -1 : 1), size, size))
        L.push({ m: new THREE.Matrix4().multiplyMatrices(T, lm), c: [cw.x, cw.y, cw.z, c.rad * s], k: [kw.x, kw.y, kw.z, s] })
      }
    }
  })
  const fm = foliageMaterial()
  const cg = cardGeo(1)
  const aC = new Float32Array(L.length * 4), aK = new Float32Array(L.length * 4)
  L.forEach((l, i) => { aC.set(l.c, i * 4); aK.set(l.k, i * 4) })
  cg.setAttribute('aClump', new THREE.InstancedBufferAttribute(aC, 4))
  cg.setAttribute('aCrown', new THREE.InstancedBufferAttribute(aK, 4))
  const cm = new THREE.InstancedMesh(cg, fm, L.length)
  L.forEach((l, i) => cm.setMatrixAt(i, l.m))
  cm.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: whorlTexture(), alphaTest: 0.5 })
  cm.castShadow = shadow; cm.receiveShadow = true
  cm.frustumCulled = false
  grp.add(cm)
  grp.userData.foliage = fm
  grp.userData.cards = cm
  // Fruit hanging under the skirt.
  if (fruit) {
    const F = []
    items.forEach((it, i) => {
      if (it.fruit === false) return
      T.compose(sv.set(it.x, 0, it.z), q.setFromAxisAngle(Y, it.rot || 0), new THREE.Vector3().setScalar(it.s || 1))
      for (const f of protos[i % 3].fruit) { const p = f.p.clone().applyMatrix4(T); F.push({ x: p.x, y: p.y, z: p.z, rx: 0.08, yaw: f.yaw, roll: f.roll, ripe: f.ripe, s: 1.15 }) }
    })
    const fr = mangoCrowd(F, 0.1)
    fr.castShadow = false
    fr.frustumCulled = false
    grp.add(fr)
    grp.userData.fruit = fr
  }
  return grp
}

let plankCache = null
/** Weathered crate boards: several boards' grain, knots and darker ends in one strip (v picks a board). */
export function plankTexture() {
  if (plankCache) return plankCache
  plankCache = canvasTex(1024, 512, (g, W, H) => {
    const r = rng(41), rows = 8, bh = H / rows
    for (let b = 0; b < rows; b++) {
      const y0 = b * bh, tone = 0.85 + r() * 0.3
      const base = [Math.round(176 * tone), Math.round(128 * tone), Math.round(80 * tone)]
      const grd = g.createLinearGradient(0, y0, 0, y0 + bh)
      grd.addColorStop(0, `rgb(${base[0] - 18},${base[1] - 16},${base[2] - 12})`); grd.addColorStop(0.5, `rgb(${base[0]},${base[1]},${base[2]})`); grd.addColorStop(1, `rgb(${base[0] - 26},${base[1] - 22},${base[2] - 16})`)
      g.fillStyle = grd; g.fillRect(0, y0, W, bh)
      // grain: long wavering lines, bunching round knots
      const knots = Array.from({ length: 1 + Math.floor(r() * 2.5) }, () => [r() * W, y0 + bh * (0.25 + r() * 0.5), 5 + r() * 7])
      for (let i = 0; i < 46; i++) {
        const yy = y0 + r() * bh, a = 0.06 + r() * 0.2
        g.strokeStyle = r() < 0.75 ? `rgba(70,40,18,${a})` : `rgba(255,226,180,${a * 0.7})`
        g.lineWidth = 0.6 + r() * 1.6
        g.beginPath()
        for (let x = 0; x <= W; x += 16) {
          let dy = Math.sin(x * 0.006 + i) * 2.2
          for (const k of knots) { const dx = x - k[0], dd = yy - k[1]; dy += Math.sign(dd || 1) * k[2] * 2.2 * Math.exp(-(dx * dx) / 900 - (dd * dd) / 120) }
          g.lineTo(x, Math.min(y0 + bh - 1, Math.max(y0 + 1, yy + dy)))
        }
        g.stroke()
      }
      for (const k of knots) {
        const kg = g.createRadialGradient(k[0], k[1], 0, k[0], k[1], k[2] * 1.4)
        kg.addColorStop(0, 'rgba(45,24,10,.9)'); kg.addColorStop(0.6, 'rgba(80,44,18,.6)'); kg.addColorStop(1, 'rgba(80,44,18,0)')
        g.fillStyle = kg; g.beginPath(); g.ellipse(k[0], k[1], k[2] * 1.8, k[2], 0, 0, 7); g.fill()
      }
      // a crack, weathered ends, a hairline gap between boards
      if (r() < 0.6) { g.strokeStyle = 'rgba(30,16,6,.55)'; g.lineWidth = 1.2; g.beginPath(); let x = r() * W * 0.3, yy = y0 + bh * (0.3 + r() * 0.4); g.moveTo(x, yy); for (let s = 0; s < 14; s++) { x += 8 + r() * 10; yy += (r() - 0.5) * 2; g.lineTo(x, yy) } g.stroke() }
      for (const end of [0, W]) { const eg = g.createLinearGradient(end, 0, end === 0 ? 60 : W - 60, 0); eg.addColorStop(0, 'rgba(40,22,8,.45)'); eg.addColorStop(1, 'rgba(40,22,8,0)'); g.fillStyle = eg; g.fillRect(end === 0 ? 0 : W - 60, y0, 60, bh) }
      g.fillStyle = 'rgba(255,236,200,.18)'; g.fillRect(0, y0 + 1, W, 2)
      g.fillStyle = 'rgba(30,16,6,.5)'; g.fillRect(0, y0 + bh - 2, W, 2)
    }
    const img = g.getImageData(0, 0, W, H), d = img.data
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n }
    g.putImageData(img, 0, 0)
  }, { repeat: true, aniso: 8 })
  return plankCache
}

/** Straw for the crate: thin flattened ribbons, each bent once, that glow gold when the sun is behind them. */
export function strawStrands(n, x0, x1, z0, z1, y, { seed = 3, spread = 0.35, len = [0.7, 1.6], tilt = 0.5 } = {}) {
  const g = new THREE.PlaneGeometry(1, 0.05, 4, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, -x * x * 0.35 + Math.sin(x * 9) * 0.01); p.setY(i, p.getY(i) * (1 - Math.abs(x) * 0.4)) }
  g.rotateX(Math.PI / 2 * 0.8)
  g.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.7 })
  const u = { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uSunCol: { value: new THREE.Color(1, 0.7, 0.4) } }
  mat.userData.u = u
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 3.);
          float rim = pow(1. - abs(dot(normal, Vd)), 3.);
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (back * .9 + rim * .35); }`)
  }
  mat.customProgramCacheKey = () => 'strawRibbon'
  const m = new THREE.InstancedMesh(g, mat, n)
  const r = rng(seed), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color()
  const tones = ['#e9c66a', '#cf9f40', '#f6df98', '#b98a34', '#ddb357', '#f0d488', '#a87a2a']
  for (let i = 0; i < n; i++) {
    const pp = new THREE.Vector3(x0 + r() * (x1 - x0), y + Math.pow(r(), 1.6) * spread, z0 + r() * (z1 - z0))
    q.setFromEuler(e.set((r() - 0.5) * tilt, r() * Math.PI * 2, (r() - 0.5) * tilt * 1.2))
    const L = len[0] + r() * (len[1] - len[0])
    M.compose(pp, q, new THREE.Vector3(L, 1 + r() * 0.8, 1))
    m.setMatrixAt(i, M)
    m.setColorAt(i, c.set(tones[Math.floor(r() * tones.length)]).multiplyScalar(0.8 + r() * 0.35))
  }
  m.castShadow = true; m.receiveShadow = true
  return m
}

/** A woven basket (open top), radius r, height h; a lathe with a painted weave. */
export function basketMesh(rad = 1, h = 1, seed = 2) {
  const pts = []
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(rad * (0.72 + 0.28 * Math.sin(t * Math.PI * 0.55)) * (1 + 0.04 * Math.sin(t * 30)), t * h)) }
  pts.push(new THREE.Vector2(rad * 1.04, h * 1.02), new THREE.Vector2(rad * 0.96, h * 1.02))
  const g = new THREE.LatheGeometry(pts, 28)
  const tex = canvasTex(256, 128, (c, W, H) => {
    c.fillStyle = '#7a5428'; c.fillRect(0, 0, W, H)
    const r = rng(seed)
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 16) {
      const o = (y / 8) % 2 ? 8 : 0
      c.fillStyle = `rgb(${170 + r() * 40},${120 + r() * 30},${60 + r() * 20})`
      c.beginPath(); c.ellipse(x + o + 4, y + 4, 7, 3.2, 0, 0, 7); c.fill()
    }
    c.fillStyle = 'rgba(60,36,14,.5)'; for (let x = 0; x < W; x += 16) c.fillRect(x + 7, 0, 2, H)
  }, { repeat: true })
  tex.repeat.set(4, 2)
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }))
  m.castShadow = true; m.receiveShadow = true
  return m
}

/** Out-of-focus discs of light: flat discs with a brighter rim, gold, green-gold and white. */
export function bokehDiscs(n, box, { size = 2, seed = 1, opacity = 0.5 } = {}) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), a = new Float32Array(n * 4)
  const r = rng(seed)
  for (let i = 0; i < n; i++) {
    p.set([lerp(box.min.x, box.max.x, r()), lerp(box.min.y, box.max.y, r()), lerp(box.min.z, box.max.z, r())], i * 3)
    a.set([0.5 + r(), r() * 6.28, r(), r()], i * 4)
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(a, 4))
  const u = { uTime: { value: 0 }, uSize: { value: size }, uOp: { value: opacity }, uPx: { value: 1 }, uSlow: { value: 1 }, uCol: { value: new THREE.Color(1, 0.86, 0.55) }, uCol2: { value: new THREE.Color(0.7, 0.95, 0.4) }, uDrift: { value: 0.6 } }
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: u,
    vertexShader: /* glsl */ `attribute vec4 aS; uniform float uTime, uSize, uPx, uSlow, uDrift; varying vec4 vS;
      void main(){ vec3 q = position; float t = uTime * uSlow;
        q += vec3(sin(t * .21 + aS.y), sin(t * .17 + aS.y * 1.7), 0.) * uDrift;
        vec4 mv = modelViewMatrix * vec4(q, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uSize * aS.x * uPx * 600. / -mv.z, 220.); vS = aS; vS.w = .55 + .45 * sin(t * .6 + aS.y * 3.); }`,
    fragmentShader: /* glsl */ `uniform vec3 uCol, uCol2; uniform float uOp; varying vec4 vS;
      void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard;
        float disc = smoothstep(1., .86, d), rim = smoothstep(.62, .93, d) * disc;
        vec3 c = mix(uCol, vS.z < .3 ? uCol2 : vec3(1., .97, .88), step(.62, vS.z) + step(vS.z, .3));
        gl_FragColor = vec4(c * (disc * .45 + rim * .35) * uOp * vS.w, 1.); }`,
  })
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.userData.u = u
  return pts
}

export { SERIF, SANS }
