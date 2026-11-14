// Chapter 6 "Into straw, not onto a heap." The orchard floor in the last gold light. Our mango, still in the picker's
// gloved hand (the iris opens on it), is lowered into a wooden crate lined with straw, rolls into its place among
// others of every ripeness and settles; the hand opens and withdraws; the camera cranes up over the full crate; two
// hands take the rope handles and the crate is lifted as we pull back down the lane between the rows of trees, toward
// the sun that is sinking into the far crowns.
// Scale: the crate's units (a mango is about 1.7 tall), so the trees are a hundred and more tall and the lane between
// the rows runs straight toward the low sun: the rows' shadows lie along themselves and the lane stays gold.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Stage, aim, skyDome, motes } from './stage.js'
import { Mango } from '../lib/mango.js'
import { Hand } from '../lib/hand.js'
import { NOISE } from '../lib/glsl.js'
import { rng, smooth, smoother, lerp, clamp, easeInOut, canvasTex } from '../lib/util.js'
import { strawBedTexture, mangoCrowd, handQuat, settle, orchardTrees, plankTexture, strawStrands, basketMesh, taperTube } from './crate-kit.js'

const W = 10, D = 6.6, H = 3.0, BED = 1.75
const SLOT = new THREE.Vector3(0.7, BED + 0.52, 1.95)

/** A dry fallen mango leaf: tan to rust, pale midrib. Along +x. */
function dryLeafTex() {
  return canvasTex(256, 64, (g, Wd, Ht) => {
    const cy = Ht / 2, x0 = 6, L = Wd - 12, wAt = (t) => Ht * 0.42 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9)
    g.beginPath(); g.moveTo(x0, cy)
    for (let i = 0; i <= 60; i++) { const t = i / 60; g.lineTo(x0 + t * L, cy - wAt(t)) }
    for (let i = 60; i >= 0; i--) { const t = i / 60; g.lineTo(x0 + t * L, cy + wAt(t)) }
    g.closePath()
    const gr = g.createLinearGradient(0, 0, Wd, 0)
    gr.addColorStop(0, '#6e5a42'); gr.addColorStop(0.5, '#a4875e'); gr.addColorStop(1, '#8a6a46')
    g.fillStyle = gr; g.fill()
    g.save(); g.clip()
    const r = rng(4)
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '90,50,24' : '200,170,110'},${0.15 + r() * 0.25})`; g.beginPath(); g.ellipse(x0 + r() * L, cy + (r() - 0.5) * Ht * 0.6, 4 + r() * 14, 2 + r() * 5, 0, 0, 7); g.fill() }
    g.restore()
    g.strokeStyle = 'rgba(235,215,160,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + L * 0.97, cy); g.stroke()
  }, { aniso: 4 })
}

/** Twisted jute rope. */
function ropeTex() {
  return canvasTex(64, 256, (g, Wd, Ht) => {
    g.fillStyle = '#9a7a4a'; g.fillRect(0, 0, Wd, Ht)
    for (let y = -Wd; y < Ht + Wd; y += 16) {
      const gr = g.createLinearGradient(0, y, Wd, y + Wd * 0.6)
      gr.addColorStop(0, '#5e4426'); gr.addColorStop(0.5, '#d2b27a'); gr.addColorStop(1, '#6e5030')
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y + Wd * 0.6); g.lineTo(Wd, y + Wd * 0.6 + 12); g.lineTo(0, y + 12); g.closePath(); g.fill()
    }
    const r = rng(6)
    for (let i = 0; i < 300; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '240,220,170' : '60,40,20'},${0.2 + r() * 0.3})`; g.lineWidth = 0.8; const x = r() * Wd, y = r() * Ht; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 3 + r() * 4); g.stroke() }
  }, { repeat: true })
}

export default class Crate extends Stage {
  constructor(engine) {
    super(engine, { near: 0.12, far: 3000 })
    const sc = this.scene, T = this.tier
    this.fov = 32
    this.frame = [0.13, -0.04]
    this.framePortrait = [0, -0.12]
    this.sun.set(-0.62, 0.165, -0.76).normalize()
    this.sunCol.setRGB(1, 0.66, 0.34)
    // The lane: along the sun's bearing (A), rows of trees either side of it (B is across the lane).
    const A = new THREE.Vector3(this.sun.x, 0, this.sun.z).normalize(), B = new THREE.Vector3(-A.z, 0, A.x)
    const lane = (s, b, y = 0) => A.clone().multiplyScalar(s).addScaledVector(B, b).setY(y)
    this.A = A; this.B = B

    // Sky and air: a deep gold horizon, the sun low in the lane, haze that thickens with distance.
    this.sky = skyDome(); sc.add(this.sky)
    const su = this.sky.userData.u
    su.uTop.value.set('#4a5d8c'); su.uHor.value.set('#ea9450'); su.uBot.value.set('#3a2a14')
    su.uSunDir.value.copy(this.sun); su.uSunCol.value.setRGB(1, 0.55, 0.22); su.uSunSize.value = 0.06
    su.uClouds.value = 0.3; su.uSunGlow.value = 0.6; su.uCloudCol.value.set('#ffcf98'); su.uCloudShade.value.set('#9a5a6a'); su.uHaze.value = 0.9
    sc.fog = new THREE.Fog('#c98a56', 160, 2200)

    // Light: the low sun down the lane (rim light, long shadows toward us), a cool sky fill from behind the camera.
    const L = this.sunL = new THREE.DirectionalLight('#ffad66', 4.6)
    L.position.copy(this.sun).multiplyScalar(470) // trees further down the lane than this cast no shadow here
    L.castShadow = true
    L.shadow.mapSize.set(T.shadow, T.shadow)
    Object.assign(L.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 5, far: 1000 })
    L.shadow.bias = -0.0004; L.shadow.normalBias = 0.05
    sc.add(L, L.target)
    this.hemi = new THREE.HemisphereLight('#9fb2d8', '#4a3418', 0.75); sc.add(this.hemi)
    const fill = new THREE.DirectionalLight('#b8c8ff', 0.55); fill.position.set(10, 8, 20); sc.add(fill)
    sc.environment = engine.env({ top: '#5a78a0', mid: '#ffb070', bottom: '#3a2a14', sun: '#ffc080', sunDir: this.sun.clone(), sunPower: 4 })

    // ---- The orchard floor: grass in the lane, leaf litter and bare earth under the rows, long shade bands.
    const gm = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
    this.groundU = { uA: { value: new THREE.Vector2(A.x, A.z) }, uB: { value: new THREE.Vector2(B.x, B.z) } }
    gm.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.groundU)
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;')
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW; uniform vec2 uA; uniform vec2 uB;\n${NOISE}`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          vec2 xz = vW.xz; float la = dot(xz, uA), lb = dot(xz, uB);
          float rowD = abs(mod(lb, 200.) - 100.);
          float under = 1. - smoothstep(34., 70., rowD + (mmNoise(vec3(xz * .03, 1.)) - .5) * 30.);
          float n1 = mmFbm(vec3(xz * .045, 2.)), n2 = mmFbm(vec3(xz * .6, 5.)), n3 = mmNoise(vec3(xz * 3.1, 7.));
          vec3 grass = mix(vec3(.13, .13, .035), vec3(.32, .24, .07), smoothstep(.25, .7, n1));
          grass = mix(grass, vec3(.34, .25, .09), smoothstep(.62, .8, mmFbm(vec3(xz * .02, 9.))) * .7);
          vec3 litter = mix(vec3(.12, .07, .035), vec3(.24, .15, .07), n2);
          vec3 c = mix(grass, litter, under);
          c *= .7 + .5 * n2 + .15 * (n3 - .5);
          float blade = mmNoise(vec3(xz.x * 1.7, xz.y * 1.7, 0.) + vec3(mmNoise(vec3(xz * 6., 2.)) * 2.));
          c *= .82 + .36 * blade;
          c = mix(c, vec3(.36, .28, .08), smoothstep(.55, .75, mmFbm(vec3(xz * .11, 4.))) * (1. - under) * .5);
          // the far rows' shadows (beyond the sun's shadow map): long bands along the rows, flecked with sun
          float far = smoothstep(55., 110., length(xz));
          float fleck = smoothstep(.62, .72, mmFbm(vec3(la * .05, lb * .22, 3.)));
          c *= mix(1., mix(.32, .9, fleck), under * far);
          // cart tracks down the lane: two packed ruts with a lip of loose dust, tread marks across them
          float tr = 0.;
          for (int k = 0; k < 2; k++) { float w = abs(lb - (k == 0 ? 9. : 16.) - sin(la * .021) * 2.5); tr = max(tr, 1. - smoothstep(.5, 1.3, w)); c = mix(c, vec3(.36, .27, .14) * (.8 + .4 * n3), smoothstep(1.2, 1.7, w) * (1. - smoothstep(1.7, 2.6, w)) * .7); }
          float tread = .85 + .15 * step(.5, fract(la * .9));
          c = mix(c, vec3(.13, .095, .05) * tread * (.85 + .3 * n2), tr * .9);
          // long soft shadows of trees further down the lane, lying along the light toward us
          float sh = 0.;
          sh = max(sh, (1. - smoothstep(2., 7., abs(lb + 24. + la * .01))) * smoothstep(-60., -10., la) * (1. - smoothstep(230., 260., la)));
          sh = max(sh, (1. - smoothstep(1.5, 6., abs(lb - 33. - la * .008))) * smoothstep(-40., 20., la) * (1. - smoothstep(300., 330., la)));
          sh = max(sh, (1. - smoothstep(4., 12., abs(lb - 2. + la * .02))) * smoothstep(140., 190., la) * (1. - smoothstep(330., 360., la)));
          c *= 1. - sh * .55 * (1. - under);
          // a bright pool where the sun comes straight down the lane
          float pool = exp(-lb * lb / 900.) * smoothstep(-40., 60., la) * (1. - smoothstep(160., 360., la));
          c = mix(c, c * vec3(1.9, 1.6, 1.05) + vec3(.03, .02, 0.), pool * (1. - sh) * .8);
          diffuseColor.rgb = c;`)
        // the sun rakes across the floor: give its direct light more weight here, so lit and shaded ground part clearly
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 2.6; reflectedLight.indirectDiffuse *= .85;')
    }
    gm.customProgramCacheKey = () => 'orchardFloor'
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), gm)
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true
    sc.add(this.ground)

    // Grass: tufts of fine blades round the crate and toward the camera, glowing where the sun comes through them.
    {
      const blades = []
      for (let k = 0; k < 4; k++) {
        const bl = new THREE.PlaneGeometry(0.06, 1, 1, 2); bl.translate(0, 0.5, 0)
        const bp = bl.attributes.position, lean = 0.15 + k * 0.08, h = 0.7 + (k % 3) * 0.25
        for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setXYZ(i, bp.getX(i) * (1 - y * 0.85), y * h, y * y * lean) }
        bl.rotateY(k * 1.26 + 0.3); bl.translate(Math.cos(k * 2.1) * 0.12, 0, Math.sin(k * 2.1) * 0.12)
        blades.push(bl)
      }
      const tuft = mergeGeometries(blades); tuft.computeVertexNormals()
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide })
      this.grassU = { uTime: { value: 0 }, uSunView: { value: new THREE.Vector3() }, uSunCol: { value: this.sunCol } }
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, this.grassU)
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec3 ip = instanceMatrix[3].xyz; float ph = ip.x * .3 + ip.z * .2;
            transformed.x += sin(uTime * 1.6 + ph) * .05 * position.y * position.y; transformed.z += cos(uTime * 1.2 + ph) * .035 * position.y;`)
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 4.);
              totalEmissiveRadiance += diffuseColor.rgb * vec3(1.2, 1.05, .5) * uSunCol * back * .7; }`)
      }
      mat.customProgramCacheKey = () => 'orchardGrass'
      const n = T.name === 'high' ? 3000 : T.name === 'mid' ? 1100 : 700
      this.grass = new THREE.InstancedMesh(tuft, mat, n)
      const r = rng(55), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color()
      for (let i = 0; i < n; i++) {
        // round the crate and the camera, and in a long strip down the lit lane toward the sun
        let x, z, dist
        if (r() < 0.55) { const ang = r() * 6.28; dist = Math.pow(r(), 0.65) * 120; x = Math.cos(ang) * dist + 6; z = Math.sin(ang) * dist * 0.7 + 14 }
        else { const sA = lerp(-40, 420, Math.pow(r(), 1.3)), bB = (r() - 0.5) * 2 * lerp(30, 70, r()); x = A.x * sA + B.x * bB; z = A.z * sA + B.z * bB; dist = Math.max(0, sA * 0.3) }
        if (Math.abs(x) < W / 2 + 0.1 && Math.abs(z) < D / 2 + 0.1) { i--; continue }
        // patchy: thinner where the noise says so, and shorter toward the edge of the patch
        const patch = 0.5 + 0.5 * Math.sin(x * 0.09 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.11 - x * 0.03)
        if (r() > 0.35 + patch * 0.65) { i--; continue }
        q.setFromEuler(e.set((r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3))
        const h = (0.8 + Math.pow(r(), 2) * 1.8) * (0.5 + patch * 0.6) * (1 - smooth(90, 125, dist) * 0.5) * (1 + smooth(40, 400, dist) * 1.2)
        this.grass.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1 + r() * 0.8, h, 1 + r() * 0.8)))
        const dry = r()
        this.grass.setColorAt(i, dry < 0.5 ? c.setRGB(0.36 + r() * 0.16, 0.3 + r() * 0.12, 0.1) : c.setRGB(0.16 + r() * 0.1, 0.22 + r() * 0.12, 0.06))
      }
      this.grass.receiveShadow = true
      sc.add(this.grass)
    }
    // Fallen leaves round the crate and under the rows.
    {
      const lg = new THREE.PlaneGeometry(1, 0.26, 3, 1); lg.rotateX(-Math.PI / 2)
      const p = lg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.abs(p.getZ(i)) * 0.4 + p.getX(i) * p.getX(i) * 0.1)
      lg.computeVertexNormals()
      const n = Math.round(900 * T.particles + 200)
      const lmat = new THREE.MeshStandardMaterial({ map: dryLeafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 })
      this.litterU = { uSunView: { value: new THREE.Vector3() }, uSunCol: { value: this.sunCol } }
      lmat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.litterU)
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = step(.84, fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453));')
        // a few leaves stand curled up off the soil and the low sun shines through them, copper
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol; varying float vLit;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 2.);
              totalEmissiveRadiance += diffuseColor.rgb * vec3(1.6, .9, .4) * uSunCol * (back * 1.2 + .25) * vLit; }`)
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vec3(1., .92, .74);')
      }
      lmat.customProgramCacheKey = () => 'orchardLitter'
      this.litter = new THREE.InstancedMesh(lg, lmat, n)
      const r = rng(66), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color()
      for (let i = 0; i < n; i++) {
        const under = r() < 0.55
        let pt
        if (under) pt = lane(lerp(-40, 380, r()), (r() < 0.5 ? -100 : 100) + (r() - 0.5) * 90)
        else { const ang = r() * 6.28, d = 6 + Math.pow(r(), 1.6) * 60; pt = new THREE.Vector3(Math.cos(ang) * d, 0, Math.sin(ang) * d * 0.8 + 4) }
        if (Math.abs(pt.x) < W / 2 + 0.3 && Math.abs(pt.z) < D / 2 + 0.3) { i--; continue }
        q.setFromEuler(e.set((r() - 0.5) * (r() < 0.25 ? 1.2 : 0.3), r() * 6.28, (r() - 0.5) * 0.5))
        const s = (under ? 3 : 2.4) * (0.7 + r() * 0.6)
        this.litter.setMatrixAt(i, m4.compose(pt.setY(0.08 + r() * 0.1), q, new THREE.Vector3(s, s, s)))
        this.litter.setColorAt(i, c.setRGB(0.8 + r() * 0.4, 0.75 + r() * 0.35, 0.65 + r() * 0.3))
      }
      this.litter.receiveShadow = true
      sc.add(this.litter)
    }

    // ---- The rows of trees, the lane between them running into the sun; a tree across the lane's end holds the sun
    // in its crown, so the light comes through in shafts.
    const trees = [], r = rng(14)
    for (const b of [-500, -300, -100, 100, 300, 500]) {
      for (let s = -260 + (b % 170 === 0 ? 0 : 0); s < 1150; s += 128) {
        const sj = s + (r() - 0.5) * 24 + (Math.abs(b) % 400 === 100 ? 0 : 64)
        const near = Math.abs(b) < 200 && sj < 700
        trees.push({ ...xz(lane(sj, b + (r() - 0.5) * 10)), s: 0.92 + r() * 0.16, rot: r() * 6.28, lod: near ? 1 : Math.abs(b) < 400 ? 0.55 : 0.4, fruit: near })
      }
    }
    trees.push({ ...xz(lane(560, 18)), s: 1.18, rot: 1.2, lod: 0.8, fruit: false })
    trees.push({ ...xz(lane(700, -60)), s: 1.1, rot: 2.6, lod: 0.6, fruit: false })
    function xz(v) { return { x: v.x, z: v.z } }
    // Only the trees whose shadows can reach the crate's light (the near rows, up the lane to the shadow map's end) cast.
    const casts = (tr) => { const s = tr.x * A.x + tr.z * A.z, b = tr.x * B.x + tr.z * B.z; return Math.abs(b) < 150 && s > -120 && s < 480 }
    const hi = T.name === 'high', cards = hi ? 9 : T.name === 'mid' ? 5 : 4
    this.orchard = orchardTrees(trees.filter(casts), { cards, seed: 3, fruit: hi })
    this.orchardFar = orchardTrees(trees.filter((tr) => !casts(tr)).map((tr) => (hi ? tr : { ...tr, lod: tr.lod * 0.7, fruit: false })), { cards, seed: 3, shadow: false })
    sc.add(this.orchard, this.orchardFar)
    this.fol = this.orchard.userData.foliage; this.folFar = this.orchardFar.userData.foliage
    for (const o of [this.orchard, this.orchardFar]) if (o.userData.fruit) o.userData.fruit.material.envMapIntensity = 0.5

    // A ladder against a tree on the right, a second crate and baskets of fruit further down the lane.
    {
      const tp = lane(150, 100), base = tp.clone().addScaledVector(B, -26), top = tp.clone().addScaledVector(B, -5).setY(58)
      const dir = top.clone().sub(base), len = dir.length(); dir.normalize()
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
      const woodM = new THREE.MeshStandardMaterial({ map: plankTexture(), color: '#b0a090', roughness: 0.9 })
      const lad = new THREE.Group()
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      for (const sx of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.9, len, 0.6), woodM); rail.position.copy(base).addScaledVector(dir, len / 2).addScaledVector(side, sx * 4.5); rail.quaternion.copy(q); rail.castShadow = true; lad.add(rail) }
      for (let k = 1; k < 12; k++) { const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 9, 6), woodM); rung.position.copy(base).addScaledVector(dir, k * len / 12); rung.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), side); rung.castShadow = true; lad.add(rung) }
      sc.add(lad)
    }
    this.props = new THREE.Group(); sc.add(this.props)
    {
      // the second crate (simple boards), full, a little way down the lane
      const c2 = new THREE.Group(), pm = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85, color: '#d8c0a0' })
      const bx = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pm); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; c2.add(m) }
      for (const y of [0.6, 1.6, 2.55]) { bx(W, 0.85, 0.16, 0, y, D / 2 - 0.08); bx(W, 0.85, 0.16, 0, y, -D / 2 + 0.08); bx(0.16, 0.85, D, W / 2 - 0.08, y, 0); bx(0.16, 0.85, D, -W / 2 + 0.08, y, 0) }
      const items = []; const rr = rng(8)
      for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) items.push({ x: -W / 2 + 1.05 + col * 1.58, y: BED + 0.5 + rr() * 0.3, z: -2.05 + row * 2.0, yaw: rr() * 6.28, roll: (rr() - 0.5) * 0.4, ripe: 0.4 + rr() * 0.5 })
      c2.add(mangoCrowd(items, T.name === 'high' ? 0.3 : 0.18))
      c2.add(strawStrands(220, -W / 2 + 0.3, W / 2 - 0.3, -D / 2 + 0.3, D / 2 - 0.3, 2.4, { seed: 12, spread: 0.6 }))
      c2.position.copy(lane(78, 22)); c2.rotation.y = 0.5
      this.props.add(c2)
      // baskets heaped with fruit
      const bk = [[60, -18, 4.2, 4.6], [104, -30, 3.6, 4.0], [96, 40, 3.9, 4.3]]
      bk.forEach(([s, b, rad, h], k) => {
        const g = new THREE.Group(), m = basketMesh(rad, h, k + 2); g.add(m)
        const it = []; const rr2 = rng(k + 30)
        for (let j = 0; j < 9; j++) { const a = j * 2.4, d = j === 0 ? 0 : rad * 0.55; it.push({ x: Math.cos(a) * d, y: h + 0.3 + (j === 0 ? 0.9 : 0), z: Math.sin(a) * d, yaw: rr2() * 6.28, roll: (rr2() - 0.5) * 0.5, ripe: 0.5 + rr2() * 0.4 }) }
        g.add(mangoCrowd(it, T.name === 'high' ? 0.25 : 0.16))
        g.position.copy(lane(s, b)); this.props.add(g)
      })
    }

    // ---- The crate: weathered boards (rounded edges, grain, knots), nails, rope handles, straw inside.
    this.crate = new THREE.Group(); sc.add(this.crate)
    const pt = plankTexture()
    const woodM = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.78, color: '#f2dcc0', bumpMap: pt, bumpScale: 0.6 })
    const postM = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.85, color: '#c4a582', bumpMap: pt, bumpScale: 0.6 })
    const br = rng(91)
    const board = (w, h, d, x, y, z, m = woodM, vertical = false) => {
      const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.05, Math.min(w, h, d) * 0.3))
      if (vertical) g.rotateZ(Math.PI / 2)
      const uv = g.attributes.uv, row = Math.floor(br() * 8), off = br(), len = Math.max(w, h, d) / 10
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len + off, (row + 0.1 + uv.getY(i) * 0.8) / 8)
      const b = new THREE.Mesh(g, m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true
      this.crate.add(b); return b
    }
    board(W, 0.18, D, 0, 0.09, 0, postM)
    const slats = [[0.6, 0.85], [1.6, 0.85], [2.56, 0.8]]
    for (const [y, h] of slats) {
      board(W, h, 0.16, 0, y, D / 2 - 0.08); board(W, h, 0.16, 0, y, -D / 2 + 0.08)
      for (const sx of [-1, 1]) board(D - 0.32, h, 0.16, sx * (W / 2 - 0.08), y, 0).rotation.y = Math.PI / 2
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) board(H, 0.36, 0.36, sx * (W / 2 - 0.18), H / 2, sz * (D / 2 - 0.18), postM, true)
    // Nail heads: two per slat end, on every face.
    {
      const ng = new THREE.CylinderGeometry(0.055, 0.06, 0.03, 8); ng.rotateX(Math.PI / 2)
      const P = []
      for (const [y] of slats) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const dy of [-0.2, 0.2]) {
        P.push([sx * (W / 2 - 0.18), y + dy, sz * (D / 2 + 0.005), 0])
        P.push([sx * (W / 2 + 0.005), y + dy, sz * (D / 2 - 0.18), 1])
      }
      const nm = new THREE.InstancedMesh(ng, new THREE.MeshStandardMaterial({ color: '#4a4038', metalness: 0.75, roughness: 0.45 }), P.length)
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion()
      P.forEach(([x, y, z, side], i) => nm.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), side ? q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) : q.identity(), new THREE.Vector3(1, 1, 1))))
      this.crate.add(nm)
    }
    // Rope handles: a loop through each end board.
    {
      const rt = ropeTex(); rt.repeat.set(1, 14)
      const rm = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.95, color: '#ffffff' })
      for (const sx of [-1, 1]) {
        const x0 = sx * (W / 2 + 0.06)
        const g = taperTube([new THREE.Vector3(x0, 2.4, -0.95), new THREE.Vector3(sx * (W / 2 + 0.3), 1.85, -0.75), new THREE.Vector3(sx * (W / 2 + 0.44), 1.28, 0), new THREE.Vector3(sx * (W / 2 + 0.3), 1.85, 0.75), new THREE.Vector3(x0, 2.4, 0.95)], 0.075, 0.075, 30, 6)
        const rope = new THREE.Mesh(g, rm); rope.castShadow = true; this.crate.add(rope)
        for (const z of [-0.95, 0.95]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), rm); k.position.set(x0, 2.4, z); this.crate.add(k) }
      }
    }
    // Straw: a bed, ribbons over it, strands caught on the rims and a few on the ground.
    const bedT = strawBedTexture(); bedT.repeat.set(2, 1.4)
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.4, D - 0.4, 24, 16), new THREE.MeshStandardMaterial({ map: bedT, roughness: 0.9 }))
    { const p = bed.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 1.7) * Math.cos(p.getY(i) * 2.1) * 0.12); bed.geometry.computeVertexNormals() }
    bed.rotation.x = -Math.PI / 2; bed.position.y = BED; bed.receiveShadow = true
    this.crate.add(bed)
    this.straws = []
    const sw = (m) => { this.straws.push(m); this.crate.add(m); return m }
    sw(strawStrands(T.name === 'high' ? 2800 : Math.round(1700 * T.particles), -W / 2 + 0.4, W / 2 - 0.4, -D / 2 + 0.4, D / 2 - 0.4, BED, { seed: 3, spread: 0.6 }))
    for (const sz of [-1, 1]) sw(strawStrands(40, -W / 2 + 0.3, W / 2 - 0.3, sz * (D / 2 - 0.12) - 0.18, sz * (D / 2 - 0.12) + 0.18, H - 0.04, { seed: sz > 0 ? 9 : 10, spread: 0.1, tilt: 1.2, len: [0.9, 2] }))
    for (const sx of [-1, 1]) sw(strawStrands(18, sx * (W / 2 - 0.12) - 0.18, sx * (W / 2 - 0.12) + 0.18, -D / 2 + 0.3, D / 2 - 0.3, H - 0.04, { seed: sx > 0 ? 19 : 20, spread: 0.1, tilt: 1.2, len: [0.9, 2] }))
    // straw spilled round the crate: a scatter, thickest by the ends where it was carried in, a few wisps further off
    for (const [cx, cz, w, d, nn, sd] of [[0, 0, W + 8, D + 8, 120, 31], [-W / 2 - 2, 1, 4, 5, 70, 32], [W / 2 + 2.5, -1, 5, 4, 70, 33], [3, D / 2 + 4, 10, 5, 50, 34]]) {
      const gs = strawStrands(Math.round(nn * (0.5 + 0.5 * T.particles)), cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 0.04, { seed: sd, spread: 0.06, tilt: 0.15 })
      gs.castShadow = false; this.straws.push(gs); sc.add(gs)
    }

    // Mangoes of every ripeness, lying in rows; a gap in the front row for ours.
    const items = []
    for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
      const x = -W / 2 + 1.05 + col * 1.58 + (r() - 0.5) * 0.15, z = -2.05 + row * 2.0 + (r() - 0.5) * 0.12
      if (Math.abs(x - SLOT.x) < 0.8 && Math.abs(z - SLOT.z) < 0.8) continue
      items.push({ x, y: BED + 0.5 + r() * 0.06, z, yaw: (r() - 0.5) * 0.5 + (r() < 0.5 ? Math.PI : 0), roll: (r() - 0.5) * 0.4, ripe: [0.15, 0.4, 0.62, 0.8, 0.95, 0.3, 0.7][Math.floor(r() * 7)] + r() * 0.08 })
    }
    this.crowd = mangoCrowd(items, hi ? 0.4 : 0.26)
    this.crowd.material.envMapIntensity = 0.5; this.crowd.material.clearcoat = 0.1
    this.crate.add(this.crowd)

    // Our mango, in the picker's hand.
    this.mango = new Mango({ ripe: 0.86, leaf: true, detail: 1 })
    this.mango.rotation.order = 'YXZ'
    sc.add(this.mango)
    this.hand = new Hand({ sleeve: '#174631' })
    this.handQ = handQuat(new THREE.Vector3(-0.8, 0.12, 0.55), new THREE.Vector3(0.1, 1, 0.25))
    sc.add(this.hand)
    // Two hands that lift the crate by its rope handles.
    this.lift = [new Hand({ sleeve: '#174631' }), new Hand({ sleeve: '#174631', left: true })]
    this.liftQ = [handQuat(new THREE.Vector3(0, -0.42, 0.9), new THREE.Vector3(-1, 0, 0)), handQuat(new THREE.Vector3(0, -0.42, 0.9), new THREE.Vector3(1, 0, 0))]
    this.lift.forEach((h) => sc.add(h))

    // Air: dust and chaff turning in the sun round the crate, soft discs of light down the lane.
    this.dust = motes(Math.round(260 * T.particles + 60), new THREE.Box3(new THREE.Vector3(-22, 0.5, -24), new THREE.Vector3(26, 16, 22)), { size: 0.05, color: '#ffd59a', drift: 0.6, opacity: 0.85, seed: 5, sizeVar: 1.6 })
    sc.add(this.dust)
    this.chaff = motes(Math.round(40 * T.particles + 12), new THREE.Box3(new THREE.Vector3(-10, 1, -8), new THREE.Vector3(14, 9, 10)), { size: 0.14, color: '#ffe2a0', drift: 0.9, opacity: 0.7, seed: 11, sizeVar: 1 })
    sc.add(this.chaff)
    this.bokeh = motes(Math.round(50 * T.particles + 16), new THREE.Box3(new THREE.Vector3(-140, 20, -260), new THREE.Vector3(60, 110, -120)), { size: 9, color: '#ffc070', drift: 2, opacity: 0.35, seed: 3, sizeVar: 1.4 })
    sc.add(this.bokeh)
    this.q0 = new THREE.Quaternion(); this.q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0.28, 0.05, 'YXZ'))
    this.tmpQ = new THREE.Quaternion()
    this.sunPt = new THREE.Vector3()
  }

  update(i, tt, time) {
    const t = clamp(tt, -0.2, 1)
    // Beats: lower (−0.14…0.3), roll into the straw (0.3…0.46), the hand opens and leaves (0.34…0.56),
    // crane up (0.4…0.7), lift (0.64…0.95).
    const lower = easeInOut(clamp((t + 0.14) / 0.44))
    const roll = clamp((t - 0.3) / 0.16)
    const away = easeInOut(clamp((t - 0.36) / 0.22))
    // The crate stays where it was packed while the camera pulls back. It used to be lifted by two gloved hands, but a
    // hand here is a sleeve with nobody behind it: in the wide shot the arms either ran into the ground or ended in the
    // air. (The lifting hands are kept below, switched off.)
    const lift = 0
    const crane = smoother(0.3, 0.66, t)
    const wide = smoother(0.62, 0.98, t)

    // The crate rises with a slight tilt; everything in it rides along.
    this.crate.position.set(0, lift * 2.6, 0)
    this.crate.rotation.set(Math.sin(lift * Math.PI) * 0.03, 0, Math.sin(lift * Math.PI) * -0.025)
    this.crate.updateMatrixWorld()

    // Our mango: held upright in the palm, lowered over its gap, then rolls onto its side in the straw.
    const held = new THREE.Vector3(lerp(2.2, SLOT.x + 0.25, lower), lerp(7.2, SLOT.y + 1.25, lower), lerp(3.0, SLOT.z + 0.1, lower))
    const rest = this.crate.localToWorld(SLOT.clone())
    const k = settle(roll)
    this.mango.position.copy(held).lerp(rest, k)
    this.q0.setFromEuler(new THREE.Euler(0, -0.4, 0.18, 'YXZ'))
    this.tmpQ.copy(this.q1).premultiply(new THREE.Quaternion().setFromEuler(this.crate.rotation))
    this.mango.quaternion.slerpQuaternions(this.q0, this.tmpQ, smooth(0, 0.85, roll))
    this.mango.position.y += Math.sin(clamp(roll * 1.3) * Math.PI) * 0.25

    // The hand under it, tilting to let it roll, opening, withdrawing up and to the right.
    const hand = this.hand
    hand.visible = t < 0.6
    const handAt = held.clone().add(new THREE.Vector3(0.05, -1.25, 0.05)).add(new THREE.Vector3(2.6, 3.2, 1.2).multiplyScalar(away))
    hand.position.copy(handAt)
    hand.quaternion.copy(this.handQ).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.6, 0, 0.8).normalize(), -smooth(0.26, 0.4, t) * 0.5))
    hand.pose(lerp(0.9, 0.25, smooth(0.3, 0.42, t)), lerp(0.12, 0.4, smooth(0.3, 0.42, t)), lerp(1, 0.3, smooth(0.3, 0.42, t)))

    // Lifting hands come in from the ends, take the rope handles, and rise with the crate.
    const reach = easeInOut(clamp((t - 0.56) / 0.12))
    this.lift.forEach((h, j) => {
      const sx = j === 0 ? 1 : -1
      h.visible = false
      const grip = this.crate.localToWorld(new THREE.Vector3(sx * (W / 2 + 0.42), 1.25, 0))
      h.position.copy(grip).add(new THREE.Vector3(sx * 2.2 * (1 - reach), 3.2 * (1 - reach), -3.0 * (1 - reach)))
      h.quaternion.copy(this.liftQ[j])
      h.pose(lerp(0.2, 0.85, smooth(0.6, 0.68, t)), 0.1, 0.6)
    })

    // Camera: close on the fruit in the hand, level enough to see down the lane behind it → follow it down → crane up
    // over the crate → pull back wide and low as the crate is lifted against the sun.
    const mp = this.mango.position
    const close = mp.clone().add(new THREE.Vector3(2.6, 2.2, 7.6))
    const over = new THREE.Vector3(9, 15, 15)
    const wideP = new THREE.Vector3(15, 6.5, 26)
    const cam = close.clone().lerp(over, crane).lerp(wideP, wide)
    const crateC = this.crate.localToWorld(new THREE.Vector3(0, 2.2, 0.5))
    const tgt = mp.clone().lerp(crateC, crane).lerp(crateC.clone().add(new THREE.Vector3(-2, 1.6, -4)), wide)
    aim(this.camera, cam, tgt, 0)
    this.post.focus = cam.distanceTo(tgt)
    this.post.range = lerp(1.6, 7, crane)
    this.post.dof = lerp(12, 7, crane)
    this.focus.copy(this.mango.position)

    this.look.bloom = 0.45; this.look.threshold = 1.0; this.look.bloomRadius = 0.6; this.look.exposure = 0.98; this.look.vig = 0.6
    this.look.rays = lerp(0.7, 0.9, wide); this.look.rayThreshold = 1.25; this.look.rayTint.setRGB(1, 0.72, 0.4)
    this.grade([0.016, 0.006, 0], [1.05, 0.98, 0.88], 1.08)
    for (const m of [this.dust, this.chaff, this.bokeh]) m.userData.u.uTime.value = time
    this.sky.userData.u.uTime.value = time
    this.fol.userData.u.uTime.value = time; this.folFar.userData.u.uTime.value = time
    this.grassU.uTime.value = time
  }

  afterCamera() {
    this.mango.tick(3, this.sunView, this.sunCol)
    this.mango.u.uRim.value = 1.6
    this.crowd.material.userData.u.uSunView.value.copy(this.sunView)
    this.crowd.material.userData.u.uSunCol.value.copy(this.sunCol)
    for (const f of [this.fol, this.folFar]) { const fu = f.userData.u; fu.uSunView.value.copy(this.sunView); fu.uSunCol.value.copy(this.sunCol) }
    for (const s of this.straws) { const su = s.material.userData.u; su.uSunView.value.copy(this.sunView); su.uSunCol.value.copy(this.sunCol) }
    this.grassU.uSunView.value.copy(this.sunView); this.litterU.uSunView.value.copy(this.sunView)
    for (const o of [this.orchard, this.orchardFar]) if (o.userData.fruit) { const fr = o.userData.fruit.material.userData.u; fr.uSunView.value.copy(this.sunView); fr.uSunCol.value.copy(this.sunCol) }
  }
}
