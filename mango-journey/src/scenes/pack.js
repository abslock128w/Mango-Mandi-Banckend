// Chapter 9 "Packed so it never bruises." A packing bench in the warehouse, early morning: a warm pendant lamp over the
// work, a window behind throwing soft shafts and a bright patch of panes across the bench, flat boxes stacked ready, a roll
// of twine, tissue, a date stamp on its ink pad, shelves of packed boxes going soft in the background, straw wisps and dust
// drifting in the light. A VMR Mangoes box assembles from an exploded view (gold guide lines, kraft faces gliding in and
// folding up along their creases), a straw nest rises inside, mangoes are laid in and glow gold against the straw, and a
// gloved hand (a real arm, out of frame to the shoulder) nests ours among them. The flaps close, a label prints itself,
// and a hand brings the date stamp from its pad and stamps the day it was plucked (a spark of gold), while a ribbon of
// text wraps the box. The shot ends pushing into the label's gold dot: the circle that opens the delivery chapter.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Stage, aim, motes } from './stage.js'
import { Mango } from '../lib/mango.js'
import { Hand, fabric, bumpTex, addRim, rimUniforms } from '../lib/hand.js'
import { rng, smooth, smoother, lerp, clamp, easeInOut, easeOut, canvasTex, SANS, SERIF } from '../lib/util.js'
import { woodTexture, kraftTexture, drawWordmark, strawMesh, strawBedTexture, mangoCrowd, handQuat } from './crate-kit.js'
import { poolMaterial, beamMaterial, beam, bokeh, glints } from './grade.js'

const W = 8, D = 5.6, H = 3.0, TH = 0.09
const SLOTS = [[-2.85, -1.35], [-0.95, -1.35], [0.95, 1.35], [2.85, -1.35], [-2.85, 1.35], [-0.95, 1.35], [2.85, 1.35]]
const OURS = new THREE.Vector3(0.95, TH + 1.05, -1.35) // the back row, so the hand that places it stays in view over the front wall
const LABEL = new THREE.Vector3(0.5, H + TH * 1.6, 0.2)
const PAD = new THREE.Vector3(6.6, 0, 2.6) // the ink pad on the bench
const STAMP_UV = [0.27, 0.46] // where the stamp lands on the label (u, v)
const WIN = new THREE.Vector3(-16, 13, -19) // the window, behind and left

/** Twill cloth for the sleeves: a fine diagonal weave (colour and bump) that repeats every ~1.4 units. */
let sleeveTex = null
function sleeveTextures() {
  if (sleeveTex) return sleeveTex
  const weave = (g, Wd, Hd, bump) => {
    g.fillStyle = bump ? '#808080' : '#e6eee8'; g.fillRect(0, 0, Wd, Hd)
    const r = rng(bump ? 5 : 6)
    for (let k = -Hd; k < Wd; k += 4) { g.strokeStyle = bump ? `rgba(255,255,255,${0.3 + r() * 0.15})` : `rgba(255,255,255,${0.1 + r() * 0.06})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(k, 0); g.lineTo(k + Hd, Hd); g.stroke() }
    for (let k = -Hd; k < Wd; k += 4) { g.strokeStyle = bump ? `rgba(0,0,0,${0.25 + r() * 0.15})` : `rgba(20,40,30,${0.08 + r() * 0.06})`; g.lineWidth = 1; g.beginPath(); g.moveTo(k + 2, 0); g.lineTo(k + 2 + Hd, Hd); g.stroke() }
    for (let i = 0; i < 160; i++) { g.fillStyle = bump ? `rgba(0,0,0,${r() * 0.2})` : `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * Wd, r() * Hd, 2 + r() * 10, 1) }
  }
  const map = canvasTex(256, 256, (g, Wd, Hd) => weave(g, Wd, Hd, false), { repeat: true })
  const bump = canvasTex(256, 256, (g, Wd, Hd) => weave(g, Wd, Hd, true), { repeat: true, srgb: false })
  // the cuff band's seam: a line of gold stitches
  const stitch = canvasTex(512, 32, (g, Wd, Hd) => {
    g.clearRect(0, 0, Wd, Hd)
    g.fillStyle = 'rgba(10,30,20,.55)'; g.fillRect(0, Hd * 0.62, Wd, 3)
    g.fillStyle = '#e8b84a'; for (let x = 4; x < Wd; x += 16) { g.beginPath(); g.ellipse(x + 4, Hd * 0.42, 5, 1.6, 0, 0, 7); g.fill() }
  }, { repeat: true })
  sleeveTex = { map, bump, stitch }
  return sleeveTex
}

/** A sleeve from a Hand's cuff to a shoulder out of frame, rebuilt every frame as one continuous cloth tube: a tapered
    forearm, a rounded elbow and the upper arm, slightly oval in section, with twill weave, a stitched cuff seam, a
    little bunching above the cuff and soft folds on the inside of the elbow that deepen as the arm bends. */
class Arm extends THREE.Group {
  constructor(color = '#22634a', { rings = 56, segs = 26 } = {}) {
    super()
    const tx = sleeveTextures()
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.86, map: tx.map, bumpMap: tx.bump, bumpScale: 2.6, sheen: 0.85, sheenRoughness: 0.5, sheenColor: new THREE.Color('#a8dcb8') })
    this.rim = rimUniforms('#ffe6c0', 0.45)
    addRim(mat, this.rim)
    this.R = rings; this.S = segs
    const g = new THREE.BufferGeometry()
    this.pos = new Float32Array(rings * (segs + 1) * 3)
    const uv = new Float32Array(rings * (segs + 1) * 2), idx = []
    for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1; idx.push(a, c, b, b, c, d) }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx)
    this.uv = uv
    this.tube = new THREE.Mesh(g, mat); this.tube.frustumCulled = false; this.tube.castShadow = true; this.tube.receiveShadow = true
    this.add(this.tube)
    // the stitched band at the cuff
    this.band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, segs * 2, 1, true), new THREE.MeshStandardMaterial({ map: tx.stitch, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }))
    tx.stitch.repeat.set(4, 1)
    this.band.geometry.translate(0, 0.5, 0); this.band.frustumCulled = false
    this.add(this.band)
    this.v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  }
  /** Follow a Hand: the forearm leaves its cuff straight back; the upper arm reaches the shoulder. */
  follow(hand, shoulder, fore = 5.4) {
    hand.updateMatrixWorld(true)
    this.visible = hand.visible
    if (!this.visible) return
    const sc = hand.scale.x
    const W = hand.localToWorld(new THREE.Vector3(0, -0.06, -0.92))
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(hand.quaternion).normalize()
    const side0 = new THREE.Vector3(1, 0, 0).applyQuaternion(hand.quaternion).normalize()
    const E = W.clone().addScaledVector(back, fore * sc), S = shoulder
    const dU = S.clone().sub(E), upLen = dU.length(); dU.normalize()
    const bend = Math.acos(clamp(back.dot(dU), -1, 1)) // 0 straight … π folded
    const inner = dU.clone().sub(back).normalize() // towards the inside of the elbow
    // centreline: forearm, a rounded corner at the elbow, upper arm (sampled by arc length)
    const cr = 1.0 * Math.min(1, bend / 1.2)
    const A = E.clone().addScaledVector(back, -cr), B = E.clone().addScaledVector(dU, cr)
    const L1 = fore * sc - cr, L2 = upLen - cr, Lc = cr * 1.6, total = L1 + Lc + L2
    const R = this.R, Sg = this.S, pos = this.pos, uv = this.uv
    const C = new THREE.Vector3(), T = new THREE.Vector3(), N = side0.clone(), Bn = new THREE.Vector3(), prevT = back.clone()
    for (let i = 0; i < R; i++) {
      const s = (i / (R - 1)) * total
      if (s <= L1) { C.copy(W).addScaledVector(back, s); T.copy(back) }
      else if (s <= L1 + Lc) { const u = (s - L1) / Lc; C.copy(A).multiplyScalar((1 - u) * (1 - u)).addScaledVector(E, 2 * u * (1 - u)).addScaledVector(B, u * u); T.copy(E).sub(A).multiplyScalar(2 * (1 - u)).addScaledVector(B.clone().sub(E), 2 * u).normalize() }
      else { C.copy(B).addScaledVector(dU, s - L1 - Lc); T.copy(dU) }
      // parallel-transport the side axis so the tube never twists
      const q = new THREE.Quaternion().setFromUnitVectors(prevT, T); N.applyQuaternion(q); prevT.copy(T)
      N.sub(T.clone().multiplyScalar(N.dot(T))).normalize(); Bn.crossVectors(T, N)
      // radius: wrist 0.66, forearm swells, elbow, upper arm, a stitched band at the cuff
      const k = s / total, ke = (fore * sc) / total, d = (s - fore * sc) / 1.1
      let r = k < ke ? lerp(0.68, 0.84, Math.sin(Math.min(1, k / ke / 0.75) * Math.PI / 2)) : lerp(0.86, 1.0, (k - ke) / (1 - ke))
      r += 0.06 * Math.exp(-d * d) // elbow
      if (s < 0.16) r += 0.035 // the cuff band
      const bunch = Math.exp(-Math.pow((s - 0.9) / 0.6, 2)) // cloth gathered just above the cuff
      for (let j = 0; j <= Sg; j++) {
        const a = (j / Sg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a)
        const dir = this.v[0].copy(N).multiplyScalar(ca * 1.08).addScaledVector(Bn, sa * 0.94)
        const towardIn = Math.max(0, this.v[1].copy(N).multiplyScalar(ca).addScaledVector(Bn, sa).dot(inner))
        const elbowFold = Math.exp(-d * d * 1.3) * (bend / Math.PI) * Math.pow(towardIn, 1.5) * Math.pow(Math.abs(Math.sin(s * 7.5 + ca * 0.8)), 2)
        const crease = Math.pow(Math.abs(Math.sin(a * 2.5 + s * 1.3)), 6) // long soft creases down the forearm
        const rr = r * (1 - 0.16 * elbowFold + 0.06 * bunch * Math.sin(a * 5 + s * 9) + 0.02 * Math.sin(a * 3 + s * 2.3) - 0.035 * crease * (k < ke ? 1 : 0.4))
        const o = (i * (Sg + 1) + j)
        pos[o * 3] = C.x + dir.x * rr; pos[o * 3 + 1] = C.y + dir.y * rr; pos[o * 3 + 2] = C.z + dir.z * rr
        uv[o * 2] = (j / Sg) * 2.4; uv[o * 2 + 1] = s / 1.4
      }
      if (i === 0) { this.band.position.copy(C).addScaledVector(T, 0.1); this.band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), T); this.band.scale.set(r * 1.06, 0.14, r * 0.98) }
    }
    const g = this.tube.geometry
    g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true
    g.computeVertexNormals(); g.computeBoundingSphere()
  }
}

function stampTex() {
  return canvasTex(256, 256, (g, Wd, Hd) => {
    g.clearRect(0, 0, Wd, Hd)
    const r = rng(23)
    g.strokeStyle = '#174631'; g.fillStyle = '#174631'
    g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.stroke()
    g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 94, 0, 7); g.stroke()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `700 26px ${SANS}`; g.fillText('PLUCKED', 128, 76)
    g.font = `400 64px ${SERIF}`; g.fillText('Day 0', 128, 134)
    g.font = `700 20px ${SANS}`; g.fillText('BY HAND', 128, 184)
    // worn rubber: knock out specks so it reads as ink, not print
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 900; i++) { g.globalAlpha = 0.2 + r() * 0.6; g.beginPath(); g.arc(r() * Wd, r() * Hd, 0.5 + r() * 2.2, 0, 7); g.fill() }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'
  }, { aniso: 8 })
}

export default class Pack extends Stage {
  constructor(engine) {
    super(engine)
    engine.renderer.localClippingEnabled = true
    const sc = this.scene, T = this.tier, hi = T.name === 'high'
    this.fov = 32
    this.frame = [-0.13, -0.05]
    this.framePortrait = [0, -0.15]
    this.sun.set(-0.55, 0.62, -0.55).normalize() // the window light comes from behind-left
    this.sunCol.setRGB(1, 0.82, 0.58)
    sc.background = new THREE.Color('#1a120b')
    sc.fog = new THREE.Fog('#2a1e14', 34, 90)

    // ---- Light: a warm pendant overhead (soft shadows), the cool morning window from behind-left, a little bounce.
    const key = this.key = new THREE.SpotLight('#ffe0b4', 300, 70, 0.55, 0.8, 1.6)
    key.position.set(-3, 17, 6); key.target.position.set(0, 0, 0)
    key.castShadow = true; key.shadow.mapSize.set(T.shadow, T.shadow); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 6
    sc.add(key, key.target)
    this.winLight = new THREE.DirectionalLight('#ffeedd', 0.75); this.winLight.position.copy(WIN).add(new THREE.Vector3(-6, 6, -4)); this.winLight.target.position.set(0, 0, 0); sc.add(this.winLight, this.winLight.target)
    const rim = new THREE.DirectionalLight('#a8c0ff', 0.7); rim.position.set(-6, 6, -12); sc.add(rim)
    sc.add(new THREE.HemisphereLight('#ffe2c0', '#2a1a0c', 0.45))
    this.boxGlow = new THREE.PointLight('#ffb84a', 0, 7, 1.6); this.boxGlow.position.set(0.3, 2.6, 0.2); sc.add(this.boxGlow)
    sc.environment = engine.env({ top: '#3a2412', mid: '#c98a4a', bottom: '#120a04', sun: '#ffd8a0', sunDir: new THREE.Vector3(0.2, 1, 0.3), sunPower: 4 })

    // The pendant lamp, seen at the top of frame, with a faint cone of light in the dusty air.
    const shade = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.6, 40, 1, true), new THREE.MeshStandardMaterial({ color: '#174631', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }))
    shade.position.set(-3, 18, 6); sc.add(shade)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.5, 2.6) }))
    bulb.position.set(-3, 17.5, 6); sc.add(bulb)
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 20), new THREE.MeshStandardMaterial({ color: '#111' })); cord.position.set(-3, 28.8, 6); sc.add(cord)
    {
      const cg = new THREE.CylinderGeometry(1.9, 9, 16, 32, 1, true)
      const cone = new THREE.Mesh(cg, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN, vV)), 1.6); gl_FragColor = vec4(vec3(1., .74, .42) * pow(vY, 1.5) * e * .07, 1.); }',
      }))
      cone.position.set(-3, 17.2 - 8, 6); cone.renderOrder = 4; sc.add(cone)
    }

    // ---- The bench (a long, lighter wood top), the room behind it: a wall with a tall window, and shelves of packed
    // boxes waiting to go out.
    // Honey-teak planks with open grain, darker seams and edges worn pale where hands and boxes have slid.
    const wt = canvasTex(1024, 1024, (g, Wd, Hd) => {
      const rr = rng(77), n = 8, ph = Hd / n
      for (let k = 0; k < n; k++) {
        const y0 = k * ph, hue = 30 + rr() * 6, lit = 44 + rr() * 8
        g.fillStyle = `hsl(${hue},${46 + rr() * 8}%,${lit}%)`; g.fillRect(0, y0, Wd, ph)
        for (let i = 0; i < 46; i++) {
          const y = y0 + rr() * ph, a = 0.06 + rr() * 0.16
          g.strokeStyle = rr() < 0.75 ? `rgba(82,46,18,${a})` : `rgba(255,226,170,${a * 0.9})`; g.lineWidth = 0.6 + rr() * 2.2
          g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= Wd; x += 24) g.lineTo(x, y + Math.sin(x * 0.006 + i * 1.7) * 3 + Math.sin(x * 0.03 + i) * 0.8); g.stroke()
        }
        for (let i = 0; i < 2; i++) { const x = rr() * Wd, y = y0 + ph * (0.3 + rr() * 0.4); g.strokeStyle = 'rgba(70,38,14,.35)'; g.lineWidth = 2; for (let r2 = 4; r2 < 22; r2 += 4) { g.beginPath(); g.ellipse(x, y, r2 * 2.2, r2 * 0.7, 0, 0, 7); g.stroke() } }
        const wear = g.createLinearGradient(0, y0, 0, y0 + ph)
        wear.addColorStop(0, 'rgba(255,232,190,.22)'); wear.addColorStop(0.08, 'rgba(255,232,190,0)'); wear.addColorStop(0.92, 'rgba(255,232,190,0)'); wear.addColorStop(1, 'rgba(255,232,190,.18)')
        g.fillStyle = wear; g.fillRect(0, y0, Wd, ph)
        g.fillStyle = 'rgba(40,20,6,.75)'; g.fillRect(0, y0, Wd, 3)
        for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(255,235,200,${0.04 + rr() * 0.06})`; g.fillRect(rr() * Wd, y0 + rr() * ph, 20 + rr() * 120, 1 + rr() * 2) }
      }
    }, { repeat: true, aniso: 8 })
    wt.repeat.set(2.2, 1.4)
    const table = new THREE.Mesh(new THREE.BoxGeometry(56, 0.8, 30), new THREE.MeshStandardMaterial({ map: wt, color: '#e0d8cc', roughness: 0.55 }))
    table.position.set(0, -0.4, -2); table.receiveShadow = true; sc.add(table)
    const r = rng(7)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3()
    // Back wall with the window (panes bright, mullions dark), set behind the shelves.
    const wallM = new THREE.MeshStandardMaterial({ color: '#6a5444', roughness: 0.95 })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), wallM); wall.position.set(0, 20, -21); sc.add(wall)
    this.winM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2da').multiplyScalar(3), fog: false })
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(9, 12), this.winM); pane.position.set(WIN.x, WIN.y, -20.9); sc.add(pane)
    const mull = new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 0.8 })
    {
      const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.5), mull, 7); let kb = 0
      for (const x of [-4.5, 0, 4.5]) bars.setMatrixAt(kb++, m4.compose(v.set(WIN.x + x, WIN.y, -20.7), q.identity(), sv.set(0.5, 12.6, 1)))
      for (const y of [-6, -2, 2, 6]) bars.setMatrixAt(kb++, m4.compose(v.set(WIN.x, WIN.y + y, -20.7), q.identity(), sv.set(9.5, 0.5, 1)))
      sc.add(bars)
    }
    // Shafts from the window down onto the bench, and the bright patch of panes they make there.
    const bdir = new THREE.Vector3(0.5, -0.5, 0.71).normalize()
    this.beamMat = beamMaterial('#ffe2b0', 0.06)
    for (const dx of hi ? [-3, 0, 3] : [0]) { const b = beam(hi ? 2.6 : 7, 40, this.beamMat, bdir); b.position.set(WIN.x + dx, WIN.y + 1, -20); sc.add(b) }
    {
      const tex = canvasTex(256, 256, (g, Wd, Hd) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, Wd, Hd)
        g.filter = 'blur(6px)'; g.fillStyle = '#fff'
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) g.fillRect(30 + i * 102, 24 + j * 72, 92, 62)
        g.filter = 'none'
      }, { srgb: false })
      const patchM = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { map: { value: tex }, uOp: { value: 0.55 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: 'uniform sampler2D map; uniform float uOp; varying vec2 vUv; void main(){ float a = texture2D(map, vUv).r; gl_FragColor = vec4(vec3(1., .86, .62) * a * uOp, 1.); }',
      })
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2)
      // shear the patch along the light's direction
      const sh = new THREE.Matrix4().set(1, 0, 0.35, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); pg.applyMatrix4(sh)
      this.patch = new THREE.Mesh(pg, patchM); this.patch.scale.set(6.5, 1, 8.5); this.patch.position.set(-8.4, 0.1, -3.2); this.patch.rotation.y = -0.5
      this.patch.renderOrder = 3
      sc.add(this.patch)
    }
    // Shelves of packed boxes (kraft, a gold band, the green wordmark), soft in the background.
    {
      const shelfM = new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#8a6440', roughness: 0.85 })
      const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(36, 0.5, 4), shelfM, 4)
      for (let k = 0; k < 4; k++) boards.setMatrixAt(k, m4.compose(v.set(10, 1 + k * 4.4, -16.5), q.identity(), sv.set(1, 1, 1)))
      sc.add(boards)
      const bm = new THREE.MeshStandardMaterial({ roughness: 0.85, map: kraftTexture(512, 256, (g, Wd, Hd) => {
        g.fillStyle = '#e9a425'; g.fillRect(0, Hd * 0.62, Wd, Hd * 0.14)
        drawWordmark(g, Wd * 0.5, Hd * 0.32, 52)
      }, 11) })
      const spots = []
      for (let k = 0; k < 4; k++) for (let x = -6; x < 28; x += 4.2 + r() * 0.8) if (r() < 0.85) spots.push([x, 1.25 + k * 4.4, -16.4 + (r() - 0.5) * 0.6, (r() - 0.5) * 0.12])
      const bx = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 2.6, 2.6), bm, spots.length)
      spots.forEach(([x, y, z, ry], k) => bx.setMatrixAt(k, m4.compose(v.set(x, y + 1.3, z), q.setFromEuler(e.set(0, ry, 0)), sv.set(1, 1, 1))))
      sc.add(bx)
    }

    // ---- Things on the bench.
    // Flat boxes, stacked ready to fold.
    {
      const flatM = new THREE.MeshStandardMaterial({ map: kraftTexture(512, 512, (g, Wd, Hd) => { g.strokeStyle = 'rgba(90,60,30,.5)'; g.lineWidth = 4; g.setLineDash([12, 10]); g.strokeRect(Wd * 0.2, Hd * 0.2, Wd * 0.6, Hd * 0.6) }, 13), roughness: 0.88 })
      const n = 14, fl = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 0.11, 6.4), flatM, n)
      for (let k = 0; k < n; k++) fl.setMatrixAt(k, m4.compose(v.set(-12.5 + (r() - 0.5) * 0.4, 0.06 + k * 0.115, -7.5 + (r() - 0.5) * 0.4), q.setFromEuler(e.set(0, 0.25 + (r() - 0.5) * 0.12, 0)), sv.set(1, 1, 1)))
      fl.castShadow = hi; fl.receiveShadow = true; sc.add(fl)
    }
    // A roll of twine, its loose end running across the bench.
    {
      const tw = canvasTex(256, 128, (g, Wd, Hd) => {
        g.fillStyle = '#b8935c'; g.fillRect(0, 0, Wd, Hd)
        const rr = rng(31)
        for (let y = 0; y < Hd; y += 3) { g.strokeStyle = `rgba(${rr() < 0.5 ? '90,60,30' : '235,210,160'},${0.35 + rr() * 0.3})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y + 6 * (rr() - 0.5)); g.stroke() }
      }, { repeat: true })
      const twM = new THREE.MeshStandardMaterial({ map: tw, roughness: 0.9, color: '#e8d0a0' })
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.6, 40, 1, true), twM)
      roll.position.set(-7.2, 1.15, 4.6); roll.rotation.set(0, 0.4, Math.PI / 2); roll.castShadow = hi; roll.receiveShadow = true; sc.add(roll)
      const capM = new THREE.MeshStandardMaterial({ color: '#c8a46c', roughness: 0.9 })
      { const ga = new THREE.RingGeometry(0.35, 1.15, 40); ga.rotateX(Math.PI / 2); ga.translate(0, 0.8, 0); const gb = new THREE.RingGeometry(0.35, 1.15, 40); gb.rotateX(-Math.PI / 2); gb.translate(0, -0.8, 0); roll.add(new THREE.Mesh(mergeGeometries([ga, gb]), capM)) }
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.62, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#3a2412', side: THREE.BackSide })); roll.add(core)
      const pts = [new THREE.Vector3(-7.0, 0.1, 3.5), new THREE.Vector3(-5.6, 0.06, 2.4), new THREE.Vector3(-5.6, 0.06, 0.6), new THREE.Vector3(-6.4, 0.06, -0.6), new THREE.Vector3(-5.2, 0.06, -1.4)]
      const strand = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 6), twM); strand.castShadow = hi; sc.add(strand)
    }
    // Tissue sheets, catching the window light.
    {
      const tg = new THREE.PlaneGeometry(4.6, 3.4, 16, 12), p = tg.attributes.position
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, 0.06 * Math.sin(x * 3.1 + y * 1.7) + 0.05 * Math.sin(y * 5.3 - x) + Math.max(0, x - 1.6) * 0.18) }
      tg.computeVertexNormals(); tg.rotateX(-Math.PI / 2)
      const tm = new THREE.MeshPhysicalMaterial({ color: '#f4ead6', roughness: 0.7, sheen: 1, sheenColor: new THREE.Color('#fff4dc'), side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
      for (const [x, z, ry, y] of hi ? [[-9.6, -2.4, 0.5, 0.05], [-8.6, -1.4, 0.2, 0.12]] : [[-9.6, -2.4, 0.5, 0.05]]) { const t = new THREE.Mesh(tg, tm); t.position.set(x, y, z); t.rotation.y = ry; t.receiveShadow = true; sc.add(t) }
    }
    // A deep green cutting mat under the work, so the kraft and the fruit glow against it.
    {
      const mt = canvasTex(512, 384, (g, Wd, Hd) => {
        g.fillStyle = '#17402e'; g.fillRect(0, 0, Wd, Hd)
        g.strokeStyle = 'rgba(190,230,200,.16)'; g.lineWidth = 1
        for (let x = 0; x < Wd; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, Hd); g.stroke() }
        for (let y = 0; y < Hd; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y); g.stroke() }
        g.strokeStyle = 'rgba(255,200,90,.35)'; g.lineWidth = 2; g.strokeRect(10, 10, Wd - 20, Hd - 20)
      })
      const matM = new THREE.Mesh(new THREE.BoxGeometry(17, 0.08, 12.5), new THREE.MeshStandardMaterial({ map: mt, roughness: 0.75 }))
      matM.position.set(0.6, 0.04, 0.4); matM.rotation.y = 0.04; matM.receiveShadow = true; sc.add(matM)
    }
    // A loose drift of straw by the box.
    { const sd = strawMesh(Math.round(220 * T.particles + 60), -6.5, -2, -10, -6.6, 0.05, 19, 0.7); sd.castShadow = hi; sc.add(sd) }
    // The ink pad (a tin with green felt) and the date stamp standing on it.
    {
      const tin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, 1.9), new THREE.MeshStandardMaterial({ color: '#c8b48a', metalness: 0.8, roughness: 0.35 }))
      tin.position.copy(PAD).add(new THREE.Vector3(0, 0.16, 0)); tin.castShadow = true; tin.receiveShadow = true; sc.add(tin)
      const felt = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: '#0f3524', roughness: 0.95 }))
      felt.position.copy(PAD).add(new THREE.Vector3(0, 0.34, 0)); sc.add(felt)
      if (hi) { const lid = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.9), tin.material); lid.position.copy(PAD).add(new THREE.Vector3(0.4, 0.06, -2.3)); lid.rotation.y = 0.2; lid.castShadow = true; sc.add(lid) }
    }
    this.stamp = new THREE.Group()
    {
      // Built hanging from its knob (origin) with the rubber face at -y.
      const woodM = new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#9a6436', roughness: 0.55 })
      const kg = new THREE.SphereGeometry(0.42, 24, 16); kg.scale(1, 0.85, 1)
      const ng = new THREE.CylinderGeometry(0.15, 0.22, 1.0, 16); ng.translate(0, -0.62, 0)
      const bg = new THREE.CylinderGeometry(0.62, 0.62, 0.36, 32); bg.translate(0, -1.28, 0)
      const woodPart = new THREE.Mesh(mergeGeometries([kg.toNonIndexed(), ng.toNonIndexed(), bg.toNonIndexed()]), woodM)
      const rubber = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.1, 32), new THREE.MeshStandardMaterial({ color: '#16241c', roughness: 0.7 })); rubber.position.y = -1.51
      this.stamp.add(woodPart, rubber)
      this.stamp.traverse((o) => { if (o.isMesh) { o.castShadow = hi; o.receiveShadow = true } })
      this.stampFace = 1.56 // knob centre to face
      sc.add(this.stamp)
    }

    // ---- The box: bottom, four walls hinged at their bottom edges, two lid flaps hinged at the long walls' tops.
    const plain = new THREE.MeshStandardMaterial({ map: kraftTexture(512, 512, (g, w, h) => { g.strokeStyle = 'rgba(90,60,30,.4)'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12) }, 2), roughness: 0.85 })
    const inner = new THREE.MeshStandardMaterial({ map: kraftTexture(512, 512, null, 3), color: '#e9d2a8', roughness: 0.9 })
    const printed = new THREE.MeshStandardMaterial({ roughness: 0.8, map: kraftTexture(1024, 384, (g, w, h) => {
      g.strokeStyle = 'rgba(90,60,30,.45)'; g.lineWidth = 4; g.strokeRect(8, 8, w - 16, h - 16)
      drawWordmark(g, w * 0.3, h * 0.46, 92)
      g.fillStyle = '#174631'; g.font = `400 54px ${SERIF}`; g.textAlign = 'left'; g.fillText('Picked by hand.', w * 0.55, h * 0.44)
      g.font = `700 24px ${SANS}`; g.fillStyle = '#a4520f'; g.fillText('FIFTY SUMMERS · SINCE 1976', w * 0.55, h * 0.62)
    }, 4) })
    const sideP = new THREE.MeshStandardMaterial({ roughness: 0.82, map: kraftTexture(512, 384, (g, w, h) => {
      g.strokeStyle = 'rgba(90,60,30,.45)'; g.lineWidth = 4; g.strokeRect(8, 8, w - 16, h - 16)
      g.fillStyle = '#174631'; g.font = `700 30px ${SANS}`; g.textAlign = 'center'; g.fillText('THIS WAY UP', w / 2, h * 0.3)
      g.beginPath(); g.moveTo(w / 2 - 40, h * 0.62); g.lineTo(w / 2, h * 0.44); g.lineTo(w / 2 + 40, h * 0.62); g.lineWidth = 8; g.stroke()
      g.font = `400 34px ${SERIF}`; g.fillText('VMR Mangoes', w / 2, h * 0.82)
    }, 6) })
    const mats = (outIdx, out) => { const a = [inner, inner, inner, inner, inner, inner]; a[outIdx] = out; return a }
    this.box = new THREE.Group(); sc.add(this.box)
    const piece = (geo, m, px, py, pz, ox, oy, oz) => {
      const pv = new THREE.Group(); pv.position.set(px, py, pz)
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(ox, oy, oz); mesh.castShadow = true; mesh.receiveShadow = true
      pv.add(mesh); this.box.add(pv); pv.userData.home = pv.position.clone(); return pv
    }
    this.bottom = piece(new THREE.BoxGeometry(W, TH, D), mats(3, plain), 0, TH / 2, 0, 0, 0, 0)
    this.front = piece(new THREE.BoxGeometry(W, H, TH), mats(4, printed), 0, TH, D / 2, 0, H / 2, -TH / 2)
    this.back = piece(new THREE.BoxGeometry(W, H, TH), mats(5, printed), 0, TH, -D / 2, 0, H / 2, TH / 2)
    this.right = piece(new THREE.BoxGeometry(TH, H, D - 2 * TH), mats(0, sideP), W / 2, TH, 0, -TH / 2, H / 2, 0)
    this.left = piece(new THREE.BoxGeometry(TH, H, D - 2 * TH), mats(1, sideP), -W / 2, TH, 0, TH / 2, H / 2, 0)
    const flapG = new THREE.BoxGeometry(W, D / 2, TH)
    this.flapF = new THREE.Group(); this.flapF.position.set(0, H, 0); this.front.add(this.flapF)
    const ff = new THREE.Mesh(flapG, [inner, inner, inner, inner, plain, inner]); ff.position.set(0, D / 4, -TH / 2); ff.castShadow = true; ff.receiveShadow = true; this.flapF.add(ff)
    this.flapB = new THREE.Group(); this.flapB.position.set(0, H, 0); this.back.add(this.flapB)
    const fb = new THREE.Mesh(flapG, [inner, inner, inner, inner, inner, plain]); fb.position.set(0, D / 4, TH / 2); fb.castShadow = true; fb.receiveShadow = true; this.flapB.add(fb)
    this.pieces = [this.bottom, this.front, this.back, this.right, this.left]
    this.burst = [new THREE.Vector3(0, 2.0, 0), new THREE.Vector3(0, 5.0, 7.0), new THREE.Vector3(0, 6.5, -7.0), new THREE.Vector3(7.5, 5.5, 0), new THREE.Vector3(-7.5, 4.0, 0)]
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.pieces.length * 6), 3))
    this.guides = new THREE.LineSegments(lg, new THREE.LineDashedMaterial({ color: new THREE.Color(3, 1.9, 0.5), dashSize: 0.35, gapSize: 0.2, transparent: true }))
    sc.add(this.guides)

    // Straw nest (kept inside the walls: strands that would poke through are clipped).
    this.nest = new THREE.Group(); this.box.add(this.nest)
    const bedT = strawBedTexture(); bedT.repeat.set(1.6, 1.2)
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.25, D - 0.25), new THREE.MeshStandardMaterial({ map: bedT, roughness: 0.9 }))
    bed.rotation.x = -Math.PI / 2; bed.position.y = TH + 0.35; bed.receiveShadow = true; this.nest.add(bed)
    const nestStraw = strawMesh(Math.round(1100 * T.particles + 300), -W / 2 + 0.3, W / 2 - 0.3, -D / 2 + 0.3, D / 2 - 0.3, TH + 0.3, 12, 0.55)
    const c = 0.02
    nestStraw.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), W / 2 - c), new THREE.Plane(new THREE.Vector3(-1, 0, 0), W / 2 - c), new THREE.Plane(new THREE.Vector3(0, 0, 1), D / 2 - c), new THREE.Plane(new THREE.Vector3(0, 0, -1), D / 2 - c)]
    nestStraw.material.clipShadows = true
    nestStraw.material.color.setRGB(1.1, 1.0, 0.85)
    this.nest.add(nestStraw)

    // The other mangoes, and ours.
    this.others = SLOTS.map(([x, z], k) => ({ x, z, yaw: (k % 2 ? Math.PI : 0) + (r() - 0.5) * 0.3, ripe: [0.62, 0.7, 0.58, 0.76, 0.66, 0.72, 0.6][k] }))
    this.crowd = mangoCrowd(this.others.map((o) => ({ x: o.x, y: OURS.y, z: o.z, yaw: o.yaw, ripe: o.ripe })), hi ? 0.6 : 0.42)
    this.crowd.material.envMapIntensity = 0.6; this.crowd.material.clearcoat = 0.12
    this.crowd.material.emissive = new THREE.Color('#ff9a1a'); this.crowd.material.emissiveIntensity = 0.05
    this.box.add(this.crowd)
    this.mango = new Mango({ ripe: 0.62, leaf: true }); this.mango.rotation.order = 'YXZ'
    this.mango.material.emissive = new THREE.Color('#ff9a1a'); this.mango.material.emissiveIntensity = 0.04
    sc.add(this.mango)
    this.goldSun = new THREE.Color(1.6, 1.15, 0.6)

    // Hands: the left nests our mango, the right brings the stamp. Each has a full sleeve to a shoulder out of frame.
    this.hand = new Hand({ sleeve: '#174631' }); sc.add(this.hand)
    this.hand.sleeve.visible = false
    this.handQ = handQuat(new THREE.Vector3(-0.82, -0.5, 0.28), new THREE.Vector3(-0.15, -1, 0.05))
    this.armL = new Arm(); sc.add(this.armL)
    if (!hi) this.armL.tube.castShadow = false
    this.stampHand = new Hand({ sleeve: '#174631' }); sc.add(this.stampHand)
    this.stampHand.sleeve.visible = false
    this.armR = new Arm(); sc.add(this.armR)
    if (!hi) this.armR.tube.castShadow = false
    // Gripping the knob from above: fingers forward and down, palm onto the knob.
    this.stampQ = handQuat(new THREE.Vector3(-0.9, -0.36, 0.22), new THREE.Vector3(-0.3, -0.9, 0.1))
    this.stampOff = new THREE.Vector3(0, 0.62, 0.42) // the knob in the hand's frame (in front of the palm)

    // The label: prints itself row by row, a print-head line glowing at the edge.
    this.labelTex = canvasTex(768, 512, (g, w, h) => this.drawLabel(g, w, h), { aniso: 8 })
    if (document.fonts) Promise.all([document.fonts.load(`700 30px Figtree`), document.fonts.load(`400 40px 'Young Serif'`)]).then(() => { this.drawLabel(this.labelTex.image.getContext('2d'), 768, 512); this.labelTex.needsUpdate = true }).catch(() => {})
    this.labelU = { map: { value: this.labelTex }, uReveal: { value: 0 }, uShade: { value: 1 } }
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), new THREE.ShaderMaterial({
      uniforms: this.labelU, transparent: true,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: /* glsl */ `uniform sampler2D map; uniform float uReveal, uShade; varying vec2 vUv;
        vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
        void main(){
          vec4 t = texture2D(map, vUv);
          float shown = step(1. - uReveal, vUv.y);
          vec3 paper = vec3(.86, .82, .74);
          vec3 c = mix(paper, lin(t.rgb), shown * t.a);
          float head = exp(-pow((vUv.y - (1. - uReveal)) * 60., 2.)) * step(.001, uReveal) * step(uReveal, .999);
          gl_FragColor = vec4(c * uShade + vec3(1., .7, .3) * head * 1.5, smoothstep(0., .04, uReveal));
        }`,
    }))
    this.label.rotation.x = -Math.PI / 2; this.label.rotation.z = 0.04
    this.label.position.copy(LABEL)
    this.box.add(this.label)
    this.dotLocal = new THREE.Vector3(LABEL.x + (0.86 - 0.5) * 3.6, LABEL.y + 0.01, LABEL.z - (0.78 - 0.5) * 2.4)
    // The stamp's ink on the label (appears at the press).
    this.inkM = new THREE.MeshBasicMaterial({ map: stampTex(), transparent: true, opacity: 0, depthWrite: false, color: new THREE.Color(0.32, 0.36, 0.33) })
    this.ink = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), this.inkM)
    this.ink.rotation.x = -Math.PI / 2; this.ink.rotation.z = 0.04 - 0.12
    this.stampLocal = new THREE.Vector3(LABEL.x + (STAMP_UV[0] - 0.5) * 3.6, LABEL.y + 0.012, LABEL.z - (STAMP_UV[1] - 0.5) * 2.4)
    this.ink.position.copy(this.stampLocal); this.ink.renderOrder = 2
    this.box.add(this.ink)
    this.spark = glints(7, '#ffe2a0')
    { const rr = rng(5); this.sparkSeeds = Array.from({ length: 7 }, (_, k) => [(k / 7) * 6.283 + rr() * 0.5, 0.55 + rr() * 0.5, rr() * 0.4, 0.6 + rr() * 0.6]) }
    sc.add(this.spark)

    // The ribbon of text that wraps the box.
    const perim = 2 * (W + D)
    const rib = canvasTex(2048, 64, (g, w, h) => {
      g.fillStyle = '#ffb81f'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#0b1f15'; g.font = `700 30px ${SANS}`; g.textBaseline = 'middle'
      const s = 'GRADED BY HAND · NO CARBIDE · NO GAS · NO PESTICIDES · '
      let x = 10; while (x < w) { g.fillText(s, x, h / 2 + 1); x += g.measureText(s).width }
    }, { repeat: true })
    if (document.fonts) document.fonts.load('700 30px Figtree').then(() => { const g = rib.image.getContext('2d'); g.fillStyle = '#ffb81f'; g.fillRect(0, 0, 2048, 64); g.fillStyle = '#0b1f15'; g.font = `700 30px ${SANS}`; g.textBaseline = 'middle'; const s = 'GRADED BY HAND · NO CARBIDE · NO GAS · NO PESTICIDES · '; let x = 10; while (x < 2048) { g.fillText(s, x, 33); x += g.measureText(s).width } rib.needsUpdate = true }).catch(() => {})
    this.ribU = { map: { value: rib }, uReveal: { value: 0 }, uOff: { value: 0 }, uRep: { value: perim / 9 } }
    const rg = new THREE.BufferGeometry(), rv = [], ru = [], rn = [], ri = []
    const o = 0.06, cs = [[-W / 2 - o, D / 2 + o], [W / 2 + o, D / 2 + o], [W / 2 + o, -D / 2 - o], [-W / 2 - o, -D / 2 - o], [-W / 2 - o, D / 2 + o]]
    let acc = 0
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = cs[k], [x1, z1] = cs[k + 1], len = Math.hypot(x1 - x0, z1 - z0)
      const nx = (z1 - z0) / len * -1, nz = (x1 - x0) / len
      const b = rv.length / 3
      for (const [x, z, a] of [[x0, z0, acc], [x1, z1, acc + len]]) for (const y of [H * 0.38, H * 0.62]) { rv.push(x, y, z); ru.push(a / perim, y > H / 2 ? 1 : 0); rn.push(nx, 0, nz) }
      ri.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
      acc += len
    }
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2)); rg.setAttribute('normal', new THREE.Float32BufferAttribute(rn, 3)); rg.setIndex(ri)
    this.ribbon = new THREE.Mesh(rg, new THREE.ShaderMaterial({
      uniforms: this.ribU, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: /* glsl */ `uniform sampler2D map; uniform float uReveal, uOff, uRep; varying vec2 vUv; varying vec3 vN;
        void main(){
          if (vUv.x > uReveal) discard;
          vec3 c = pow(texture2D(map, vec2(vUv.x * uRep - uOff, vUv.y)).rgb, vec3(2.2));
          float sh = .55 + .45 * clamp(vN.z * .6 + vN.x * .3 + .5, 0., 1.);
          gl_FragColor = vec4(c * sh * .9, 1.);
        }`,
    }))
    this.box.add(this.ribbon)

    // Air: dust in the lamp and window light, a few straw wisps turning slowly as they drift down, soft bokeh behind.
    this.dust = motes(Math.round(220 * T.particles + 40), new THREE.Box3(new THREE.Vector3(-16, 0, -14), new THREE.Vector3(12, 16, 8)), { size: 0.05, color: '#ffe0a8', drift: 0.35, opacity: 0.8, seed: 9 })
    sc.add(this.dust)
    this.bok = bokeh(hi ? 18 : 10, new THREE.Box3(new THREE.Vector3(-14, 4, -16), new THREE.Vector3(22, 16, -12)), { size: 1.1, color: '#ffc070', opacity: 0.14, drift: 0.4, seed: 4 })
    sc.add(this.bok)
    {
      const n = hi ? 16 : 9
      const wg = new THREE.CylinderGeometry(0.02, 0.014, 1, 4, 1); wg.rotateZ(Math.PI / 2)
      this.wisps = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: '#f2d27a', roughness: 0.6, emissive: '#5a3a08', emissiveIntensity: 0.4 }), n)
      const rr = rng(12)
      this.wispSeeds = Array.from({ length: n }, () => [-9 + rr() * 16, 2 + rr() * 11, -7 + rr() * 11, rr() * 6.28, 0.6 + rr() * 0.9, 0.5 + rr()])
      this.wisps.frustumCulled = false
      sc.add(this.wisps)
    }
    this.q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.5, 0.15, 'YXZ'))
    this.q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0.2, 0, 'YXZ'))
    this.tv = new THREE.Vector3()
    this.rayFrom = WIN.clone()
    this.look.rays = 0.5; this.look.rayThreshold = 1.5; this.look.rayTint.setRGB(1, 0.86, 0.62)
  }

  drawLabel(g, w, h) {
    g.clearRect(0, 0, w, h)
    g.fillStyle = '#f6efdc'; g.fillRect(0, 0, w, h)
    g.strokeStyle = '#174631'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28)
    g.fillStyle = '#174631'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'
    g.font = `400 54px ${SERIF}`; g.fillText('VMR Mangoes', 48, 104)
    g.fillStyle = '#a4520f'; g.font = `700 24px ${SANS}`; g.fillText('GRADED BY HAND · SEMI-RIPE', 50, 148)
    g.strokeStyle = 'rgba(23,70,49,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(48, 182); g.lineTo(w - 48, 182); g.stroke()
    // The plucked day is left for the stamp (a faint dashed ring marks its place).
    g.strokeStyle = 'rgba(23,70,49,.28)'; g.lineWidth = 2; g.setLineDash([6, 7]); g.beginPath(); g.arc(w * STAMP_UV[0], h * (1 - STAMP_UV[1]), 76, 0, 7); g.stroke(); g.setLineDash([])
    g.fillStyle = '#0b1f15'; g.font = `700 26px ${SANS}`; g.fillText('READY TO EAT', 350, 236)
    g.font = `400 40px ${SERIF}`; g.fillText('1 to 4 days', 350, 290)
    g.fillText('on your counter', 350, 336)
    for (let k = 0; k < 26; k++) { g.fillStyle = '#0b1f15'; g.fillRect(w - 260 + k * 8, 380, k % 3 === 0 ? 4 : 2, 70) }
    g.fillStyle = '#ffb81f'; g.beginPath(); g.arc(w * 0.86, h * 0.22, 38, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#174631'; g.beginPath(); g.ellipse(w * 0.86 + 20, h * 0.22 - 34, 16, 7, -0.6, 0, Math.PI * 2); g.fill()
  }

  update(i, tt, time) {
    const t = clamp(tt, -0.16, 1)
    // Beats: assemble (−0.16…0.26), nest (0.2…0.36), lay the others (0.3…0.5), nest ours (0.4…0.64),
    // close the flaps (0.62…0.74), print the label (0.71…0.79), stamp the day (0.73…0.87, press at 0.81),
    // ribbon (0.74…0.9), push in.
    const glide = easeInOut(clamp((t + 0.16) / 0.3))
    const fold = (a, b) => easeInOut(clamp((t - a) / (b - a)))
    const ex = 1 - glide
    this.pieces.forEach((pc, k) => { pc.position.copy(pc.userData.home).addScaledVector(this.burst[k], ex); pc.rotation.y = ex * [0.25, -0.2, 0.3, -0.35, 0.2][k] })
    this.front.rotation.x = Math.PI / 2 * (1 - fold(0.0, 0.14))
    this.back.rotation.x = -Math.PI / 2 * (1 - fold(0.04, 0.18))
    this.right.rotation.z = -Math.PI / 2 * (1 - fold(0.08, 0.22))
    this.left.rotation.z = Math.PI / 2 * (1 - fold(0.12, 0.26))
    const cf = fold(0.62, 0.7), cb = fold(0.66, 0.74)
    this.flapF.rotation.x = -Math.PI / 2 * cf + (1 - cf) * 0.35
    this.flapB.rotation.x = Math.PI / 2 * cb - (1 - cb) * 0.35
    const gp = this.guides.geometry.attributes.position
    this.pieces.forEach((pc, k) => {
      const a = pc.userData.home, b = pc.position
      gp.setXYZ(k * 2, a.x, a.y + 0.05, a.z); gp.setXYZ(k * 2 + 1, b.x, b.y + 0.05, b.z)
    })
    gp.needsUpdate = true
    this.guides.computeLineDistances()
    this.guides.material.opacity = smooth(0.02, 0.25, ex)
    this.guides.visible = ex > 0.02

    const nest = easeOut(clamp((t - 0.2) / 0.16))
    this.nest.scale.set(1, Math.max(0.001, nest), 1)
    this.nest.visible = nest > 0.001
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    this.others.forEach((o, k) => {
      const kk = easeOut(clamp((t - 0.3 - k * 0.025) / 0.12))
      q.setFromEuler(e.set(Math.PI / 2, o.yaw, 0, 'YXZ'))
      const s = kk < 0.001 ? 0.0001 : 1
      M.compose(this.tv.set(o.x + (1 - kk) * 0.6, OURS.y + (1 - kk) * 2.8, o.z + (1 - kk) * 0.4), q, new THREE.Vector3(s, s, s))
      this.crowd.setMatrixAt(k, M)
    })
    this.crowd.instanceMatrix.needsUpdate = true
    // The fruit glows gold in its straw while the box is open.
    const open = smooth(0.28, 0.4, t) * (1 - smooth(0.64, 0.73, t))
    this.boxGlow.intensity = 9 * open

    // Ours: brought in from behind the box in a gloved hand that holds it from above (the back of the glove, the gold
    // cuff and the sleeve all read), lowered into its place and rolled onto its side; the fingers open and the hand leaves.
    const carry = easeInOut(clamp((t - 0.36) / 0.16)), roll = smoother(0.5, 0.58, t), away = easeInOut(clamp((t - 0.56) / 0.12))
    const held = new THREE.Vector3(lerp(7.5, OURS.x, carry), lerp(8.2, OURS.y + 0.55, carry), lerp(-2.2, OURS.z, carry))
    this.mango.position.copy(held).lerp(OURS, roll)
    this.mango.quaternion.slerpQuaternions(this.q0, this.q1, roll)
    this.mango.visible = t > 0.33
    const h = this.hand
    h.visible = t > 0.33 && t < 0.72
    h.quaternion.copy(this.handQ)
    const gripAt = this.mango.position.clone().add(this.tv.set(0.37, 0.98, -0.13))
    h.position.copy(gripAt).add(new THREE.Vector3(5.5, 3.5, 0.5).multiplyScalar(away)).add(new THREE.Vector3(0, 0.35 * smooth(0.56, 0.6, t), 0))
    h.pose(lerp(0.72, 0.18, smooth(0.55, 0.6, t)), lerp(0.18, 0.35, smooth(0.55, 0.6, t)), lerp(0.85, 0.3, smooth(0.55, 0.6, t)))
    this.armL.follow(h, new THREE.Vector3(12.5, 14.5, -5.5).add(new THREE.Vector3(2, 2, 0).multiplyScalar(away)))

    // Label: prints, then the date stamp: the right hand comes in, lifts the stamp off its pad, presses it onto the label
    // (ink appears, a spark of gold), lifts it away out of frame.
    this.labelU.uReveal.value = smoother(0.71, 0.79, t)
    this.label.visible = t > 0.7
    this.box.updateMatrixWorld(true)
    const target = this.box.localToWorld(this.stampLocal.clone())
    const restKnob = PAD.clone().add(new THREE.Vector3(0, 0.38 + this.stampFace, 0))
    const overLabel = target.clone().add(new THREE.Vector3(0, this.stampFace + 1.6, 0))
    const onLabel = target.clone().add(new THREE.Vector3(0, this.stampFace + 0.02, 0))
    const outOf = overLabel.clone().add(new THREE.Vector3(11, 3, -4))
    const reach = smoother(0.72, 0.765, t), lift = smoother(0.765, 0.795, t), down = smoother(0.795, 0.81, t), up = smoother(0.818, 0.835, t), leave = smoother(0.835, 0.875, t)
    const knob = restKnob.clone()
    if (lift > 0) { knob.lerpVectors(restKnob, overLabel, lift); knob.y += Math.sin(lift * Math.PI) * 1.6 }
    if (down > 0) knob.lerpVectors(overLabel, onLabel, down)
    if (up > 0) knob.lerpVectors(onLabel, overLabel, up)
    if (leave > 0) knob.lerpVectors(overLabel, outOf, leave)
    this.stamp.position.copy(knob)
    this.stamp.rotation.set(0, 0.3 * lift, (1 - down) * lift * 0.12 * (1 - up))
    const sh = this.stampHand
    sh.visible = reach > 0.001 && leave < 0.999
    sh.quaternion.copy(this.stampQ)
    const grip = knob.clone().sub(this.stampOff.clone().applyQuaternion(this.stampQ))
    const from = grip.clone().add(new THREE.Vector3(10, 2, -4))
    sh.position.copy(from).lerp(grip, reach)
    sh.pose(lerp(0.3, 0.78, smooth(0.74, 0.77, t)), 0.05, lerp(0.4, 0.95, smooth(0.74, 0.77, t)))
    this.armR.follow(sh, new THREE.Vector3(12.5, 11.5, -8.5), 4.6)
    // Ink and sparkle.
    const pressed = smooth(0.805, 0.812, t)
    this.inkM.opacity = 0.92 * pressed
    this.ink.visible = pressed > 0.001
    const sk = clamp((t - 0.806) / 0.06)
    const spos = this.spark.geometry.attributes.position, sK = this.spark.geometry.attributes.aK
    this.sparkSeeds.forEach(([a, rr, dy, sp], k) => {
      const rad = 0.7 + rr * (0.4 + 1.6 * easeOut(sk))
      spos.setXYZ(k, target.x + Math.cos(a) * rad, target.y + 0.15 + dy + sk * 0.8 * sp, target.z + Math.sin(a) * rad)
      sK.setX(k, sk > 0 && sk < 1 ? Math.pow(1 - sk, 1.4) * (0.75 + 0.25 * Math.sin(time * 9 + k * 2.1)) * sp : 0)
    })
    spos.needsUpdate = true; sK.needsUpdate = true
    this.spark.material.uniforms.uSize.value = 54 * this.engine.dpr * (this.engine.h / 900)

    // Ribbon.
    this.ribU.uReveal.value = smoother(0.74, 0.9, t) * 1.001
    this.ribU.uOff.value = time * 0.04
    this.ribbon.visible = t > 0.74

    // Camera: three-quarter view of the exploded box, slowly circling; down closer for the nesting; up over the lid;
    // then a push into the label's gold dot.
    const orbit = lerp(0.75, 0.25, smoother(-0.16, 0.7, t))
    const rad = lerp(25, 15, smoother(-0.1, 0.5, t))
    const ht = lerp(15, 17, smoother(0.2, 0.5, t)) + smooth(0.62, 0.8, t) * 3
    const camA = new THREE.Vector3(Math.sin(orbit) * rad, ht, Math.cos(orbit) * rad)
    const dot = this.box.localToWorld(this.dotLocal.clone())
    const push = smoother(0.86, 1.0, t)
    const camB = dot.clone().add(new THREE.Vector3(0.6, 3.4, 2.4))
    const cam = camA.lerp(camB, push)
    const tgt = new THREE.Vector3(0, lerp(1.4, 1.0, smooth(0.3, 0.6, t)), 0).lerp(this.box.localToWorld(LABEL.clone()), smooth(0.7, 0.86, t)).lerp(dot, push)
    aim(this.camera, cam, tgt, 0)
    this.post.focus = cam.distanceTo(tgt)
    this.post.range = lerp(6, 1.2, push)
    this.post.dof = lerp(7, 12, push)
    this.focus.copy(dot)

    // Air.
    const wsd = this.wispSeeds, wm = this.wisps
    wsd.forEach(([x, y, z, ph, sp, len], k) => {
      const fall = ((time * 0.12 * sp + ph) % 1)
      const yy = y + 4 - fall * 9
      M.compose(this.tv.set(x + Math.sin(time * 0.4 * sp + ph) * 1.2, yy, z + Math.cos(time * 0.3 * sp + ph) * 0.8), q.setFromEuler(e.set(time * 0.7 * sp + ph, time * 0.5 + ph * 2, Math.sin(time * 0.9 + ph))), new THREE.Vector3(len, 1, 1).multiplyScalar(Math.min(1, Math.sin(fall * Math.PI) * 3)))
      wm.setMatrixAt(k, M)
    })
    wm.instanceMatrix.needsUpdate = true
    this.beamMat.uniforms.uTime.value = time
    this.dust.userData.u.uTime.value = time
    this.bok.userData.u.uTime.value = time; this.bok.userData.u.uScale.value = this.engine.h * this.engine.dpr / 900

    this.look.bloom = 0.45; this.look.threshold = 0.95; this.look.exposure = 1.04; this.look.vig = 0.6
    const tall = this.camera.aspect < 1 // on a phone the type sits over the window: a glow, not a blaze
    this.winM.color.set('#fff2da').multiplyScalar(tall ? 0.3 : 3)
    this.look.rays = (tall ? 0.2 : 0.45) * (1 - push)
    this.grade([0.006, 0.008, 0.012], [1.04, 0.99, 0.92], 1.04)
  }

  afterCamera() {
    this.mango.tick(3, this.sunView, this.goldSun)
    this.crowd.material.userData.u.uSunView.value.copy(this.sunView)
    this.crowd.material.userData.u.uSunCol.value.copy(this.goldSun)
  }
}
