// Chapters 0 and 1: the seed. One continuous set, a cutaway of the ground like a diorama.
// 0 "One Mango": a mango stone in the warm dark, close, a gold hairline root just starting below it, spores drifting.
// 1 "It starts smaller than your thumb": the camera pulls back to the cut face of the soil (strata, pebbles); the
//   husk splits, a root system grows downward by scroll (tubes revealed by a growth front, gold tips), a shoot pushes
//   up, breaks the surface in a puff of soil and opens two bronze leaves against the dawn. The camera rises with it to
//   the low sun, which is the match point for the iris into the tree.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Stage, aim, skyDome, motes } from './stage.js'
import { leafGeometry, leafMaterial } from '../lib/mango.js'
import { NOISE, BUMP } from '../lib/glsl.js'
import { rng, smooth, smoother, lerp, clamp, easeOut } from '../lib/util.js'

const SEED = new THREE.Vector3(0, -3, 0.04)
const SEED_R = new THREE.Vector3(0.55, 0.85, 0.3)

// ---- Growing tubes (roots, the shoot): visible up to a growth front, pointed at the front, gold where it is new. ----
function growMaterial({ color = '#f4e8c8', old = '#c4a479', glow = '#ffb22e', glowAmt = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62 })
  const u = { uGrow: { value: 0 }, uC0: { value: new THREE.Color(color) }, uC1: { value: new THREE.Color(old) }, uGlow: { value: new THREE.Color(glow) }, uGlowAmt: { value: glowAmt } }
  m.userData.u = u
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aU; attribute float aBirth; attribute float aDur; attribute vec3 aAxis; uniform float uGrow; varying float vU; varying float vFront; varying float vAge;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float front = (uGrow - aBirth) / aDur;
        float tipK = clamp((front - aU) / .07, 0., 1.);
        transformed = aAxis + (transformed - aAxis) * (.15 + .85 * sqrt(tipK));
        vU = aU; vFront = front; vAge = clamp(front - aU, 0., 3.);`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uC0; uniform vec3 uC1; uniform vec3 uGlow; uniform float uGlowAmt; varying float vU; varying float vFront; varying float vAge;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vU > vFront || vFront <= 0.) discard;
        diffuseColor.rgb = mix(uC0, uC1, smoothstep(.1, 1.2, vAge));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * (exp(-vAge * 30.) * 1.8 + exp(-vAge * 2.5) * .45 + .07) * uGlowAmt;`)
  }
  m.customProgramCacheKey = () => 'grow'
  return m
}

/** Tube geometry along a curve with per-vertex growth attributes. */
function growTube(curve, r0, r1, birth, dur, segs = 32, rad = 6) {
  const g = new THREE.TubeGeometry(curve, segs, 1, rad, false)
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, cnt = p.count
  const aU = new Float32Array(cnt), aB = new Float32Array(cnt), aD = new Float32Array(cnt), aA = new Float32Array(cnt * 3)
  const pt = new THREE.Vector3()
  for (let i = 0; i < cnt; i++) {
    const t = uv.getX(i)
    curve.getPointAt(Math.min(1, t), pt)
    const r = lerp(r0, r1, Math.pow(t, 0.8))
    p.setXYZ(i, pt.x + n.getX(i) * r, pt.y + n.getY(i) * r, pt.z + n.getZ(i) * r)
    aU[i] = t; aB[i] = birth; aD[i] = dur
    aA[i * 3] = pt.x; aA[i * 3 + 1] = pt.y; aA[i * 3 + 2] = pt.z
  }
  g.setAttribute('aU', new THREE.BufferAttribute(aU, 1))
  g.setAttribute('aBirth', new THREE.BufferAttribute(aB, 1))
  g.setAttribute('aDur', new THREE.BufferAttribute(aD, 1))
  g.setAttribute('aAxis', new THREE.BufferAttribute(aA, 3))
  g.computeVertexNormals()
  return g
}

/** A procedural root system: a taproot and laterals that stay close to the cut face. Growth runs 0…1. */
function rootSystem(origin, r) {
  const list = []
  const grow = (start, dir, len, r0, birth, depth) => {
    const pts = [start.clone()], steps = 9, d = dir.clone().normalize(), p = start.clone()
    for (let k = 0; k < steps; k++) {
      d.x += (r() - 0.5) * 0.7; d.y += (r() - 0.5) * 0.3 - (depth === 0 ? 0.35 : 0.1); d.z += (r() - 0.5) * 0.3
      d.normalize()
      p.addScaledVector(d, len / steps)
      p.z = clamp(p.z * 0.5 + 0.03 + (r() - 0.3) * 0.06, 0.02, 0.14)
      pts.push(p.clone())
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const dur = len * 0.09
    list.push({ curve, r0, r1: r0 * 0.22, birth, dur, depth })
    if (depth >= 3) return
    const kids = depth === 0 ? 11 : depth === 1 ? 5 : 2
    for (let k = 0; k < kids; k++) {
      const u = 0.1 + (k + r() * 0.6) / kids * 0.8
      const at = curve.getPointAt(u), tan = curve.getTangentAt(u)
      const side = (k % 2 ? 1 : -1) * (0.7 + r() * 0.5)
      const nd = new THREE.Vector3(side, -0.25 - r() * 0.5, (r() - 0.5) * 0.3).add(tan.clone().multiplyScalar(0.2))
      grow(at, nd, len * (0.45 + r() * 0.22) * (1 - u * 0.4), r0 * 0.55, birth + dur * u, depth + 1)
    }
  }
  grow(origin, new THREE.Vector3(0.15, -1, 0), 9.5, 0.13, 0, 0)
  const end = Math.max(...list.map((l) => l.birth + l.dur))
  list.forEach((l) => { l.birth /= end; l.dur /= end })
  return list
}

export default class Seed extends Stage {
  constructor(engine) {
    super(engine)
    const sc = this.scene, T = this.tier, r = rng(23)
    this.fov = 30
    this.frame = [0, 0.13]
    this.framePortrait = [0, 0.16]
    this.parallax = 0.8

    // Dawn sky (only seen once we are up at the surface), fog on the horizon.
    this.sky = skyDome(); sc.add(this.sky)
    const su = this.sky.userData.u
    su.uClouds.value = 0.4; su.uHaze.value = 0.45; su.uSunSize.value = 0.08; su.uCloudSpeed.value = 0.002
    this.sunDir = new THREE.Vector3(0.1, 0.045, -1).normalize()
    su.uSunDir.value.copy(this.sunDir)
    sc.fog = new THREE.Fog('#d68a58', 40, 260)

    // ---- The cut face of the soil: strata, pebbles, grain; lit by a warm glow near the seed.
    const wallM = new THREE.MeshStandardMaterial({ roughness: 0.95, color: '#ffffff' })
    wallM.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE}\n${BUMP}`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          float wy = vW.y + (mmFbm(vec3(vW.x * .12, vW.y * .25, 1.)) - .5) * 2.4 + sin(vW.x * .18) * .5;
          vec3 humus = vec3(.03, .02, .012), loam = vec3(.12, .06, .028), laterite = vec3(.34, .11, .04), clay = vec3(.5, .36, .18), deep = vec3(.06, .045, .035);
          vec3 c = humus;
          c = mix(c, loam, smoothstep(-.6, -1.6, wy));
          c = mix(c, laterite, smoothstep(-4.2, -4.8, wy));
          c = mix(c, clay, smoothstep(-7.2, -7.5, wy) * (1. - smoothstep(-8.6, -8.9, wy)));
          c = mix(c, laterite * .7, smoothstep(-8.6, -8.9, wy));
          c = mix(c, deep, smoothstep(-11., -13., wy));
          c = mix(c, clay * .8, smoothstep(-1.6, -1.8, wy) * (1. - smoothstep(-2.0, -2.2, wy)) * .5);
          c *= .7 + .6 * mmFbm(vW * vec3(1.6, 3.2, 1.6));
          float band = sin(wy * 9. + mmNoise(vW * 2.) * 3.) * .5 + .5;
          c *= .9 + .12 * band;
          vec2 pb = mmDots(vW * 2.2, .3);
          c = mix(c, vec3(.30, .26, .21) * (.6 + .6 * pb.y), pb.x * .8 * step(.55, pb.y));
          float specks = step(.93, mmNoise(vW * 38.));
          c += specks * vec3(.12, .1, .07);
          diffuseColor.rgb = c;
          float wH = mmFbm(vW * 7.) + pb.x * step(.55, pb.y) * .8;`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = mmBump(-vViewPosition, normal, wH, .02);')
    }
    wallM.customProgramCacheKey = () => 'soilwall'
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 40, 1, 1), wallM)
    wall.position.set(0, -20, 0); wall.receiveShadow = true
    sc.add(wall)
    // A lip of topsoil and grass along the cut edge, and the ground running back to the horizon.
    const groundM = new THREE.MeshStandardMaterial({ roughness: 1, color: '#ffffff' })
    groundM.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;')
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float n = mmFbm(vec3(vW.xz * .35, 2.)), m = mmFbm(vec3(vW.xz * 2.5, 5.));
          diffuseColor.rgb = mix(vec3(.07, .045, .025), vec3(.09, .14, .04), smoothstep(.35, .7, n)) * (.75 + .5 * m);`)
    }
    groundM.customProgramCacheKey = () => 'soiltop'
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 260, 1, 1), groundM)
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -130); ground.receiveShadow = true
    sc.add(ground)
    // Low hills on the horizon, as dark silhouettes against the dawn.
    const hillM = new THREE.MeshStandardMaterial({ color: '#1c2a17', roughness: 1, flatShading: true })
    for (let k = 0; k < 9; k++) {
      const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillM)
      h.scale.set(40 + r() * 50, 6 + r() * 9, 20)
      h.position.set(-170 + k * 42 + r() * 20, -2, -200 - r() * 40)
      sc.add(h)
    }
    // Tufts of grass on the lip.
    {
      const bl = new THREE.PlaneGeometry(0.05, 1, 1, 3); bl.translate(0, 0.5, 0)
      const bp = bl.attributes.position
      for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setX(i, bp.getX(i) * (1 - y)); bp.setZ(i, y * y * 0.25) }
      bl.computeVertexNormals()
      const n = Math.round(1400 * T.particles + 300)
      const gm = new THREE.MeshStandardMaterial({ color: '#4f6a28', roughness: 0.8, side: THREE.DoubleSide })
      this.grass = new THREE.InstancedMesh(bl, gm, n)
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), c = new THREE.Color()
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * 40, z = -Math.pow(r(), 1.6) * 30 - 0.02
        if (Math.abs(x) < 0.5 && z > -1) { i--; continue }
        q.setFromEuler(e.set((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5))
        sv.set(1 + r(), 0.15 + r() * 0.45, 1)
        this.grass.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), q, sv))
        this.grass.setColorAt(i, c.setRGB(0.7 + r() * 0.5, 0.75 + r() * 0.4, 0.5 + r() * 0.3))
      }
      sc.add(this.grass)
    }
    // Pebbles half-buried in the cut face.
    {
      const pg = new THREE.IcosahedronGeometry(1, 2), pp = pg.attributes.position, v = new THREE.Vector3()
      for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); v.multiplyScalar(1 + (Math.sin(v.x * 5) * Math.sin(v.y * 4 + v.z * 3)) * 0.12); pp.setXYZ(i, v.x, v.y, v.z) }
      pg.computeVertexNormals()
      const n = 120
      this.pebbles = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), n)
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color()
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * 30, y = -0.4 - Math.pow(r(), 0.9) * 18
        if (Math.hypot(x - SEED.x, (y - SEED.y) * 0.8) < 1.6) { i--; continue }
        const s = 0.06 + Math.pow(r(), 3) * 0.5
        q.setFromEuler(e.set(r() * 6, r() * 6, r() * 6))
        this.pebbles.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, (r() - 0.6) * s), q, new THREE.Vector3(s * (1 + r() * 0.6), s * (0.6 + r() * 0.4), s)))
        const g = 0.25 + r() * 0.35
        this.pebbles.setColorAt(i, c.setRGB(g * 1.15, g, g * 0.82))
      }
      this.pebbles.castShadow = true; this.pebbles.receiveShadow = true
      sc.add(this.pebbles)
    }

    // ---- The seed: a flat, fibrous husk in two halves hinged at the bottom, a pale kernel inside, a fuzz of fibres.
    this.seed = new THREE.Group(); this.seed.position.copy(SEED); this.seed.rotation.z = -1.1
    sc.add(this.seed)
    const huskM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, side: THREE.DoubleSide })
    this.huskU = { uTime: { value: 0 }, uRimK: { value: 1 } }
    huskM.onBeforeCompile = (s) => {
      s.uniforms.uRimK = this.huskU.uRimK
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvO = position;')
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vO;\n${NOISE}\n${BUMP}`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          float fib = mmNoise(vec3(vO.x * 34., vO.y * 2.6, vO.z * 34.)) * .6 + mmNoise(vec3(vO.x * 80., vO.y * 5., vO.z * 80.)) * .4;
          float mot = mmFbm(vO * 3.);
          vec3 c = mix(vec3(.36, .24, .12), vec3(.72, .56, .34), fib) * (.75 + .5 * mot);
          if (!gl_FrontFacing) c = mix(vec3(.62, .52, .34), vec3(.80, .70, .48), fib) * .9;
          diffuseColor.rgb = c;
          float hH = fib;`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = mmBump(-vViewPosition, normal, hH, .006);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { float fr = pow(1. - clamp(abs(dot(normal, normalize(vViewPosition))), 0., 1.), 3.); totalEmissiveRadiance += vec3(1., .5, .16) * fr * uRimK * (.6 + .4 * fib); }`)
        .replace('#include <common>', '#include <common>\nuniform float uRimK;')
    }
    huskM.customProgramCacheKey = () => 'husk'
    const half = (start) => {
      const g = new THREE.SphereGeometry(1, 40, 30, start, Math.PI)
      g.scale(SEED_R.x, SEED_R.y, SEED_R.z)
      // Pointed a little at the top, flattened at the seam.
      const p = g.attributes.position
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - 0.18 * Math.max(0, y / SEED_R.y) ** 2)) }
      g.translate(0, SEED_R.y, 0) // hinge at the bottom
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, huskM); m.castShadow = true; m.receiveShadow = true
      const piv = new THREE.Group(); piv.position.y = -SEED_R.y; piv.add(m)
      return piv
    }
    this.halfR = half(Math.PI / 2); this.halfL = half(-Math.PI / 2)
    this.seed.add(this.halfR, this.halfL)
    this.kernel = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: '#e8dfb0', roughness: 0.45, emissive: '#3a3010', emissiveIntensity: 0.4 }))
    this.kernel.scale.set(SEED_R.x * 0.82, SEED_R.y * 0.86, SEED_R.z * 0.62)
    this.seed.add(this.kernel)
    {
      // Fibres: short strands lying along the husk surface, catching the light.
      const n = 420, pos = new Float32Array(n * 6), v = new THREE.Vector3()
      for (let i = 0; i < n; i++) {
        const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1)
        v.set(Math.sin(ph) * Math.cos(th) * SEED_R.x, Math.cos(ph) * SEED_R.y, Math.sin(ph) * Math.sin(th) * SEED_R.z * 1.02)
        const L = 0.025 + r() * 0.05
        pos.set([v.x, v.y, v.z, v.x * (1 + L * 0.6) + (r() - 0.5) * 0.04, v.y + L * (r() < 0.5 ? 1 : -1), v.z * (1 + L * 0.8)], i * 6)
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.fibres = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c9a56c', transparent: true, opacity: 0.22 }))
      this.seed.add(this.fibres)
    }

    // ---- Roots and the shoot.
    const roots = rootSystem(new THREE.Vector3(SEED.x + 0.22, SEED.y - 0.42, 0.02), r)
    this.rootMat = growMaterial({})
    this.roots = new THREE.Mesh(mergeGeometries(roots.map((l) => growTube(l.curve, l.r0, l.r1, l.birth, l.dur, l.depth === 0 ? 64 : 24, l.depth === 0 ? 8 : 5))), this.rootMat)
    this.roots.castShadow = true; this.roots.frustumCulled = false
    sc.add(this.roots)
    this.rootList = roots
    // Root hairs: a fuzz along the older root, appearing a little behind the growth front.
    {
      const P = [], A = []
      const v = new THREE.Vector3(), tg = new THREE.Vector3(), nn = new THREE.Vector3()
      roots.forEach((l) => {
        const n = l.depth === 0 ? 70 : l.depth === 1 ? 26 : 10
        for (let k = 0; k < n; k++) {
          const u = 0.04 + r() * 0.9
          l.curve.getPointAt(u, v); l.curve.getTangentAt(u, tg)
          for (let h = 0; h < 2; h++) {
            nn.set(r() - 0.5, r() - 0.5, (r() - 0.5) * 0.4).cross(tg).normalize()
            const L = (0.03 + r() * 0.07) * (l.depth === 0 ? 1.4 : 1)
            const rr = lerp(l.r0, l.r1, Math.pow(u, 0.8))
            P.push(v.x + nn.x * rr, v.y + nn.y * rr, v.z + nn.z * rr, v.x + nn.x * (rr + L) + tg.x * L * 0.4, v.y + nn.y * (rr + L) + tg.y * L * 0.4, v.z + nn.z * (rr + L))
            A.push(l.birth, l.dur, u, r(), l.birth, l.dur, u, r())
          }
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('aG', new THREE.BufferAttribute(new Float32Array(A), 4))
      this.hairU = { uGrow: { value: 0 }, uOp: { value: 0.5 } }
      this.hairs = new THREE.LineSegments(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.hairU,
        vertexShader: `attribute vec4 aG; uniform float uGrow; varying float vA; void main(){ float front = (uGrow - aG.x) / aG.y;
          vA = smoothstep(aG.z + .03, aG.z + .12, front); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float uOp; varying float vA; void main(){ if (vA < .01) discard; gl_FragColor = vec4(vec3(1., .66, .36) * vA * uOp, 1.); }`,
      }))
      this.hairs.frustumCulled = false
      sc.add(this.hairs)
    }
    // A soft glow riding each growing root tip.
    {
      const n = roots.length, g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(n), 1))
      this.tipU = { uPx: { value: 1 }, uOp: { value: 1 } }
      this.tips = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.tipU,
        vertexShader: `attribute float aK; uniform float uPx; varying float vK; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vK = aK; gl_PointSize = aK > .001 ? (8. + 30. * aK) * uPx * 6. / -mv.z : 0.; }`,
        fragmentShader: `uniform float uOp; varying float vK; void main(){ vec2 c = gl_PointCoord - .5; float a = exp(-dot(c, c) * 22.) + exp(-dot(c, c) * 90.); gl_FragColor = vec4(vec3(1., .66, .22) * a * vK * uOp, 1.); }`,
      }))
      this.tips.frustumCulled = false
      sc.add(this.tips)
    }
    // The fungal network in the soil: soft luminous strands that branch out from round the seed and fade into the dark;
    // they wake, and carry slow beads of pale light, as the roots reach them.
    {
      const P = [], M = [], Wd = [], BP = [], BM = []
      const walk = (x, y, ang, steps, gen, w0) => {
        let px = x, py = y, d = 0, curl = (r() - 0.5) * 0.08
        for (let k = 0; k < steps; k++) {
          ang += (r() - 0.5) * 0.22 + curl + Math.sin(k * 0.23 + gen * 2.1) * 0.05
          const nx = px + Math.cos(ang) * 0.06, ny = py + Math.sin(ang) * 0.06
          if (ny > -0.35) { ang = -Math.abs(ang); continue }
          const dist = Math.hypot(px - SEED.x, (py - SEED.y) * 0.8), on = Math.min(1, dist / 9)
          const w = w0 * (1 - 0.6 * (k / steps)), z0 = 0.035 + gen * 0.012
          const dx = nx - px, dy = ny - py, l = Math.hypot(dx, dy), ox = (-dy / l) * w, oy = (dx / l) * w
          // a ribbon quad, soft across its width
          P.push(px - ox, py - oy, z0, px + ox, py + oy, z0, nx + ox, ny + oy, z0, px - ox, py - oy, z0, nx + ox, ny + oy, z0, nx - ox, ny - oy, z0)
          Wd.push(-1, 1, 1, -1, 1, -1)
          for (let j = 0; j < 6; j++) M.push(d + (j >= 4 || j === 2 ? 0.06 : 0), on, gen, dist)
          if (k % 2 === 0) { BP.push(px, py, z0 + 0.005); BM.push(d, on, gen, dist) }
          px = nx; py = ny; d += 0.06
          if (gen < 2 && r() < 0.05) walk(px, py, ang + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.7), Math.floor(steps * (0.35 + r() * 0.3)), gen + 1, w * 0.7)
        }
      }
      // threads leave the seed's neighbourhood outward, curling, thinning as they go
      const nT = Math.round(11 * (0.6 + 0.4 * T.particles))
      for (let i = 0; i < nT; i++) {
        const a = (i / nT) * Math.PI * 2 + r() * 0.5, rad = 0.9 + Math.pow(r(), 1.5) * 2.5
        walk(SEED.x + Math.cos(a) * rad, SEED.y + Math.sin(a) * rad * 0.8, a + (r() - 0.5) * 0.8, 60 + Math.floor(r() * 70), 0, 0.05 + r() * 0.025)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('aM', new THREE.BufferAttribute(new Float32Array(M), 4)); g.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(Wd), 1))
      this.mycU = { uTime: { value: 0 }, uWake: { value: 0 }, uBase: { value: 0.2 }, uOp: { value: 1 }, uPx: { value: 1 }, uReach: { value: 3 } }
      const pulse = 'float pulse = pow(.5 + .5 * sin(aM.x * 1.6 - uTime * 1.2 + aM.y * 40.), 24.);'
      const lit = 'float on = mix(uBase, 1., smoothstep(aM.y + .05, aM.y - .05, uWake)); float fade = exp(-aM.w * aM.w / (uReach * uReach));'
      this.myc = new THREE.Mesh(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: this.mycU,
        vertexShader: `attribute vec4 aM; attribute float aW; uniform float uTime, uWake, uBase, uReach; varying float vB; varying float vW;
          void main(){ ${lit} ${pulse}
            vB = (on * .09 + on * on * pulse * .9) * fade * (1. - aM.z * .25); vW = aW;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float uOp; varying float vB; varying float vW; void main(){ float c = exp(-vW * vW * 2.2); gl_FragColor = vec4(vec3(.55, .92, .7) * (c * .6 + pow(c, 8.) * .5) * vB * uOp, 1.); }`,
      }))
      this.myc.frustumCulled = false
      sc.add(this.myc)
      // the pulses themselves, as soft beads of light sliding along the strands
      const bg2 = new THREE.BufferGeometry()
      bg2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BP), 3)); bg2.setAttribute('aM', new THREE.BufferAttribute(new Float32Array(BM), 4))
      this.mycP = new THREE.Points(bg2, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.mycU,
        vertexShader: `attribute vec4 aM; uniform float uTime, uWake, uBase, uPx, uReach; varying float vB;
          void main(){ ${lit} ${pulse}
            vB = on * on * pulse * fade * (1. - aM.z * .3);
            vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = vB > .01 ? (6. + 14. * vB) * uPx : 0.; }`,
        fragmentShader: `uniform float uOp; varying float vB; void main(){ vec2 c = gl_PointCoord - .5; float a = exp(-dot(c, c) * 14.); gl_FragColor = vec4(vec3(.6, 1., .82) * a * vB * uOp * .4, 1.); }`,
      }))
      this.mycP.frustumCulled = false
      sc.add(this.mycP)
    }
    // Water beads seeping through the cut face, and flecks of mica that wink in the glow.
    {
      const n = 46, bg = new THREE.SphereGeometry(1, 12, 8)
      const sd = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) { let x, y; do { x = lerp(-7, 7, r()); y = lerp(-0.8, -9, r()) } while (Math.hypot(x - SEED.x, y - SEED.y) < 1.2); sd.set([x, y, 0.02 + r() * 0.04, r()], i * 4) }
      bg.setAttribute('aS', new THREE.InstancedBufferAttribute(sd, 4))
      this.beadU = { uTime: { value: 0 }, uOp: { value: 1 }, uGlow: { value: new THREE.Vector3() } }
      this.beads = new THREE.InstancedMesh(bg, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.beadU,
        vertexShader: `attribute vec4 aS; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vF; varying vec3 vW;
          void main(){ float ph = fract(uTime * (.012 + aS.w * .02) + aS.w * 7.); float s = (.025 + aS.w * .04) * smoothstep(0., .1, ph) * (1. - smoothstep(.85, 1., ph));
            vec3 c = vec3(aS.x, aS.y - ph * .9, aS.z); vec3 p = c + position * vec3(s, s * 1.25, s * .7);
            vec4 mv = modelViewMatrix * vec4(p, 1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vW = c; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uOp; uniform vec3 uGlow; varying vec3 vN; varying vec3 vV; varying vec3 vW;
          void main(){ vec3 n = normalize(vN), v = normalize(vV); float fr = pow(1. - clamp(dot(n, v), 0., 1.), 2.);
            float sp = pow(max(dot(reflect(-normalize(vec3(.5, .6, .6)), n), v), 0.), 70.);
            float near = 1. / (1. + .25 * dot(vW.xy - uGlow.xy, vW.xy - uGlow.xy));
            gl_FragColor = vec4((vec3(1., .62, .3) * fr * .5 + vec3(1., .85, .6) * sp * 2.5) * (.25 + near) * uOp, 1.); }`,
      }), n)
      this.beads.frustumCulled = false
      sc.add(this.beads)
      const m = 420, mp = new Float32Array(m * 3), mph = new Float32Array(m)
      for (let i = 0; i < m; i++) { mp.set([lerp(-12, 12, r()), lerp(-0.5, -13, Math.pow(r(), 0.8)), 0.012], i * 3); mph[i] = r() * 60 }
      const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('aPh', new THREE.BufferAttribute(mph, 1))
      this.micaU = { uTime: { value: 0 }, uPx: { value: 1 }, uOp: { value: 1 }, uGlow: { value: new THREE.Vector3() } }
      this.mica = new THREE.Points(mg, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.micaU,
        vertexShader: `attribute float aPh; uniform float uTime, uPx; uniform vec3 uGlow; varying float vB;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
            float near = 1. / (1. + .35 * dot(position.xy - uGlow.xy, position.xy - uGlow.xy));
            vB = pow(max(sin(uTime * .8 + aPh) * sin(uTime * .31 + aPh * 2.3), 0.), 5.) * (.15 + near);
            gl_PointSize = (2. + 6. * vB) * uPx; }`,
        fragmentShader: `uniform float uOp; varying float vB; void main(){ vec2 c = gl_PointCoord - .5; float a = exp(-dot(c, c) * 30.); gl_FragColor = vec4(vec3(1., .85, .6) * a * vB * uOp * 1.6, 1.); }`,
      }))
      this.mica.frustumCulled = false
      sc.add(this.mica)
    }
    const shootC = new THREE.CatmullRomCurve3([
      new THREE.Vector3(SEED.x - 0.2, SEED.y + 0.42, 0.04), new THREE.Vector3(-0.3, -1.7, 0.06), new THREE.Vector3(0.1, -0.6, 0.05),
      new THREE.Vector3(0.02, 0.2, 0.04), new THREE.Vector3(-0.08, 0.9, 0.05), new THREE.Vector3(0.04, 1.45, 0.05)])
    this.shootC = shootC
    this.shootMat = growMaterial({ color: '#c9c27a', old: '#8a5a32', glow: '#ffcf6a', glowAmt: 0.35 })
    this.shoot = new THREE.Mesh(growTube(shootC, 0.07, 0.045, 0, 1, 80, 8), this.shootMat)
    this.shoot.castShadow = true; this.shoot.frustumCulled = false
    sc.add(this.shoot)
    // Two young leaves, bronze-red, at the shoot's tip.
    this.leafMat = leafMaterial({ transl: 1.6 })
    this.leafMat.color.setRGB(7, 0.36, 0.62)
    this.tipGroup = new THREE.Group(); sc.add(this.tipGroup)
    const lg = leafGeometry(1, 0.22, 0.3); lg.scale(1, 1.6, 1)
    this.leaves = [0, 1].map((k) => {
      const piv = new THREE.Group()
      const m = new THREE.Mesh(lg, this.leafMat); m.castShadow = true; m.rotation.order = 'ZYX'
      piv.add(m); piv.rotation.y = k ? Math.PI : 0
      this.tipGroup.add(piv)
      return m
    })
    // Soil crumbs thrown up where the shoot breaks the surface: they arc, bounce once, roll and settle (or tumble down
    // the cut face).
    {
      const n = 46
      const cg = new THREE.IcosahedronGeometry(1, 1), cp = cg.attributes.position, v = new THREE.Vector3()
      for (let i = 0; i < cp.count; i++) { v.fromBufferAttribute(cp, i); v.multiplyScalar(0.75 + 0.5 * Math.abs(Math.sin(v.x * 7.1 + v.y * 3.3) * Math.cos(v.z * 5.3))); cp.setXYZ(i, v.x, v.y * 0.8, v.z) }
      cg.computeVertexNormals()
      this.crumbs = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: '#6e4a2c', roughness: 1, flatShading: true }), n)
      this.crumbs.castShadow = true
      this.crumbData = Array.from({ length: n }, (_, k) => {
        const a = r() * Math.PI * 2, v0 = 0.5 + r() * 1.3, fwd = k % 5 === 0
        return { vx: Math.cos(a) * v0 * 0.75, vz: fwd ? 0.12 + r() * 0.2 : -0.06 - Math.abs(Math.sin(a)) * v0 * 0.45, up: 1.0 + r() * 2.2, s: 0.018 + Math.pow(r(), 1.5) * 0.06, spin: 5 + r() * 12, ax: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize() }
      })
      for (let i = 0; i < n; i++) this.crumbs.setColorAt(i, new THREE.Color().setRGB(0.7 + r() * 0.5, 0.65 + r() * 0.45, 0.6 + r() * 0.4))
      sc.add(this.crumbs)
    }
    // Dew on the grass tips, winking in the first sun.
    {
      const im = this.grass.instanceMatrix.array, P = [], ph = []
      for (let i = 0; i < this.grass.count; i += 5) {
        const o = i * 16, sy = Math.hypot(im[o + 4], im[o + 5], im[o + 6])
        P.push(im[o + 12] + im[o + 4] * 0.9 + im[o + 8] * 0.2, im[o + 13] + im[o + 5] * 0.9 + im[o + 9] * 0.2, im[o + 14] + im[o + 6] * 0.9 + im[o + 10] * 0.2); ph.push(r() * 60)
        if (sy < 0) continue
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('aPh', new THREE.BufferAttribute(new Float32Array(ph), 1))
      this.dewU = { uTime: { value: 0 }, uPx: { value: 1 }, uOp: { value: 0 } }
      this.dew = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.dewU,
        vertexShader: `attribute float aPh; uniform float uTime, uPx; varying float vB;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
            vB = .25 + pow(max(sin(uTime * .9 + aPh) * sin(uTime * .43 + aPh * 1.9), 0.), 6.) * 2.;
            gl_PointSize = clamp((3. + 9. * vB) * uPx * 2.5 / -mv.z, 1., 40.); }`,
        fragmentShader: `uniform float uOp; varying float vB; void main(){ vec2 c = gl_PointCoord - .5;
          float st = max(0., 1. - abs(c.x) * 12.) * max(0., 1. - abs(c.y) * 2.4) + max(0., 1. - abs(c.y) * 12.) * max(0., 1. - abs(c.x) * 2.4);
          float a = exp(-dot(c, c) * 60.) + st * .5; gl_FragColor = vec4(vec3(1., .86, .62) * a * vB * uOp, 1.); }`,
      }))
      this.dew.frustumCulled = false
      sc.add(this.dew)
    }

    // ---- Light: a warm glow by the seed (the warm dark), a faint cool fill, the dawn sun later.
    this.glow = new THREE.PointLight('#ffad55', 2.4, 8, 2); this.glow.position.set(0.9, -2.2, 2.4); sc.add(this.glow)
    this.glow2 = new THREE.PointLight('#ff9a3c', 1.5, 7, 2); sc.add(this.glow2)
    this.fill = new THREE.HemisphereLight('#6a7aa8', '#1a0f08', 0.06); sc.add(this.fill)
    this.sunL = new THREE.DirectionalLight('#ffb070', 0)
    this.sunL.castShadow = true
    this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    const sh = this.sunL.shadow.camera; sh.left = -4; sh.right = 4; sh.top = 4; sh.bottom = -4; sh.near = 1; sh.far = 60
    this.sunL.shadow.bias = -0.0005; this.sunL.shadow.normalBias = 0.02
    sc.add(this.sunL, this.sunL.target)
    sc.environment = engine.env({ top: '#3a3a5a', mid: '#e09060', bottom: '#2a1608', sun: '#ffc080', sunDir: new THREE.Vector3(0.1, 0.1, -1), sunPower: 5 })

    // Spores in the dark around the seed; dust in the dawn air.
    this.spores = motes(Math.round(220 * T.particles + 40), new THREE.Box3(new THREE.Vector3(-6, -9, -0.2), new THREE.Vector3(6, -0.3, 4)), { size: 0.03, color: '#ffc46a', drift: 0.3, opacity: 0.9, seed: 5, sizeVar: 1.6 })
    sc.add(this.spores)
    this.dust = motes(Math.round(120 * T.particles + 30), new THREE.Box3(new THREE.Vector3(-5, 0.1, -6), new THREE.Vector3(5, 4, 4)), { size: 0.03, color: '#ffe0b0', drift: 0.25, opacity: 0, seed: 9 })
    sc.add(this.dust)

    // The camera's path: keys in chapter-1 time (chapter 0 sits before it), through a Catmull-Rom spline.
    this.keys = [
      { t: 0.0, p: [0.15, -2.85, 5.6], g: [0.0, -2.95, 0] },
      { t: 0.24, p: [1.4, -4.0, 9.5], g: [0.5, -3.9, 0] },
      { t: 0.45, p: [1.5, -4.6, 17.5], g: [1.0, -4.8, 0] },
      { t: 0.6, p: [1.1, -3.4, 16.5], g: [0.8, -3.4, 0] },
      { t: 0.71, p: [0.55, -0.45, 6.4], g: [0.2, -0.2, 0] },
      { t: 0.84, p: [0.95, 1.2, 3.4], g: [3.2, 2.4, -40] },
      { t: 1.0, p: [0.9, 1.15, 3.0], g: [3.4, 2.3, -40] },
    ]
    this.pCurve = new THREE.CatmullRomCurve3(this.keys.map((k) => new THREE.Vector3(...k.p)), false, 'centripetal')
    this.gCurve = new THREE.CatmullRomCurve3(this.keys.map((k) => new THREE.Vector3(...k.g).sub(new THREE.Vector3(...k.p)).normalize().multiplyScalar(6).add(new THREE.Vector3(...k.p))), false, 'centripetal')
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3(); this.tipV = new THREE.Vector3(); this.tanV = new THREE.Vector3()
  }

  /** Keyframe time → spline parameter (uniform knots), eased between keys. */
  keyU(t) {
    const K = this.keys, n = K.length - 1
    if (t <= 0) return 0
    if (t >= 1) return 1
    let i = 0
    while (i < n - 1 && t > K[i + 1].t) i++
    const f = (t - K[i].t) / (K[i + 1].t - K[i].t)
    const e = f * f * (3 - 2 * f) * 0.6 + f * 0.4
    return (i + e) / n
  }

  update(i, tt, time) {
    const t = clamp(tt, -0.2, 1)
    const zero = i === 0
    // One axis for the whole set: chapter 0 is a slow, close hold; chapter 1 is the growth.
    const crack = zero ? 0 : smoother(0.04, 0.24, t)
    const rootG = zero ? lerp(0.0, 0.035, smooth(0.1, 1, t)) : lerp(0.035, 1, smoother(0.04, 0.6, t))
    const shootG = zero ? 0 : smoother(0.24, 0.74, t)
    const dawn = zero ? 0 : smooth(0.52, 0.86, t)
    const breakT = 0.66 // shoot breaks the surface around here

    // Seed: breathing slightly in ch0, splitting in ch1.
    this.seed.rotation.z = -1.1 + Math.sin(time * 0.3) * 0.01
    this.halfR.rotation.z = -crack * 0.17; this.halfL.rotation.z = crack * 0.17
    this.halfR.position.x = crack * 0.04; this.halfL.position.x = -crack * 0.04
    this.kernel.scale.set(SEED_R.x * (0.82 + crack * 0.08), SEED_R.y * (0.86 + crack * 0.06), SEED_R.z * 0.62)
    this.rootMat.userData.u.uGrow.value = rootG
    this.rootMat.userData.u.uGlowAmt.value = zero ? 1.6 : lerp(1.4, 0.7, dawn)
    this.shootMat.userData.u.uGrow.value = shootG
    this.shoot.visible = shootG > 0.001

    // The tip and its leaves.
    const tip = this.shootC.getPointAt(Math.max(0.001, shootG), this.tipV)
    const tan = this.shootC.getTangentAt(Math.max(0.001, shootG), this.tanV)
    this.tipGroup.position.copy(tip)
    this.tipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan)
    const unf = smoother(breakT + 0.04, 0.86, t) * (zero ? 0 : 1)
    this.tipGroup.visible = tip.y > -0.3
    this.leaves.forEach((m, k) => {
      const s = lerp(0.12, 0.95, unf)
      m.scale.set(s, s * lerp(0.4, 1, unf), s)
      // Folded up against the tip, then opening outward and drooping, as young mango leaves do.
      m.rotation.set(-Math.PI / 2 + 0.95 * unf, 0, lerp(1.45, 0.3 + k * 0.08, unf) - Math.sin(time * 0.9 + k) * 0.03 * unf)
    })

    // Crumbs burst where the shoot breaks through, arc, bounce once and settle on the soil.
    const cb = zero ? -1 : (t - breakT) / 0.12
    this.crumbs.visible = cb > 0
    if (this.crumbs.visible) {
      const tau = cb * 0.9, G = 6.4
      this.crumbData.forEach((d, k) => {
        const t1 = (2 * d.up) / G
        let x, y, z, ang
        if (tau < t1 || d.vz > 0) {
          x = d.vx * tau; z = 0.04 + d.vz * tau; y = d.up * tau - 0.5 * G * tau * tau
          if (d.vz > 0 && y < 0) z = Math.min(z, 0.06 + d.s) // over the edge: down the cut face
          ang = d.spin * tau
        } else {
          const tb = tau - t1, vb = d.up * 0.26, t2 = (2 * vb) / G, x1 = d.vx * t1, z1 = 0.04 + d.vz * t1
          if (tb < t2) { y = vb * tb - 0.5 * G * tb * tb; x = x1 + d.vx * 0.45 * tb; z = z1 + d.vz * 0.45 * tb; ang = d.spin * (t1 + tb * 0.6) }
          else { const tr = tb - t2, roll = (1 - Math.exp(-tr * 3)) / 3; y = 0; x = x1 + d.vx * 0.45 * t2 + d.vx * 0.3 * roll; z = z1 + d.vz * 0.45 * t2 + d.vz * 0.3 * roll; ang = d.spin * (t1 + t2 * 0.6 + roll * 0.8) }
          y = Math.max(0, y)
        }
        if (d.vz <= 0 || y >= 0) y += d.s * 0.7
        this.q.setFromAxisAngle(d.ax, ang)
        this.m4.compose(this.v.set(x, y, z), this.q, this.v2.setScalar(d.s))
        this.crumbs.setMatrixAt(k, this.m4)
      })
      this.crumbs.instanceMatrix.needsUpdate = true
    }
    // Root hairs, tip glows, the waking network, beads, mica.
    const px = this.engine.h * this.engine.dpr / 900
    this.hairU.uGrow.value = rootG; this.hairU.uOp.value = (zero ? 0.3 : 0.3) * (1 - dawn * 0.7)
    {
      const P = this.tips.geometry.attributes.position, K = this.tips.geometry.attributes.aK
      this.rootList.forEach((l, k) => {
        const f = (rootG - l.birth) / l.dur
        if (f > 0.001 && f < 1) { l.curve.getPointAt(f, this.v3); P.setXYZ(k, this.v3.x, this.v3.y, this.v3.z + 0.02); K.setX(k, (1 - smooth(0.85, 1, f)) * (l.depth === 0 ? 1 : 0.75)) } else K.setX(k, 0)
      })
      P.needsUpdate = true; K.needsUpdate = true
    }
    this.tipU.uPx.value = px; this.tipU.uOp.value = (zero ? 1.3 : 1) * (1 - dawn * 0.6)
    this.mycU.uTime.value = time; this.mycU.uPx.value = px; this.mycU.uWake.value = zero ? 0.1 + 0.08 * smooth(0, 1, t) : lerp(0.18, 1.1, smoother(0.04, 0.62, t))
    this.mycU.uBase.value = 0.2; this.mycU.uReach.value = zero ? 2.6 : lerp(2.8, 8, smoother(0.04, 0.62, t)); this.mycU.uOp.value = (zero ? lerp(0.3, 1, smooth(0.55, 1, t)) : 1) * (1 - dawn * 0.9) // quiet behind the title, waking as the film starts
    this.beadU.uTime.value = time; this.beadU.uOp.value = 1 - dawn; this.beadU.uGlow.value.set(SEED.x + 0.5, SEED.y + 0.3, 0)
    this.micaU.uTime.value = time; this.micaU.uPx.value = px; this.micaU.uOp.value = 1 - dawn; this.micaU.uGlow.value.copy(this.beadU.uGlow.value)
    this.huskU.uRimK.value = zero ? lerp(0.5, 0.9, smooth(0, 1, t)) : 0.9 * (1 - crack * 0.4) * (1 - dawn)
    this.dewU.uTime.value = time; this.dewU.uPx.value = px; this.dewU.uOp.value = smooth(0.66, 0.84, t) * (zero ? 0 : 1)

    // Light: underground warmth fading as the dawn comes up.
    this.glow.intensity = lerp(7, 2, dawn) * (zero ? 1 : 1)
    this.glow.position.set(SEED.x + 1.0, SEED.y + 0.9, 2.2)
    const tipBelow = Math.min(tip.y, -0.3)
    this.glow2.position.set(tip.x + 0.8, tipBelow + 0.3, 1.6)
    this.glow2.intensity = zero ? 0 : lerp(0, 3.5, smooth(0.2, 0.4, t)) * (1 - dawn * 0.6)
    const su = this.sky.userData.u
    su.uTop.value.setRGB(lerp(0.01, 0.05, dawn), lerp(0.012, 0.07, dawn), lerp(0.04, 0.2, dawn))
    su.uHor.value.setRGB(lerp(0.12, 0.95, dawn), lerp(0.07, 0.40, dawn), lerp(0.08, 0.2, dawn))
    su.uBot.value.setRGB(0.05, 0.03, 0.02)
    su.uSunCol.value.setRGB(lerp(0.5, 1.3, dawn), lerp(0.2, 0.55, dawn), lerp(0.08, 0.16, dawn))
    su.uSunGlow.value = lerp(0.1, 0.75, dawn)
    su.uCloudCol.value.setRGB(lerp(0.3, 1.2, dawn), lerp(0.2, 0.62, dawn), lerp(0.25, 0.45, dawn))
    su.uCloudShade.value.setRGB(lerp(0.05, 0.36, dawn), lerp(0.05, 0.22, dawn), lerp(0.1, 0.3, dawn))
    su.uTime.value = time
    this.scene.fog.color.copy(su.uHor.value).multiplyScalar(0.8)
    this.sun.copy(this.sunDir)
    this.sunCol.setRGB(1, lerp(0.55, 0.68, dawn), lerp(0.3, 0.4, dawn))
    this.sunL.color.copy(this.sunCol)
    this.sunL.intensity = dawn * 3.2
    this.sunL.position.copy(this.sunDir).multiplyScalar(30)
    this.sunL.target.position.set(0, 0.5, 0)
    this.fill.intensity = lerp(0.06, 0.7, dawn)
    this.fill.color.setRGB(lerp(0.4, 0.75, dawn), lerp(0.45, 0.6, dawn), lerp(0.66, 0.7, dawn))
    this.spores.userData.u.uTime.value = time; this.dust.userData.u.uTime.value = time
    this.spores.userData.u.uOp.value = 0.9 * (1 - dawn)
    this.dust.userData.u.uOp.value = dawn * 0.8

    // Camera.
    const pos = this.v.set(0, 0, 0), gaze = this.v2.set(0, 0, 0)
    if (zero) {
      const k = smooth(0, 1, t)
      pos.set(lerp(0.6, 0.15, k) + Math.sin(time * 0.2) * 0.04, lerp(-2.7, -2.85, k), lerp(7.2, 5.6, k))
      gaze.set(lerp(0.05, 0, k), lerp(-2.9, -2.95, k), 0)
    } else {
      const u = this.keyU(t)
      this.pCurve.getPoint(u, pos)
      this.gCurve.getPoint(u, gaze)
    }
    if (!zero && this.camera.aspect < 1) {
      // Portrait: step back and turn a little toward the seedling so both leaves and the sun stay in the frame.
      const k = smooth(0.7, 0.84, t)
      pos.add(this.v3.copy(pos).sub(tip).multiplyScalar(0.55 * k))
      gaze.lerp(tip, 0.42 * k)
    }
    aim(this.camera, pos, gaze)
    // Frame: in ch0 the seed sits above the title; in ch1 up and right of the type (bottom-left).
    const fk = zero ? 0 : smooth(0.0, 0.25, t)
    this.frame[0] = lerp(0, 0.2, fk) * (1 - smooth(0.66, 0.86, t) * 0.7)
    this.frame[1] = lerp(0.2, 0.06, fk) * (1 - smooth(0.7, 0.86, t))
    this.framePortrait[0] = 0
    this.framePortrait[1] = lerp(0.2, 0.12, fk) * (1 - smooth(0.7, 0.86, t) * 0.5)
    // Focus: the seed, then the growing tip.
    const fp = zero || t < 0.25 ? SEED : tip
    this.post.focus = this.camera.position.distanceTo(fp)
    this.post.range = zero ? 0.6 : lerp(1.4, 4, smooth(0.2, 0.5, t)) * (1 - dawn * 0.4) + dawn * 1.5
    this.post.dof = zero ? 9 : lerp(6, 6, dawn)
    // Match point: the sun.
    this.focus.copy(this.sunDir).multiplyScalar(280).add(this.camera.position)

    this.look.rays = dawn * 0.55 * (1 - smooth(0.74, 0.82, t)); this.look.rayThreshold = 1.5; this.look.rayTint.setRGB(1, 0.74, 0.46)
    this.look.bloom = lerp(0.7, 0.7, dawn)
    this.look.threshold = lerp(0.62, 0.95, dawn)
    this.look.bloomRadius = 0.6
    this.look.exposure = lerp(1.05, 0.95, dawn)
    this.look.vig = lerp(0.75, 0.5, dawn)
    this.grade([lerp(0.012, 0.01, dawn), lerp(0.006, 0.004, dawn), 0.002], [1.04, 1.0, lerp(0.92, 0.96, dawn)], 1.05)
  }

  afterCamera() {
    this.leafMat.userData.u.uSunView.value.copy(this.sunView)
    this.leafMat.userData.u.uSunCol.value.copy(this.sunCol)
    this.leafMat.userData.u.uTime.value = 0
  }
}
