// Chapter 8 "Every one is turned, pressed and looked at." The warehouse on day 1, early morning. Low sun through a row of
// high windows throws long gold shafts through dusty air; warm pendant lamps hang over a long wooden table and pool on
// the floor; racks of crates of green and gold fruit recede into haze; a hanging scale, jute sacks, a chalk board and a
// slow ceiling fan. Our rider (the same Mango Mandi person who will pack and deliver it), lit like a portrait (warm key,
// cool window rim, a catch-light in the eyes), lifts our mango, turns it in both hands, tilts his head, presses it gently
// with a thumb and nods; a scan line of light reads it; it goes into the RAW · DAYS 1–3 tray while the trays fill; a
// bruised one is set aside, NEVER SOLD. The viewer can drag our mango to turn it while he holds it (mouse or touch).
import * as THREE from 'three'
import { Stage, aim, motes } from './stage.js'
import { Mango, mangoMaterial, mangoGeometry } from '../lib/mango.js'
import { Person, wordmarkTexture } from '../lib/character.js'
import { canvasTex, labelTex, rng, clamp, lerp, smooth, smoother, SANS, SERIF } from '../lib/util.js'

const TOP = 14.8 // table top
const BELT_Z = -3.6
const LIE = 0.6 // centre height of a mango lying on its side above the belt
const WALL_Z = -104

// ---- Small light-and-air kit, shared by the indoor chapters (grade, pack, counter, finale) ------------------------------

const QV = 'varying vec2 vUv; void main(){ vUv = uv; vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n gl_Position = projectionMatrix * modelViewMatrix * p; }'

/** An additive soft disc (light pool, glow, bokeh) on a plane; works on plain and instanced meshes. */
export function poolMaterial(color = '#ffc070', op = 0.3, power = 1.6) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(color) }, uOp: { value: op }, uPow: { value: power } },
    vertexShader: QV,
    fragmentShader: 'uniform vec3 uCol; uniform float uOp, uPow; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = pow(clamp(1. - d, 0., 1.), uPow); gl_FragColor = vec4(uCol * a * uOp, 1.); }',
  })
}

/** A beam of light in dusty air: two crossed planes from a source point along a direction, fading with length and when
    seen edge-on, with slow drifting dust density. uv.y = 1 at the source. */
export function beamMaterial(color = '#ffd9a0', op = 0.1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(color) }, uOp: { value: op }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying float vF; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `uniform vec3 uCol; uniform float uOp, uTime; varying vec2 vUv; varying float vF;
      void main(){
        float e = smoothstep(0., .3, vUv.x) * smoothstep(1., .7, vUv.x);
        float f = smoothstep(0., .35, vUv.y) * (.35 + .65 * vUv.y);
        float n = .7 + .3 * sin(vUv.x * 19. + vUv.y * 3. + uTime * .25) * sin(vUv.x * 7.3 - vUv.y * 5. - uTime * .17);
        gl_FragColor = vec4(uCol * e * f * n * uOp * smoothstep(.05, .45, vF), 1.);
      }`,
  })
}
export function beam(width, length, mat, dir) {
  const g = new THREE.Group()
  const geo = new THREE.PlaneGeometry(width, length); geo.translate(0, -length / 2, 0)
  for (const ry of [0, Math.PI / 2]) { const m = new THREE.Mesh(geo, mat); m.rotation.y = ry; m.renderOrder = 5; g.add(m) }
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize())
  return g
}

/** Bokeh: soft discs with a brighter rim, sized in world units (for out-of-focus lights and drifting motes). */
export function bokeh(n, box, { size = 0.6, color = '#ffc860', opacity = 0.4, drift = 0.5, seed = 3, rim = 0.5 } = {}) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n)
  const r = rng(seed)
  for (let i = 0; i < n; i++) {
    p[i * 3] = box.min.x + r() * (box.max.x - box.min.x); p[i * 3 + 1] = box.min.y + r() * (box.max.y - box.min.y); p[i * 3 + 2] = box.min.z + r() * (box.max.z - box.min.z)
    s[i] = 0.5 + r()
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1))
  const u = { uTime: { value: 0 }, uSize: { value: size }, uCol: { value: new THREE.Color(color) }, uOp: { value: opacity }, uDrift: { value: drift }, uRim: { value: rim }, uScale: { value: 1 } }
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: u,
    vertexShader: /* glsl */ `attribute float aS; uniform float uTime, uSize, uDrift, uScale; varying float vA;
      void main(){ vec3 q = position; float ph = aS * 37.;
        q += vec3(sin(uTime * .21 + ph), sin(uTime * .17 + ph * 1.3) * .8 + sin(uTime * .05 + ph) * .5, cos(uTime * .19 + ph * .7)) * uDrift;
        vec4 mv = modelViewMatrix * vec4(q, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * aS * uScale * projectionMatrix[1][1] * 0.5 * 900. / -mv.z; vA = .6 + .4 * sin(uTime * .9 + ph); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uOp, uRim; varying float vA; void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard; float a = smoothstep(1., .82, d) * (1. - uRim + uRim * smoothstep(.4, .95, d)); gl_FragColor = vec4(uCol * a * uOp * vA, 1.); }`,
  })
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.userData.u = u
  return pts
}

/** Four-point star glints (sparkles), drawn as points; positions set each frame. */
export function glints(n, color = '#fff2c8') {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(n), 1))
  const u = { uCol: { value: new THREE.Color(color) }, uSize: { value: 40 } }
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: u,
    vertexShader: 'attribute float aK; uniform float uSize; varying float vK; void main(){ vK = aK; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * aK; }',
    fragmentShader: 'uniform vec3 uCol; varying float vK; void main(){ vec2 q = (gl_PointCoord - .5) * 2.; float s = exp(-abs(q.x) * 18.) * exp(-abs(q.y) * 2.2) + exp(-abs(q.y) * 18.) * exp(-abs(q.x) * 2.2); s += exp(-dot(q, q) * 14.) * .8; gl_FragColor = vec4(uCol * s * vK * 2.2, 1.); }',
  })
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 20
  return pts
}

// ---- Textures -----------------------------------------------------------------------------------------------------------

function woodTex() {
  return canvasTex(1024, 256, (g, W, H) => {
    g.fillStyle = '#8a5a32'; g.fillRect(0, 0, W, H)
    const r = rng(21)
    for (let p = 0; p < 4; p++) {
      const y0 = (p / 4) * H
      g.fillStyle = `hsl(${26 + r() * 6},${42 + r() * 10}%,${30 + r() * 8}%)`; g.fillRect(0, y0, W, H / 4)
      for (let i = 0; i < 60; i++) {
        const y = y0 + r() * H / 4
        g.strokeStyle = `rgba(${40 + r() * 40},${20 + r() * 20},10,${0.1 + r() * 0.2})`; g.lineWidth = 0.6 + r() * 1.6
        g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 2 + (r() - 0.5) * 1.5); g.stroke()
      }
      g.fillStyle = 'rgba(20,10,4,.6)'; g.fillRect(0, y0, W, 2)
    }
  }, { repeat: true })
}

function cardTex(text, sub, tone) {
  return labelTex(1024, 360, (g, W, H) => {
    g.fillStyle = tone === 'red' ? '#2a0f0a' : '#f6efdc'; g.fillRect(0, 0, W, H)
    g.strokeStyle = tone === 'red' ? '#ff6a4d' : '#174631'; g.lineWidth = 10; g.strokeRect(14, 14, W - 28, H - 28)
    g.fillStyle = tone === 'red' ? '#ff6a4d' : tone === 'gold' ? '#a4520f' : '#174631'
    g.textAlign = 'center'
    g.font = `700 ${tone === 'red' ? 120 : 104}px ${SANS}`
    g.fillText(text, W / 2, H * (sub ? 0.4 : 0.52))
    if (sub) { g.font = `400 72px ${SERIF}`; g.fillStyle = tone === 'red' ? '#ffd0c4' : '#0b1f15'; g.fillText(sub, W / 2, H * 0.74) }
  })
}

function chalkTex() {
  const draw = (g, W, H) => {
    g.fillStyle = '#1d2a24'; g.fillRect(0, 0, W, H)
    const r = rng(17)
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(230,235,220,${0.015 + r() * 0.03})`; g.beginPath(); g.ellipse(r() * W, r() * H, 10 + r() * 60, 4 + r() * 20, r() * 3, 0, 7); g.fill() }
    g.strokeStyle = '#6a4a2a'; g.lineWidth = 26; g.strokeRect(13, 13, W - 26, H - 26)
    g.fillStyle = 'rgba(240,236,220,.88)'; g.textAlign = 'left'
    g.font = `400 64px ${SERIF}`; g.fillText('Today · Lot 1', 70, 120)
    g.font = `700 34px ${SANS}`
    g.fillStyle = 'rgba(190,230,170,.9)'; g.fillText('RAW · DAYS 1–3', 70, 210)
    g.fillStyle = 'rgba(255,200,90,.92)'; g.fillText('SEMI-RIPE · DAYS 4–7', 70, 270)
    g.fillStyle = 'rgba(255,150,120,.9)'; g.fillText('NEVER AFTER DAY 7', 70, 330)
    g.strokeStyle = 'rgba(240,236,220,.7)'; g.lineWidth = 4; g.lineCap = 'round'
    for (let k = 0; k < 4; k++) { const x0 = 70 + k * 80; for (let j = 0; j < 4; j++) { g.beginPath(); g.moveTo(x0 + j * 14, 380); g.lineTo(x0 + j * 14 + 3, 440); g.stroke() } g.beginPath(); g.moveTo(x0 - 8, 430); g.lineTo(x0 + 56, 388); g.stroke() }
    // a chalk mango, and a leaf
    g.strokeStyle = 'rgba(255,205,100,.9)'; g.lineWidth = 6
    g.beginPath(); g.ellipse(W - 200, 250, 92, 120, -0.4, 0, 7); g.stroke()
    g.strokeStyle = 'rgba(170,220,140,.9)'; g.beginPath(); g.ellipse(W - 150, 120, 50, 18, -0.7, 0, 7); g.stroke()
    g.fillStyle = 'rgba(240,236,220,.8)'; g.font = `400 40px ${SERIF}`; g.textAlign = 'center'; g.fillText('by hand', W - 210, 430)
  }
  const tex = canvasTex(1024, 512, draw)
  if (document.fonts) Promise.all([document.fonts.load(`700 34px Figtree`), document.fonts.load(`400 64px 'Young Serif'`)]).then(() => { draw(tex.image.getContext('2d'), 1024, 512); tex.needsUpdate = true }).catch(() => {})
  return tex
}

function burlapTex() {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#9a7a4e'; g.fillRect(0, 0, W, H)
    const r = rng(41)
    for (let y = 0; y < H; y += 4) { g.fillStyle = `rgba(${60 + r() * 30},${40 + r() * 20},20,${0.2 + r() * 0.2})`; g.fillRect(0, y, W, 1.6) }
    for (let x = 0; x < W; x += 4) { g.fillStyle = `rgba(220,190,140,${0.08 + r() * 0.12})`; g.fillRect(x, 0, 1.6, H) }
    g.fillStyle = 'rgba(23,70,49,.75)'; g.font = `800 34px ${SANS}`; g.textAlign = 'center'; g.fillText('MANGO', W / 2, H * 0.55)
  }, { repeat: true })
}

export default class Grade extends Stage {
  constructor(engine) {
    super(engine, { far: 900 })
    const sc = this.scene, T = this.tier
    const hi = T.name === 'high', lo = T.name === 'low'
    this.fov = 30
    this.frame = [0.22, 0.0]
    this.framePortrait = [0, -0.1]
    const HAZE = '#3a3d38'
    sc.background = new THREE.Color('#1c1a16')
    sc.fog = new THREE.Fog(HAZE, 45, 190)
    sc.environment = engine.env({ top: '#6a5a48', mid: '#e0a050', bottom: '#120a05', sun: '#fff0d0', sunDir: new THREE.Vector3(0.3, 0.6, 1), sunPower: 3 })
    this.scene.environmentIntensity = 0.45
    this.sun.set(-0.6, 0.62, -0.5).normalize() // morning sun, low, behind the room's back wall
    this.sunCol.setRGB(1, 0.8, 0.52)

    // ---- Light. Warm pendant key over the table (soft shadows), a warm face key from the camera side, a cool window rim
    // from behind, low warm bounce, and the low sun through the high windows (no shadow; drawn as shafts and pools).
    this.key = new THREE.SpotLight('#ffcf8a', 820, 160, 0.62, 0.75, 1.6)
    this.key.position.set(2, 44, 4); this.key.target.position.set(0, TOP, -3)
    this.key.castShadow = true; this.key.shadow.mapSize.set(T.shadow, T.shadow); this.key.shadow.bias = -0.0003; this.key.shadow.radius = 5
    this.key.shadow.camera.near = 8; this.key.shadow.camera.far = 80
    sc.add(this.key, this.key.target)
    this.rim = new THREE.SpotLight('#a9c6ff', 900, 120, 0.3, 0.7, 1.6); sc.add(this.rim, this.rim.target)
    this.rim2 = new THREE.SpotLight('#ffd9a0', 420, 120, 0.28, 0.8, 1.6); sc.add(this.rim2, this.rim2.target)
    this.fill = new THREE.PointLight('#ff9c50', 50, 90, 1.4); this.fill.position.set(20, 26, 22); sc.add(this.fill)
    this.face = new THREE.SpotLight('#ffd2a0', 190, 90, 0.12, 0.85, 1.5); sc.add(this.face, this.face.target)
    this.mangoLight = new THREE.PointLight('#fff0c8', 22, 9, 1.5); sc.add(this.mangoLight)
    this.cool = new THREE.DirectionalLight('#8fb0d8', 0.35); this.cool.position.set(-30, 20, 40); sc.add(this.cool)
    this.sunL = new THREE.DirectionalLight('#ffd49a', 1.1); this.sunL.position.set(-60, 62, -50); sc.add(this.sunL)
    sc.add(new THREE.HemisphereLight('#8a7058', '#120a06', 0.4))
    for (const [x, z] of [[-60, -48], [-5, -48], [50, -48], [-30, -74], [30, -74]]) { const b = new THREE.PointLight('#ffb870', 70, 55, 1.6); b.position.set(x, 30, z); sc.add(b) }

    const r = rng(8)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1), e = new THREE.Euler(), v = new THREE.Vector3()

    // ---- Pendant lamps: three over the table, rows receding into the room (instanced), each with a glow cone and a pool.
    const shadeMat = new THREE.MeshStandardMaterial({ color: '#174631', roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide })
    const innerMat = new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffb860', emissiveIntensity: 1.4, side: THREE.BackSide })
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd79a').multiplyScalar(6) })
    const cordMat = new THREE.MeshBasicMaterial({ color: '#0a0604' })
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uOp: { value: 0.12 } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec3 nn = normal;\n#ifdef USE_INSTANCING\n nn = mat3(instanceMatrix) * nn;\n#endif\n vec4 mv = modelViewMatrix * p; vN = normalize(normalMatrix * nn); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uOp; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(normalize(vN), vV)), 1.5); gl_FragColor = vec4(vec3(1., .72, .38) * pow(vY, 1.8) * e * uOp, 1.); }',
    })
    const lamps = [[-26, 46, -2], [2, 46, 4], [30, 46, -2]]
    for (const x of [-64, -22, 22, 64]) lamps.push([x, 50, -34])
    for (const x of [-90, -45, 0, 45, 90]) lamps.push([x, 54, -58])
    for (const x of [-70, -24, 24, 70]) lamps.push([x, 58, -82])
    const nL = lamps.length
    const shadeG = new THREE.CylinderGeometry(1.2, 4.6, 3.4, hi ? 40 : 24, 1, true)
    const shadeI = new THREE.InstancedMesh(shadeG, shadeMat, nL), innerI = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.15, 4.5, 3.35, hi ? 40 : 24, 1, true), innerMat, nL)
    const bulbI = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 16, 10), bulbMat, nL), cordI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 5), cordMat, nL)
    const coneG = new THREE.CylinderGeometry(4.2, 18, 1, 32, 1, true); coneG.translate(0, -0.5, 0)
    const coneI = new THREE.InstancedMesh(coneG, coneMat, nL)
    const poolI = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMaterial('#ffb35a', 0.22, 2.2), nL)
    lamps.forEach(([x, y, z], k) => {
      const s = k < 3 ? 1 : 0.85
      q.identity()
      shadeI.setMatrixAt(k, m4.compose(v.set(x, y, z), q, sv.setScalar(s))); innerI.setMatrixAt(k, m4)
      bulbI.setMatrixAt(k, m4.compose(v.set(x, y - 1.4 * s, z), q, sv.setScalar(s)))
      cordI.setMatrixAt(k, m4.compose(v.set(x, y + 31, z), q, sv.set(1, 60, 1)))
      const ground = k < 3 ? TOP + 0.05 : 0.05, len = y - 2 - ground - (k < 3 ? 6 : 4)
      coneI.setMatrixAt(k, m4.compose(v.set(x, y - 1.6 * s, z), q, sv.set(s * (0.6 + len / 60), len, s * (0.6 + len / 60))))
      poolI.setMatrixAt(k, m4.compose(v.set(x, ground + 0.02, z), q.setFromEuler(e.set(-Math.PI / 2, 0, 0)), sv.set(k < 3 ? 26 : 34, k < 3 ? 18 : 34, 1)))
    })
    shadeI.castShadow = false
    sc.add(shadeI, innerI, bulbI, cordI, coneI, poolI)
    this.lampPos = lamps

    // ---- The room: a worn concrete floor, a plastered back wall with a row of high windows (the morning sun), steel
    // racks of crates in two rows, pillars, the chalk board, sacks, a hanging scale, a slow fan.
    const floorTex = canvasTex(512, 512, (g, W, H) => {
      g.fillStyle = '#6a5240'; g.fillRect(0, 0, W, H)
      const rr = rng(3)
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rr() < 0.5 ? '255,230,200' : '20,10,4'},${0.03 + rr() * 0.06})`; g.beginPath(); g.arc(rr() * W, rr() * H, 1 + rr() * 14, 0, 6.3); g.fill() }
      g.strokeStyle = 'rgba(20,10,4,.35)'; g.lineWidth = 2
      for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * W / 4, 0); g.lineTo(k * W / 4, H); g.stroke(); g.beginPath(); g.moveTo(0, k * H / 4); g.lineTo(W, k * H / 4); g.stroke() }
    }, { repeat: true })
    floorTex.repeat.set(10, 10)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#8a7058', roughness: 0.62, map: floorTex, metalness: 0.05 }))
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor)
    const plaster = canvasTex(512, 256, (g, W, H) => {
      g.fillStyle = '#5a5048'; g.fillRect(0, 0, W, H)
      const rr = rng(5)
      for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${rr() < 0.5 ? '255,220,180' : '30,15,5'},${0.03 + rr() * 0.05})`; g.beginPath(); g.arc(rr() * W, rr() * H, 2 + rr() * 22, 0, 6.3); g.fill() }
      g.fillStyle = 'rgba(30,15,5,.35)'; g.fillRect(0, H * 0.78, W, H * 0.22)
      g.fillStyle = 'rgba(255,200,120,.25)'; g.fillRect(0, H * 0.775, W, 3)
    }, { repeat: true })
    plaster.repeat.set(4, 1)
    const wallM = new THREE.MeshStandardMaterial({ color: '#9a9088', map: plaster, roughness: 0.95 })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(400, 140), wallM)
    wall.position.set(0, 70, WALL_Z); sc.add(wall)

    // High windows (right of the room, away from the headline): bright panes behind dark mullions, so the shafts have
    // something to break up. Morning sun streams in as beams that land as pools on the floor.
    this.windows = []
    // What the glass shows: a pale morning sky over the tops of trees, soft (it is far and out of focus anyway).
    const outTex = canvasTex(256, 256, (g, Wd, Hd) => {
      const gr = g.createLinearGradient(0, 0, 0, Hd); gr.addColorStop(0, '#cfe0ea'); gr.addColorStop(0.55, '#f6ecd2'); gr.addColorStop(1, '#f2dcae')
      g.fillStyle = gr; g.fillRect(0, 0, Wd, Hd)
      const rr = rng(61)
      for (let i = 0; i < 70; i++) {
        const x = rr() * Wd, y = Hd * (0.45 + rr() * 0.6), rad = 14 + rr() * 34
        g.fillStyle = `rgba(${50 + rr() * 50},${85 + rr() * 50},${40 + rr() * 30},${0.35 + rr() * 0.4})`; g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, 0, 0, 7); g.fill()
      }
      for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(70,110,50,${0.3 + rr() * 0.3})`; g.beginPath(); g.ellipse(rr() < 0.5 ? rr() * 40 : Wd - rr() * 40, rr() * Hd * 0.6, 20 + rr() * 20, 16 + rr() * 14, 0, 0, 7); g.fill() }
    })
    const winM = this.winM = new THREE.MeshBasicMaterial({ map: outTex, color: new THREE.Color(1.8, 1.7, 1.55), fog: false })
    const mullM = new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.8 })
    const winXs = [-46, -20, 6], LIT = -20
    const WW = 15, WH = 12, WY = 47
    const winG = new THREE.PlaneGeometry(WW, WH), winI = new THREE.InstancedMesh(winG, winM, winXs.length)
    const mullV = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, WH + 1.6, 1.2), mullM, winXs.length * 3)
    const mullH = new THREE.InstancedMesh(new THREE.BoxGeometry(WW + 1.6, 0.8, 1.2), mullM, winXs.length * 3)
    winXs.forEach((x, k) => {
      winI.setMatrixAt(k, m4.compose(v.set(x, WY, WALL_Z + 0.2), q.identity(), sv.set(1, 1, 1)))
      winI.setColorAt(k, x === LIT ? new THREE.Color(1, 1, 1) : new THREE.Color(0.05, 0.06, 0.07))
      for (let j = 0; j < 3; j++) {
        mullV.setMatrixAt(k * 3 + j, m4.compose(v.set(x - WW / 2 + j * WW / 2, WY, WALL_Z + 0.5), q, sv))
        mullH.setMatrixAt(k * 3 + j, m4.compose(v.set(x, WY - WH / 2 + j * WH / 2, WALL_Z + 0.5), q, sv))
      }
      this.windows.push(new THREE.Vector3(x, WY, WALL_Z))
    })
    sc.add(winI, mullV, mullH)
    this.beamMat = beamMaterial('#ffd49a', hi ? 0.07 : 0.08)
    const bdir = new THREE.Vector3(0.6, -0.62, 0.5).normalize()
    this.bdir = bdir
    const pools = []
    winXs.filter((x) => x === LIT).forEach((x) => {
      if (x === LIT) for (const dx of [-WW / 3, 0, WW / 3]) {
        const b = beam(WW / 3 - 0.5, 130, this.beamMat, bdir); b.position.set(x + dx, WY, WALL_Z + 1); sc.add(b)
      }
      const tHit = WY / -bdir.y
      pools.push([x + bdir.x * tHit, WALL_Z + bdir.z * tHit])
    })
    const sunPoolM = poolMaterial('#ffcf8a', 0.32, 1.4)
    pools.forEach(([x, z]) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(26, 36), sunPoolM); p.rotation.set(-Math.PI / 2, 0, 0.42); p.position.set(x, 0.06, z); sc.add(p)
    })

    // Pillars.
    const pillarM = new THREE.MeshStandardMaterial({ color: '#7a5a40', roughness: 0.9, map: plaster })
    const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(7, 140, 7), pillarM, 4)
    ;[[-80, -36], [72, -36], [-110, -70], [104, -70]].forEach(([x, z], k) => pillars.setMatrixAt(k, m4.compose(v.set(x, 70, z), q.identity(), sv.set(1, 1, 1))))
    pillars.castShadow = true; pillars.receiveShadow = true; sc.add(pillars)

    // Racks: green steel uprights and plank shelves in two rows, loaded with slatted crates, many of them open and heaped
    // with fruit: whole crates of deep green raw ones, and of gold.
    const steel = new THREE.MeshStandardMaterial({ color: '#1d3a2a', roughness: 0.5, metalness: 0.4 })
    const crateTex = canvasTex(256, 256, (g, W, H) => {
      g.fillStyle = '#2a170a'; g.fillRect(0, 0, W, H)
      const rr = rng(9)
      for (let k = 0; k < 4; k++) {
        const y0 = k * H / 4 + 6
        g.fillStyle = `hsl(${28 + rr() * 8},${45 + rr() * 10}%,${40 + rr() * 10}%)`; g.fillRect(4, y0, W - 8, H / 4 - 12)
        for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(40,20,8,${0.1 + rr() * 0.2})`; g.beginPath(); const yy = y0 + rr() * (H / 4 - 12); g.moveTo(4, yy); g.lineTo(W - 4, yy + (rr() - 0.5) * 3); g.stroke() }
      }
    })
    const crateMat = new THREE.MeshStandardMaterial({ color: '#a89482', roughness: 0.85, map: crateTex })
    const shelfYs = [0.6, 12.5, 24.5]
    const rows = [[-60, -130, 130], [-86, -120, 120]]
    const rackPts = []
    for (const [z, x0, x1] of rows) for (let x = x0; x <= x1; x += 26) rackPts.push([x, z])
    const up = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 32, 0.9), steel, rackPts.length * 2)
    const plank = new THREE.InstancedMesh(new THREE.BoxGeometry(26, 0.7, 11), new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.8, map: woodTex() }), rackPts.length * shelfYs.length)
    let ku = 0, kp = 0
    const crateSpots = []
    rackPts.forEach(([x, z]) => {
      for (const dz of [-5, 5]) up.setMatrixAt(ku++, m4.compose(v.set(x - 13, 16, z + dz), q.identity(), sv.set(1, 1, 1)))
      shelfYs.forEach((y) => {
        plank.setMatrixAt(kp++, m4.compose(v.set(x, y, z), q.identity(), sv.set(1, 1, 1)))
        for (const cx of [-6.2, 6.2]) if (r() < 0.88) crateSpots.push([x + cx + (r() - 0.5), y + 0.35 + 2.75, z + (r() - 0.5) * 1.5, (r() - 0.5) * 0.08, r() < 0.62])
      })
    })
    up.count = ku; plank.count = kp; up.castShadow = plank.receiveShadow = true
    sc.add(up, plank)
    for (let x = -100; x < 100; x += 11) {
      if (Math.abs(x - 2) < 30 || Math.abs(x - 40) < 10) continue
      const hN = 1 + Math.floor(r() * 4)
      for (let h = 0; h < hN; h++) crateSpots.push([x + (r() - 0.5) * 1.5, 2.75 + h * 5.6, -38 + (r() - 0.5) * 3, (r() - 0.5) * 0.12, h === hN - 1])
    }
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 5.5, 8), crateMat, crateSpots.length)
    crateSpots.forEach(([x, y, z, ry], k) => crates.setMatrixAt(k, m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, ry, 0)), sv.set(1, 1, 1))))
    crates.castShadow = false; crates.receiveShadow = true
    sc.add(crates)
    // Fruit in the open crates: mangoes lying on their sides, a little varied in size and angle. The front row of racks
    // (and the floor stacks) hold raw green fruit with a gold blush; the back row holds deeper gold.
    const heap = crateSpots.filter((c) => c[4])
    const per = lo ? 5 : 7
    const hg = mangoGeometry(hi ? 0.15 : 0.12)
    const nH = heap.length * per
    const hr = new Float32Array(nH)
    let kh = 0
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1)
    this._heapM = []
    heap.forEach(([x, y, z]) => {
      const gold = z < -70
      for (let i = 0; i < per; i++) {
        const back = i < Math.ceil(per / 2), n = back ? Math.ceil(per / 2) : Math.floor(per / 2), j = back ? i : i - Math.ceil(per / 2)
        hr[kh] = gold ? 0.6 + r() * 0.1 : 0.3 + r() * 0.18
        v.set(x - (n - 1) * 1.3 + j * 2.6 + (r() - 0.5) * 0.4, y + 3.05 + (back ? 0 : 0.25) + r() * 0.2, z + (back ? -1.6 : 1.6) + (r() - 0.5) * 0.5)
        // long axis along x (seen side-on), rolled about it, a small yaw and tilt
        qa.setFromAxisAngle(Y, r() * 6.28); qb.setFromAxisAngle(Z, Math.PI / 2 * (r() < 0.5 ? 1 : -1) + (r() - 0.5) * 0.3); qc.setFromAxisAngle(Y, (r() - 0.5) * 0.7)
        q.copy(qc).multiply(qb).multiply(qa)
        m4.compose(v, q, sv.setScalar(1.05 + r() * 0.25))
        this._heapM.push(m4.clone())
        kh++
      }
    })
    hg.setAttribute('aRipe', new THREE.InstancedBufferAttribute(hr, 1))
    this.heapMat = mangoMaterial({ instanced: true })
    this.heapMat.emissive = new THREE.Color('#ff9a20'); this.heapMat.emissiveIntensity = 0.0
    const heapM = new THREE.InstancedMesh(hg, this.heapMat, nH)
    this._heapM.forEach((m, k) => heapM.setMatrixAt(k, m)); this._heapM = null
    heapM.receiveShadow = true
    sc.add(heapM)

    // Stacked gold boxes with the green wordmark label, on pallets.
    const goldBox = new THREE.MeshPhysicalMaterial({ color: '#e9a425', roughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color('#fff0c0') })
    const labelMat = new THREE.MeshStandardMaterial({ map: wordmarkTexture({ w: 512, h: 256, bg: '#174631' }), roughness: 0.7 })
    const boxSpots = []
    for (const [bx, bz, n] of [[24, -30, 2], [-62, -30, 3], [-86, -40, 2]]) {
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) for (let h = 0; h < 4 - (i + j) % 2; h++) boxSpots.push([bx + i * 8.6, 1.4 + 3.1 + h * 6.3, bz + j * 7.6, (r() - 0.5) * 0.06])
    }
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(8.2, 6.2, 7.2), goldBox, boxSpots.length)
    const labels = new THREE.InstancedMesh(new THREE.PlaneGeometry(6.2, 3.1), labelMat, boxSpots.length)
    boxSpots.forEach(([x, y, z, ry], k) => {
      q.setFromEuler(e.set(0, ry, 0))
      boxes.setMatrixAt(k, m4.compose(v.set(x, y, z), q, sv.set(1, 1, 1)))
      labels.setMatrixAt(k, m4.compose(v.set(x, y - 0.3, z).add(new THREE.Vector3(0, 0, 3.62).applyQuaternion(q)), q, sv))
    })
    boxes.castShadow = true; boxes.receiveShadow = true
    sc.add(boxes, labels)
    const pallet = new THREE.InstancedMesh(new THREE.BoxGeometry(18, 1.4, 16), new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9, map: woodTex() }), 3)
    ;[[28.3, -26.2], [-53.4, -26.2], [-81.7, -36.2]].forEach(([x, z], k) => pallet.setMatrixAt(k, m4.compose(v.set(x, 0.7, z), q.identity(), sv.set(1, 1, 1))))
    sc.add(pallet)

    // Jute sacks slumped against the stacks (one instanced, lumpy shape).
    {
      const sg = new THREE.SphereGeometry(1, 20, 14), p = sg.attributes.position
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i)
        const y = v.y, w = 1 - 0.32 * Math.max(0, y) ** 2 + 0.06 * Math.sin(v.x * 7 + v.z * 5)
        p.setXYZ(i, v.x * w * 2.6, (y < 0 ? y * 0.75 : y * (1.05 + 0.6 * Math.max(0, y - 0.6))) * 3.2, v.z * w * 2.1)
      }
      sg.translate(0, 2.4, 0); sg.computeVertexNormals()
      const sacks = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ map: burlapTex(), roughness: 0.95, color: '#c8b090' }), 7)
      ;[[38, -24, 0.3], [43, -22, -0.5], [40.5, -27, 1.2], [-40, -26, 0.8], [-45, -24, -0.2], [-42.5, -29, 2], [41, -25.5, 0.1]].forEach(([x, z, ry], k) => {
        sacks.setMatrixAt(k, m4.compose(v.set(x, k === 6 ? 4.3 : 0, z), q.setFromEuler(e.set(k === 6 ? 1.3 : (r() - 0.5) * 0.2, ry, k === 6 ? 0.2 : (r() - 0.5) * 0.15)), sv.setScalar(k === 6 ? 0.85 : 1)))
      })
      sacks.castShadow = true; sacks.receiveShadow = true
      sc.add(sacks)
    }

    // The chalk board high on the back-left wall, soft in the haze.
    this.chalk = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), new THREE.MeshStandardMaterial({ map: chalkTex(), roughness: 0.9 }))
    this.chalk.position.set(-86, 45, WALL_Z + 0.3); sc.add(this.chalk)

    // A hanging spring scale with a brass pan of fruit, swaying very slightly.
    {
      const g = new THREE.Group(); g.position.set(22, 38, -42)
      const brass = new THREE.MeshStandardMaterial({ color: '#c8963c', metalness: 0.9, roughness: 0.32 })
      const dark = new THREE.MeshStandardMaterial({ color: '#174631', roughness: 0.45, metalness: 0.2 })
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 18, 5), dark); chain.position.y = 9; g.add(chain)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.9, 32), [dark, new THREE.MeshStandardMaterial({ roughness: 0.3, map: canvasTex(256, 256, (c) => {
        c.fillStyle = '#f4ead2'; c.beginPath(); c.arc(128, 128, 124, 0, 6.3); c.fill()
        c.strokeStyle = '#174631'; c.lineWidth = 3
        for (let k = 0; k < 40; k++) { const a = (k / 40) * 6.283; c.beginPath(); c.moveTo(128 + Math.cos(a) * (k % 5 ? 108 : 96), 128 + Math.sin(a) * (k % 5 ? 108 : 96)); c.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118); c.stroke() }
        c.strokeStyle = '#c0391b'; c.lineWidth = 5; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + 90 * Math.cos(-0.5), 128 + 90 * Math.sin(-0.5)); c.stroke()
      }) }), dark])
      body.rotation.x = Math.PI / 2; body.position.y = -1.6; g.add(body)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.2, 8, 40), brass); ring.position.set(0, -1.6, 0.46); g.add(ring)
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 6, 16, Math.PI * 1.4), brass); hook.position.y = -4.5; g.add(hook)
      const pan = new THREE.Mesh(new THREE.SphereGeometry(4.6, 32, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), brass)
      pan.position.y = -8.6 + 4.6 * 0.93; pan.scale.y = 0.6; g.add(pan)
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2, x = Math.cos(a) * 3.9, z = Math.sin(a) * 3.9
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 4), brass)
        const top = new THREE.Vector3(0, -4.8, 0), bot = new THREE.Vector3(x, -10.9, z)
        ch.position.copy(top).add(bot).multiplyScalar(0.5); ch.scale.y = top.distanceTo(bot); ch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize()); g.add(ch)
      }
      const pf = mangoGeometry(0.22)
      pf.setAttribute('aRipe', new THREE.InstancedBufferAttribute(new Float32Array([0.85, 0.7, 0.9, 0.8]), 1))
      const pm = new THREE.InstancedMesh(pf, this.heapMat, 4)
      ;[[-1.2, 0, 0.6], [1.1, 0.1, -0.5], [0.1, 0.3, 1.4], [0, 0.9, -0.2]].forEach(([x, y, z], k) => pm.setMatrixAt(k, m4.compose(v.set(x, -10.2 + y, z), q.setFromEuler(e.set(Math.PI / 2, k * 1.7, 0.3)), sv.setScalar(1.1))))
      g.add(pm)
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true } })
      sc.add(g)
      this.hangScale = g
    }

    // A slow ceiling fan high over the room.
    {
      this.fans = []
      const fm = new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.6, metalness: 0.3 })
      for (const [x, y, z] of [[-14, 39, -30], [46, 44, -62]]) {
        const g = new THREE.Group(); g.position.set(x, y, z)
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 30, 6), fm); rod.position.y = 15; g.add(rod)
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 1.2, 16), fm); g.add(hub)
        const blades = new THREE.Group()
        for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.15, 1.6), fm); b.position.x = 5; const h = new THREE.Group(); h.rotation.y = (k / 3) * Math.PI * 2; b.rotation.x = 0.18; h.add(b); blades.add(h) }
        g.add(blades)
        sc.add(g)
        this.fans.push(blades)
      }
    }

    // ---- The table, its belt and legs.
    const wood = new THREE.MeshStandardMaterial({ color: '#e8b070', roughness: 0.5, map: woodTex() })
    wood.map.repeat.set(3, 1)
    const top = new THREE.Mesh(new THREE.BoxGeometry(110, 1.2, 15), wood); top.position.set(0, TOP - 0.6, -1); top.receiveShadow = true; top.castShadow = true; sc.add(top)
    for (const x of [-50, -20, 20, 50]) for (const z of [-7.5, 5.5]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, TOP - 1.2, 1.4), wood); leg.position.set(x, (TOP - 1.2) / 2, z); leg.castShadow = true; sc.add(leg) }
    const belt = new THREE.Mesh(new THREE.BoxGeometry(110, 0.25, 4.2), new THREE.MeshStandardMaterial({ color: '#1e1814', roughness: 0.6 })); belt.position.set(0, TOP + 0.12, BELT_Z); belt.receiveShadow = true; sc.add(belt)
    for (const z of [BELT_Z - 2.3, BELT_Z + 2.3]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(110, 0.6, 0.3), new THREE.MeshStandardMaterial({ color: '#c99a4a', roughness: 0.35, metalness: 0.6 })); rail.position.set(0, TOP + 0.4, z); sc.add(rail) }

    // Mangoes on the belt (instanced, each its own ripeness).
    const mg = mangoGeometry(hi ? 0.36 : 0.26)
    this.beltN = 26
    const ripe = new Float32Array(this.beltN)
    for (let i = 0; i < this.beltN; i++) ripe[i] = 0.05 + r() * 0.55
    mg.setAttribute('aRipe', new THREE.InstancedBufferAttribute(ripe, 1))
    this.beltMat = mangoMaterial({ instanced: true })
    this.beltMangoes = new THREE.InstancedMesh(mg, this.beltMat, this.beltN)
    this.beltMangoes.castShadow = true; this.beltMangoes.receiveShadow = true
    this.beltSeed = Array.from({ length: this.beltN }, () => [r() * 6.28, (r() - 0.5) * 0.5, r()])
    sc.add(this.beltMangoes)

    // The two trays and their cards, and the place set aside.
    const tray = (x, label, sub, tone) => {
      const g = new THREE.Group(); g.position.set(x, TOP, 2.0)
      const base = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 6.4), wood); base.position.y = 0.25; base.castShadow = true; base.receiveShadow = true; g.add(base)
      for (const [w, d, px, pz] of [[15, 0.6, 0, -3.2], [15, 0.6, 0, 3.2], [0.6, 6.4, -7.5, 0], [0.6, 6.4, 7.5, 0]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), wood); s.position.set(px, 0.8, pz); s.castShadow = true; g.add(s) }
      const liner = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 5.8), new THREE.MeshStandardMaterial({ color: '#d8c79a', roughness: 1 })); liner.position.y = 0.55; g.add(liner)
      const card = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 3.25), new THREE.MeshStandardMaterial({ map: cardTex(label, sub, tone), roughness: 0.8 }))
      card.position.set(0, 1.0, 3.62); card.rotation.x = -0.38; g.add(card)
      sc.add(g)
      return g
    }
    this.trayRaw = tray(-10.5, 'RAW · DAYS 1–3', 'firm and tangy', 'green')
    this.traySemi = tray(14, 'SEMI-RIPE · DAYS 4–7', 'ripens with you', 'gold')
    const never = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 2.6), new THREE.MeshStandardMaterial({ map: cardTex('NEVER SOLD', '', 'red'), roughness: 0.8 }))
    // NEVER SOLD lies at the back edge of the bench by his left hand, so he can slide the bruised one onto it.
    never.position.set(5.2, TOP + 0.02, -7.0); never.rotation.x = -Math.PI / 2; never.rotation.z = 0.12; never.scale.setScalar(0.62); sc.add(never)
    this.neverPos = new THREE.Vector3(5.0, TOP + LIE + 0.02, -6.8)
    // A small weighing scale at the end of the table: a steel platform, a column and a round dial.
    {
      const g = new THREE.Group(); g.position.set(-38, TOP, 0.5)
      const steelM = new THREE.MeshStandardMaterial({ color: '#c8c0b0', roughness: 0.3, metalness: 0.85 })
      const base = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 7), new THREE.MeshStandardMaterial({ color: '#174631', roughness: 0.45, metalness: 0.2 })); base.position.y = 0.6; g.add(base)
      const plate = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.3, 6.4), steelM); plate.position.y = 1.35; g.add(plate)
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      sc.add(g)
    }
    // Tray fruit: a few slots pre-filled, the rest drop in during the chapter.
    const slots = []
    for (const [tr, base] of [[this.trayRaw, 0.08], [this.traySemi, 0.5]]) {
      for (let row = 0; row < 2; row++) for (let col = 0; col < 5; col++) slots.push({ p: new THREE.Vector3(tr.position.x - 5.6 + col * 2.8, TOP + 1.1, tr.position.z - 1.5 + row * 3.0), ripe: base + r() * 0.15, at: r() < 0.5 ? -1 : 0.05 + r() * 0.75, rot: r() * 6.28, raw: tr === this.trayRaw, ours: false })
    }
    this.oursSlot = slots.find((s) => s.raw && s.p.z < this.trayRaw.position.z && Math.abs(s.p.x - this.trayRaw.position.x) < 0.5)
    this.oursSlot.ours = true
    this.slots = slots.filter((s) => !s.ours)
    const tg = mangoGeometry(hi ? 0.36 : 0.26)
    tg.setAttribute('aRipe', new THREE.InstancedBufferAttribute(new Float32Array(this.slots.map((s) => s.ripe)), 1))
    this.trayMangoes = new THREE.InstancedMesh(tg, mangoMaterial({ instanced: true }), this.slots.length)
    this.trayMangoes.castShadow = true; this.trayMangoes.receiveShadow = true
    sc.add(this.trayMangoes)

    // Our mango (with its tiny leaf), and the bruised one.
    this.mango = new Mango({ ripe: 0.22, leaf: true })
    sc.add(this.mango)
    this.bruised = new Mango({ ripe: 0.5, leaf: false, detail: 0.6 })
    this.bruised.u.uBruise.value = 1
    this.bruised.u.uBruiseDir.value.set(0.2, 0.3, 1).normalize()
    sc.add(this.bruised)
    // Its halo (a soft ring of light behind it, never over it) and a few glints on the skin as it turns.
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uOp: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform float uOp; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = smoothstep(.22, .42, d) * exp(-max(d - .4, 0.) * 5.) * smoothstep(1., .8, d); gl_FragColor = vec4(vec3(1., .74, .32) * a * uOp, 1.); }',
    }))
    this.halo.renderOrder = 6
    sc.add(this.halo)
    this.glint = glints(5)
    this.glintSeeds = Array.from({ length: 5 }, (_, k) => [r() * 6.28, r() * 2 - 1, r() * 6.28, 0.6 + r() * 0.8])
    sc.add(this.glint)

    // The scan line: a disc of gold light that slices down through the fruit.
    this.scan = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uOp: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform float uOp; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = smoothstep(1., .3, d) * .06 + smoothstep(.05, 0., abs(d - .9)) * .5; gl_FragColor = vec4(vec3(1., .7, .25) * a * uOp * 3., 1.); }',
    }))
    this.scanLine = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc861').multiplyScalar(6), transparent: true }))
    sc.add(this.scan, this.scanLine)

    // The rider. A portrait: the cap's gold is toned down so the lamp does not blow it out; the eyes get their own tiny
    // environment (one soft window in front) for a catch-light.
    this.person = new Person({ helmet: false, apron: true, lod: hi ? 1 : T.name === 'mid' ? 0.72 : 0.6 })
    this.person.position.set(-1, 0, -11.2)
    sc.add(this.person)
    this.person.mats.cap.color.setRGB(0.72, 0.68, 0.6)
    this.person.mats.cap.sheen = 0.15
    const eyeEnv = engine.env({ top: '#20160e', mid: '#3a2a1a', bottom: '#0a0604', sun: '#fff4e0', sunDir: new THREE.Vector3(0.35, 0.45, 1), sunPower: 26 })
    this.person.traverse((o) => { if (o.isMesh && o.material && o.material.clearcoatRoughness === 0.05 && o.material.map && !o.material.vertexColors) { o.material.envMap = eyeEnv; o.material.envMapIntensity = 1.6 } })

    this.dust = motes(Math.round(240 * T.particles + 40), new THREE.Box3(new THREE.Vector3(-30, 14, -16), new THREE.Vector3(34, 40, 14)), { size: 0.08, color: '#ffd8a0', drift: 0.8, opacity: 0.6, seed: 5 })
    sc.add(this.dust)
    // Dust in the window light: bigger, brighter specks inside the beams' volume.
    this.dust2 = motes(Math.round(420 * T.particles + 60), new THREE.Box3(new THREE.Vector3(-40, 4, -96), new THREE.Vector3(110, 54, -22)), { size: 0.3, color: '#ffe0a8', drift: 1.6, opacity: 0.5, seed: 11 })
    sc.add(this.dust2)
    // Out-of-focus lamp bokeh hanging far back in the haze.
    this.bok = bokeh(hi ? 26 : 16, new THREE.Box3(new THREE.Vector3(-90, 20, -96), new THREE.Vector3(90, 58, -50)), { size: 2.2, color: '#ffb860', opacity: 0.16, drift: 1, seed: 7 })
    sc.add(this.bok)

    this.userQ = new THREE.Quaternion(); this.userTarget = new THREE.Euler(0, 0, 0, 'YXZ'); this.userE = new THREE.Euler(0, 0, 0, 'YXZ')
    this.tmp = new THREE.Vector3(); this.tq = new THREE.Quaternion()
    this.ourPos = new THREE.Vector3()
    this.held = false
    this.rayFrom = new THREE.Vector3(-20, 47, WALL_Z)
    this.look.rays = 0.32; this.look.rayThreshold = 1.15; this.look.rayTint.setRGB(1, 0.82, 0.55)
  }

  /** Mango orientation lying on its side along the belt (long axis along x). */
  lieQ(spin = 0, out = new THREE.Quaternion()) { return out.setFromEuler(new THREE.Euler(spin, 0, -Math.PI / 2 + 0.08, 'XYZ')) }

  dragHit(nx, ny, i, t) {
    if (i !== 8 || !this.held) return false
    const v = this.tmp.copy(this.ourPos).project(this.camera)
    const edge = this.ourPos.clone().add(new THREE.Vector3(0, 1.4, 0)).project(this.camera)
    const rad = Math.abs(edge.y - v.y) * 1.25
    const asp = this.camera.aspect
    return Math.hypot((nx - v.x) * asp, ny - v.y) < rad * Math.max(1, asp) * 0.8 + 0.05
  }
  dragBy(dx, dy) { this.userTarget.y += dx * 7; this.userTarget.x = clamp(this.userTarget.x + dy * 5, -1.2, 1.2) }

  update(i, tt, time, dt) {
    const t = clamp(tt, -0.2, 1)
    const P = this.person, M = this.mango
    // Belt motion (pure in t): the belt carries everything along +x.
    const beltX = (t + 0.2) * 48
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1)
    for (let k = 0; k < this.beltN; k++) {
      const [spin, wob] = this.beltSeed[k]
      let x = ((k * 5 + 2.5 + beltX) % 130) - 65
      const ourX = -4 + (Math.min(t, 0.18) - 0.18) * 48, bX = Math.min(2.6, 2.6 - (0.84 - t) * 48)
      const gap = (t < 0.18 && Math.abs(x - ourX) < 2.8) || (t < 0.9 && Math.abs(x - bX) < 2.8)
      q.copy(this.lieQ(spin + (x + 65) * 0.06, q))
      m4.compose(this.tmp.set(x, TOP + LIE + 0.25, BELT_Z + wob), q, sv.setScalar(gap ? 0.0001 : 1))
      this.beltMangoes.setMatrixAt(k, m4)
    }
    this.beltMangoes.instanceMatrix.needsUpdate = true

    // Our mango's path: on the belt (arrives at x = -4 at t 0.18), lifted (0.18–0.3), held and turned (0.3–0.6),
    // pressed (0.5–0.6), into the raw tray (0.62–0.74).
    const pick = 0.18, up = smoother(pick, 0.3, t), place = smoother(0.62, 0.74, t)
    const onBelt = new THREE.Vector3(-4 + (Math.min(t, pick) - pick) * 48, TOP + LIE + 0.25, BELT_Z)
    const inspect = new THREE.Vector3(-0.2, 22.4, -4.0)
    const inTray = this.oursSlot.p.clone()
    const pos = new THREE.Vector3()
    const lift = onBelt.clone().lerp(inspect, up)
    lift.y += Math.sin(up * Math.PI) * 1.5
    pos.copy(lift)
    if (place > 0) { pos.lerpVectors(inspect, inTray, place); pos.y += Math.sin(place * Math.PI) * 2.2 }
    const turn = smooth(0.3, 0.58, t)
    const lieQ = this.lieQ(t < pick ? (t + 0.2) * 48 * 0.06 : 0)
    const showQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 + Math.sin(turn * Math.PI) * 0.25, -0.6 + turn * Math.PI * 1.4, 0.15 - Math.sin(turn * Math.PI * 2) * 0.15, 'YXZ'))
    const trayQ = this.lieQ(0.6)
    const mq = new THREE.Quaternion().slerpQuaternions(lieQ, showQ, up)
    if (place > 0) mq.slerp(trayQ, place)
    this.held = t > 0.24 && t < 0.62
    const ud = 1 - Math.exp(-dt * 8)
    this.userE.x += (this.userTarget.x - this.userE.x) * ud; this.userE.y += (this.userTarget.y - this.userE.y) * ud
    if (!this.held && t > 0.62) { this.userTarget.x *= 0.9; this.userTarget.y *= 0.9 }
    this.userQ.setFromEuler(this.userE)
    const press = Math.sin(clamp((t - 0.5) / 0.1) * Math.PI)
    M.position.copy(pos)
    M.quaternion.copy(this.userQ).multiply(mq)
    M.scale.set(1 + press * 0.012, 1 - press * 0.02, 1 + press * 0.012)
    M.ripe = 0.22
    this.ourPos.copy(pos)

    // The bruised one rides the belt up to him (stopped at x 2.6 at t 0.84) and he slides it off, back onto NEVER SOLD.
    const bT = smoother(0.845, 0.92, t)
    const bBelt = new THREE.Vector3(Math.min(2.6, 2.6 - (0.84 - t) * 48), TOP + LIE + 0.25, BELT_Z + 0.2)
    this.bruised.position.copy(bBelt).lerp(this.neverPos, bT)
    this.bruised.position.y += Math.sin(bT * Math.PI) * 0.9
    this.bruised.quaternion.copy(this.lieQ(2.4 + bBelt.x * 0.06 + bT * 1.5))

    // Tray fruit dropping in.
    this.slots.forEach((s, k) => {
      const d = s.at < 0 ? 1 : smoother(s.at, s.at + 0.06, t)
      const p = s.p.clone(); p.y += (1 - d) * 7
      m4.compose(p, this.lieQ(s.rot, q), sv.setScalar(d <= 0 ? 0.0001 : 1))
      this.trayMangoes.setMatrixAt(k, m4)
    })
    this.trayMangoes.instanceMatrix.needsUpdate = true

    // The rider: posture keyed on the beats, weight shifting over planted feet, hands by IK on the fruit, head and eyes
    // on whatever he is handling. The check reads as: lift, turn it in both hands, tilt the head, lean in and press
    // with a thumb (a little squint), then a clear double nod and a smile.
    // Sorting (0.58–0.92), staged as one action: he steps half a pace to his right towards the raw tray, turns at the
    // waist and leans in, lowers the mango into its place with his right hand while the left rests on the bench edge,
    // eyes on the fruit; lets go, straightens and steps back; then slides the bruised one off the belt onto NEVER SOLD
    // with his left hand, the right resting on the bench. Elbows stay bent and low (all targets are within reach).
    const sOut = smooth(0.58, 0.68, t), sBack = smooth(0.8, 0.9, t), sB = sOut * (1 - sBack)
    const placeLean = smooth(0.62, 0.7, t) * (1 - smooth(0.75, 0.82, t))
    const bk = smooth(0.82, 0.86, t) * (1 - smooth(0.92, 0.97, t))
    const lean = Math.max(smooth(0.08, 0.18, t) * (1 - smooth(0.2, 0.3, t)), placeLean * 1.25, bk * 0.7)
    const tilt = smooth(0.3, 0.38, t) * (1 - smooth(0.56, 0.64, t))
    const pressK = smooth(0.47, 0.52, t) * (1 - smooth(0.58, 0.62, t))
    const nodK = clamp((t - 0.6) / 0.075)
    const nod = t > 0.6 && t < 0.675 ? 0.17 * Math.sin(nodK * Math.PI) * Math.abs(Math.sin(nodK * Math.PI * 2)) : 0
    const breathe = Math.sin(time * 1.6) * 0.012
    const turnBody = -0.32 * smooth(0.6, 0.7, t) * (1 - smooth(0.76, 0.84, t)) + 0.3 * bk
    const shift = -0.55 * smooth(0.06, 0.16, t) * (1 - smooth(0.24, 0.34, t)) - 0.45 * placeLean + 0.35 * bk
    const dip = 0.35 * lean + 0.15 * pressK
    // Where he stands: home, or half a pace to the right (body turned a little), feet stepping one after the other.
    const HOME = new THREE.Vector3(-1, 0, -11.2), SIDE = new THREE.Vector3(-5.8, 0, -10.6), SIDE_YAW = -0.3
    P.position.lerpVectors(HOME, SIDE, sB); P.rotation.y = SIDE_YAW * sB
    P.pose({
      hips: [0, turnBody * 0.5, -shift * 0.05], spine: [0.05 + lean * 0.26 + breathe + pressK * 0.06, turnBody * 0.5, shift * 0.06], chest: [0.02 + lean * 0.18 + tilt * 0.06, 0, 0],
      neck: [0, 0, 0], head: [0, 0, 0],
      smile: 0.35 + smooth(0.58, 0.66, t) * 0.75 - pressK * 0.15, blink: Math.max(Person.blinkAt(time, 1), pressK * 0.38),
    })
    P.j.hips.position.set(shift, 15.45 - dip, 0)
    P.updateMatrixWorld(true)
    const footAt = (pos, yaw, sd) => this.tmp.set(sd * 1.6, 1.35, 0.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(pos).clone()
    for (const sd of [1, -1]) {
      // right foot leads going out and coming back; each foot lifts as it travels
      const fo = sd < 0 ? smooth(0.58, 0.64, t) : smooth(0.62, 0.68, t), fb = sd < 0 ? smooth(0.84, 0.9, t) : smooth(0.8, 0.86, t)
      const f = fo * (1 - fb), lift = Math.sin(Math.PI * fo) * (1 - fb) + Math.sin(Math.PI * fb) * fo
      const fp = footAt(HOME, 0, sd).lerp(footAt(SIDE, SIDE_YAW, sd), f); fp.y += lift * 0.9
      P.foot(sd > 0 ? 'L' : 'R', fp, SIDE_YAW * f + sd * 0.08, -lift * 0.25)
    }
    P.updateMatrixWorld(true)
    const pole = (s) => P.localToWorld(new THREE.Vector3(s * 7, 12, -8))
    const rest = (s) => ({ p: P.localToWorld(new THREE.Vector3(s * 3.4, TOP + 0.9, 6.8)), q: P.palmBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-s * 0.2, 0, 1)) })
    // a hand resting on the bench's near edge, palm down, close to the body
    const bench = (s) => ({ p: P.localToWorld(new THREE.Vector3(s * 3.3, TOP + 0.75, 4.2)), q: P.palmBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-s * 0.35, 0, 1)) })
    const mWorld = M.position
    const sideGrip = (s, extraY = 0) => ({
      p: mWorld.clone().add(new THREE.Vector3(s * 1.05, -0.55 + extraY, -0.15)),
      q: P.palmBasis(new THREE.Vector3(-s, 0.3, 0), new THREE.Vector3(-s * 0.1, 1, 0.35)),
    })
    // lowering it in: the hand over the fruit, fingers down and forward around it
    const topGrip = () => ({ p: mWorld.clone().add(new THREE.Vector3(0.25, 1.0, -0.55)), q: P.palmBasis(new THREE.Vector3(0, -1, 0.15), new THREE.Vector3(-0.3, -0.2, 1)) })
    const underGrip = () => ({ p: mWorld.clone().add(new THREE.Vector3(-0.2, -0.95, 0)), q: P.palmBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.5, 0, 1)) })
    const blend = (a, b, k) => ({ p: a.p.clone().lerp(b.p, k), q: a.q.clone().slerp(b.q, k) })
    const reachIn = smoother(0.08, pick, t), release = smoother(0.75, 0.81, t)
    let R = blend(rest(-1), underGrip(), reachIn)
    if (t > pick) R = blend(underGrip(), sideGrip(-1), smooth(0.24, 0.32, t))
    if (t > 0.6) R = blend(sideGrip(-1), topGrip(), smooth(0.6, 0.66, t))
    if (t > 0.74) { const lifted = topGrip(); lifted.p.y += 1.6 * release; R = blend(lifted, bench(-1), smooth(0.78, 0.86, t)) }
    P.reach('R', R.p, R.q, pole(-1))
    const join = smoother(0.24, 0.32, t) * (1 - smoother(0.58, 0.64, t))
    let Lh = t < 0.5 ? blend(rest(1), sideGrip(1), join) : blend(bench(1), sideGrip(1), join)
    if (t < 0.5) Lh = blend(rest(1), sideGrip(1), join)
    const bruisedGrip = { p: this.bruised.position.clone().add(new THREE.Vector3(0.25, 0.95, 0.2)), q: P.palmBasis(new THREE.Vector3(0, -1, 0.2), new THREE.Vector3(-0.2, -0.25, 1)) }
    if (bk > 0) Lh = blend(Lh, bruisedGrip, bk)
    P.reach('L', Lh.p, Lh.q, pole(1))
    const thumbPress = smooth(0.5, 0.54, t) * (1 - smooth(0.58, 0.62, t))
    const benchFlat = smooth(0.6, 0.66, t)
    P.pose({ curlR: lerp(0.3, 0.7, Math.max(reachIn, this.held ? 1 : 0, smooth(0.6, 0.66, t) * (1 - release))) * (1 - release * 0.6), thumbR: 0.4 + thumbPress * 0.6, curlL: lerp(0.3, 0.62, join) * (1 - benchFlat * 0.5) + thumbPress * 0.1 + bk * 0.25, thumbL: 0.5, spreadL: 0.1 + benchFlat * 0.1, spreadR: 0.1 })
    const lookT = t < 0.62 ? (t < pick ? onBelt : mWorld) : t < 0.82 ? mWorld : bk > 0.3 ? this.bruised.position : inTray
    P.lookAt(lookT, 0.55, 1)
    P.j.head.rotation.z += tilt * 0.24
    P.j.head.rotation.x += nod + pressK * 0.1
    P.j.neck.rotation.x -= lean * 0.12

    // The scan line passes over the fruit (0.4–0.55).
    const sk = clamp((t - 0.4) / 0.15)
    const sOp = Math.sin(sk * Math.PI)
    this.scan.material.uniforms.uOp.value = sOp
    this.scanLine.material.opacity = sOp
    this.scan.visible = this.scanLine.visible = sOp > 0.001
    this.scan.position.copy(mWorld).add(new THREE.Vector3(0, 1.3 - sk * 2.6, 0))
    this.scan.rotation.x = -Math.PI / 2 + 0.12
    this.scanLine.position.copy(this.scan.position)
    this.scanLine.rotation.x = this.scan.rotation.x
    this.scanLine.scale.setScalar(0.35 + 0.42 * Math.sin(Math.acos(clamp((1.3 - sk * 2.6) / 1.35, -1, 1))))

    // Camera: in from the dark (the headlight's circle becomes a lamp), push to the hands at inspection, ease out to
    // the trays as it goes in, then settle on our mango in the raw tray.
    const c0 = new THREE.Vector3(14, 26, 54), l0 = new THREE.Vector3(-3, 21, -5)
    const c1 = new THREE.Vector3(6, 25.0, 23), l1 = new THREE.Vector3(0.2, 24.0, -6)
    const c2 = new THREE.Vector3(4, 29, 36), l2 = new THREE.Vector3(-7.5, 22, -3)
    const a = smoother(-0.15, 0.32, t), b = smoother(0.56, 0.74, t), c = smoother(0.8, 1, t)
    const cam = c0.clone().lerp(c1, a).lerp(c2, b), look = l0.clone().lerp(l1, a).lerp(l2, b)
    cam.lerp(new THREE.Vector3(-21, 29, 28), c); look.lerp(inTray.clone().lerp(new THREE.Vector3(-3, 28, -9), 0.45 * (1 - smooth(0.9, 1, t))), c)
    cam.x += Math.sin(time * 0.3) * 0.3; cam.y += Math.sin(time * 0.23) * 0.2
    aim(this.camera, cam, look)
    // Portrait light that follows his face: warm key from the camera side, a cool window rim from behind-left and a
    // warm kicker from behind-right.
    const headW = P.j.head.localToWorld(this.tmp.set(0, 1.9, 1.2))
    this.face.target.position.copy(headW); this.face.position.copy(headW).add(new THREE.Vector3(9, 2, 24))
    this.rim.target.position.copy(headW).add(new THREE.Vector3(0, -4, 0)); this.rim.position.copy(headW).add(new THREE.Vector3(-14, 10, -24))
    this.rim2.target.position.copy(headW).add(new THREE.Vector3(0, -5, 0)); this.rim2.position.copy(headW).add(new THREE.Vector3(16, 8, -22))
    const holdK = smooth(0.18, 0.28, t) * (1 - smooth(0.6, 0.7, t))
    this.mangoLight.position.copy(mWorld).add(new THREE.Vector3(1.5, 3, 4)); this.mangoLight.intensity = 26 * holdK
    this.post.focus = cam.distanceTo(mWorld) + 2.0 * a * (1 - b); this.post.range = lerp(12, 9, a); this.post.dof = lerp(4, 6, a)
    this.focus.copy(t < 0.1 ? onBelt : mWorld)

    // The precious one: a soft halo behind it and a few glints that come and go on its skin as it turns.
    const toCam = this.tmp.copy(cam).sub(mWorld).normalize()
    this.halo.position.copy(mWorld).addScaledVector(toCam, -1.6)
    this.halo.quaternion.copy(this.camera.quaternion)
    this.halo.scale.setScalar(5.6)
    this.halo.material.uniforms.uOp.value = 0.32 * holdK + 0.2 * smooth(0.4, 0.5, t) * (1 - smooth(0.55, 0.62, t))
    this.halo.visible = holdK > 0.001
    const gp = this.glint.geometry.attributes.position, gk = this.glint.geometry.attributes.aK
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    this.glintSeeds.forEach(([a0, h, ph, sp], k) => {
      const ang = a0 + turn * 5 + time * 0.15 * sp
      const pp = mWorld.clone().addScaledVector(right, Math.cos(ang) * 0.62).addScaledVector(upv, h * 0.85 + 0.1).addScaledVector(toCam, 0.75 + Math.sin(ang) * 0.1)
      gp.setXYZ(k, pp.x, pp.y, pp.z)
      const tw = Math.pow(Math.max(0, Math.sin(time * 1.3 * sp + ph)), 6)
      gk.setX(k, tw * holdK * (Math.sin(ang) > -0.2 ? 1 : 0))
    })
    gp.needsUpdate = true; gk.needsUpdate = true
    this.glint.material.uniforms.uSize.value = 46 * this.engine.dpr * (this.engine.h / 900)

    // Air and life.
    this.fans.forEach((f, k) => { f.rotation.y = time * (0.6 + k * 0.17) })
    this.hangScale.rotation.z = Math.sin(time * 0.5) * 0.012; this.hangScale.rotation.x = Math.sin(time * 0.37 + 1) * 0.01
    this.beamMat.uniforms.uTime.value = time

    this.look.bloom = 0.55; this.look.threshold = 0.95; this.look.exposure = 1.18; this.look.vig = 0.58
    this.grade([0.004, 0.012, 0.018], [1.07, 1.0, 0.9], 1.04)
    // On a tall screen the type sits over the window: keep it a soft glow there, not a blaze.
    const tall = this.camera.aspect < 1
    this.winM.color.setRGB(1.8, 1.7, 1.55).multiplyScalar(tall ? 0.35 : 1)
    this.look.rays = (tall ? 0.12 : 0.32) * (1 - 0.3 * a * (1 - b))
    for (const d of [this.dust, this.dust2]) d.userData.u.uTime.value = time
    this.bok.userData.u.uTime.value = time; this.bok.userData.u.uScale.value = this.engine.h * this.engine.dpr / 900
    P.rimU.uRimCol.value.set('#9cc2ff'); P.rimU.uRim.value = 0.3
  }

  afterCamera() {
    for (const m of [this.mango, this.bruised]) m.tick(this.dust.userData.u.uTime.value, this.sunView, this.sunCol)
    this.beltMat.userData.u.uSunView.value.copy(this.sunView)
    this.heapMat.userData.u.uSunView.value.copy(this.sunView)
  }
}
