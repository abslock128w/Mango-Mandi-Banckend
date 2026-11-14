// Chapters 4 and 5: the fruit, then the pick. One continuous set in the canopy.
// 4 "And one flower becomes this": extreme close-up, shallow focus; the fruitlet swells into our mango, matte green to
//   waxed green, dew beads, dappled light moving through the leaves.
// 5 "Before it falls": the season turns gold, the mango ripens and sways heavier; time slows (bullet-time: motes and
//   leaves nearly freeze, a radial blur); the picker's gloved hand in the VMR Mangoes sleeve rises and takes it as the
//   stalk snaps; one leaf spins away. A ghost mango falls and bruises below: what does not happen.
import * as THREE from 'three'
import { Stage, aim, skyDome, motes } from './stage.js'
import { Mango, STEM_POINT, leafGeometry, leafMaterial, leafDepthMaterial, stemMesh, ghostMaterial, mangoGeometry, mangoPoint } from '../lib/mango.js'
import { Hand, rimUniforms } from '../lib/hand.js'
import { NOISE } from '../lib/glsl.js'
import { bokehDiscs } from './crate-kit.js'
import { rng, smooth, smoother, lerp, clamp, easeInOut, expoOut, backOut, canvasTex } from '../lib/util.js'

const STEM_TOP = STEM_POINT.clone().add(new THREE.Vector3(0.03, 0.18, 0.01))
const ATTACH = new THREE.Vector3(0.05, 1.05, 0) // where the peduncle meets the stem stub (world, full size)

/** The canopy seen from inside it: layered leaf masses with holes of bright sky, brighter toward the sun. */
function canopyScreen() {
  const u = {
    uSun: { value: new THREE.Vector3(0, 0.6, -1) }, uSky: { value: new THREE.Color(1.6, 1.7, 1.2) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.6) },
    uLeafA: { value: new THREE.Color(0.012, 0.035, 0.01) }, uLeafB: { value: new THREE.Color(0.12, 0.26, 0.04) }, uT: { value: 0 }, uWind: { value: 0 }, uHole: { value: 0.64 }, uGlow: { value: 0 }, uTL: { value: 0 }, uTLK: { value: 0.46 }, uRes: { value: new THREE.Vector2(1, 1) }, uRect: { value: new THREE.Vector4(0, 0.5, 0.5, 1) },
  }
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: u, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uSky, uSunCol, uLeafA, uLeafB; uniform float uT, uWind, uHole, uGlow, uTL, uTLK; uniform vec2 uRes; uniform vec4 uRect; varying vec3 vD;
      ${NOISE}
      // round out-of-focus discs of sky between the leaves: two sizes of cells, each maybe holding one disc
      float discs(vec2 p, float sc, float seed, float bias, out float br){
        vec2 q = p * sc, c = floor(q), f = fract(q) - .5;
        float h = mmHash2(c + seed), h2 = mmHash2(c + seed + 17.3), h3 = mmHash2(c + seed + 41.9);
        vec2 o = (vec2(h2, h3) - .5) * .16; float rad = .18 + .24 * h3;
        float dd = length(f - o);
        float on = step(1. - (.2 + bias), h);
        br = .2 + 1.7 * h2 * h2 * h2;
        return on * smoothstep(rad, rad * .82, dd) * (1. + .35 * smoothstep(rad * .6, rad * .95, dd));
      }
      void main(){
        vec3 d = normalize(vD);
        vec2 p = vec2(atan(d.x, -d.z) * 2.2, d.y * 2.4);
        vec2 w = vec2(sin(uWind * .7 + p.y * 3.), cos(uWind * .5 + p.x * 2.)) * .015;
        float n = mmFbm2(p * 2.1 + w + vec2(uT * .05, 0.));
        float lv = mmNoise2(p * 15. + w * 6. + 3.1) * .6 + mmNoise2(p * 31. + 7.) * .4;
        float sd = max(dot(d, normalize(uSun)), 0.);
        float b1, b2, b3;
        float bias = pow(sd, 2.) * .35 + smoothstep(-.2, .5, d.y) * .08 - .06;
        float h1 = discs(p + w, 2.2, 1., bias, b1), h2 = discs(p + w * 2., 4.1, 7., bias, b2), h3 = discs(p + w * 3., 7.3, 13., bias - .05, b3);
        float hole = clamp(max(max(h1 * b1, h2 * b2), h3 * b3 * .8), 0., 1.6);
        float lit = smoothstep(.35, .8, lv) * (.35 + .65 * smoothstep(.4, .6, n));
        vec3 leaves = mix(uLeafA, uLeafB, lit) * (1. + 2.4 * pow(sd, 3.) * uSunCol);
        // a hole is sky seen through leaves: dim and green-gold away from the sun, blazing near it
        vec3 sky = uSky * vec3(.95, 1., .78) * (.45 + 1.7 * pow(sd, 5.)) + uSunCol * pow(sd, 14.) * 8.;
        // below the horizon the holes look down onto the sunlit floor of the orchard
        vec3 floorC = uSky * vec3(.32, .26, .14) * (.6 + .8 * mmNoise2(p * 3.));
        vec3 col = mix(leaves, mix(floorC, sky, smoothstep(-.2, .15, d.y)), min(hole, 1.)) * (1. + .3 * max(hole - 1., 0.));
        col *= mix(.45, 1., smoothstep(-.7, .15, d.y));
        // a broad soft glow round the sun, through the leaves
        col = mix(col, uSunCol * uSky * .9, pow(sd, 3.) * uGlow);
        // keep the place behind the headline warm and plain while it is up
        vec2 sq = gl_FragCoord.xy / uRes;
        float inR = smoothstep(uRect.x - .12, uRect.x + .02, sq.x) * (1. - smoothstep(uRect.z - .02, uRect.z + .16, sq.x)) * smoothstep(uRect.y - .14, uRect.y + .02, sq.y) * (1. - smoothstep(uRect.w - .02, uRect.w + .14, sq.y));
        col = mix(col, uSunCol * uSky * vec3(.95, .78, .42) * uTLK * (.92 + .18 * mmNoise2(p * 2.)), inR * uTL);
        gl_FragColor = vec4(col, 1.);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(85, 64, 32), m)
  mesh.userData.u = u
  mesh.renderOrder = -5
  return mesh
}

/** A ladybird, about 0.16 long along +x, sitting on its belly at the origin (up +y). */
function ladybird() {
  const g = new THREE.Group()
  const spots = canvasTex(128, 64, (c, W, H) => {
    c.fillStyle = '#c4160c'; c.fillRect(0, 0, W, H)
    c.fillStyle = '#120808'; c.fillRect(0, 0, W, 3)
    for (const [x, y, r] of [[30, 20, 7], [70, 16, 6], [100, 26, 7], [44, 44, 6], [86, 46, 5], [18, 50, 4]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill() }
  })
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: spots, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }))
  shell.scale.set(0.08, 0.05, 0.065)
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.4 }))
  head.scale.set(0.035, 0.028, 0.04); head.position.set(0.078, 0.012, 0)
  const eyes = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: '#f4efe0', roughness: 0.5 }))
  eyes.scale.set(0.012, 0.012, 0.03); eyes.position.set(0.098, 0.022, 0)
  g.add(shell, head, eyes)
  return g
}

export default class Fruit extends Stage {
  constructor(engine) {
    super(engine)
    const sc = this.scene, T = this.tier
    this.fov = 30
    this.frame = [0.14, 0]
    this.framePortrait = [0, -0.08]
    this.sky = skyDome(); sc.add(this.sky)
    const su = this.sky.userData.u
    su.uClouds.value = 0; su.uHaze.value = 0.8
    this.sky.visible = false
    // The canopy all round, with holes of sky that the sun comes through (they throw the shafts).
    this.screen = canopyScreen(); this.screen.position.set(0, 2, 0); sc.add(this.screen)

    // Light: a low sun behind and above (rim and translucency), a cool fill, sky bounce.
    this.sunL = new THREE.DirectionalLight('#ffe3b0', 3.2)
    this.sunL.castShadow = true
    this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    this.sunL.shadow.camera.left = -6; this.sunL.shadow.camera.right = 6; this.sunL.shadow.camera.top = 6; this.sunL.shadow.camera.bottom = -6
    this.sunL.shadow.camera.near = 1; this.sunL.shadow.camera.far = 40
    this.sunL.shadow.bias = -0.0004; this.sunL.shadow.normalBias = 0.02; this.sunL.shadow.radius = 4
    sc.add(this.sunL, this.sunL.target)
    this.fill = new THREE.DirectionalLight('#cfe0ff', 0.9); this.fill.position.set(-6, 1, 8); sc.add(this.fill)
    this.key = new THREE.DirectionalLight('#fff0d8', 1.6); this.key.position.set(5, 3, 9); sc.add(this.key)
    // A soft warm kicker that rides with the fruit, so it always reads as the jewel of the frame.
    this.kick = new THREE.PointLight('#ffe6b8', 0, 9, 2); sc.add(this.kick)
    this.scene.fog = new THREE.Fog('#c8c890', 30, 150)
    this.hemi = new THREE.HemisphereLight('#fff0d0', '#24361c', 0.9); sc.add(this.hemi)
    this.envDay = engine.env({ top: '#6f9a5a', mid: '#e7d9a0', bottom: '#1d2a14', sun: '#fff3d0', sunDir: new THREE.Vector3(0.4, 0.7, -0.6), sunPower: 4 })
    this.envGold = engine.env({ top: '#5a6a3a', mid: '#ffb860', bottom: '#2a1a0a', sun: '#ffd090', sunDir: new THREE.Vector3(0.6, 0.35, -0.7), sunPower: 7 })
    sc.environment = this.envDay

    // The mango, its stalk and the branch it hangs from.
    this.mango = new Mango({ ripe: 0.05, leaf: true, detail: 1.2 })
    this.fruit = new THREE.Group(); this.fruit.add(this.mango); sc.add(this.fruit)
    this.mango.rotation.y = -0.5
    this.mango.u.uBlushDir.value.set(0.62, 0.55, 0.56).normalize()
    // waxed skin: a clear coat with a soft sheen, so the light slides over it
    Object.assign(this.mango.material, { clearcoat: 0.85, clearcoatRoughness: 0.18, envMapIntensity: 1.3 })
    this.mango.material.sheenColor.set('#e8f4c8')
    this.branch = stemMesh([new THREE.Vector3(-9, 5.6, -2.5), new THREE.Vector3(-3, 5.0, -1.4), new THREE.Vector3(0.4, 4.4, -0.6), new THREE.Vector3(4, 4.9, 0.2), new THREE.Vector3(10, 6.2, 1)], 0.32, 0.16, '#5a4630')
    sc.add(this.branch)
    this.pedTop = new THREE.Vector3(0.35, 4.45, -0.6)
    this.ped = this.makePeduncle(); sc.add(this.ped)
    this.pedStub = null

    // Leaves: a whorl above the fruit, a background screen (out of focus), and a few very near (blurred foreground).
    const lm = this.leafMat = leafMaterial({ wind: 0.02, transl: 1.9 })
    // Leaves thin out (a dithered fade) where the headline sits, while it needs a plain gold ground.
    {
      const su0 = this.screen.userData.u, base = lm.onBeforeCompile
      lm.onBeforeCompile = (sh, rr) => {
        base(sh, rr)
        Object.assign(sh.uniforms, { uTL: su0.uTL, uRes: su0.uRes, uRect: su0.uRect })
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTL; uniform vec2 uRes; uniform vec4 uRect;')
          .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
            { vec2 sq = gl_FragCoord.xy / uRes;
              float inR = smoothstep(uRect.x - .1, uRect.x + .06, sq.x) * (1. - smoothstep(uRect.z - .06, uRect.z + .14, sq.x)) * smoothstep(uRect.y - .12, uRect.y + .06, sq.y) * (1. - smoothstep(uRect.w - .06, uRect.w + .12, sq.y));
              if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) < inR * uTL) discard; }`)
      }
      lm.customProgramCacheKey = () => 'leafClear'
    }
    const lg = leafGeometry(1, 0.34, 0.22)
    const r = rng(11)
    const L = []
    const add = (n, fn) => { for (let i = 0; i < n; i++) L.push(fn(i)) }
    add(22, (i) => { // the whorl at the branch, around the stalk
      const a = (i / 22) * Math.PI * 2 + r() * 0.3, along = lerp(-2.5, 3.2, r())
      const p = this.branch.userData.curve.getPoint(clamp(0.45 + along / 22, 0, 1))
      return { p, rx: -0.4 - r() * 0.9, ry: a, rz: -0.3 - r() * 0.6, s: 3.2 + r() * 1.6 }
    })
    add(Math.round(70 * T.leaves + 20), () => ({ p: new THREE.Vector3(lerp(-22, 22, r()), lerp(-6, 14, r()), lerp(-12, -26, r())), rx: (r() - 0.5) * 0.8, ry: (r() - 0.5) * 0.8, rz: r() * 6.28, s: 3.5 + r() * 3, k: 0.62 }))
    add(Math.round(90 * T.leaves + 30), () => ({ p: new THREE.Vector3(lerp(-60, 60, r()), lerp(-10, 30, r()), lerp(-30, -55, r())), rx: (r() - 0.5) * 0.8, ry: (r() - 0.5) * 0.8, rz: r() * 6.28, s: 6 + r() * 5, k: 0.4 }))
    add(16, () => ({ p: new THREE.Vector3(lerp(-7, 7, r()), lerp(1.5, 6, r()), lerp(-4, -1, r())), rx: -0.6 - r() * 0.6, ry: r() * 6.28, rz: -0.4 - r() * 0.5, s: 2.8 + r() * 1.5 }))
    add(6, (i) => ({ p: new THREE.Vector3((i % 2 ? 1 : -1) * lerp(6, 9, r()), lerp(-1, 5, r()), lerp(3, 5, r())), rx: r() * 6, ry: r() * 6, rz: r() * 6, s: 3 + r() * 2 }))
    this.leaves = new THREE.InstancedMesh(lg, lm, L.length)
    this.leaves.customDepthMaterial = leafDepthMaterial()
    this.leaves.castShadow = true; this.leaves.receiveShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), c = new THREE.Color()
    L.forEach((l, i) => {
      q.setFromEuler(e.set(l.rx, l.ry, l.rz)); sv.setScalar(l.s)
      this.leaves.setMatrixAt(i, m4.compose(l.p, q, sv))
      this.leaves.setColorAt(i, c.setRGB(0.85 + r() * 0.3, 0.9 + r() * 0.25, 0.8 + r() * 0.2).multiplyScalar(l.k || 1))
    })
    sc.add(this.leaves)
    // The leaf that spins away at the snap.
    this.flyLeaf = new THREE.Mesh(lg, lm); this.flyLeaf.scale.setScalar(2.4); this.flyLeaf.castShadow = true
    this.flyLeaf.customDepthMaterial = leafDepthMaterial()
    sc.add(this.flyLeaf)

    // Dew on the skin (children of the body, so they swell with it).
    const dewG = new THREE.SphereGeometry(1, 14, 10)
    // Water beads read by their light alone: a bright rim, a caustic on the side away from the light, a hard glint.
    this.dewU = { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uCol: { value: new THREE.Color(0.6, 0.9, 0.4) }, uOp: { value: 0 } }
    this.dewMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.dewU,
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ mat4 mw = modelViewMatrix * instanceMatrix; vec4 mv = mw * vec4(position, 1.);
        vN = normalize(mat3(mw) * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uSunView, uCol; uniform float uOp; varying vec3 vN; varying vec3 vV;
        void main(){ vec3 n = normalize(vN), v = normalize(vV), l = normalize(uSunView + vec3(0., .3, 0.)), k = normalize(vec3(.4, .7, .6));
          float fres = pow(1. - clamp(dot(n, v), 0., 1.), 2.5);
          float spec = pow(max(dot(reflect(-l, n), v), 0.), 60.) + pow(max(dot(reflect(-k, n), v), 0.), 160.) * 1.6;
          float caus = smoothstep(.2, .9, dot(n, -k)) * .8;
          gl_FragColor = vec4((uCol * (fres * .55 + caus * .45) + vec3(1., .97, .9) * spec * 2.4) * uOp, 1.); }`,
    })
    const geo = mangoGeometry(0.5), pos = geo.attributes.position, nor = geo.attributes.normal
    const dn = 46
    this.dew = new THREE.InstancedMesh(dewG, this.dewMat, dn)
    const glintP = []
    for (let i = 0; i < dn; i++) {
      let k = 0
      do { k = Math.floor(r() * pos.count) } while (nor.getZ(k) < 0.1 || pos.getY(k) > 0.7)
      const p = new THREE.Vector3().fromBufferAttribute(pos, k), n = new THREE.Vector3().fromBufferAttribute(nor, k)
      const s = 0.008 + Math.pow(r(), 4) * 0.03
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      this.dew.setMatrixAt(i, m4.compose(p.add(n.clone().multiplyScalar(s * 0.2)), q, new THREE.Vector3(s, s * 1.15, s * 0.55)))
      if (s > 0.012) glintP.push(p.x + n.x * s * 0.6, p.y + n.y * s * 0.6, p.z + n.z * s * 0.6)
    }
    this.mango.body.add(this.dew)
    // Glints: the sun caught in single beads, twinkling as the light and the leaves move.
    {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glintP), 3))
      const ph = new Float32Array(glintP.length / 3); for (let i = 0; i < ph.length; i++) ph[i] = r() * 50
      g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1))
      this.glintU = { uTime: { value: 0 }, uOp: { value: 0 }, uPx: { value: 1 }, uCol: { value: new THREE.Color(1, 0.95, 0.8) } }
      this.glints = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, uniforms: this.glintU,
        vertexShader: `attribute float aPh; uniform float uTime, uPx; varying float vB;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); mv.xyz += normalize(-mv.xyz) * .05; gl_Position = projectionMatrix * mv;
            vB = pow(max(sin(uTime * .9 + aPh) * sin(uTime * .37 + aPh * 1.7), 0.), 6.); gl_PointSize = (10. + 30. * vB) * uPx; }`,
        fragmentShader: `uniform float uOp; uniform vec3 uCol; varying float vB;
          void main(){ vec2 c = gl_PointCoord - .5; float st = max(0., 1. - abs(c.x) * 16.) * max(0., 1. - abs(c.y) * 2.2) + max(0., 1. - abs(c.y) * 16.) * max(0., 1. - abs(c.x) * 2.2);
            float core = exp(-dot(c, c) * 90.); gl_FragColor = vec4(uCol * (st * .8 + core * 1.5) * (.15 + vB) * uOp, 1.); }`,
      }))
      this.glints.frustumCulled = false
      this.mango.body.add(this.glints)
    }
    // Drops that run down the skin after the shower.
    {
      this.runs = new THREE.InstancedMesh(dewG, this.dewMat, 6)
      this.runData = Array.from({ length: 6 }, (_, k) => ({ a: Math.PI / 2 + (k - 2.5) * 0.32 + (r() - 0.5) * 0.15, t0: 0.5 + k * 0.035 + r() * 0.03, dur: 0.18 + r() * 0.08, s: 0.022 + r() * 0.012 }))
      this.mango.body.add(this.runs)
    }

    // Bokeh behind, pollen-like motes in the air.
    this.bokeh = bokehDiscs(Math.round(70 * T.particles + 24), new THREE.Box3(new THREE.Vector3(-34, -12, -46), new THREE.Vector3(34, 26, -20)), { size: 2.3, seed: 3, opacity: 0.5 })
    sc.add(this.bokeh)
    // A shower: streaks falling through the light.
    {
      const n = Math.round(420 * T.particles + 120)
      const g = new THREE.PlaneGeometry(0.014, 0.75)
      const sd = new Float32Array(n * 4); for (let i = 0; i < n; i++) sd.set([lerp(-9, 9, r()), lerp(-6, 10, r()), lerp(-7, 5, r()), r()], i * 4)
      g.setAttribute('aS', new THREE.InstancedBufferAttribute(sd, 4))
      this.rainU = { uTime: { value: 0 }, uOp: { value: 0 } }
      this.rain = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.rainU,
        vertexShader: `attribute vec4 aS; uniform float uTime; varying float vA;
          void main(){ vec3 c = aS.xyz; c.y = 10. - mod(10. - aS.y + uTime * (15. + aS.w * 6.), 16.); c.x += c.y * .04;
            vec4 mv = viewMatrix * vec4(c, 1.); mv.xy += position.xy; gl_Position = projectionMatrix * mv; vA = .4 + .6 * aS.w; }`,
        fragmentShader: `uniform float uOp; varying float vA; void main(){ gl_FragColor = vec4(vec3(.75, .82, .85) * vA * uOp, 1.); }`,
      }), n)
      this.rain.frustumCulled = false
      sc.add(this.rain)
    }
    // A ladybird walking up the stalk.
    this.bug = ladybird(); sc.add(this.bug)
    // The snap: a glint, sap sparkle hanging in the slowed air, a few leaves let go.
    {
      const n = 70, g = new THREE.BufferGeometry(), v = new Float32Array(n * 3), a = new Float32Array(n)
      for (let i = 0; i < n; i++) { const d = new THREE.Vector3(r() - 0.5, r() * 0.9 - 0.2, r() - 0.5).normalize().multiplyScalar(0.6 + r() * 2.2); v.set([d.x, d.y, d.z], i * 3); a[i] = r() }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aV', new THREE.BufferAttribute(v, 3)); g.setAttribute('aR', new THREE.BufferAttribute(a, 1))
      this.sparkU = { uK: { value: 0 }, uOp: { value: 0 }, uPx: { value: 1 }, uO: { value: new THREE.Vector3() } }
      this.sparks = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.sparkU,
        vertexShader: `attribute vec3 aV; attribute float aR; uniform float uK, uPx; uniform vec3 uO; varying float vA;
          void main(){ vec3 p = uO + aV * uK * (.7 + aR * .6) - vec3(0., 1.6 * uK * uK, 0.);
            vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
            vA = (1. - smoothstep(.2 + aR * .5, .3 + aR * .7, uK)) * (.5 + .5 * sin(aR * 40. + uK * 30.)); gl_PointSize = (2. + aR * 5.) * uPx * 14. / -mv.z * 6.; }`,
        fragmentShader: `uniform float uOp; varying float vA; void main(){ vec2 c = gl_PointCoord - .5; float a = exp(-dot(c, c) * 40.); gl_FragColor = vec4(vec3(1., .86, .5) * a * vA * uOp * 2.2, 1.); }`,
      }))
      this.sparks.frustumCulled = false; sc.add(this.sparks)
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
      this.flashU = { uOp: { value: 0 }, uPx: { value: 1 }, uSize: { value: 130 } }
      this.flash = new THREE.Points(fg, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: this.flashU,
        vertexShader: `uniform float uPx, uSize; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_PointSize = uSize * uPx; }`,
        fragmentShader: `uniform float uOp; void main(){ vec2 c = gl_PointCoord - .5; float r = length(c);
          float st = (max(0., 1. - abs(c.x) * 40.) * max(0., 1. - abs(c.y) * 2.) + max(0., 1. - abs(c.y) * 40.) * max(0., 1. - abs(c.x) * 2.)) * .9;
          float core = exp(-r * r * 160.) * 1.6 + exp(-r * r * 30.) * .35; gl_FragColor = vec4(vec3(1., .9, .66) * (st + core) * uOp, 1.); }`,
      }))
      this.flash.frustumCulled = false; this.flash.renderOrder = 10; sc.add(this.flash)
      this.looseLeaves = new THREE.InstancedMesh(lg, lm, 5)
      this.looseLeaves.frustumCulled = false; this.looseLeaves.castShadow = true
      this.looseData = Array.from({ length: 5 }, (_, k) => ({ p: new THREE.Vector3(lerp(-3, 3, r()), lerp(2.2, 4.4, r()), lerp(-2, 1.5, r())), v: new THREE.Vector3((r() - 0.5) * 4, 0.6 + r(), (r() - 0.5) * 2 + 0.8), sp: new THREE.Vector3(r() * 6, r() * 5, r() * 7), s: 0.9 + r() * 0.8, d: 0.02 * k }))
      sc.add(this.looseLeaves)
    }
    this.dust = motes(Math.round(160 * T.particles + 40), new THREE.Box3(new THREE.Vector3(-8, -6, -6), new THREE.Vector3(8, 7, 5)), { size: 0.035, color: '#fff0c0', drift: 0.25, opacity: 0.9, seed: 7 })
    sc.add(this.dust)

    // The picker's hand: VMR Mangoes green sleeve, cream glove.
    this.handRim = rimUniforms('#ffc87a', 0.3)
    this.hand = new Hand({ sleeve: '#174631', rim: this.handRim })
    this.hand.scale.setScalar(1.0)
    sc.add(this.hand)

    // The ghost: the fall we prevent, and the ground it would hit.
    this.ghost = new THREE.Mesh(this.mango.body.geometry, ghostMaterial('#ffd9a0'))
    sc.add(this.ghost)
    // The ground under the tree: a patch of grass and fallen leaves in the shade, fading into the dark under the canopy.
    const gmat = new THREE.MeshStandardMaterial({ color: '#4a4a22', roughness: 1 })
    const su1 = this.screen.userData.u
    this.groundU = { uFar: { value: new THREE.Color() }, uHide: { value: 1 }, uTL: su1.uTL, uRes: su1.uRes, uRect: su1.uRect, uTLCol: { value: new THREE.Color() } }
    gmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float n = mmFbm(vec3(vW.xz * .25, 1.)), m = mmNoise(vec3(vW.xz * 3., 2.)), lv = smoothstep(.55, .75, mmNoise(vec3(vW.xz * 1.3, 5.)));
          vec3 c = diffuseColor.rgb * (.6 + .7 * n) * (.85 + .3 * m);
          c = mix(c, vec3(.16, .08, .03), lv * .6);
          diffuseColor.rgb = c;`)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uFar, max(uHide, smoothstep(12., 34., length(vW.xz))));\n{ vec2 sq = gl_FragCoord.xy / uRes; float inR = smoothstep(uRect.x - .12, uRect.x + .02, sq.x) * (1. - smoothstep(uRect.z - .02, uRect.z + .16, sq.x)) * smoothstep(uRect.y - .14, uRect.y + .02, sq.y) * (1. - smoothstep(uRect.w - .02, uRect.w + .14, sq.y)); gl_FragColor.rgb = mix(gl_FragColor.rgb, uTLCol, inR * uTL); }')
        .replace('#include <common>', '#include <common>\nuniform vec3 uFar; uniform float uHide; uniform float uTL; uniform vec2 uRes; uniform vec4 uRect; uniform vec3 uTLCol;')
      Object.assign(sh.uniforms, this.groundU)
    }
    gmat.customProgramCacheKey = () => 'fruitGround'
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), gmat)
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -6.5; this.ground.receiveShadow = true
    sc.add(this.ground)
    this.splat = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#ff8a5a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.splat.rotation.x = -Math.PI / 2; this.splat.position.y = -6.48
    sc.add(this.splat)

    this.clock = 0
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3(); this.tq = new THREE.Quaternion(); this.ax = new THREE.Vector3()
    // The grasp: palm (local +y) toward the fruit, fingers (local +z) forward round its front, the arm back and down.
    {
      const f = new THREE.Vector3(-0.8, 0.12, 0.55).normalize()
      const n = new THREE.Vector3(0.1, 1, 0.25); n.sub(f.clone().multiplyScalar(n.dot(f))).normalize()
      const x = new THREE.Vector3().crossVectors(n, f)
      this.handQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, f))
      this.inHandLocal = new THREE.Vector3(0, 0.82, 0.25)
    }
    this.ui = true
  }

  makePeduncle(top = this.pedTop, bottom = ATTACH) {
    const mid = top.clone().lerp(bottom, 0.5).add(new THREE.Vector3(0.25, 0, 0.15))
    const m = stemMesh([top.clone(), mid, bottom.clone()], 0.05, 0.036, '#7c7a3c')
    m.material.map = null
    return m
  }

  mountUI(film) {
    const ch = film.querySelector('[data-id=pick]')
    ch.insertAdjacentHTML('beforeend', `<div class="ghost-tag" data-ghost><svg viewBox="0 0 60 60"><path d="M10 10L50 50M50 10L10 50"/></svg><span>Not this. A fallen mango bruises.</span></div>`)
    this.tag = ch.querySelector('[data-ghost]')
  }

  uiUpdate(active, i, t, engine) {
    if (!this.tag) return
    const show = active && i === 5 ? smooth(0.7, 0.76, t) * (1 - smooth(0.9, 0.95, t)) : 0
    this.tag.style.opacity = show.toFixed(3)
    if (show > 0) {
      const v = engine.project(this.ghostLand, this.camera)
      const w = this.tag.offsetWidth || 200, x = Math.min(v.x * innerWidth + 18, innerWidth - w - 14), y = (1 - v.y) * innerHeight + (x < v.x * innerWidth ? 24 : -30)
      this.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    }
  }

  update(i, tt, time, dt) {
    const t = clamp(tt, -0.2, 1)
    const four = i === 4
    // chapter 5: the fruit stays left of the top-right headline while it is up, then the hand brings it right
    const fx = four ? 0.14 : lerp(lerp(0.14, -0.25, smooth(0, 0.12, t)), 0.17, smooth(0.6, 0.7, t)) // then clear of the top-left line on shorter screens too
    this.frame[0] = fx
    this.framePortrait[1] = four ? -0.08 : lerp(-0.08, -0.2, smooth(0, 0.12, t)) * (1 - smooth(0.6, 0.7, t)) + -0.1 * smooth(0.6, 0.7, t)
    // Phases on one axis: grow (chapter 4), then ripen, bullet-time, the pick (chapter 5).
    const grow = four ? smoother(0.02, 0.78, t) : 1
    const ripenK = four ? 0 : smoother(0.0, 0.3, t)
    const bullet = four ? 0 : smooth(0.3, 0.5, t) * (1 - smooth(0.66, 0.78, t))
    const handUp = four ? 0 : easeInOut(clamp((t - 0.32) / 0.28))
    const snap = four ? 0 : smooth(0.595, 0.61, t)
    const carry = four ? 0 : easeInOut(clamp((t - 0.7) / 0.3))
    const speed = 1 - 0.96 * bullet
    this.clock += dt * speed
    const ck = this.clock

    // Season and light: dappled green morning → late gold.
    const gold = ripenK
    const su = this.sky.userData.u
    su.uTop.value.setRGB(lerp(0.03, 0.035, gold), lerp(0.09, 0.03, gold), lerp(0.04, 0.012, gold))
    su.uHor.value.setRGB(lerp(0.55, 1.15, gold), lerp(0.62, 0.48, gold), lerp(0.25, 0.1, gold))
    su.uBot.value.setRGB(0.04, 0.06, 0.02)
    // Chapter 4 is weeks in a few seconds: the sun crosses again and again (the dapples race over the skin), a shower
    // passes and the light comes back washed and brighter. All of it lands back on the morning light at t = 1.
    const day = four ? Math.sin(t * Math.PI * 5) : 0
    const dayI = four ? 0.8 + 0.2 * Math.cos(t * Math.PI * 10) : 1
    const rainK = four ? smooth(0.4, 0.46, t) * (1 - smooth(0.58, 0.66, t)) : 0
    const clear = four ? smooth(0.6, 0.7, t) * (1 - smooth(0.86, 1, t)) : 0
    this.goboT = four ? t * 26 : 26 + t * 4
    this.sun.set(lerp(0.42, 0.55, gold) + day * 0.5, lerp(0.5, 0.32, gold), -0.75).normalize()
    su.uSunDir.value.copy(this.sun)
    su.uSunCol.value.setRGB(1, lerp(0.85, 0.55, gold), lerp(0.55, 0.22, gold))
    this.sunCol.setRGB(1, lerp(0.88, 0.74, gold), lerp(0.62, 0.42, gold))
    this.sunL.color.copy(this.sunCol); this.sunL.intensity = lerp(3.0, 4.2, gold) * dayI * (1 - 0.75 * rainK) * (1 + 0.35 * clear)
    this.sunL.position.copy(this.sun).multiplyScalar(20)
    this.hemi.color.setRGB(lerp(1, 0.75, rainK), lerp(0.95, 0.75, gold) * lerp(1, 0.9, rainK), lerp(0.85, 0.5, gold) + rainK * 0.2); this.hemi.intensity = lerp(0.9, 0.7, gold) * (1 - 0.25 * rainK)
    this.scene.environment = gold > 0.5 ? this.envGold : this.envDay
    const bu = this.bokeh.userData.u
    bu.uCol.value.setRGB(1, lerp(0.86, 0.62, gold), lerp(0.55, 0.26, gold)); bu.uCol2.value.setRGB(lerp(0.7, 1, gold), lerp(0.95, 0.5, gold), lerp(0.4, 0.16, gold))
    bu.uOp.value = lerp(0.5, 0.6, gold) * (1 - 0.7 * rainK) * (1 + 0.4 * clear)
    // The canopy round us and its sky holes follow the light.
    const cu = this.screen.userData.u
    cu.uSun.value.copy(this.sun); cu.uSunCol.value.copy(this.sunCol)
    cu.uSky.value.setRGB(lerp(1.8, 2.6, gold), lerp(1.7, 1.5, gold), lerp(0.95, 0.5, gold)).multiplyScalar((1 - 0.65 * rainK) * (1 + 0.3 * clear))
    cu.uLeafB.value.setRGB(lerp(0.1, 0.24, gold), lerp(0.24, 0.17, gold), lerp(0.035, 0.02, gold)).multiplyScalar(1 - 0.4 * rainK)
    cu.uLeafA.value.setRGB(lerp(0.012, 0.03, gold), lerp(0.035, 0.025, gold), lerp(0.01, 0.006, gold))
    cu.uT.value = four ? t * 12 : 12 + t
    cu.uGlow.value = four ? 0.15 : lerp(0.15, 0.42, gold)
    // after the snap the headline moves to the top left: keep that corner plain warm gold behind it
    // (and the top right before it, behind the first headline)
    const early = t < 0.58
    cu.uTL.value = four ? 0 : early ? smooth(0.03, 0.12, t) * (1 - smooth(0.5, 0.57, t)) * 0.85 : smooth(0.6, 0.66, t)
    // on a phone the key words are gold, not green: a deeper amber ground suits cream and gold
    cu.uTLK.value = this.camera.aspect < 1 ? 0.14 : 0.46
    if (this.camera.aspect < 1) cu.uRect.value.set(-0.2, 0.64, 1.2, 1.3)
    else if (early) cu.uRect.value.set(0.42, 0.5, 1.2, 1.3)
    else cu.uRect.value.set(-0.2, 0.55, 0.47, 1.3)
    cu.uRes.value.set(this.engine.rtA.width, this.engine.rtA.height)
    cu.uWind.value = time
    this.rainU.uOp.value = rainK * 0.35; this.rainU.uTime.value = time; this.rain.visible = rainK > 0.001
    const px = this.engine.h * this.engine.dpr / 900
    for (const U of [bu, this.glintU, this.sparkU, this.flashU]) U.uPx.value = px

    // The fruit: swelling, ripening, swaying heavier, straining, then in the hand.
    const s = lerp(0.14, 1, grow)
    this.mango.ripe = four ? lerp(0.16, 0.5, smooth(0.1, 0.85, t)) : lerp(0.5, 0.9, ripenK)
    const mu = this.mango.u
    mu.uGobo.value = lerp(0.55, 0.3, gold) * (1 - carry)
    mu.uRim.value = four ? 2.2 : lerp(2.2, 1.8, gold)
    this.dew.visible = four || t < 0.15
    this.dewU.uOp.value = four ? smooth(0.25, 0.5, t) * 0.6 + smooth(0.45, 0.6, t) * 0.4 : 1 - smooth(0, 0.12, t)
    this.dewU.uCol.value.setRGB(lerp(0.55, 1, clamp(this.mango.ripe * 1.5)), lerp(0.85, 0.78, clamp(this.mango.ripe * 1.5)), 0.35)
    this.glintU.uOp.value = (four ? smooth(0.25, 0.5, t) * (1 - 0.6 * rainK) * (1 + 0.8 * clear) : 1 - smooth(0, 0.12, t)) * 1.2
    this.glintU.uTime.value = time
    // Drops running down the skin once the shower has passed over.
    this.runs.visible = four && t > 0.48
    if (this.runs.visible) {
      this.runData.forEach((d, k) => {
        const lt = clamp((t - d.t0) / d.dur), u = lerp(0.62, -0.97, Math.pow(lt, 1.35)), rr = Math.sqrt(Math.max(0, 1 - u * u))
        const pnt = mangoPoint(Math.cos(d.a) * rr, u, Math.sin(d.a) * rr, this.tmp)
        const nrm = this.tmp2.set(pnt.x, pnt.y * 0.6, pnt.z * 1.4).normalize()
        const sz = lt >= 1 ? 0.0001 : d.s * smooth(0, 0.08, lt)
        this.tq.setFromUnitVectors(this.ax.set(0, 0, 1), nrm)
        this.runs.setMatrixAt(k, new THREE.Matrix4().compose(pnt.addScaledVector(nrm, sz * 0.25), this.tq, new THREE.Vector3(sz, sz * (1.3 + lt * 0.6), sz * 0.6)))
      })
      this.runs.instanceMatrix.needsUpdate = true
    }
    const sway = (0.04 + ripenK * 0.06) * (1 - handUp * 0.9)
    const strain = smooth(0.4, 0.595, t) * (1 - snap) * (four ? 0 : 1)
    const jitter = strain * 0.012 * Math.sin(time * 80)
    const swingZ = Math.sin(ck * 1.3) * sway + jitter
    const swingX = Math.sin(ck * 0.9 + 1) * sway * 0.6
    // Hanging from the stalk's end: pivot at the attach point.
    const hang = new THREE.Vector3(ATTACH.x, ATTACH.y, ATTACH.z)
    this.fruit.position.copy(hang)
    this.fruit.rotation.set(swingX, 0, swingZ)
    this.mango.position.copy(STEM_TOP).multiplyScalar(-s)
    this.mango.scale.setScalar(s)

    // The hand: rises from below, cups the fruit from underneath, fingers closing up its sides; the stalk snaps;
    // the hand lowers and brings it toward us.
    const H = this.hand
    const bodyNow = new THREE.Vector3(ATTACH.x - STEM_TOP.x, ATTACH.y - STEM_TOP.y, ATTACH.z - STEM_TOP.z)
    const grasp = bodyNow.clone().add(new THREE.Vector3(-0.05, -1.32, 0.05))
    const below = grasp.clone().add(new THREE.Vector3(1.8, -7, 0.8)), away = grasp.clone().add(new THREE.Vector3(0.9, -2.0, 2.6))
    const hp = handUp < 1 ? below.clone().lerp(grasp, expoOut(handUp * 0.999)) : grasp.clone().lerp(away, carry)
    if (!this.inHandOK) {
      H.position.copy(grasp); H.quaternion.copy(this.handQ); H.updateMatrixWorld(true)
      this.inHandLocal.copy(H.worldToLocal(bodyNow.clone())); this.inHandOK = true
    }
    H.position.copy(hp)
    H.quaternion.copy(this.handQ).premultiply(this.tq.setFromAxisAngle(this.ax.set(0, 0, 1), (1 - handUp) * -0.4 + 0.32 + carry * 0.2))
    const close = smooth(0.5, 0.6, t)
    H.pose(lerp(0.25, 1.4, close), lerp(0.55, 0.1, close), lerp(0.1, 1.1, close))
    H.visible = !four && t > 0.3

    if (snap > 0) {
      // Off the stalk: the fruit now rides in the hand.
      H.updateMatrixWorld()
      const inHand = H.localToWorld(this.tmp2.copy(this.inHandLocal))
      this.fruit.position.copy(hang).lerp(inHand.add(STEM_TOP), snap)
      this.fruit.rotation.set(swingX * (1 - snap), 0, swingZ * (1 - snap) + carry * 0.25)
    }
    // The stalk: whole, then broken and springing back.
    const recoil = snap > 0 ? Math.sin(clamp((t - 0.6) * 18, 0, Math.PI * 3)) * Math.exp(-clamp(t - 0.6, 0, 1) * 9) : 0
    this.ped.visible = snap < 0.5
    if (snap >= 0.5) {
      if (!this.pedStub) { this.pedStub = this.makePeduncle(this.pedTop, this.pedTop.clone().lerp(ATTACH, 0.82)); this.scene.add(this.pedStub) }
      this.pedStub.visible = true
      this.pedStub.rotation.z = recoil * 0.06
    } else if (this.pedStub) this.pedStub.visible = false

    // A leaf lets go at the snap and spins away.
    const lf = clamp((t - 0.6) / 0.4)
    this.flyLeaf.visible = !four && t > 0.45
    const l0 = new THREE.Vector3(-1.4, 2.6, -1.2)
    this.flyLeaf.position.set(l0.x - lf * 6 - Math.sin(lf * 6) * 0.6, l0.y + lf * 2.0 - lf * lf * 5, l0.z - lf * 1.5)
    this.flyLeaf.rotation.set(0.6 + lf * 9 * (0.3 + speed * 0.7), -0.8 + lf * 5, -1.2 + lf * 7)

    // The ghost falls from where the fruit hung, and bruises on the ground.
    const gf = four ? -1 : clamp((t - 0.61) / 0.12)
    this.ghost.visible = gf >= 0 && t < 0.95
    const g0 = new THREE.Vector3(ATTACH.x - 0.8, ATTACH.y - 1.0, ATTACH.z - 0.6)
    const groundY = this.ground.position.y + 0.6
    const fallY = lerp(g0.y, groundY, gf * gf)
    const land = gf >= 1
    this.ghostLand = this.ghostLand || new THREE.Vector3()
    this.ghost.position.set(g0.x - gf * 2.6, fallY, g0.z - gf * 0.6)
    this.ghostLand.set(g0.x - 2.6, groundY, g0.z - 0.6)
    const sq = land ? 1 - 0.35 * Math.exp(-(t - 0.73) * 25) : 1
    this.ghost.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq))
    this.ghost.rotation.set(0.4, 0, gf * 2.2)
    this.ghost.material.uniforms.uOp.value = 1.4 * smooth(0, 0.1, gf) * (1 - smooth(0.86, 0.92, t))
    this.splat.position.x = this.ghostLand.x; this.splat.position.z = this.ghostLand.z
    this.splat.material.opacity = land ? 0.35 * (1 - smooth(0.86, 0.92, t)) : 0
    this.splat.scale.setScalar(land ? 0.8 + smooth(0.74, 0.8, t) * 0.9 : 0.01)

    // The ladybird walks up the stalk through the weeks, and off it as the season turns.
    const bu2 = four ? lerp(0.9, 0.72, t) : lerp(0.72, 0.04, smooth(0, 0.4, t))
    this.bug.visible = this.ped.visible && (four || t < 0.4)
    if (this.bug.visible) {
      const crv = this.ped.userData.curve, bp = crv.getPointAt(bu2), tg = crv.getTangentAt(bu2)
      const head = tg.clone().negate(), nn = new THREE.Vector3(0.25, 0.1, 1).addScaledVector(head, -new THREE.Vector3(0.25, 0.1, 1).dot(head)).normalize()
      const zz = new THREE.Vector3().crossVectors(head, nn)
      this.bug.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(head, nn, zz)).multiply(this.tq.setFromAxisAngle(this.ax.set(0, 1, 0), Math.sin(time * 9) * 0.12))
      this.bug.position.copy(bp).addScaledVector(nn, 0.045 * 0.9)
      this.bug.scale.setScalar(0.9 * (four ? smooth(0.08, 0.2, t) : 1))
    }
    // The snap: a glint where the stalk parts, sap sparkle hanging in the slowed air, leaves let go.
    const brk = this.pedTop.clone().lerp(ATTACH, 0.93)
    const sk = four ? 0 : Math.max(0, t - 0.603) * 13
    this.sparks.visible = !four && t > 0.603 && t < 0.95
    this.sparkU.uK.value = sk; this.sparkU.uO.value.copy(brk); this.sparkU.uOp.value = 1 - smooth(0.85, 0.95, t)
    this.flash.position.copy(brk)
    this.flashU.uOp.value = four ? 0 : Math.exp(-Math.pow((t - 0.606) / 0.012, 2)) * 0.5
    this.flash.visible = this.flashU.uOp.value > 0.003
    const lf2 = four ? 0 : clamp((t - 0.6) / 0.4)
    this.looseLeaves.visible = lf2 > 0
    if (lf2 > 0) {
      this.looseData.forEach((d, k) => {
        const e = Math.max(0, lf2 - d.d)
        const pp = d.p.clone().addScaledVector(d.v, e * 2.4).add(this.tmp.set(Math.sin(e * 9 + k) * 0.6, -e * e * 7, 0))
        this.tq.setFromEuler(new THREE.Euler(d.sp.x + e * 8, d.sp.y + e * 5, d.sp.z + e * 7))
        this.looseLeaves.setMatrixAt(k, new THREE.Matrix4().compose(pp, this.tq, new THREE.Vector3().setScalar(d.s)))
      })
      this.looseLeaves.instanceMatrix.needsUpdate = true
    }
    this.handRim.uRim.value = lerp(0.25, 0.55, gold); this.handRim.uRimCol.value.copy(this.sunCol)
    // Shafts: from the sun through the canopy's holes, strongest in the washed light after the shower.
    this.look.rays = (four ? (0.42 + 0.4 * clear) * (1 - 0.8 * rainK) : lerp(0.42, 0.26, gold)) * (this.camera.aspect < 1 ? 0.45 : 1)
    this.look.rayThreshold = four ? 1.25 : 1.45
    this.look.rayTint.setRGB(1, lerp(0.95, 0.78, gold), lerp(0.8, 0.5, gold))

    // Camera: chapter 4 a slow push around the swelling fruit; chapter 5 a side view, a pull back and down to show the
    // fall that does not happen, then a close follow of the fruit in the hand.
    const fruitPos = this.mango.body.getWorldPosition(new THREE.Vector3())
    const target = fruitPos.clone()
    const cam = new THREE.Vector3()
    if (four) {
      const dist = lerp(2.4, 8.5, grow), a = lerp(-0.55, 0.12, t)
      // the rise eases out as the chapter ends, so it arrives at rest where chapter 5 picks it up
      cam.set(Math.sin(a) * dist, lerp(0.3, 1.0, 1 - (1 - t) * (1 - t)), Math.cos(a) * dist).add(target)
      this.post.range = lerp(0.5, 2.0, grow); this.post.dof = lerp(16, 11, grow)
    } else {
      const pull = smooth(0.6, 0.7, t) * (1 - smooth(0.82, 0.9, t))
      // the turn carries on from chapter 4 at the speed it had there and eases to a stop (it used to stop dead at the
      // handover and start again from rest), and the height settles from where chapter 4 left it (it used to drop a step)
      const xa = Math.min(1, Math.max(0, t / 0.55))
      const a = 0.12 + 0.26 * (1 - Math.pow(1 - xa, 1.417)) - carry * 0.25
      const dist = lerp(8.5, 7.2, smooth(0.25, 0.55, t)) + pull * 6 - carry * 2.2
      target.y -= pull * 2.6 - carry * 0.3
      target.x -= pull * 1.0
      cam.set(Math.sin(a) * dist, lerp(1.0, 0.8, smooth(0, 0.3, t)) - pull * 1.2 + carry * 0.6, Math.cos(a) * dist).add(target)
      this.post.range = lerp(1.8, 7, pull); this.post.dof = lerp(11, 5, pull)
    }
    aim(this.camera, cam, target, Math.sin(ck * 0.2) * 0.01)
    this.kick.position.copy(cam).lerp(fruitPos, 0.55).add(this.tmp.set(1.2, 1.4, 0).multiplyScalar(s))
    this.kick.distance = 9 * Math.max(0.3, s); this.kick.intensity = (four ? 3.2 : lerp(3.2, 1.2, gold)) * (1 - carry)
    this.post.focus = cam.distanceTo(fruitPos)
    this.focus.copy(fruitPos)
    this.scene.fog.color.copy(su.uHor.value).multiplyScalar(0.85)
    // the ground far below shows only while we look down at the fall that does not happen
    const gh = four ? 1 : 1 - smooth(0.5, 0.62, t) * (1 - smooth(0.84, 0.9, t))
    this.groundU.uTLCol.value.copy(cu.uSunCol.value).multiply(cu.uSky.value).multiply((this.tmpC || (this.tmpC = new THREE.Color())).setRGB(0.95 * cu.uTLK.value, 0.78 * cu.uTLK.value, 0.42 * cu.uTLK.value))
    this.groundU.uHide.value = gh
    this.groundU.uFar.value.copy(cu.uLeafA.value).add(cu.uLeafB.value).multiplyScalar(0.3)
    this.ground.visible = gh < 0.999
    this.ground.material.color.setRGB(lerp(0.08, 0.16, gold), lerp(0.11, 0.1, gold), 0.04)
    this.ground.material.color.setRGB(lerp(0.08, 0.16, gold), lerp(0.11, 0.1, gold), 0.04)

    // Post: bullet-time radial blur centred on the fruit; the snap flashes the bloom.
    this.look.radial = bullet * 0.032
    this.camera.updateMatrixWorld()
    const sp = this.tmp.copy(this.focus).project(this.camera)
    this.look.rc.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5)
    this.look.bloom = lerp(0.55, 0.85, gold) + (four ? 0 : Math.exp(-Math.pow((t - 0.605) / 0.02, 2)) * (this.camera.aspect < 1 ? 0.35 : 0.9)) // the snap's flash of light; held down on tall screens, where the bright canopy is in frame
    this.look.threshold = 0.75
    this.look.exposure = lerp(1.0, 1.05, gold) * (four ? 1 - 0.15 * smooth(0.4, 0.46, t) * (1 - smooth(0.58, 0.66, t)) : 1)
    this.look.vig = 0.55 + bullet * 0.25
    this.grade([lerp(0, 0.02, gold), lerp(0.006, 0.008, gold), lerp(0.012, 0, gold)], [lerp(1.04, 1.04, gold), 1, lerp(0.95, 0.94, gold)], 1.06)
    this.dust.userData.u.uSlow.value = speed; this.bokeh.userData.u.uSlow.value = speed
    this.dust.userData.u.uTime.value = ck; this.bokeh.userData.u.uTime.value = ck
    this.leafMat.userData.u.uTime.value = ck
    su.uTime.value = ck
  }

  afterCamera() {
    this.mango.tick(this.goboT ?? this.clock, this.sunView, this.sunCol)
    this.dewU.uSunView.value.copy(this.sunView)
    this.leafMat.userData.u.uSunView.value.copy(this.sunView)
    this.leafMat.userData.u.uSunCol.value.copy(this.sunCol)
  }
}
