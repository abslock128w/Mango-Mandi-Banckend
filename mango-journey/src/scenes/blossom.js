// Chapter 3 "Every spring it flowers.": a push in to a flowering branch. Conical panicles of tiny cream flowers with
// pink centres open from the base upward (instanced, folded buds unfolding in the vertex shader), bees as warm motes
// with short trails, petals drifting down; one flower sets fruit, a tiny green fruitlet that swells and is the match
// point for the iris into chapter 4.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Stage, aim, skyDome, motes } from './stage.js'
import { Mango, leafGeometry, leafMaterial, leafDepthMaterial, stemMesh, barkTexture } from '../lib/mango.js'
import { rng, smooth, smoother, lerp, clamp, easeInOut, canvasTex } from '../lib/util.js'
import { bokehDiscs } from './crate-kit.js'

/** One flower: five petals round a pink-orange centre, normal +z. aR = radial distance (for folding into a bud). */
function flowerGeometry() {
  const parts = []
  const petal = new THREE.Shape()
  petal.moveTo(0, 0); petal.bezierCurveTo(0.35, 0.18, 0.95, 0.32, 1, 0); petal.bezierCurveTo(0.95, -0.32, 0.35, -0.18, 0, 0)
  for (let k = 0; k < 5; k++) {
    const g = new THREE.ShapeGeometry(petal, 4)
    g.rotateZ((k / 5) * Math.PI * 2)
    g.translate(0, 0, 0.02 * (k % 2))
    parts.push(g)
  }
  const c = new THREE.SphereGeometry(0.22, 8, 6); c.scale(1, 1, 0.6); c.translate(0, 0, 0.06)
  parts.push(c)
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed ? p.toNonIndexed() : p))
  const p = g.attributes.position, n = p.count
  const col = new Float32Array(n * 3), aR = new Float32Array(n)
  const cream = new THREE.Color('#fbf3d6'), base = new THREE.Color('#f2c0a8'), centre = new THREE.Color('#d8582e')
  const ci = new THREE.Color()
  const petalVerts = n - c.toNonIndexed().attributes.position.count
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y)
    if (i < petalVerts) { aR[i] = r; ci.copy(base).lerp(cream, Math.min(1, r * 1.6)) } else { aR[i] = 0; ci.copy(centre) }
    col.set([ci.r, ci.g, ci.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aR', new THREE.BufferAttribute(aR, 1))
  g.computeVertexNormals()
  return g
}

export default class Blossom extends Stage {
  constructor(engine) {
    super(engine)
    const sc = this.scene, T = this.tier, r = rng(31)
    this.fov = 32
    this.frame = [-0.12, 0.08]
    this.framePortrait = [0, 0.14]

    // Afternoon sky, high sun behind and to the right (petals and leaves glow against it).
    this.sky = skyDome(); sc.add(this.sky)
    const su = this.sky.userData.u
    su.uTop.value.set('#2f5a8c'); su.uHor.value.set('#86a066'); su.uBot.value.set('#1e2e16')
    su.uClouds.value = 0.45; su.uHaze.value = 0.6; su.uSunSize.value = 0.05
    this.sun.set(0.45, 0.62, -0.65).normalize()
    su.uSunDir.value.copy(this.sun); su.uSunCol.value.setRGB(1, 0.92, 0.75)
    this.sunCol.setRGB(1, 0.93, 0.78)
    sc.fog = new THREE.Fog('#3f5a2f', 16, 70)
    this.sunL = new THREE.DirectionalLight('#fff0d6', 3.2)
    this.sunL.position.copy(this.sun).multiplyScalar(20)
    this.sunL.castShadow = true
    this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    const sh = this.sunL.shadow.camera; sh.left = -7; sh.right = 7; sh.top = 7; sh.bottom = -7; sh.near = 1; sh.far = 50
    this.sunL.shadow.bias = -0.0004; this.sunL.shadow.normalBias = 0.02
    sc.add(this.sunL, this.sunL.target)
    sc.add(new THREE.HemisphereLight('#e8f0ff', '#3a4a22', 1.0))
    const key = new THREE.DirectionalLight('#fff4e4', 1.4); key.position.set(-2, 3, 8); sc.add(key)
    this.fruitKey = new THREE.PointLight('#fff2d0', 0, 3, 2); sc.add(this.fruitKey)
    sc.environment = engine.env({ top: '#5f8fd0', mid: '#f2ead0', bottom: '#2f4020', sun: '#fff6e0', sunDir: this.sun, sunPower: 5 })

    // Branch and twigs.
    this.branch = stemMesh([new THREE.Vector3(-15, -3.6, -5), new THREE.Vector3(-7, -2.2, -3.2), new THREE.Vector3(-2.5, -1.4, -1.2), new THREE.Vector3(1.5, -1.1, -0.6), new THREE.Vector3(7, -1.8, -2.8), new THREE.Vector3(12, -2.4, -5)], 0.26, 0.12, '#5a4632')
    sc.add(this.branch)
    const PAN = [
      { b: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0.12, 1, 0.12), L: 4.2, hero: true },
      { b: new THREE.Vector3(-3.4, -0.4, -1.6), dir: new THREE.Vector3(-0.25, 1, 0.05), L: 3.6 },
      { b: new THREE.Vector3(3.0, -0.3, -2.0), dir: new THREE.Vector3(0.3, 1, -0.1), L: 3.8 },
      { b: new THREE.Vector3(-6.4, -1.1, -3.0), dir: new THREE.Vector3(-0.2, 1, 0.2), L: 3.3 },
      { b: new THREE.Vector3(6.2, -0.9, -3.6), dir: new THREE.Vector3(0.2, 1, 0), L: 3.4 },
      { b: new THREE.Vector3(-1.4, -0.6, -4.5), dir: new THREE.Vector3(0.05, 1, -0.2), L: 3.0 },
    ]
    const twigPts = PAN.map((p) => {
      const a = this.branch.userData.curve.getPoint(clamp((p.b.x + 15) / 27, 0.05, 0.95))
      return [a, a.clone().lerp(p.b, 0.5).add(new THREE.Vector3(0, 0.15, 0.05)), p.b.clone()]
    })
    twigPts.forEach((pts) => sc.add(stemMesh(pts, 0.1, 0.06, '#6a5636')))

    // Panicles: a rachis with laterals (merged tubes), flowers along every lateral.
    const tubes = [], F = [] // flowers: { p, n, birth, s }
    const rach = new THREE.MeshStandardMaterial({ color: '#b85a3e', roughness: 0.6 })
    const tube = (pts, r0, r1) => {
      const c = new THREE.CatmullRomCurve3(pts)
      const g = new THREE.TubeGeometry(c, 10, 1, 5, false)
      const pp = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv, pt = new THREE.Vector3()
      for (let i = 0; i < pp.count; i++) { const t = uv.getX(i); c.getPointAt(Math.min(1, t), pt); const rr = lerp(r0, r1, t); pp.setXYZ(i, pt.x + nn.getX(i) * rr, pt.y + nn.getY(i) * rr, pt.z + nn.getZ(i) * rr) }
      g.computeVertexNormals(); g.deleteAttribute('uv'); tubes.push(g)
      return c
    }
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1)
    this.heroSpot = null
    PAN.forEach((P, pi) => {
      const dir = P.dir.clone().normalize()
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize()
      const ax = tube([P.b.clone(), P.b.clone().addScaledVector(dir, P.L * 0.5).addScaledVector(side, 0.08), P.b.clone().addScaledVector(dir, P.L)], 0.05, 0.015)
      const nl = 22
      for (let k = 0; k < nl; k++) {
        const u = 0.08 + (k / nl) * 0.82
        const at = ax.getPointAt(u)
        let ang = k * 2.39996 + pi
        if (P.hero && k === 5) ang = Math.PI / 2 + 0.25 // the lateral that will carry our fruit faces the camera
        const radial = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
        const len = P.L * 0.36 * Math.pow(1 - u, 0.75) + 0.18
        const ld = radial.clone().multiplyScalar(1).addScaledVector(dir, 0.75).normalize()
        const tip = at.clone().addScaledVector(ld, len)
        const lc = tube([at, at.clone().lerp(tip, 0.5).addScaledVector(dir, 0.05), tip], 0.022, 0.008)
        const nf = Math.max(4, Math.round(len * 17 * (0.55 + 0.45 * T.particles)))
        for (let f = 0; f < nf; f++) {
          const uu = 0.15 + (f / nf) * 0.85
          const fp = lc.getPointAt(Math.min(1, uu))
          const n = ld.clone().multiplyScalar(0.4).add(new THREE.Vector3(r() - 0.5, r() - 0.2, r() - 0.5).multiplyScalar(1.6)).normalize()
          fp.addScaledVector(n, 0.04)
          F.push({ p: fp, n, birth: 0.05 + u * 0.55 + uu * 0.12 + r() * 0.12, s: 0.075 + r() * 0.035, hero: false })
        }
        if (P.hero && k === 5) {
          this.heroSpot = tip.clone()
          F.push({ p: tip.clone(), n: new THREE.Vector3(0.15, 0.3, 1).normalize(), birth: 0.1, s: 0.085, hero: true })
        }
      }
      // A crown of flowers at the top of the rachis.
      for (let f = 0; f < 10; f++) {
        const fp = ax.getPointAt(0.9 + f * 0.01).add(new THREE.Vector3(r() - 0.5, r() * 0.3, r() - 0.5).multiplyScalar(0.25))
        F.push({ p: fp, n: new THREE.Vector3(r() - 0.5, 1, r() - 0.5).normalize(), birth: 0.62 + r() * 0.2, s: 0.06 + r() * 0.02 })
      }
    })
    this.rachis = new THREE.Mesh(mergeGeometries(tubes), rach)
    this.rachis.castShadow = true
    sc.add(this.rachis)

    const fg = flowerGeometry()
    const fm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide })
    this.fu = { uOpen: { value: 0 }, uHeroDrop: { value: 0 }, uSunView: { value: new THREE.Vector3() } }
    fm.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.fu)
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aR; attribute float aBirth; attribute float aHero; uniform float uOpen; uniform float uHeroDrop; varying float vO;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float o = clamp((uOpen - aBirth) * 7., 0., 1.);
          o = o * o * (3. - 2. * o);
          transformed.xy *= mix(.28, 1., o);
          transformed.z += (1. - o) * aR * 1.1;
          transformed *= mix(.62, 1., o);
          transformed *= 1. - aHero * uHeroDrop;
          vO = o;`)
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; varying float vO;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(.62, .78, .42), vec3(1.), vO);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 2.);
            totalEmissiveRadiance += diffuseColor.rgb * (back * .45 + .04) * vO; }`)
    }
    fm.customProgramCacheKey = () => 'mflower'
    // Keep the spot where our fruit sets clear of other flowers.
    for (let k = F.length - 1; k >= 0; k--) if (!F[k].hero && this.heroSpot && F[k].p.distanceTo(this.heroSpot) < 0.3) F.splice(k, 1)
    this.flowers = new THREE.InstancedMesh(fg, fm, F.length)
    const aB = new Float32Array(F.length), aH = new Float32Array(F.length)
    const m4 = new THREE.Matrix4(), sv = new THREE.Vector3()
    F.forEach((f, i) => {
      q.setFromUnitVectors(up, f.n)
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * 6.28))
      this.flowers.setMatrixAt(i, m4.compose(f.p, q, sv.setScalar(f.s)))
      aB[i] = f.birth; aH[i] = f.hero ? 1 : 0
    })
    fg.setAttribute('aBirth', new THREE.InstancedBufferAttribute(aB, 1))
    fg.setAttribute('aHero', new THREE.InstancedBufferAttribute(aH, 1))
    this.flowers.castShadow = false
    sc.add(this.flowers)
    this.flowerCount = F.length
    this.F = F

    // Leaves: whorls under each panicle, plus a soft background canopy.
    const lm = this.leafMat = leafMaterial({ wind: 0.015, transl: 1.8 })
    const lg = leafGeometry(1, 0.2, 0.2)
    const L = []
    PAN.forEach((P) => {
      for (let k = 0; k < 9; k++) L.push({ p: P.b.clone().add(new THREE.Vector3(0, -0.15, 0)), rx: -0.2 - r() * 0.5, ry: (k / 9) * 6.28 + r() * 0.4, rz: -0.35 - r() * 0.6, s: 2.6 + r() * 1.3 })
    })
    for (let k = 0; k < Math.round(200 * T.leaves + 60); k++) L.push({ p: new THREE.Vector3(lerp(-40, 40, r()), lerp(-12, 18, r()), lerp(-10, -40, r())), rx: (r() - 0.5) * 0.8, ry: (r() - 0.5) * 0.8, rz: r() * 6.28, s: 3.5 + r() * 4, dark: true })
    for (let k = 0; k < 7; k++) L.push({ p: new THREE.Vector3(lerp(-6, 7, r()), lerp(-2, 4, r()), lerp(5, 8, r())), rx: r() * 6, ry: r() * 6, rz: r() * 6, s: 2.5 + r() * 2 })
    this.leaves = new THREE.InstancedMesh(lg, lm, L.length)
    this.leaves.customDepthMaterial = leafDepthMaterial()
    this.leaves.castShadow = true; this.leaves.receiveShadow = true
    const e = new THREE.Euler(), c = new THREE.Color()
    L.forEach((l, i) => {
      q.setFromEuler(e.set(l.rx, l.ry, l.rz))
      this.leaves.setMatrixAt(i, m4.compose(l.p, q, sv.setScalar(l.s)))
      this.leaves.setColorAt(i, l.dark ? c.setRGB(0.35 + r() * 0.2, 0.45 + r() * 0.2, 0.35 + r() * 0.15) : c.setRGB(0.8 + r() * 0.35, 0.85 + r() * 0.3, 0.75 + r() * 0.25))
    })
    sc.add(this.leaves)

    // Falling petals: tiny cream quads tumbling down on loops (positions from time in the shader).
    {
      const n = Math.round(160 * T.particles + 40)
      const g = new THREE.PlaneGeometry(0.07, 0.045)
      const seeds = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) seeds.set([lerp(-8, 8, r()), lerp(-3, 5, r()), lerp(-5, 4, r()), r()], i * 4)
      g.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds, 4))
      this.petalU = { uTime: { value: 0 }, uOp: { value: 0 } }
      const m = new THREE.ShaderMaterial({
        side: THREE.DoubleSide, transparent: true, uniforms: this.petalU,
        vertexShader: /* glsl */ `attribute vec4 aS; uniform float uTime; varying float vL;
          mat3 rot(vec3 a){ float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
            return mat3(cy*cz, cy*sz, -sy, sx*sy*cz - cx*sz, sx*sy*sz + cx*cz, sx*cy, cx*sy*cz + sx*sz, cx*sy*sz - sx*cz, cx*cy); }
          void main(){ float t = uTime * (.25 + aS.w * .2) + aS.w * 10.;
            float fall = mod(t, 8.);
            vec3 c = vec3(aS.x + sin(t * 1.3 + aS.w * 9.) * .5, aS.y + 4. - fall, aS.z + cos(t * .9 + aS.w * 5.) * .4);
            mat3 R = rot(vec3(t * 2.1, t * 1.7 + aS.w * 6., t * 1.2));
            vec3 nrm = R * vec3(0., 0., 1.); vL = .55 + .45 * abs(nrm.y);
            vec4 mv = modelViewMatrix * vec4(c + R * position, 1.); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uOp; varying float vL; void main(){ gl_FragColor = vec4(vec3(1., .95, .84) * vL * 1.6, uOp); }`,
      })
      this.petals = new THREE.InstancedMesh(g, m, n)
      this.petals.frustumCulled = false
      sc.add(this.petals)
    }

    // The fruitlet that sets.
    this.fruitlet = new Mango({ ripe: 0, leaf: false, detail: 0.6 })
    this.fruitlet.rotation.set(0.1, -0.5, 0.15)
    sc.add(this.fruitlet)
    this.dust = motes(Math.round(90 * T.particles + 30), new THREE.Box3(new THREE.Vector3(-8, -3, -4), new THREE.Vector3(8, 6, 5)), { size: 0.025, color: '#fff6d8', drift: 0.3, opacity: 0.7, seed: 4 })
    sc.add(this.dust)
    this.bokeh = bokehDiscs(Math.round(70 * T.particles + 20), new THREE.Box3(new THREE.Vector3(-40, -12, -45), new THREE.Vector3(40, 22, -22)), { size: 2.5, seed: 8, opacity: 0.7 })
    this.bokeh.userData.u.uCol.value.setRGB(1, 0.93, 0.72); this.bokeh.userData.u.uCol2.value.setRGB(0.75, 1, 0.5)
    sc.add(this.bokeh)
    this.makeBees(r)
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3()
  }

  /** Bees: furred, striped bodies with blurred wings, flying from flower to flower; pollen glitters where they land. */
  makeBees(r) {
    const nb = 9
    const stripes = canvasTex(32, 128, (g, W, H) => {
      g.fillStyle = '#e8a628'; g.fillRect(0, 0, W, H)
      g.fillStyle = '#1a120a'; g.fillRect(0, 0, W, 30)
      for (const y of [52, 76, 98]) g.fillRect(0, y, W, 11)
      g.fillStyle = '#2a1c0e'; g.fillRect(0, 116, W, 12)
    })
    const body = new THREE.SphereGeometry(1, 14, 10); body.rotateZ(-Math.PI / 2); body.scale(0.1, 0.06, 0.062)
    const head = new THREE.SphereGeometry(1, 10, 8); head.scale(0.045, 0.045, 0.05); head.translate(0.11, 0.005, 0)
    { const uv = head.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.95) }
    const bg = mergeGeometries([body, head])
    this.bees = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.9 }), nb)
    this.bees.frustumCulled = false; this.bees.castShadow = true
    const wg = new THREE.PlaneGeometry(0.16, 0.08); wg.translate(0.0, 0.05, 0)
    this.wingU = { uTime: { value: 0 }, uOp: { value: 0 } }
    this.wings = new THREE.InstancedMesh(wg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: this.wingU,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.); }',
      fragmentShader: `uniform float uOp; varying vec2 vUv; void main(){ vec2 c = (vUv - vec2(.5, .1)) * vec2(2., 1.15); float d = length(c);
        float a = smoothstep(1., .2, d) * (.55 + .45 * smoothstep(.2, 1., d)); gl_FragColor = vec4(vec3(.85, .92, 1.) * a * .28 * uOp, 1.); }`,
    }), nb * 2)
    this.wings.frustumCulled = false
    // Each bee's round of flowers: a random open flower, then near neighbours.
    const open = this.F.map((f, k) => k).filter((k) => this.F[k].birth < 0.45 && !this.F[k].hero)
    this.beeData = Array.from({ length: nb }, () => {
      let cur = open[Math.floor(r() * open.length)]
      const stops = [cur]
      for (let k = 0; k < 5; k++) {
        const p = this.F[cur].p
        const near = open.filter((j) => j !== cur && this.F[j].p.distanceTo(p) < 1.4 && this.F[j].p.distanceTo(p) > 0.25)
        cur = near.length ? near[Math.floor(r() * near.length)] : open[Math.floor(r() * open.length)]
        stops.push(cur)
      }
      return { stops: stops.map((k) => this.F[k].p.clone().addScaledVector(this.F[k].n, 0.07)), nrm: stops.map((k) => this.F[k].n.clone()), ph: r() * 20, sp: 0.85 + r() * 0.3 }
    })
    const ng = nb * 7, sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ng * 3), 3)); sg.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(ng), 1))
    this.pollenOff = Array.from({ length: ng }, () => new THREE.Vector3(r() - 0.5, r() - 0.3, r() - 0.5).multiplyScalar(0.16))
    this.pollenU = { uPx: { value: 1 }, uOp: { value: 0 } }
    this.pollen = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.pollenU,
      vertexShader: `attribute float aK; uniform float uPx; varying float vK; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vK = aK; gl_PointSize = aK > .01 ? (3. + 9. * aK) * uPx : 0.; }`,
      fragmentShader: `uniform float uOp; varying float vK; void main(){ vec2 c = gl_PointCoord - .5; float st = max(0., 1. - abs(c.x) * 10.) * max(0., 1. - abs(c.y) * 2.5) + max(0., 1. - abs(c.y) * 10.) * max(0., 1. - abs(c.x) * 2.5);
        float a = exp(-dot(c, c) * 50.) + st * .6; gl_FragColor = vec4(vec3(1., .82, .35) * a * vK * uOp * 1.8, 1.); }`,
    }))
    this.pollen.frustumCulled = false
    this.scene.add(this.bees, this.wings, this.pollen)
    this.bm = new THREE.Matrix4(); this.bq = new THREE.Quaternion(); this.bv = new THREE.Vector3(); this.bs = new THREE.Vector3(); this.bx = new THREE.Vector3(); this.by = new THREE.Vector3(); this.bz = new THREE.Vector3()
    this.wq = new THREE.Quaternion(); this.wo = new THREE.Vector3(); this.wm = new THREE.Matrix4(); this.wq2 = new THREE.Quaternion()
  }

  updateBees(time, op) {
    const C = 2.8, LAND = 1.2
    const P = this.pollen.geometry.attributes.position, K = this.pollen.geometry.attributes.aK
    this.beeData.forEach((d, b) => {
      const tt = time * d.sp + d.ph, k = Math.floor(tt / C), f = tt / C - k
      const n = d.stops.length, a = d.stops[k % n], bb = d.stops[(k + 1) % n]
      const land = f * C < LAND
      let pos, dir
      if (land) {
        pos = this.bv.copy(a).addScaledVector(d.nrm[k % n], 0.02 + Math.sin(time * 9 + b) * 0.008)
        dir = this.bx.copy(d.nrm[k % n]).negate().add(this.by.set(Math.sin(time * 2 + b) * 0.3, 0.2, 0)).normalize()
      } else {
        const u = (f * C - LAND) / (C - LAND), e = u * u * (3 - 2 * u)
        pos = this.bv.copy(a).lerp(bb, e)
        pos.y += Math.sin(u * Math.PI) * 0.35; pos.x += Math.sin(u * Math.PI * 2 + b) * 0.12
        dir = this.bx.copy(bb).sub(a).add(this.by.set(0, Math.cos(u * Math.PI) * 0.6, 0)).normalize()
      }
      // orient: +x along the heading, +y as near world up as possible
      const z = this.bz.crossVectors(dir, this.by.set(0, 1, 0)).normalize(), y = this.by.crossVectors(z, dir)
      this.bq.setFromRotationMatrix(this.bm.makeBasis(dir, y, z))
      const sc = Math.max(0.0001, op * (0.9 + (b % 3) * 0.08))
      this.bees.setMatrixAt(b, this.bm.compose(pos, this.bq, this.bs.setScalar(sc)))
      const flap = Math.sin(time * 40 + b) * 0.25
      for (const side of [0, 1]) {
        this.wq.setFromAxisAngle(this.wo.set(1, 0, 0), (side ? -1 : 1) * (0.5 + flap))
        this.wo.set(-0.01, 0.045, side ? -0.03 : 0.03).applyQuaternion(this.bq).multiplyScalar(sc).add(pos)
        this.wings.setMatrixAt(b * 2 + side, this.wm.compose(this.wo, this.wq2.copy(this.bq).multiply(this.wq), this.bs.setScalar(sc)))
      }
      // pollen glitters round the flower while the bee works it, and a moment after it leaves
      const g = land ? Math.min(1, (f * C) / 0.3) : Math.max(0, 1 - (f * C - LAND) / 0.6)
      for (let j = 0; j < 7; j++) {
        const o = this.pollenOff[b * 7 + j], tw = 0.5 + 0.5 * Math.sin(time * 7 + j * 2.1 + b)
        P.setXYZ(b * 7 + j, a.x + o.x, a.y + o.y + (land ? 0 : (f * C - LAND) * 0.1), a.z + o.z)
        K.setX(b * 7 + j, g * tw * op)
      }
    })
    this.bees.instanceMatrix.needsUpdate = true; this.wings.instanceMatrix.needsUpdate = true
    P.needsUpdate = true; K.needsUpdate = true
  }

  update(i, tt, time) {
    const t = clamp(tt, -0.2, 1)
    const open = smoother(-0.05, 0.6, t)
    this.fu.uOpen.value = lerp(0, 1.02, open)
    const set = smoother(0.5, 0.86, t) // the hero flower gives way to a fruitlet
    this.fu.uHeroDrop.value = smooth(0.48, 0.6, t)
    const F = this.heroSpot
    const fs = lerp(0.0, 0.13, set)
    this.fruitlet.visible = set > 0.001
    this.fruitlet.scale.setScalar(Math.max(0.001, fs))
    // Hang from the lateral's tip: the stem top sits at the spot.
    this.fruitlet.position.copy(F).add(this.tmp.set(-0.05, -1.04, 0).multiplyScalar(fs))
    this.fruitlet.ripe = 0.02

    const beeOp = smooth(0.08, 0.3, t) * (1 - smooth(0.85, 1, t))
    this.updateBees(time, beeOp)
    this.wingU.uOp.value = beeOp; this.pollenU.uOp.value = 1; this.pollenU.uPx.value = this.engine.h * this.engine.dpr / 900
    this.bokeh.userData.u.uPx.value = this.pollenU.uPx.value
    this.petalU.uTime.value = time; this.petalU.uOp.value = smooth(0.3, 0.55, t) * 0.95
    this.leafMat.userData.u.uTime.value = time
    this.dust.userData.u.uTime.value = time; this.bokeh.userData.u.uTime.value = time
    this.sky.userData.u.uTime.value = time

    // Camera: from the flowering branch, a steady push in to the one flower that sets.
    const k = easeInOut(clamp((t + 0.1) / 1.1))
    const k2 = smoother(0.45, 1, t)
    const fruitC = this.fruitlet.getWorldPosition(this.tmp2).clone()
    if (!this.fruitlet.visible) fruitC.copy(F).y -= 0.1
    const p0 = new THREE.Vector3(2.6, 2.4, 11.5), g0 = new THREE.Vector3(-0.6, 1.6, -1)
    const p1 = new THREE.Vector3(1.4, 2.0, 5.6), g1 = new THREE.Vector3(0.1, 1.7, 0)
    const p2 = fruitC.clone().add(new THREE.Vector3(0.45, 0.22, 1.25)), g2 = fruitC.clone()
    const pos = p0.clone().lerp(p1, smooth(0, 0.5, k)).lerp(p2, k2)
    const gaze = g0.clone().lerp(g1, smooth(0, 0.5, k)).lerp(g2, k2)
    pos.x += Math.sin(time * 0.25) * 0.05 * (1 - k2); pos.y += Math.sin(time * 0.31) * 0.04 * (1 - k2)
    aim(this.camera, pos, gaze)
    this.frame[0] = lerp(-0.13, -0.04, k2); this.frame[1] = lerp(0.08, 0.03, k2)
    this.framePortrait[1] = lerp(0.14, 0.06, k2)
    this.post.focus = pos.distanceTo(k2 > 0.3 ? fruitC : F)
    this.post.range = lerp(2.4, 0.35, k2)
    this.post.dof = lerp(14, 15, k2)
    this.focus.copy(fruitC)

    this.fruitKey.position.copy(fruitC).add(this.tmp.set(0.4, 0.5, 0.8)); this.fruitKey.intensity = set * 1.4
    this.look.bloom = 0.42; this.look.threshold = 0.92; this.look.bloomRadius = 0.55
    this.look.exposure = 1.0; this.look.vig = 0.5
    this.look.rays = 0.6; this.look.rayThreshold = 1.3; this.look.rayTint.setRGB(1, 0.95, 0.8)
    this.grade([0.004, 0.006, 0.0], [1.02, 1.01, 0.97], 1.06)
  }

  afterCamera() {
    const lu = this.leafMat.userData.u
    lu.uSunView.value.copy(this.sunView); lu.uSunCol.value.copy(this.sunCol)
    this.fu.uSunView.value.copy(this.sunView)
    this.fruitlet.tick(3, this.sunView, this.sunCol)
  }
}
