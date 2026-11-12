// Chapter 10 "At your door the day after you order." The last gold of an evening turning to blue hour in an Indian
// neighbourhood. Outside the warehouse (its loading bay open on a lit room of racks and gold boxes) our rider sets the
// gold box on the rack of his green scooter, straps it, takes the gold helmet off its hook and puts it on, swings onto
// the scooter, glances over his shoulder and pulls out. He rides down the sunlit street past the chai stall and the fruit
// cart (an auto-rickshaw passing behind him), a crane rises over terraces of water tanks, washing lines, cots and pots
// while kites and birds hang over the lanes and the lamps and windows come on, then comes down to a pale teal house
// under festoon lights. He parks, lifts the box off the rack, walks past the kolam and up the step under the mango-leaf
// toran, balances the box to ring the bell; the door opens to warm light; the customer takes the box with both hands,
// smiles and nods; he waves. We follow the box into the warm light.
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { Stage, aim, skyDome, motes } from './stage.js'
import { Person, UNIFORM, wordmarkTexture } from '../lib/character.js'
import { NOISE } from '../lib/glsl.js'
import { rng, clamp, lerp, smooth, smoother, easeInOut, canvasTex, SERIF, SANS } from '../lib/util.js'

const PITCH = 420, BLOCK = 300, SLAB = 1.6
const HOUSE = new THREE.Vector3(700, 0, 900) // the front door (on the block edge, facing -z)
const STEP_Y = 3.4, PORCH_Y = 5.2

// ---- small geometry helpers -------------------------------------------------------------------------------------
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))
/** Merge [geometry, matrix, colour?] parts into one geometry with position, normal, uv and colour. */
function bake(parts) {
  const gs = parts.map(([g, m, c]) => {
    const q = (g.index ? g.toNonIndexed() : g.clone())
    if (m) q.applyMatrix4(m)
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k)
    if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2))
    const col = new THREE.Color(c || '#ffffff'), n = q.attributes.position.count, a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b }
    q.setAttribute('color', new THREE.BufferAttribute(a, 3))
    return q
  })
  return mergeGeometries(gs)
}
function rbox(w, h, d, k = 0.6, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg)
  const p = g.attributes.position, v = new THREE.Vector3(), n = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    n.set(v.x / (w / 2), v.y / (h / 2), v.z / (d / 2))
    const s = n.clone().normalize().multiplyScalar(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)))
    n.lerp(s, k)
    p.setXYZ(i, n.x * w / 2, n.y * h / 2, n.z * d / 2)
  }
  g.computeVertexNormals()
  return g
}
const vc = (o) => { o.vertexColors = true; return o }

// ---- textures ----------------------------------------------------------------------------------------------------
let TX = null
function textures() {
  if (TX) return TX
  TX = {}
  TX.tread = canvasTex(64, 256, (g, W, H) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, W, H)
    for (let y = 0; y < H; y += 8) { g.fillStyle = '#1a1a1a'; g.save(); g.translate(W / 2, y); g.rotate(0.5); g.fillRect(-W, -1.5, W * 2, 3); g.restore() }
  }, { repeat: true, srgb: false })
  TX.tread.repeat.set(1, 6)
  TX.rail = canvasTex(256, 64, (g, W, H) => {
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 5, W, 5); g.fillRect(0, H * 0.5, W, 3)
    for (let x = 4; x < W; x += 16) g.fillRect(x, 0, 3, H)
    for (let x = 12; x < W; x += 32) { g.beginPath(); g.arc(x, H * 0.27, 6, 0, 6.3); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke() }
  }, { repeat: true })
  TX.gate = canvasTex(128, 128, (g, W, H) => {
    g.clearRect(0, 0, W, H); g.fillStyle = '#fff'
    g.fillRect(0, 0, W, 8); g.fillRect(0, H - 8, W, 8); g.fillRect(0, 0, 8, H); g.fillRect(W - 8, 0, 8, H); g.fillRect(0, H * 0.45, W, 6)
    for (let x = 14; x < W - 8; x += 12) g.fillRect(x, 0, 4, H)
    for (let x = 20; x < W; x += 24) { g.beginPath(); g.moveTo(x - 6, 8); g.lineTo(x, 0); g.lineTo(x + 6, 8); g.fill() }
  })
  TX.shutter = canvasTex(64, 256, (g, W, H) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, W, H)
    for (let y = 0; y < H; y += 6) { g.fillStyle = '#9a9a9a'; g.fillRect(0, y, W, 2); g.fillStyle = '#f2f2f2'; g.fillRect(0, y + 2, W, 1) }
    g.fillStyle = '#707070'; g.fillRect(W / 2 - 4, H - 14, 8, 6)
  }, { repeat: true })
  TX.awning = canvasTex(128, 32, (g, W, H) => {
    for (let x = 0; x < W; x += 16) { g.fillStyle = (x / 16) % 2 ? '#ffffff' : '#c9c2b0'; g.fillRect(x, 0, 16, H) }
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, H - 4, W, 4)
  }, { repeat: true })
  TX.wall = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
    const r = rng(41)
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,40,20'},${0.03 + r() * 0.05})`; g.beginPath(); g.arc(r() * W, r() * H, 1 + r() * 10, 0, 6.3); g.fill() }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,40,20,${0.03 + r() * 0.04})`; const x = r() * W; g.fillRect(x, r() * H * 0.5, 2 + r() * 4, 30 + r() * 120) }
  }, { repeat: true })
  TX.mat = canvasTex(128, 64, (g, W, H) => {
    g.fillStyle = '#6a3a1e'; g.fillRect(0, 0, W, H)
    for (let y = 4; y < H - 4; y += 3) { g.fillStyle = y % 6 ? '#8a5a2e' : '#5a2e16'; g.fillRect(6, y, W - 12, 2) }
    g.strokeStyle = '#2e5a2a'; g.lineWidth = 5; g.strokeRect(6, 6, W - 12, H - 12)
  })
  TX.panel = canvasTex(256, 512, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
    const r = rng(7)
    for (let i = 0; i < 400; i++) { g.strokeStyle = `rgba(80,60,30,${0.04 + r() * 0.05})`; g.beginPath(); const y = r() * H; g.moveTo(0, y); g.lineTo(W, y + (r() - 0.5) * 8); g.stroke() }
    const pan = (x, y, w, h) => { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 6, y + 6, w - 12, h - 12); g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x + 14, y + 14, w - 28, h - 28) }
    pan(24, 30, W - 48, 190); pan(24, 260, (W - 60) / 2, 220); pan(36 + (W - 60) / 2, 260, (W - 60) / 2, 220)
  })
  return TX
}

// ---- The scooter ----------------------------------------------------------------------------------------------------
// Local: forward +z, up +y; wheels at z -10 and +11 (radius 4.25). Groups: chassis (bobs), steer (turns about the
// raked steering axis, carries the front wheel), rear wheel, side stand.
function makeScooter() {
  const S = new THREE.Group()
  const chassis = new THREE.Group(); S.add(chassis)
  const T = textures()
  const mats = {
    paint: vc(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.32, side: THREE.DoubleSide })),
    metal: vc(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.18, metalness: 0.95 })),
    rubber: vc(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 })),
    tyre: new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.9, bumpMap: T.tread, bumpScale: 3 }),
  }
  const lensM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2c8').multiplyScalar(6) })
  const tailM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a20').multiplyScalar(3) })
  const amberM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffa020').multiplyScalar(1.6) })
  const G = UNIFORM.green, GOLD = '#f2b02a', CHROME = '#e4ddd0', BLACK = '#1a1816', LEATHER = '#3a2418'
  const P = { body: { paint: [], metal: [], rubber: [] }, steer: { paint: [], metal: [], rubber: [] } }
  const add = (grp, mat, g, m, c) => P[grp][mat].push([g, m, c])
  // Steering frame: pivot at the front axle, the axis raked back.
  const RAKE = -0.32, pivot = new THREE.Vector3(0, 4.25, 11)
  const toSteer = new THREE.Matrix4().compose(pivot, new THREE.Quaternion().setFromEuler(new THREE.Euler(RAKE, 0, 0)), new THREE.Vector3(1, 1, 1)).invert()
  const st = (m) => toSteer.clone().multiply(m)

  // Rear cowl: a rounded egg with a gold pinstripe and the wordmark on each side.
  const egg = new THREE.SphereGeometry(1, 40, 28)
  { const p = egg.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); if (y < -0.4) p.setY(i, -0.4 + (y + 0.4) * 0.5); p.setX(i, p.getX(i) * (1 - 0.12 * Math.max(0, -z))) } egg.computeVertexNormals() }
  add('body', 'paint', egg, M(0, 9.8, -8.2, 0, 0, 0, 4.4, 4.1, 7.3), G)
  add('body', 'paint', new THREE.TorusGeometry(1, 0.03, 6, 72), M(0, 10.6, -8.2, Math.PI / 2, 0, 0, 4.25, 7.15, 1), GOLD)
  // floor tunnel, footboard and its rubber mat
  add('body', 'paint', rbox(3.6, 3.2, 12, 0.5), M(0, 6.6, 0.4), G)
  add('body', 'paint', rbox(8.6, 0.8, 11.5, 0.4), M(0, 5.35, 1.6), G)
  for (let k = 0; k < 7; k++) add('body', 'rubber', new THREE.BoxGeometry(7.4, 0.22, 0.55), M(0, 5.82, -3.2 + k * 1.55), BLACK)
  add('body', 'metal', new THREE.BoxGeometry(8.8, 0.3, 0.3), M(0, 5.5, 7.4), GOLD)
  // leg shield (front apron) with a gold edge, horn grille and a gold leaf emblem
  add('body', 'paint', new THREE.CylinderGeometry(5.0, 4.4, 13.5, 36, 4, true, -Math.PI * 0.42, Math.PI * 0.84), M(0, 12.4, 4.6, -0.18), G)
  add('body', 'paint', new THREE.CylinderGeometry(4.6, 4.0, 13.2, 36, 1, true, -Math.PI * 0.42, Math.PI * 0.84), M(0, 12.4, 4.55, -0.18), '#0f2c1f')
  add('body', 'metal', new THREE.CylinderGeometry(5.06, 5.06, 0.35, 36, 1, true, -Math.PI * 0.42, Math.PI * 0.84), M(0, 19.1, 3.4, -0.18), GOLD)
  for (const s of [1, -1]) add('body', 'metal', new THREE.BoxGeometry(0.3, 13.4, 0.3), M(s * 4.7 * Math.sin(Math.PI * 0.42), 12.4, 4.6 + 4.7 * Math.cos(Math.PI * 0.42), -0.18), GOLD)
  add('body', 'metal', rbox(2.2, 2.8, 0.6, 0.5), M(0, 13.6, 9.55, -0.18), CHROME)
  for (let k = 0; k < 5; k++) add('body', 'rubber', new THREE.BoxGeometry(1.8, 0.14, 0.2), M(0, 12.6 + k * 0.5, 9.9, -0.18), BLACK)
  add('body', 'metal', new THREE.CylinderGeometry(0.75, 0.75, 0.25, 24), M(0, 16.6, 9.3, Math.PI / 2 - 0.18), GOLD)
  // seat: a shaped saddle with gold piping
  add('body', 'rubber', rbox(5.6, 1.4, 12.6, 0.6), M(0, 14.55, -6.4), LEATHER)
  add('body', 'rubber', rbox(5.2, 1.1, 12.0, 0.85), M(0, 15.3, -6.6, 0.03), LEATHER)
  add('body', 'metal', new THREE.TorusGeometry(1, 0.07, 6, 64), M(0, 14.95, -6.4, Math.PI / 2, 0, 0, 2.85, 6.35, 1), GOLD)
  // rack (chrome) behind the seat, a grab rail
  for (const s of [1, -1]) {
    add('body', 'metal', new THREE.CylinderGeometry(0.3, 0.3, 8.2, 10), M(s * 3.4, 16.1, -14.6, Math.PI / 2), CHROME)
    add('body', 'metal', new THREE.CylinderGeometry(0.28, 0.28, 5.2, 10), M(s * 3.2, 13.8, -11.4, 0.5), CHROME)
  }
  for (const z of [-10.6, -14.6, -18.6]) add('body', 'metal', new THREE.CylinderGeometry(0.28, 0.28, 7.1, 10), M(0, 16.1, z, 0, 0, Math.PI / 2), CHROME)
  // tail light, blank plate, rear indicators
  add('body', 'metal', rbox(3.4, 1.7, 0.8, 0.6), M(0, 12.8, -15.0), CHROME)
  add('body', 'rubber', rbox(4.6, 2.8, 0.2, 0.3), M(0, 9.2, -15.25), '#1e1a16')
  add('body', 'rubber', new THREE.BoxGeometry(4.2, 2.4, 0.12), M(0, 9.2, -15.36), '#efe6cf')
  // engine / swing arm, exhaust
  add('body', 'rubber', rbox(2.6, 3.0, 9.5, 0.4), M(-2.3, 5.6, -8.8), '#2a2a2c')
  add('body', 'metal', new THREE.CylinderGeometry(0.85, 0.7, 6.5, 16), M(2.7, 5.0, -11.2, Math.PI / 2 - 0.12), '#3a3632')
  add('body', 'metal', new THREE.CylinderGeometry(0.88, 0.88, 1.2, 16), M(2.7, 5.4, -14.4, Math.PI / 2 - 0.12), CHROME)
  // the helmet hook under the seat front
  add('body', 'metal', new THREE.TorusGeometry(0.6, 0.12, 6, 16, Math.PI), M(2.6, 13.2, -0.6, 0, Math.PI / 2, Math.PI), CHROME)

  // Steered parts: fork, mudguard, headset cowl, headlamp, handlebar, grips, levers, mirrors, speedo, indicators.
  for (const s of [1, -1]) add('steer', 'metal', new THREE.CylinderGeometry(0.42, 0.42, 10.5, 12), st(M(s * 1.7, 9.2, 9.4, RAKE)), CHROME)
  const guard = new THREE.CylinderGeometry(5.0, 5.0, 3.6, 28, 1, true, Math.PI * 0.05, Math.PI * 0.95)
  add('steer', 'paint', guard, st(M(0, 4.25, 11, 0.35, 0, Math.PI / 2, 1, 1, 1)), G)
  add('steer', 'metal', new THREE.TorusGeometry(5.0, 0.12, 6, 28, Math.PI * 0.95), st(M(1.85, 4.25, 11, 0, Math.PI / 2, 0.4)), GOLD)
  add('steer', 'paint', rbox(5.6, 3.4, 5.4, 0.7), st(M(0, 20.0, 6.4, -0.1)), G)
  add('steer', 'metal', new THREE.TorusGeometry(1.5, 0.28, 10, 32), st(M(0, 19.8, 9.05, 0)), CHROME)
  add('steer', 'rubber', new THREE.CylinderGeometry(1.45, 1.2, 1.0, 28), st(M(0, 19.8, 8.7, Math.PI / 2)), '#2a2622')
  add('steer', 'metal', new THREE.CylinderGeometry(0.42, 0.42, 13.4, 12), st(M(0, 21.2, 5.2, 0, 0, Math.PI / 2)), CHROME)
  for (const s of [1, -1]) {
    add('steer', 'rubber', new THREE.CapsuleGeometry(0.62, 2.4, 4, 12), st(M(s * 6.0, 21.2, 5.2, 0, 0, Math.PI / 2)), BLACK)
    for (let k = 0; k < 4; k++) add('steer', 'rubber', new THREE.TorusGeometry(0.64, 0.08, 4, 14), st(M(s * (5.0 + k * 0.6), 21.2, 5.2, 0, Math.PI / 2, 0)), '#2a2826')
    add('steer', 'metal', new THREE.SphereGeometry(0.5, 10, 8), st(M(s * 7.45, 21.2, 5.2)), CHROME)
    add('steer', 'metal', new THREE.CapsuleGeometry(0.14, 3.3, 3, 6), st(M(s * 5.4, 21.0, 6.6, 0, 0, Math.PI / 2 - s * 0.12)), CHROME)
    add('steer', 'metal', new THREE.CylinderGeometry(0.13, 0.13, 4.6, 6), st(M(s * 4.9, 23.3, 4.8, -0.12, 0, -s * 0.3)), CHROME)
    add('steer', 'rubber', new THREE.SphereGeometry(1, 16, 12), st(M(s * 5.6, 25.6, 4.5, 0, 0, 0, 1.45, 0.95, 0.35)), BLACK)
    add('steer', 'metal', new THREE.CircleGeometry(1.25, 20), st(M(s * 5.6, 25.6, 4.12, 0, Math.PI, 0, 1.1, 0.75, 1)), '#cfd8e0')
    add('steer', 'rubber', new THREE.SphereGeometry(0.42, 10, 8), st(M(s * 3.0, 19.9, 8.3)), '#ffffff')
  }
  add('steer', 'rubber', new THREE.CylinderGeometry(1.1, 1.1, 0.5, 20), st(M(0, 21.95, 4.5, -0.5)), '#1a1816')
  add('steer', 'rubber', new THREE.CircleGeometry(0.95, 20), st(M(0, 22.2, 4.62, -0.5 - Math.PI / 2, 0, 0)), '#efe6cf')

  const meshOf = (parts, mat) => { if (!parts.length) return null; const m = new THREE.Mesh(bake(parts), mat); m.castShadow = true; m.receiveShadow = true; return m }
  for (const k of ['paint', 'metal', 'rubber']) { const m = meshOf(P.body[k], mats[k]); if (m) chassis.add(m) }
  const steerTilt = new THREE.Group(); steerTilt.position.copy(pivot); steerTilt.rotation.x = RAKE; chassis.add(steerTilt)
  const steer = new THREE.Group(); steerTilt.add(steer)
  for (const k of ['paint', 'metal', 'rubber']) { const m = meshOf(P.steer[k], mats[k]); if (m) steer.add(m) }
  // the headlamp lens (glowing) and indicators
  const lens = new THREE.Mesh(new THREE.CircleGeometry(1.32, 28), lensM); lens.applyMatrix4(st(M(0, 19.8, 9.12))); steer.add(lens)
  const tail = new THREE.Mesh(rbox(2.8, 1.2, 0.4, 0.6), tailM); tail.position.set(0, 12.8, -15.35); chassis.add(tail)
  for (const s of [1, -1]) { const ind = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), amberM); ind.position.set(s * 2.6, 12.8, -15.1); chassis.add(ind) }
  // wordmark decals on the side panels (curved to the cowl)
  const markM = new THREE.MeshStandardMaterial({ map: wordmarkTexture(), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  for (const s of [1, -1]) {
    const g = new THREE.PlaneGeometry(6.4, 3.2, 16, 1), p = g.attributes.position
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); const zz = -8.2 + x * s; const ex = 4.4 * Math.sqrt(Math.max(0, 1 - ((zz + 8.2) / 7.3) ** 2 - ((p.getY(i) + 0.6) / 4.1) ** 2)) * (1 - 0.12 * Math.max(0, -(zz + 8.2) / 7.3)); p.setXYZ(i, s * (ex + 0.05), p.getY(i) + 11.0, zz) }
    g.computeVertexNormals()
    const d = new THREE.Mesh(g, markM); chassis.add(d)
  }
  // Wheels: a treaded tyre, a gold five-spoke rim, a chrome hub and a dark brake drum.
  const wheel = () => {
    const w = new THREE.Group()
    const ty = new THREE.Mesh(new THREE.TorusGeometry(3.2, 1.05, 16, 56), mats.tyre); ty.rotation.y = Math.PI / 2; w.add(ty)
    const parts = [
      [new THREE.TorusGeometry(2.3, 0.32, 8, 40), M(0, 0, 0, 0, Math.PI / 2, 0), GOLD],
      [new THREE.CylinderGeometry(0.95, 0.95, 1.9, 20), M(0, 0, 0, 0, 0, Math.PI / 2), CHROME],
      [new THREE.CylinderGeometry(1.7, 1.7, 1.2, 24), M(-0.3, 0, 0, 0, 0, Math.PI / 2), '#2e2a26'],
    ]
    for (let k = 0; k < 5; k++) parts.push([new THREE.BoxGeometry(0.6, 1.9, 0.45), M(0.15, 0, 0, (k / 5) * Math.PI * 2, 0, 0).multiply(M(0, 1.35, 0)), GOLD])
    const hub = new THREE.Mesh(bake(parts), mats.metal); w.add(hub)
    w.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    return w
  }
  const rear = wheel(); rear.position.set(0, 4.25, -10); S.add(rear)
  const front = wheel(); steer.add(front) // at the pivot (= the axle)
  // the side stand (his left, +x)
  const stand = new THREE.Group(); stand.position.set(2.7, 5.0, -2.6); chassis.add(stand)
  const rod = new THREE.Mesh(bake([[new THREE.CylinderGeometry(0.28, 0.22, 5.2, 8), M(0, -2.6, 0), '#2a2826'], [new THREE.BoxGeometry(0.9, 0.25, 1.2), M(0, -5.2, 0), '#2a2826']]), mats.metal)
  rod.castShadow = true; stand.add(rod)
  // Headlight: a soft cone and a spot.
  const cone = new THREE.Mesh(new THREE.ConeGeometry(16, 60, 32, 1, true), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uOp: { value: 1 } },
    vertexShader: 'varying float vY; varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vH = (modelMatrix * vec4(position, 1.)).y; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uOp; varying float vY; varying float vH; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(clamp(abs(dot(vN, vV)), 0., 1.), 2.); gl_FragColor = vec4(vec3(1., .86, .6) * pow(clamp(vY, 0., 1.), 2.5) * e * .2 * uOp * smoothstep(0.5, 6., vH), 1.); }',
  }))
  cone.rotation.x = -Math.PI / 2 - 0.12; cone.position.set(0, 17.5, 39); chassis.add(cone)
  const spot = new THREE.SpotLight('#ffe8b8', 900, 260, 0.45, 0.6, 1.4); spot.position.set(0, 19.8, 9.5); spot.target.position.set(0, 0, 80); chassis.add(spot, spot.target)
  Object.assign(S.userData, { chassis, steer, rear, front, stand, cone, spot, lens, tail, toSteer })
  return S
}

// ---- The gold box with the wordmark, a green strap with a gold buckle ---------------------------------------------
function makeBox() {
  const g = new THREE.Group()
  const gold = new THREE.MeshPhysicalMaterial({ color: UNIFORM.gold, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#fff2c0'), map: textures().wall })
  const W = 8.2, H = 6.2, D = 7.2
  const box = new THREE.Mesh(rbox(W, H, D, 0.12, 4), gold); box.castShadow = true; box.receiveShadow = true; g.add(box)
  const lidM = new THREE.MeshPhysicalMaterial({ color: '#f2ad1c', roughness: 0.5 })
  const lid = new THREE.Mesh(rbox(W + 0.35, 0.9, D + 0.35, 0.2, 3), lidM); lid.position.y = H / 2 - 0.3; lid.castShadow = true; g.add(lid)
  const mark = new THREE.MeshStandardMaterial({ map: wordmarkTexture({ w: 1024, h: 512, bg: UNIFORM.green }), roughness: 0.7 })
  for (const [x, z, ry] of [[0, D / 2 + 0.03, 0], [0, -D / 2 - 0.03, Math.PI], [W / 2 + 0.03, 0, Math.PI / 2], [-W / 2 - 0.03, 0, -Math.PI / 2]]) {
    const w = Math.abs(ry) === Math.PI / 2 ? D * 0.72 : W * 0.72
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.5), mark); p.position.set(x, -0.45, z); p.rotation.y = ry; g.add(p)
  }
  const strapM = new THREE.MeshStandardMaterial({ color: UNIFORM.green, roughness: 0.7 })
  const strap = new THREE.Group()
  strap.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, H + 1.6, D + 0.5), strapM))
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.25), new THREE.MeshStandardMaterial({ color: '#e8b040', metalness: 0.8, roughness: 0.3 })); buckle.position.set(0, -0.6, D / 2 + 0.28); strap.add(buckle)
  strap.position.y = -0.6; g.add(strap); g.userData.strap = strap
  g.userData.size = new THREE.Vector3(W, H, D)
  return g
}

// ---- The city ------------------------------------------------------------------------------------------------------
// Everything static is merged per material into tiles (one block wide near the route, two blocks further out) so the
// renderer can cull what a shot cannot see; fine detail (signs, shutters, slats, grilles, terrace tiles, windows) lives
// in canvas textures and in the façade shader, not in triangles.
const HASH = 'float bh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }'
const FLOOR = 52
// painted plaster in a harmonised mix: ochre, terracotta, pale teal, dusty pink, cream (bare brick is the exception, set per building)
const WALLS = ['#e8bb5e', '#e0a35e', '#d0835c', '#a9d0c4', '#94c2b8', '#e9b6ae', '#dfaab0', '#f2e6c8', '#eedbb2', '#f2d47c', '#c2d9b8', '#f0c9a0']
const CREAM = '#f3ead6', STONE = '#7e756a', TERRA = '#a4522a'
const SIGNS = [['Sweets', '#b8322a', '#ffe9b0'], ['Tailor', '#1f4f7a', '#ffffff'], ['Chai', '#1d5a3d', '#ffd36b'], ['Cycle Works', '#e3a21a', '#2a1a10'],
  ['Kirana', '#7a2f6a', '#fff1d0'], ['Medical', '#2b7a4a', '#ffffff'], ['Tiffin', '#d4572a', '#fff6e0'], ['Photo Studio', '#283a5a', '#ffcf5a']]
const CLOTH = ['#c0392b', '#f2e6cf', '#2a6fb0', '#e8b33a', '#8a3fa0', '#2e7d4f', '#f19c79', '#e05a8a', '#36a3a0', '#ffffff']

// atlas regions (1024²): uv rects [u0, v0, u1, v1]
const AT = 1024
const rct = (x, y, w, h) => [x / AT, 1 - (y + h) / AT, (x + w) / AT, 1 - y / AT]
const RA = {
  sign: (k) => rct((k % 2) * 512 + 4, Math.floor(k / 2) * 128 + 4, 504, 120),
  shutter: rct(0, 512, 256, 256), shop: rct(256, 512, 256, 256),
  ac: rct(514, 514, 124, 124), solar: rct(642, 514, 124, 124), wood: rct(770, 514, 124, 124), kolamSq: rct(898, 514, 124, 124),
  chai: rct(514, 642, 252, 124), white: rct(620, 820, 300, 150), wh: rct(0, 768, 512, 256),
}
// strip texture (repeats along u): rail, gate, four awnings
const SV = (y0, y1) => [1 - y1 / 512, 1 - y0 / 512]
const RS = { rail: SV(2, 126), gate: SV(130, 254), awn: (k) => SV(258 + k * 64, 318 + k * 64) }
const strip = (k, n) => [0, k[0], n, k[1]]

let CT = null
function cityTex() {
  if (CT) return CT
  CT = {}
  CT.atlas = canvasTex(AT, AT, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, AT, AT)
    const r = rng(19)
    // painted signboards
    SIGNS.forEach(([word, bg, ink], k) => {
      const x = (k % 2) * 512, y = Math.floor(k / 2) * 128
      g.fillStyle = bg; g.fillRect(x, y, 512, 128)
      g.strokeStyle = ink; g.lineWidth = 5; g.strokeRect(x + 10, y + 10, 492, 108)
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y + 112, 512, 16)
      g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.font = `${word.length > 8 ? 54 : 70}px ${SERIF}`; g.fillText(word, x + 256, y + 58)
      g.font = `600 17px ${SANS}`; g.fillText(['SINCE 1979', 'ALTERATIONS · STITCHING', 'TEA · SNACKS', 'REPAIRS · SPARES', 'DAILY NEEDS', '24 HOURS', 'HOME MEALS', 'PASSPORT PHOTOS'][k], x + 256, y + 102)
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,20,10'},${0.04 + r() * 0.08})`; g.fillRect(x + r() * 512, y + r() * 128, 2 + r() * 8, 1 + r() * 3) }
    })
    // rolling shutter
    { const x = 0, y = 512; g.fillStyle = '#d9dcdc'; g.fillRect(x, y, 256, 256)
      for (let s = 0; s < 256; s += 7) { g.fillStyle = '#8f9595'; g.fillRect(x, y + s, 256, 2); g.fillStyle = '#f4f6f4'; g.fillRect(x, y + s + 2, 256, 1) }
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(110,70,40,${0.05 + r() * 0.12})`; g.fillRect(x + r() * 256, y + 120 + r() * 136, 1 + r() * 3, 4 + r() * 30) }
      g.fillStyle = '#4a4a4a'; g.fillRect(x + 110, y + 236, 36, 10); g.fillRect(x + 20, y + 240, 14, 8); g.fillRect(x + 222, y + 240, 14, 8) }
    // a lit shop interior: shelves of goods, a counter, a tube light
    { const x = 256, y = 512, gr = g.createLinearGradient(0, y, 0, y + 256); gr.addColorStop(0, '#d8a868'); gr.addColorStop(1, '#7a4422'); g.fillStyle = gr; g.fillRect(x, y, 256, 256)
      g.fillStyle = '#fff6e0'; g.fillRect(x + 40, y + 8, 176, 7)
      for (let sh = 0; sh < 5; sh++) { const yy = y + 30 + sh * 36; g.fillStyle = '#3a2412'; g.fillRect(x + 8, yy + 28, 240, 4); for (let i = 0; i < 26; i++) { g.fillStyle = ['#a8504a', '#4a6a90', '#c8a050', '#4a7a5a', '#d8cbb0', '#7a5a88', '#b8683a'][Math.floor(r() * 7)]; const w = 4 + r() * 5, h = 10 + r() * 14; g.fillRect(x + 10 + i * 9.2, yy + 28 - h, w, h) } }
      g.fillStyle = '#6a3e22'; g.fillRect(x, y + 214, 256, 42); g.fillStyle = '#8a5a32'; g.fillRect(x, y + 210, 256, 6) }
    // air conditioner front, solar panel, wooden door, kolam square
    { const x = 512, y = 512; g.fillStyle = '#e6e4de'; g.fillRect(x, y, 128, 128); g.strokeStyle = '#7a7a76'; g.lineWidth = 3
      for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + 48, y + 64, 8 + k * 7, 0, 6.3); g.stroke() }
      for (let k = 0; k < 9; k++) g.fillRect(x + 92, y + 18 + k * 10, 26, 3); g.strokeRect(x + 4, y + 4, 120, 120) }
    { const x = 640, y = 512; g.fillStyle = '#cfd4d8'; g.fillRect(x, y, 128, 128); g.fillStyle = '#1b2f52'; g.fillRect(x + 5, y + 5, 118, 118); g.strokeStyle = '#6a86b0'; g.lineWidth = 1.5
      for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x + 5 + k * 19.7, y + 5); g.lineTo(x + 5 + k * 19.7, y + 123); g.stroke() } for (let k = 1; k < 10; k++) { g.beginPath(); g.moveTo(x + 5, y + 5 + k * 11.8); g.lineTo(x + 123, y + 5 + k * 11.8); g.stroke() } }
    { const x = 768, y = 512; g.fillStyle = '#7a4a28'; g.fillRect(x, y, 128, 128); for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#6a3e22' : '#86532e'; g.fillRect(x + k * 16, y, 15, 128) }
      g.strokeStyle = 'rgba(30,15,5,.6)'; g.lineWidth = 4; g.strokeRect(x + 14, y + 12, 100, 46); g.strokeRect(x + 14, y + 68, 100, 50); g.fillStyle = '#d8a640'; g.fillRect(x + 100, y + 62, 8, 8) }
    { const x = 896, y = 512; g.fillStyle = '#b44a2a'; g.fillRect(x, y, 128, 128); g.strokeStyle = '#ffffff'; g.lineWidth = 3
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(x + 16 + i * 32, y + 16 + j * 32, 12, 0, 6.3); g.stroke() } }
    // chai stall board
    { const x = 512, y = 640; g.fillStyle = '#1d4a32'; g.fillRect(x, y, 256, 128); g.strokeStyle = '#ffd36b'; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, 240, 112)
      g.fillStyle = '#ffd36b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `64px ${SERIF}`; g.fillText('Chai', x + 128, y + 54); g.font = `600 16px ${SANS}`; g.fillStyle = '#fff3d6'; g.fillText('TEA · SAMOSA · BUN', x + 128, y + 100) }
    // warehouse interior: racks of gold boxes, crates, tube lights, a back-wall glow
    { const x = 0, y = 768, gr = g.createLinearGradient(0, y, 0, y + 256); gr.addColorStop(0, '#fff0c8'); gr.addColorStop(0.55, '#f2b864'); gr.addColorStop(1, '#8a5a2a'); g.fillStyle = gr; g.fillRect(x, y, 512, 256)
      const rg = g.createRadialGradient(x + 256, y + 40, 10, x + 256, y + 40, 300); rg.addColorStop(0, 'rgba(255,255,240,.7)'); rg.addColorStop(1, 'rgba(255,255,240,0)'); g.fillStyle = rg; g.fillRect(x, y, 512, 256)
      for (const tx of [90, 256, 422]) { g.fillStyle = '#ffffff'; g.fillRect(x + tx - 40, y + 10, 80, 6) }
      for (const rx of [10, 330]) { g.fillStyle = '#4a3a2c'; for (let k = 0; k < 4; k++) g.fillRect(x + rx, y + 60 + k * 46, 172, 5); g.fillRect(x + rx, y + 50, 5, 200); g.fillRect(x + rx + 167, y + 50, 5, 200)
        for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) { g.fillStyle = r() < 0.75 ? '#e9a520' : '#b07a48'; g.fillRect(x + rx + 10 + i * 27, y + 60 + k * 46 - 26 - (r() < 0.3 ? 0 : 0), 24, 26); g.fillStyle = 'rgba(23,70,49,.8)'; g.fillRect(x + rx + 14 + i * 27, y + 60 + k * 46 - 18, 16, 6) } }
      for (let i = 0; i < 5; i++) { g.fillStyle = '#9a6a3a'; g.fillRect(x + 200 + i * 22, y + 200 - (i % 2) * 22, 20, 20) }
      g.fillStyle = 'rgba(60,40,20,.55)'; g.fillRect(x, y + 236, 512, 20) }
  }, { aniso: 8 })
  CT.strip = canvasTex(256, 512, (g) => {
    g.clearRect(0, 0, 256, 512); g.fillStyle = '#fff'
    // balcony railing: top and bottom rails, balusters, a band of rings
    g.fillRect(0, 0, 256, 10); g.fillRect(0, 118, 256, 8); g.fillRect(0, 70, 256, 4)
    for (let x = 6; x < 256; x += 16) g.fillRect(x, 0, 4, 126)
    g.lineWidth = 3; g.strokeStyle = '#fff'; for (let x = 14; x < 256; x += 32) { g.beginPath(); g.arc(x, 40, 11, 0, 6.3); g.stroke() }
    // gate: frame, bars with spear tips, a middle rail
    g.fillRect(0, 140, 256, 6); g.fillRect(0, 246, 256, 8); g.fillRect(0, 196, 256, 5)
    for (let x = 6; x < 256; x += 13) { g.fillRect(x, 140, 4, 114); g.beginPath(); g.moveTo(x - 3, 142); g.lineTo(x + 2, 130); g.lineTo(x + 7, 142); g.fill() }
    // awnings: stripes with a darker hem
    const aw = [['#b8322a', '#f3e6cc'], ['#1f6f5b', '#f3e6cc'], ['#2a5aa0', '#f6f2e8'], ['#e08a1a', '#f6d65a']]
    aw.forEach(([a, b], k) => { const y = 256 + k * 64; for (let x = 0; x < 256; x += 32) { g.fillStyle = a; g.fillRect(x, y, 16, 64); g.fillStyle = b; g.fillRect(x + 16, y, 16, 64) } g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, y + 54, 256, 10) })
  }, { repeat: true })
  CT.strip.wrapT = THREE.ClampToEdgeWrapping
  CT.kolam = canvasTex(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512)
    const c = 256
    // rice-flour dots and loops, a lotus in the middle, coloured petals
    g.strokeStyle = 'rgba(255,252,240,.95)'; g.lineWidth = 7; g.lineCap = 'round'
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.beginPath(); g.ellipse(c + Math.cos(a) * 120, c + Math.sin(a) * 120, 70, 34, a, 0, 6.3); g.stroke() }
    g.beginPath(); g.arc(c, c, 210, 0, 6.3); g.stroke(); g.beginPath(); g.arc(c, c, 238, 0, 6.3); g.lineWidth = 4; g.stroke()
    const petals = ['#e2483a', '#f2a91c', '#d23c8c', '#f2a91c']
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.fillStyle = petals[k % 4]; g.beginPath(); g.ellipse(c + Math.cos(a) * 178, c + Math.sin(a) * 178, 20, 10, a, 0, 6.3); g.fill() }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.39; g.fillStyle = k % 2 ? '#2e8a5a' : '#f2a91c'; g.beginPath(); g.ellipse(c + Math.cos(a) * 52, c + Math.sin(a) * 52, 34, 14, a, 0, 6.3); g.fill() }
    g.fillStyle = '#e2483a'; g.beginPath(); g.arc(c, c, 24, 0, 6.3); g.fill(); g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(c, c, 10, 0, 6.3); g.fill()
    g.fillStyle = 'rgba(255,252,240,.95)'; for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * 224, c + Math.sin(a) * 224, 5, 0, 6.3); g.fill() }
  })
  CT.kolamStrip = canvasTex(512, 64, (g) => {
    g.clearRect(0, 0, 512, 64); g.strokeStyle = 'rgba(255,252,240,.95)'; g.lineWidth = 4
    for (let x = 16; x < 512; x += 32) { g.beginPath(); g.ellipse(x, 32, 14, 22, 0, 0, 6.3); g.stroke(); g.fillStyle = ['#e2483a', '#f2a91c', '#d23c8c'][(x / 32) % 3 | 0]; g.beginPath(); g.arc(x, 32, 6, 0, 6.3); g.fill() }
    g.fillStyle = 'rgba(255,252,240,.95)'; g.fillRect(0, 2, 512, 3); g.fillRect(0, 59, 512, 3)
  })
  return CT
}

// ---- merging: parts [geometry, matrix, colour, uvRect] → one non-indexed geometry per material per tile -------------
const _prep = new WeakMap()
function prep(g) {
  let q = _prep.get(g); if (q) return q
  q = g.index ? g.toNonIndexed() : g
  if (!q.attributes.normal) q.computeVertexNormals()
  if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2))
  _prep.set(g, q); return q
}
class Batch {
  constructor() { this.L = new Map() }
  add(key, g, m, c, uvr) { const q = prep(g); let l = this.L.get(key); if (!l) this.L.set(key, (l = { parts: [], n: 0 })); l.parts.push([q, m, c, uvr]); l.n += q.attributes.position.count }
  static merge(l) {
    const n = l.n, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), C = new Float32Array(n * 3)
    const v = new THREE.Vector3(), nm = new THREE.Matrix3(), col = new THREE.Color()
    let o = 0
    for (const [q, m, c, r] of l.parts) {
      const p = q.attributes.position.array, nn = q.attributes.normal.array, uv = q.attributes.uv.array, k = q.attributes.position.count
      if (m) nm.getNormalMatrix(m)
      col.set(c ?? '#ffffff')
      for (let i = 0; i < k; i++) {
        const j = (o + i) * 3
        v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); if (m) v.applyMatrix4(m); P[j] = v.x; P[j + 1] = v.y; P[j + 2] = v.z
        v.set(nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]); if (m) v.applyMatrix3(nm).normalize(); N[j] = v.x; N[j + 1] = v.y; N[j + 2] = v.z
        let a = uv[i * 2], b = uv[i * 2 + 1]; if (r) { a = r[0] + a * (r[2] - r[0]); b = r[1] + b * (r[3] - r[1]) }
        UV[(o + i) * 2] = a; UV[(o + i) * 2 + 1] = b
        C[j] = col.r; C[j + 1] = col.g; C[j + 2] = col.b
      }
      o += k
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 3))
    g.computeBoundingSphere(); g.computeBoundingBox()
    return g
  }
}
// unit parts
const GU = {
  box: new THREE.BoxGeometry(1, 1, 1), plane: new THREE.PlaneGeometry(1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cylO: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), cone: new THREE.ConeGeometry(1, 1, 8), sph: new THREE.IcosahedronGeometry(1, 1), sph0: new THREE.IcosahedronGeometry(1, 0),
  ball: new THREE.SphereGeometry(1, 10, 7), tor: new THREE.TorusGeometry(1, 0.12, 4, 16),
}
// a lumpy leafy mass: an icosphere pushed in and out by a few waves
GU.bush = (() => { const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv')), p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + 0.16 * Math.sin(v.x * 7.1 + v.y * 3.3) * Math.sin(v.z * 6.3 - v.y * 4.1) + 0.1 * Math.sin(v.x * 13 + v.z * 11); v.multiplyScalar(n); if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.5; p.setXYZ(i, v.x, v.y, v.z) } g.computeVertexNormals(); return g })()
/** Matrix: position, yaw then pitch (local x tilt), scale. */
const MO = (x, y, z, ry = 0, rx = 0, sx = 1, sy = 1, sz = 1, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz))
const shade = (hex, k, add = 0) => { const c = new THREE.Color(hex); c.r = Math.min(1, c.r * k + add); c.g = Math.min(1, c.g * k + add); c.b = Math.min(1, c.b * k + add); return c }

// ---- materials ----
function cityMaterials(U) {
  const T = cityTex(), wall = textures().wall
  const mats = {
    shell: shellMaterial(U),
    plaster: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92, map: wall }),
    metal: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.42, metalness: 0.45 }),
    atlas: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.55, metalness: 0.1, map: T.atlas }),
    cut: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.45, metalness: 0.4, map: T.strip, alphaTest: 0.5, side: THREE.DoubleSide }),
    awn: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, map: T.strip, side: THREE.DoubleSide }),
    cloth: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    leaf: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.78 }),
    glow: new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, map: T.atlas }),
    vehicle: new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  }
  mats.thin = mats.metal // thin metal parts that should not throw long shadows
  for (const k in mats) mats[k].name = k
  // wind in the leaves and the washing (ambient)
  for (const k of ['leaf', 'cloth']) {
    const amp = k === 'leaf' ? 0.35 : 0.5
    mats[k].onBeforeCompile = (s) => {
      s.uniforms.uTime = U.uTime
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 w = position; float ph = w.x * .21 + w.z * .17 + w.y * .05; transformed += vec3(sin(uTime * 1.7 + ph), sin(uTime * 2.3 + ph * 1.3) * .4, cos(uTime * 1.3 + ph * .8)) * ${amp.toFixed(2)}; }`)
    }
    mats[k].customProgramCacheKey = () => 'mm-wind-' + k
  }
  return mats
}

/** Plastered buildings, all in one shader: weathered paint (fade, damp, a base of grime, rain streaks under the sills),
 *  a stone plinth, floor bands, recessed windows with frames, grilles, curtains and rooms behind (interior-mapped; lit
 *  one by one as the evening comes, a few with a flickering TV), shopfronts on the ground floor, and terraces on top
 *  (terracotta tiles, lime wash, chequer, red oxide) with dirt along the parapets. */
function shellMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.9 })
  m.onBeforeCompile = (s) => {
    s.uniforms.uLit = U.uLit; s.uniforms.uTime = U.uTime
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aC; attribute vec3 aS; attribute vec4 aK; varying vec3 vWP; varying vec3 vWN; varying vec3 vC; varying vec3 vS; varying vec4 vK;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal); vC = aC; vS = aS; vK = aK;')
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec3 vC; varying vec3 vS; varying vec4 vK; uniform float uLit, uTime;\n' + HASH + NOISE)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
      {
        vec3 N = normalize(vWN);
        vec3 tint = diffuseColor.rgb;
        float seed = fract(vK.x); bool brick = vK.x > 5.;
        if (N.y < .5) {
          bool xf = abs(N.x) > .5;
          float W = xf ? vS.z : vS.x;
          float u = xf ? vWP.z - (vC.z - vS.z * .5) : vWP.x - (vC.x - vS.x * .5);
          float hgt = vWP.y - (vC.y - vS.y * .5);
          float top = vS.y - hgt;
          float side = xf ? sign(N.x) : 2. + sign(N.z);
          bool shopF = !xf && abs(vK.y) > .5 && sign(N.z) == sign(vK.y);
          bool wins = !xf || mod(vK.z, 2.) > .5;
          float nb = max(1., floor(W / 26.)); float bw = W / nb; float FL = ${FLOOR}.;
          vec2 cell = vec2(floor(u / bw), floor(hgt / FL)); vec2 f = vec2(fract(u / bw), fract(hgt / FL));
          float h1 = bh(cell + seed * 17.3 + side * 5.1);
          vec2 fp = xf ? vWP.zy : vWP.xy;
          float n1 = mmNoise2(fp * .035 + seed * 13.), n2 = mmNoise2(fp * .11 + 3.1);
          float nfl = floor(vS.y / FL);
          if (brick) { vec2 bq = vec2(u / 6.5 + .5 * step(1., mod(floor(hgt / 2.6), 2.)), hgt / 2.6); vec2 bf = fract(bq); tint = mix(vec3(.62, .3, .2), vec3(.72, .38, .26), bh(floor(bq))) ; tint = mix(vec3(.78, .72, .64), tint, step(.07, bf.x) * step(.12, bf.y)); }
          else {
            if (nfl >= 4. && hgt > (nfl - 1.) * FL + 2.) tint = mix(tint, vec3(.96, .92, .84), .7);
            if (nfl >= 3. && abs(hgt - FL - 4.5) < 2.2) tint = mix(vec3(.12, .4, .38), vec3(.72, .24, .18), step(.5, seed));
          }
          vec3 wall = tint * (.86 + .2 * n1 + .06 * n2);
          wall *= 1. - .16 * smoothstep(.58, .78, mmNoise2(fp * .018 + 7. + seed * 5.));
          float grime = smoothstep(20., 0., hgt + 7. * n2);
          wall = mix(wall, wall * vec3(.5, .46, .42), grime * .75);
          wall *= 1. - .12 * smoothstep(6., 0., top);
          float band = step(10., hgt) * step(mod(hgt, FL), 2.2);
          wall = mix(wall, tint * 1.08 + .05, band * .85);
          if (hgt < 3.2) wall = vec3(.3, .28, .26) * (.8 + .3 * n1);
          vec3 col = wall;
          float x0 = .22, x1 = .78, y0 = .3, y1 = .74, fr = .045;
          bool ground = hgt < FL;
          if (wins && hgt > 3.2 && top > 6. && !(shopF && ground)) {
            float inX = step(x0, f.x) * step(f.x, x1);
            float inW = inX * step(y0, f.y) * step(f.y, y1);
            float inG = step(x0 + fr, f.x) * step(f.x, x1 - fr) * step(y0 + fr * 1.3, f.y) * step(f.y, y1 - fr * 1.3);
            // rain streaks below the sill, the shadow of the sunshade above
            float streak = inX * step(f.y, y0) * smoothstep(y0 - .3, y0, f.y) * step(.55, bh(vec2(floor(f.x * 17.), cell.x + cell.y * 9.)));
            col *= 1. - .22 * streak;
            col *= 1. - .35 * inX * step(y1, f.y) * smoothstep(y1 + .12, y1, f.y);
            if (inW > .5) {
              vec3 frameC = h1 > .62 ? vec3(.86, .83, .76) : h1 > .34 ? vec3(.08, .27, .2) : h1 > .12 ? vec3(.38, .2, .1) : vec3(.2, .3, .45);
              col = frameC * .85;
              // reveal: the window sits in a recess, shaded on top and one side
              float rv = smoothstep(y1 - fr * 1.3, y1, f.y) + smoothstep(x0 + fr, x0, f.x) * .6;
              if (inG > .5) {
                vec2 q = vec2((f.x - .5) / (x1 - x0 - 2. * fr) * 2., (f.y - (y0 + y1) * .5) / (y1 - y0 - 2.6 * fr) * 2.);
                vec3 V = normalize(vWP - cameraPosition);
                vec3 T = xf ? vec3(0., 0., 1.) : vec3(1., 0., 0.);
                float vn = max(.18, -dot(V, N));
                vec2 off = vec2(dot(V, T), V.y) / vn * .8;
                vec2 bq = q + off;
                float h2 = bh(cell * 1.7 + seed * 3.1 + side);
                float lit = step(h2, uLit + (vK.z > 1.5 ? .5 : 0.));
                vec3 room = mix(vec3(.06, .05, .045), vec3(.2, .15, .11), h1);
                float inside = step(abs(bq.x), 1.) * step(abs(bq.y), 1.);
                vec3 ic = mix(room * (.45 + .3 * clamp(1.6 - max(abs(bq.x), abs(bq.y)), 0., 1.)), room * 1.3, inside);
                float h3 = bh(cell + seed + 9.);
                vec3 curt = h3 < .3 ? vec3(.62, .18, .15) : h3 < .55 ? vec3(.14, .4, .42) : h3 < .8 ? vec3(.9, .74, .48) : vec3(.66, .48, .72);
                float sway = .04 * sin(uTime * .9 + h3 * 30.) * step(.7, h2);
                float cv = h3 > .15 ? step(h3 > .5 ? -.15 + sway : .25 + sway, h3 > .5 ? q.x : -q.x) : 0.;
                ic = mix(ic, curt * (.55 + .25 * sin(q.x * 26.)), cv * .92);
                vec3 warm = mix(vec3(1., .56, .24), vec3(1., .76, .46), h1);
                float tv = step(.84, bh(cell * 2.3 + seed));
                vec3 tvc = vec3(.45, .6, 1.) * (.55 + .45 * sin(uTime * 13. + h2 * 40.) * sin(uTime * 4.7 + h1 * 20.));
                vec3 lc = mix(warm, tvc, tv * (1. - cv));
                totalEmissiveRadiance += lc * lit * (cv > .5 ? .6 * curt + .25 : vec3(1.)) * (.7 + .3 * inside) * 1.7;
                vec3 sky = mix(vec3(.24, .3, .48), vec3(1., .66, .42), clamp(-V.y * 2. + .45, 0., 1.));
                float fres = pow(1. - vn, 3.);
                col = mix(ic, sky, .2 + .55 * fres) * (1. - lit * .25);
                float mul = step(abs(f.x - .5), .007) + step(abs(f.y - .62), .007);
                col = mix(col, frameC * .8, clamp(mul, 0., 1.));
                // grilles: bars on every ground floor, a grid or bars on some upper ones
                float gk = ground ? 1. : step(h1, .6);
                float bars = step(.8, fract(q.x * 3.5 + .5));
                float grid = max(bars, step(.86, fract(q.y * 2.5 + .5)));
                float gpat = ground || h1 < .3 ? bars : grid;
                col = mix(col, vec3(.05, .05, .05), gk * gpat * .85);
                roughnessFactor = .14;
              } else col *= 1. - .35 * rv;
            }
          }
          if (shopF && ground) {
            float us = u / W, inS = step(.07, us) * step(us, .93);
            if (hgt > 3.2 && hgt < 33. && inS > .5) col = vec3(.48, .5, .5) * (.7 + .3 * step(.4, fract(hgt * .45))) * (.85 + .15 * n2);
            else if (hgt >= 34. && hgt < 45. && inS > .5) col = mix(vec3(.72, .2, .16), vec3(.12, .32, .5), step(.5, fract(seed * 7.))) * (.9 + .1 * n1);
          }
          diffuseColor.rgb = col;
        } else {
          // the terrace floor
          vec2 p = vWP.xz - vC.xz, hs = vS.xz * .5;
          float k = vK.w;
          vec3 c;
          if (k < .5) { vec2 t = fract(vWP.xz / 7.); c = mix(vec3(.62, .3, .18), vec3(.72, .38, .22), bh(floor(vWP.xz / 7.))) * mix(.62, 1., step(.07, t.x) * step(.07, t.y)); }
          else if (k < 1.5) { c = vec3(.84, .82, .78) * (.9 + .1 * mmNoise2(vWP.xz * .2)); c *= 1. - .25 * smoothstep(.04, .0, abs(mmNoise2(vWP.xz * .05) - .5)); }
          else if (k < 2.5) { vec2 t = floor(vWP.xz / 1.3); float h = bh(t); c = vec3(.66, .64, .6) * (.9 + .1 * h); c = mix(c, vec3(.9, .88, .84), step(.82, h)); c = mix(c, vec3(.55, .3, .22), step(.95, h)); c = mix(c, vec3(.3, .45, .5), step(.975, h)); }
          else { vec2 t = fract(vWP.xz / 11.); c = vec3(.55, .2, .14) * (.85 + .15 * bh(floor(vWP.xz / 11.))) * mix(.7, 1., step(.03, t.x) * step(.03, t.y)); }
          float edge = min(hs.x - abs(p.x), hs.y - abs(p.y));
          c *= .62 + .38 * smoothstep(0., 9., edge);
          c *= 1. - .22 * smoothstep(.6, .8, mmNoise2(vWP.xz * .03 + seed * 9.));
          diffuseColor.rgb = c * (.85 + .3 * diffuseColor.r * 0.);
          roughnessFactor = .9;
        }
      }`)
  }
  m.customProgramCacheKey = () => 'mm-shell2'
  return m
}

/** Shells: one box per building (no bottom), each vertex carrying the box's centre, size and keys for the shader. */
function shellGeometry(list) {
  const n = list.length * 30
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), AC = new Float32Array(n * 3), AS = new Float32Array(n * 3), AK = new Float32Array(n * 4), UV = new Float32Array(n * 2)
  const col = new THREE.Color()
  let o = 0
  const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]]]
  for (const b of list) {
    const { x, y, z, w, h, d } = b, hs = [w / 2, h / 2, d / 2]
    col.set(b.tint)
    for (const [nn, uu, vv] of faces) {
      const c0 = [x + nn[0] * hs[0], y + nn[1] * hs[1], z + nn[2] * hs[2]]
      const corner = (a, bb) => [c0[0] + uu[0] * a * hs[0] + vv[0] * bb * hs[0], c0[1] + uu[1] * a * hs[1] + vv[1] * bb * hs[1], c0[2] + uu[2] * a * hs[2] + vv[2] * bb * hs[2]]
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)]
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
      for (let i = 0; i < 6; i++) {
        const j = o * 3
        P[j] = q[i][0]; P[j + 1] = q[i][1]; P[j + 2] = q[i][2]
        N[j] = nn[0]; N[j + 1] = nn[1]; N[j + 2] = nn[2]
        C[j] = col.r; C[j + 1] = col.g; C[j + 2] = col.b
        AC[j] = x; AC[j + 1] = y; AC[j + 2] = z; AS[j] = w; AS[j + 1] = h; AS[j + 2] = d
        AK[o * 4] = b.k[0]; AK[o * 4 + 1] = b.k[1]; AK[o * 4 + 2] = b.k[2]; AK[o * 4 + 3] = b.k[3]
        UV[o * 2] = uvs[i][0] * (nn[1] ? w : (nn[0] ? d : w)) / 60; UV[o * 2 + 1] = uvs[i][1] * (nn[1] ? d : h) / 60
        o++
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setAttribute('aC', new THREE.BufferAttribute(AC, 3)); g.setAttribute('aS', new THREE.BufferAttribute(AS, 3)); g.setAttribute('aK', new THREE.BufferAttribute(AK, 4))
  g.computeBoundingSphere()
  return g
}

/** Roads: asphalt with wear and patches, worn centre dashes, edge lines and zebras, manhole covers, a wet sheen with
 *  puddles that mirror the street lamps, and warm pools of light under them. */
function groundMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
  m.onBeforeCompile = (s) => {
    s.uniforms.uLamp = U.uLamp
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz;')
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform float uLamp;\n' + NOISE + LAMP_GLSL)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
      {
        vec2 p = vWP.xz; float P = ${PITCH}.;
        vec2 c = p - P * floor(p / P + .5); vec2 a = abs(c);
        float n = mmNoise2(p * .08) * .6 + mmNoise2(p * .6) * .4;
        vec3 asph = vec3(.13, .13, .14) * (.75 + .4 * n);
        float onV = step(a.x, 45.), onH = step(a.y, 45.);
        asph *= 1. - .16 * (onV * exp(-pow(a.x - 20., 2.) / 40.) + onH * exp(-pow(a.y - 20., 2.) / 40.));
        asph = mix(asph, vec3(.2, .19, .18), smoothstep(.62, .7, mmNoise2(p * .03 + 4.)) * .6);
        float j = onV * onH;
        float dash = (1. - j) * (onV * step(a.x, .9) * step(fract(p.y / 36.), .5) + onH * step(a.y, .9) * step(fract(p.x / 36.), .5));
        float edge = onV * (1. - onH) * step(abs(a.x - 39.), .55) + onH * (1. - onV) * step(abs(a.y - 39.), .55);
        float zeb = onV * step(46., a.y) * step(a.y, 64.) * step(a.x, 36.) * step(.5, fract(c.x / 6.)) + onH * step(46., a.x) * step(a.x, 64.) * step(a.y, 36.) * step(.5, fract(c.y / 6.));
        float wear = smoothstep(.25, .65, mmNoise2(p * .4)) * (.6 + .4 * smoothstep(.3, .7, mmNoise2(p * .05 + 9.)));
        float mark = clamp(dash + edge + zeb, 0., 1.) * wear;
        vec3 col = mix(asph, vec3(.84, .82, .76), mark);
        // manhole covers in the lanes
        vec2 mh = vec2(onV > .5 ? 20. * sign(c.x) : 0., onH > .5 ? 20. * sign(c.y) : 0.);
        float along = onV > .5 ? p.y : p.x;
        float cellA = floor(along / 110.);
        vec2 mc = onV > .5 ? vec2(P * floor(p.x / P + .5) + (bh(vec2(cellA, 3.)) < .5 ? -14. : 14.), (cellA + .5) * 110.) : vec2((cellA + .5) * 110., P * floor(p.y / P + .5) + (bh(vec2(cellA, 7.)) < .5 ? -14. : 14.));
        float md = length(p - mc);
        float hasM = step(bh(vec2(cellA, onV)), .55) * (1. - j);
        float man = hasM * step(md, 4.6);
        col = mix(col, vec3(.1, .095, .09) * (.8 + .4 * step(.5, fract(md * 1.4))), man);
        col = mix(col, vec3(.2, .19, .17), hasM * step(4.6, md) * step(md, 5.2));
        // wet: puddles are dark and glossy and mirror the lamps
        float wet = smoothstep(.5, .66, mmNoise2(p * .012 + 2.) * .7 + mmNoise2(p * .07) * .3) * (1. - man);
        col *= 1. - .35 * wet;
        roughnessFactor = mix(.9, .08, wet);
        diffuseColor.rgb = col;
        totalEmissiveRadiance += vec3(1., .6, .28) * lampPool(p) * uLamp * (1. + wet);
        totalEmissiveRadiance += vec3(1., .66, .34) * lampGlint(p, cameraPosition) * uLamp * (.25 + 1.6 * wet) * (1. - .85 * smoothstep(70., 260., cameraPosition.y));
      }`)
  }
  m.customProgramCacheKey = () => 'mm-road2'
  return m
}
const LAMP_GLSL = /* glsl */ `
  ${HASH}
  vec2 lampAt1(vec2 p){ float P = ${PITCH}.; return vec2(P * floor(p.x / P + .5) + 34., 140. * floor((p.y - 70.) / 140. + .5) + 70.); }
  vec2 lampAt2(vec2 p){ float P = ${PITCH}.; return vec2(140. * floor((p.x - 20.) / 140. + .5) + 20., P * floor(p.y / P + .5) + 34.); }
  float lampOk(vec2 l, float ax){ float P = ${PITCH}.; float v = ax < .5 ? l.y : l.x; return step(60., abs(v - P * floor(v / P + .5))) * step(-1300., l.x) * step(l.x, 2000.) * step(-1200., l.y) * step(l.y, 2200.); }
  float lampPool(vec2 p){
    vec2 l1 = lampAt1(p), l2 = lampAt2(p);
    float d1 = length(p - l1), d2 = length(p - l2);
    return exp(-d1 * d1 / 900.) * lampOk(l1, 0.) + exp(-d2 * d2 / 900.) * lampOk(l2, 1.);
  }
  // the reflection of the nearest lamp head (h 58) in a wet road: a streak stretched towards the camera
  float lampGlint(vec2 p, vec3 cam){
    float h = 58., k = (cam.y + h) / max(cam.y, 1.);
    vec2 foot = cam.xz + (p - cam.xz) * k;
    float g = 0.;
    for (int f = 0; f < 2; f++) {
      vec2 l = f == 0 ? lampAt1(foot) : lampAt2(foot);
      float ok = lampOk(l, float(f));
      vec2 G = cam.xz + (l - cam.xz) / k;
      vec2 dir = normalize(G - cam.xz + 1e-4); vec2 nrm = vec2(-dir.y, dir.x);
      vec2 dd = p - G; float al = dot(dd, dir), pe = dot(dd, nrm);
      float dist = length(G - cam.xz);
      g += ok * exp(-pe * pe / (1.5 + dist * .004)) * exp(-al * al / (60. + dist * 1.2));
    }
    return g;
  }`
/** Footpaths: interlocking pavers on top, worn kerb stones on the sides with faded black-and-white paint. */
function slabMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
  m.onBeforeCompile = (s) => {
    s.uniforms.uLamp = U.uLamp
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);')
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uLamp;\n' + NOISE + LAMP_GLSL)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
      {
        if (vWN.y > .5) {
          vec2 q = vWP.xz / vec2(6., 3.); q.x += step(1., mod(floor(q.y), 2.)) * .5;
          vec2 t = floor(q), ft = fract(q);
          float grout = step(.07, ft.x) * step(.1, ft.y);
          vec3 tile = mix(vec3(.5, .45, .42), vec3(.62, .54, .46), bh(t)) * (.85 + .15 * bh(t + 3.));
          tile = mix(tile, tile * vec3(.75, .8, .82), step(.86, bh(t + 7.)));
          vec2 c = vWP.xz - ${PITCH}. * floor(vWP.xz / ${PITCH}. + .5); vec2 a = abs(c);
          float kerb = step(min(a.x, a.y), 47.);
          vec3 col = mix(tile * mix(.62, 1., grout), vec3(.62, .6, .56) * (.85 + .2 * mmNoise2(vWP.xz * .3)), kerb);
          col *= .85 + .15 * mmNoise2(vWP.xz * .05);
          diffuseColor.rgb = col;
          totalEmissiveRadiance += vec3(1., .6, .28) * lampPool(vWP.xz) * uLamp * .8;
        } else {
          float st = step(.5, fract((vWP.x + vWP.z) / 12.));
          float worn = smoothstep(.3, .7, mmNoise2(vWP.xz * .2 + vWP.y));
          diffuseColor.rgb = mix(vec3(.5, .48, .45), mix(vec3(.08, .08, .08), vec3(.82, .8, .74), st), .75 * worn);
        }
      }`)
  }
  m.customProgramCacheKey = () => 'mm-slab2'
  return m
}

// ---- reusable prop part lists (local coordinates) ----
function potParts(kind, s = 1, lush = false) {
  const LB = lush ? GU.bush : GU.sph
  const pot = kind === 2 ? '#e8e0d0' : TERRA
  const P = [[GU.cylO, MO(0, 2.2 * s, 0, 0, 0, 2.3 * s, 4.4 * s, 2.3 * s), pot], [GU.cyl, MO(0, 4.3 * s, 0, 0, 0, 2.5 * s, 0.5 * s, 2.5 * s), shade(pot, 0.85)]]
  if (kind === 1) { P.push([LB, MO(0, 5.8 * s, 0, 0, 0, 2.8 * s, 2.2 * s, 2.8 * s), '#3d6a2c']); for (let k = 0; k < 6; k++) P.push([GU.sph0, MO(Math.cos(k) * 1.8 * s, 7.4 * s + (k % 2) * 0.6 * s, Math.sin(k) * 1.8 * s, 0, 0, 0.8 * s, 0.8 * s, 0.8 * s), k % 2 ? '#f29a1a' : '#f2c21a']) }
  else P.push([LB, MO(0, 6.4 * s, 0, s * 3, 0, 3 * s, 3 * s, 3 * s), kind === 2 ? '#3a7a3a' : '#467a32'])
  return P
}
function bikeParts(col) {
  return [
    ['vehicle', GU.ball, MO(0, 8.2, -6, 0, 0, 3.4, 3.2, 5.4), col], ['vehicle', GU.box, MO(0, 4.6, 1.5, 0, 0, 6.4, 0.6, 9), col], ['vehicle', GU.box, MO(0, 10.5, 5.8, 0, -0.2, 6.6, 11, 1.2), col],
    ['vehicle', GU.box, MO(0, 12, -5.5, 0, 0, 4.4, 1.4, 10), '#2a1d14'], ['metal', GU.cyl6, MO(0, 17.5, 4.6, 0, 0, 0.35, 11, 0.35, Math.PI / 2), '#cfc8bc'],
    ['metal', GU.tor, MO(0, 3.5, -8.5, Math.PI / 2, 0, 2.6, 2.6, 6), '#181818'], ['metal', GU.tor, MO(0, 3.5, 9, Math.PI / 2, 0, 2.6, 2.6, 6), '#181818'],
    ['vehicle', GU.box, MO(0, 16.5, 6, 0, 0, 4.4, 2.6, 4), col], ['glow', GU.plane, MO(0, 16.5, 8.05, 0, 0, 1.8, 1.4, 1), '#fff0c8'],
  ]
}
function cycleParts(col) {
  const P = [['thin', GU.tor, MO(0, 5.5, -8, Math.PI / 2, 0, 5.4, 5.4, 3), '#1a1a1a'], ['thin', GU.tor, MO(0, 5.5, 8, Math.PI / 2, 0, 5.4, 5.4, 3), '#1a1a1a']]
  for (const [a, b] of [[[0, 5.5, -8], [0, 14, 0]], [[0, 14, 0], [0, 15, 6]], [[0, 15, 6], [0, 5.5, 8]], [[0, 5.5, -8], [0, 6, 0]], [[0, 6, 0], [0, 14, 0]], [[0, 6, 0], [0, 15, 6]], [[0, 14, 0], [0, 17, -1.5]], [[0, 15, 6], [0, 19, 5.5]]]) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), mid = A.clone().add(Bv).multiplyScalar(0.5), L = A.distanceTo(Bv)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize())
    P.push(['thin', GU.cyl6, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(0.35, L, 0.35)), col])
  }
  P.push(['metal', GU.box, MO(0, 17.4, -1.5, 0, 0, 2.2, 0.8, 4), '#2a1d14'], ['metal', GU.cyl6, MO(0, 19, 5.5, 0, 0, 0.3, 9, 0.3, Math.PI / 2), '#9a9a9a'])
  return P
}
GU.rbox = rbox(1, 1, 1, 0.55, 3)
GU.wheel = new THREE.CylinderGeometry(1, 1, 1, 14)
const wheelParts = (x, y, z, r, w) => [['vehicle', GU.wheel, MO(x, y, z, 0, 0, r, w, r, Math.PI / 2), '#151515'], ['metal', GU.cyl, MO(x + Math.sign(x) * 0.15, y, z, 0, 0, r * 0.55, w + 0.1, r * 0.55, Math.PI / 2), '#b8b4ac']]
/** An auto-rickshaw: a rounded green body, a yellow canvas hood, a windscreen, three wheels, a headlamp. */
function autoParts() {
  const G = '#2f7a3a', Y = '#f0c020', K = '#1a1a1a'
  return [
    ['vehicle', GU.rbox, MO(0, 8.5, -4, 0, 0, 15, 8, 17), G], ['vehicle', GU.rbox, MO(0, 9.5, 7.6, 0, -0.28, 10, 12, 6), G], ['vehicle', GU.rbox, MO(0, 4.6, 10.5, 0, 0, 4, 5, 4), K],
    ['vehicle', GU.rbox, MO(0, 25.2, -1.5, 0, 0, 16.4, 2.4, 26), Y], ['vehicle', GU.rbox, MO(0, 18.5, -12.4, 0, 0, 16, 13, 1.6), Y], ['vehicle', GU.rbox, MO(-7.7, 20, -7, 0, 0, 1.2, 11, 10), Y], ['vehicle', GU.rbox, MO(7.7, 20, -7, 0, 0, 1.2, 11, 10), Y],
    ['vehicle', GU.box, MO(0, 19.5, 9.6, 0, -0.28, 10, 9, 0.5), '#3a4a58'], ['metal', GU.cyl6, MO(0, 21.6, 6.4, 0, 0, 0.35, 13, 0.35, Math.PI / 2), '#2a2a2a'],
    ['vehicle', GU.rbox, MO(0, 13.6, -6, 0, 0, 13, 2.4, 7), '#6a2a1a'], ['vehicle', GU.rbox, MO(0, 18.5, -9.6, 0, 0, 13, 7.5, 2), '#6a2a1a'],
    ...wheelParts(-7.6, 3.4, -9, 3.3, 2.2), ...wheelParts(7.6, 3.4, -9, 3.3, 2.2), ...wheelParts(0.01, 3.4, 11.5, 3.3, 2.2),
    ['glow', GU.ball, MO(0, 14.2, 11.2, 0, 0, 1.5, 1.5, 0.7), '#fff2c8'], ['glow', GU.ball, MO(-6.5, 9, -12.6, 0, 0, 0.8, 0.6, 0.4), '#ff3a20'], ['glow', GU.ball, MO(6.5, 9, -12.6, 0, 0, 0.8, 0.6, 0.4), '#ff3a20'],
  ]
}
/** A small hatchback: a rounded body, a glasshouse with dark windows, pillars, four wheels with hubs, lamps. */
function carParts(col) {
  return [
    ['vehicle', GU.rbox, MO(0, 6.6, 0, 0, 0, 16, 7, 36), col], ['vehicle', GU.rbox, MO(0, 12.4, -2, 0, 0, 14.4, 6.6, 20), col],
    ['vehicle', GU.box, MO(0, 12.6, -2, 0, 0, 14.6, 4.2, 17), '#2a3440'], ['vehicle', GU.box, MO(0, 12.4, 8.4, 0, -0.5, 13, 4.6, 0.4), '#2a3440'], ['vehicle', GU.box, MO(0, 12.4, -12.2, 0, 0.45, 13, 4.2, 0.4), '#2a3440'],
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].flatMap(([sx, sz]) => wheelParts(sx * 7.6, 3.3, sz * 11.5, 3.3, 2.4)),
    ['glow', GU.ball, MO(5.2, 7.6, 18, 0, 0, 1.6, 1.1, 0.5), '#fff2d0'], ['glow', GU.ball, MO(-5.2, 7.6, 18, 0, 0, 1.6, 1.1, 0.5), '#fff2d0'],
    ['glow', GU.ball, MO(5.6, 8, -18, 0, 0, 1.4, 1, 0.5), '#ff3020'], ['glow', GU.ball, MO(-5.6, 8, -18, 0, 0, 1.4, 1, 0.5), '#ff3020'],
    ['metal', GU.box, MO(0, 4.6, 18.4, 0, 0, 13, 1.4, 0.6), '#d8d0c0'], ['metal', GU.box, MO(0, 4.6, -18.4, 0, 0, 13, 1.4, 0.6), '#d8d0c0'],
  ]
}

// ---- Street trees: a trunk that forks into limbs, a canopy of clumped leaf cards that lets light through (neem, or a
// gulmohar in red blossom), an iron guard. Instanced; trees away from the route get a cheap lumpy version. ---------------
let LEAFTEX = null
function leafTex() {
  if (LEAFTEX) return LEAFTEX
  LEAFTEX = canvasTex(512, 256, (g) => {
    g.clearRect(0, 0, 512, 256)
    const r = rng(29)
    const leaflet = (x, y, a, L, W, col) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(W, L * 0.4, 0, L); g.quadraticCurveTo(-W, L * 0.4, 0, 0); g.fill(); g.restore() }
    const frond = (x0, x1, fl) => {
      for (let i = 0; i < 70; i++) {
        const cx = x0 + 18 + r() * (x1 - x0 - 36), cy = 18 + r() * 220, a = r() * 6.28, n = 5 + Math.floor(r() * 5)
        const greens = fl ? ['#5a9a3a', '#6aaa40', '#7ab84a', '#4a8a34'] : ['#5a8f38', '#6a9f40', '#7aac46', '#4a7f32', '#8aba50']
        g.strokeStyle = '#3a4a22'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * n * 6, cy + Math.sin(a) * n * 6); g.stroke()
        for (let k = 0; k < n; k++) for (const s of [-1, 1]) leaflet(cx + Math.cos(a) * k * 6, cy + Math.sin(a) * k * 6, a + s * (fl ? 1.3 : 0.9), fl ? 7 : 12 + r() * 4, fl ? 2.2 : 3.4, greens[Math.floor(r() * greens.length)])
      }
      if (fl) for (let i = 0; i < 46; i++) { const cx = x0 + 14 + r() * (x1 - x0 - 28), cy = 14 + r() * 228; for (let k = 0; k < 6; k++) leaflet(cx, cy, (k / 6) * 6.28 + r() * 0.3, 9 + r() * 4, 5, ['#f0501a', '#f86a1e', '#e8401a', '#ffb020'][k === 0 ? 3 : Math.floor(r() * 3)]) }
    }
    frond(0, 256, false); frond(256, 512, true)
  }, { aniso: 4 })
  return LEAFTEX
}
function treeGeometries(hi = true) {
  const rr = rng(13)
  // bark: trunk, three limbs, a few branches, and the guard
  const bark = []
  const limb = (a, b, r0, r1, col = '#5a4636') => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), L = A.distanceTo(Bv); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); bark.push([new THREE.CylinderGeometry(r1, r0, L, r0 > 1.2 ? 6 : 4, 1, true), new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), col]) }
  limb([0, 0, 0], [0.5, 26, 0.3], 3.4, 2.6, '#4e3c2e')
  const tips = []
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + 0.4, out = 22 + rr() * 12, up = 46 + rr() * 10
    const mid = [Math.cos(a) * out * 0.45, 37 + rr() * 5, Math.sin(a) * out * 0.45], tip = [Math.cos(a) * out, up, Math.sin(a) * out]
    limb([0.5, 25, 0.3], mid, 2.2, 1.5); limb(mid, tip, 1.5, 0.8)
    for (let j = 0; j < 2; j++) { const b2 = a + (j ? 0.7 : -0.7), t2 = [tip[0] + Math.cos(b2) * 13, tip[1] + 7, tip[2] + Math.sin(b2) * 13]; limb(tip, t2, 0.8, 0.4); tips.push(t2) }
    tips.push(tip)
  }
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; bark.push([new THREE.BoxGeometry(0.4, 9, 0.4), M(Math.cos(a) * 5, 4.5, Math.sin(a) * 5), '#22221f']) }
  bark.push([new THREE.TorusGeometry(5, 0.3, 4, 14), M(0, 8.8, 0, Math.PI / 2), '#22221f'], [new THREE.CylinderGeometry(5.2, 5.2, 0.6, 14), M(0, 0.3, 0), '#4a3a2a'])
  // canopy: clumps of crossed leaf cards around the branch tips, darker inside
  const cards = (half) => {
    const parts = [], cr = rng(half ? 71 : 37)
    const clumps = tips.map((t) => [t[0] * 1.1, t[1] + 2, t[2] * 1.1]).concat(tips.filter((_, i) => i % 3 === 0).map((t) => [t[0] * 1.25, t[1] - 9, t[2] * 1.25]), [[0, 64, 0], [8, 58, -10], [-10, 60, 8]])
    for (const c of clumps) for (let k = 0; k < (hi ? 6 : 3); k++) {
      const p = [c[0] + (cr() - 0.5) * 22, c[1] + (cr() - 0.5) * 11, c[2] + (cr() - 0.5) * 22], sz = (hi ? 23 : 29) + cr() * 12
      const dist = Math.hypot(p[0], (p[1] - 56) * 1.6, p[2]) / 40, shade0 = 0.55 + 0.5 * Math.min(1, dist)
      const col = new THREE.Color(shade0, shade0, shade0)
      for (let j = 0; j < 3; j++) {
        const g = new THREE.PlaneGeometry(sz, sz * 0.8), uv = g.attributes.uv
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (half ? 0.5 : 0))
        parts.push([g, new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler((cr() - 0.5) * 0.9, j * 1.05 + cr(), (cr() - 0.5) * 0.6)), new THREE.Vector3(1, 1, 1)), col])
      }
    }
    return bake(parts)
  }
  const keepUV = (parts) => { const gs = parts.map(([g, m, c]) => { const q = g.index ? g.toNonIndexed() : g.clone(); q.applyMatrix4(m); const n = q.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b } q.setAttribute('color', new THREE.BufferAttribute(a, 3)); return q }); return mergeGeometries(gs) }
  void keepUV
  // the far tree: a trunk and three lumpy masses
  const far = bake([[new THREE.CylinderGeometry(2, 3, 40, 5, 1, true), M(0, 20, 0), '#4e3c2e'], [GU.sph, M(0, 58, 0, 0, 0, 0, 34, 18, 34), '#5a7a36'], [GU.sph, M(16, 52, 8, 0, 1, 0, 22, 14, 22), '#4e6e30'], [GU.sph, M(-14, 54, -10, 0, 2, 0, 24, 15, 24), '#668640']])
  return { bark: bake(bark), neem: cards(false), gul: cards(true), far }
}
function makeTrees(sc, near, far, U, hi) {
  const G = treeGeometries(hi), tex = leafTex()
  const barkM = vc(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }))
  const leafM = vc(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }))
  leafM.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = instanceMatrix[3].x * .03 + instanceMatrix[3].z * .02 + position.x * .05; float k = clamp((position.y - 30.) / 40., 0., 1.); transformed += vec3(sin(uTime * 1.3 + ph), sin(uTime * 2.1 + ph * 1.7) * .3, cos(uTime * 1.1 + ph)) * k * 1.3; }`)
  }
  leafM.customProgramCacheKey = () => 'mm-tree-leaf'
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45, side: THREE.DoubleSide })
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3(), c = new THREE.Color()
  const inst = (geo, mat, list, cast, tint) => {
    if (!list.length) return null
    const im = new THREE.InstancedMesh(geo, mat, list.length)
    list.forEach(([x, z, s, , rot], k) => { im.setMatrixAt(k, m4.compose(v.set(x, SLAB, z), q.setFromEuler(e.set(0, rot ?? s * 9, 0)), sv.setScalar(s))); if (tint) im.setColorAt(k, c.setHSL(tint[0] + ((k * 0.37) % 1) * tint[1], tint[2], tint[3] + ((k * 0.61) % 1) * tint[4])) })
    im.castShadow = cast; im.receiveShadow = true; im.computeBoundingSphere()
    if (mat === leafM) im.customDepthMaterial = depth
    sc.add(im); return im
  }
  // one set of instanced meshes per two-block cluster, so shots and the shadow pass only draw the trees near them
  const groups = new Map()
  for (const t of near) { const k = Math.floor(t[0] / 840) + ',' + Math.floor(t[1] / 840); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t) }
  for (const list of groups.values()) {
    inst(G.bark, barkM, list, true)
    inst(G.neem, leafM, list.filter((t) => !t[3]), hi, [0.22, 0.05, 0.25, 0.85, 0.3])
    inst(G.gul, leafM, list.filter((t) => t[3]), hi, [0.0, 0.0, 0.0, 0.9, 0.2])
  }
  const fm = inst(G.far, vc(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 })), far, false)
  return { leafM, far: fm }
}
/** Lay out the neighbourhood around the route. Returns the moving and glowing things for update(). */
function buildCity(sc, T, U, route, mats) {
  const tier = T.name, thin = T.leaves ?? 1, hi = tier === 'high'
  const r = rng(31), r2 = rng(77)
  const keep = (p = 1) => r2() < thin * p
  const routePts = []; for (let k = 0; k <= 120; k++) routePts.push(route.getPointAt(k / 120))
  const dRoute = (x, z) => { let d = 1e9; for (const p of routePts) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2); return Math.sqrt(d) }
  // the view down the warehouse street at the ride-off also gets full detail
  const nRoute = routePts.length
  for (let x = 440; x <= 1320; x += 40) routePts.push(new THREE.Vector3(x, 0, 0))
  const dRoute0 = (x, z) => { let d = 1e9; for (let k = 0; k < nRoute; k++) { const p = routePts[k]; d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2) } return Math.sqrt(d) }
  const NEAR = hi ? 330 : 210, MID = hi ? 900 : 440
  const B = new Batch()
  const tileKey = (x, z, s) => `${s}:${Math.floor(x / s)},${Math.floor(z / s)}`
  const TN = hi ? PITCH : PITCH * 2 // near tiles: one block on high, two on smaller tiers (fewer draw calls)
  const add = (mat, x, z, g, m, c, uv, s = PITCH) => B.add(mat + '|' + (s === PITCH ? 'N' : 'F') + tileKey(x, z, s === PITCH ? TN : s), g, m, c, uv || (mat === 'glow' ? RA.white : uv))
  const addParts = (x, z, parts, W, s = PITCH, matOver = null) => { for (const [mat, g, m, c, uv] of parts) add(matOver || mat, x, z, g, W.clone().multiply(m), c, uv, s) }
  const shells = new Map()
  const slabs = []
  const blds = []
  const clearCam = (x, z) => x > -320 && x < 340 && z > 20 && z < 90 // the tracking camera's lane
  for (let i = -4; i <= 3; i++) for (let j = -3; j <= 6; j++) { // the city ends east of the long street, opening the view to the far skyline
    const cx = PITCH * i + PITCH / 2, cz = PITCH * j + PITCH / 2
    slabs.push([cx, cz])
    for (const row of [-1, 1]) {
      let x = cx - BLOCK / 2, first = true
      while (x < cx + BLOCK / 2 - 30) {
        const w = Math.min(cx + BLOCK / 2 - x, 40 + Math.floor(r() * 6) * 10)
        const px = x + w / 2
        x += w
        const last = x >= cx + BLOCK / 2 - 30
        const edgeZ = cz + row * (BLOCK / 2)
        const fz = r(), ff = r(), fs = r(), fd = r(), ft = r(), fk = r()
        if (Math.abs(px + 170) < 150 && cz < 0 && cz > -400) { first = false; continue }
        if (row < 0 && Math.abs(px - HOUSE.x) < 72 && Math.abs(edgeZ - (HOUSE.z - 15)) < 30) { first = false; continue }
        const dr = Math.min(dRoute(px, edgeZ), dRoute(px, cz))
        const detail = dr < NEAR ? 2 : dr < MID ? 1 : 0
        const camRow = row < 0 && Math.abs(edgeZ - 60) < 1 && px > -360 && px < 380 // behind the tracking camera
        const feat = row > 0 && Math.abs(edgeZ + 60) < 1 && px > 50 && px < 390 // the shopfronts behind the rider at the start
        const shop = feat || (!camRow && detail > 0 && fz < (dRoute(px, edgeZ) < 120 ? 0.5 : 0.28))
        const floors = feat ? 2 + Math.floor(ff * 2.2) : 2 + Math.floor(Math.pow(ff, detail === 2 ? 1.7 : 1.3) * (detail === 2 ? 3.3 : 4))
        const H = floors * FLOOR + 2
        const set = camRow ? 40 : shop ? 2 : 9 + fs * 8
        const d = 64 + fd * 56
        const face = row
        const bz = edgeZ - face * (set + d / 2)
        const bw = w - 3 - ft * 5
        const tint = WALLS[Math.floor(fk * WALLS.length)]
        const end = first || last
        const b = { px, bz, w: bw, d, H, floors, face, shop, tint, edgeZ, detail, end, camRow, feat, seed: r(), x0: x - w, x1: x, viewOnly: detail === 2 && Math.min(dRoute0(px, edgeZ), dRoute0(px, cz)) >= NEAR }
        b.brick = !feat && r() < 0.1
        b.sideWin = end || r() < 0.25 ? 1 : 0
        b.roofKind = Math.floor(r() * 4)
        const sk = detail === 2 ? 'N' + tileKey(px, bz, TN) : 'F' + tileKey(px, bz, PITCH * 2)
        if (!shells.has(sk)) shells.set(sk, [])
        shells.get(sk).push({ x: px, y: SLAB + H / 2, z: bz, w: bw, h: H, d, tint, k: [b.seed + (b.brick ? 10 : 0), shop ? face : 0, b.sideWin + (feat ? 2 : 0), b.roofKind], detail })
        blds.push(b)
        first = false
      }
    }
  }
  // ---- façade dressing near the route ----
  const frameOf = (b, axis, sgn) => axis === 'z'
    ? { cx: b.px, cz: b.bz + sgn * b.d / 2, tx: 1, tz: 0, nx: 0, nz: sgn, W: b.w, ry: sgn > 0 ? 0 : Math.PI }
    : { cx: b.px + sgn * b.w / 2, cz: b.bz, tx: 0, tz: 1, nx: sgn, nz: 0, W: b.d, ry: sgn * Math.PI / 2 }
  const at = (F, u, out) => [F.cx + F.tx * (u - F.W / 2) + F.nx * out, F.cz + F.tz * (u - F.W / 2) + F.nz * out]
  const props = { tree: [], farTree: [], bike: [], cycle: [], roofPeople: [], spill: [] }
  function dressFace(b, F, front) {
    const T2 = (mat, u, y, out, g, sx, sy, sz, c, uv, rx = 0) => { const [x, z] = at(F, u, out); add(mat, b.px, b.bz, g, MO(x, y, z, F.ry, rx, sx, sy, sz), c, uv) }
    const W = F.W, nb = Math.max(1, Math.floor(W / 26)), bw = W / nb
    const trim = shade(b.tint, 1.1, 0.05)
    if (front) {
      T2('plaster', W / 2, SLAB + 2, 0.6, GU.box, W + 1.2, 4, 1.2, STONE)
      for (let fl = 1; fl < b.floors; fl++) T2('plaster', W / 2, SLAB + fl * FLOOR + 1, 0.8, GU.box, W + 1.6, 2.2, 1.6, trim)
    }
    const tall = b.floors >= 4
    const balc = front && b.floors >= 2 && (b.feat || tall || (!b.shop && r() < 0.6))
    const bwid = Math.min(W * 0.7, bw * 2 - 4)
    const ac = []
    for (let fl = front && b.shop ? 1 : 0; fl < b.floors; fl++) for (let k = 0; k < nb; k++) {
      const u = (k + 0.5) * bw, ww = bw * 0.56, base = SLAB + fl * FLOOR
      if (balc && fl >= 1 && Math.abs(u - W / 2) < bwid / 2) continue
      T2('plaster', u, base + FLOOR * 0.74 + 2.4, 2.6, GU.box, ww + 5, 1.1, 5.2, trim, null, 0.12)
      if (hi) T2('plaster', u, base + FLOOR * 0.3 - 0.5, 1, GU.box, ww + 2.4, 1, 2, CREAM)
      if (fl >= 1 && r() < 0.2) ac.push([u + (r() < 0.5 ? -1 : 1) * ww * 0.25, base + FLOOR * 0.3 - 6])
    }
    for (const [u, y] of ac) {
      T2('metal', u, y, 2.6, GU.box, 9, 6.4, 4.6, '#dcdad4')
      T2('atlas', u, y, 4.95, GU.plane, 8.6, 6, 1, '#ffffff', RA.ac)
      T2('metal', u - 3.5, y - 3.6, 2.6, GU.box, 0.5, 0.5, 5.4, '#555'); T2('metal', u + 3.5, y - 3.6, 2.6, GU.box, 0.5, 0.5, 5.4, '#555')
    }
    if (front) {
      // a drain pipe down one side, a cable bundle along the first floor
      const pu = r() < 0.5 ? 2 : W - 2
      T2('metal', pu, SLAB + b.H / 2, 1.4, GU.cyl6, 0.8, b.H, 0.8, r() < 0.3 ? '#4a6a8a' : '#5a5650')
      T2('metal', pu, SLAB + b.H - 1, 3, GU.box, 1.6, 1.6, 4, '#5a5650')
      if (balc) for (let fl = 1; fl < b.floors; fl++) {
        const base = SLAB + fl * FLOOR, ry = F.ry
        T2('plaster', W / 2, base + 0.7, 5, GU.box, bwid, 1.4, 10, trim)
        T2('cut', W / 2, base + 5.4, 9.8, GU.plane, bwid, 8.6, 1, b.railCol || (b.railCol = ['#2a3a2e', '#3a2a24', '#e0d8c8', '#24303a', '#6a2a1a'][Math.floor(r() * 5)]), strip(RS.rail, bwid / 16))
        for (const s of [-1, 1]) { const [x, z] = at(F, W / 2 + s * bwid / 2, 5); add('cut', b.px, b.bz, GU.plane, MO(x, base + 5.4, z, ry + Math.PI / 2, 0, 9.6, 8.6, 1), b.railCol, strip(RS.rail, 0.6)) }
        T2('metal', W / 2, base + 9.8, 9.8, GU.box, bwid + 0.6, 0.6, 0.9, b.railCol)
        // pots on the ledge, washing over the rail, a creeper
        const np = keep() ? 1 + Math.floor(r() * 3) : 0
        for (let p = 0; p < np; p++) { const [x, z] = at(F, W / 2 + (r() - 0.5) * (bwid - 6), 6.5); addParts(b.px, b.bz, potParts(Math.floor(r() * 3), 0.75).map(([g, m, c]) => [g === GU.sph || g === GU.sph0 || g === GU.bush ? 'leaf' : 'plaster', g, m, c]), MO(x, base + 1.4, z, r() * 6)) }
        if (r() < 0.55 && keep()) {
          let u0 = W / 2 - bwid / 2 + 3
          while (u0 < W / 2 + bwid / 2 - 6) { const cw = 4 + r() * 6, ch = 6 + r() * 7; const [x, z] = at(F, u0 + cw / 2, 10.3); add('cloth', b.px, b.bz, GU.box, MO(x, base + 10 - ch / 2, z, F.ry, 0, cw, ch, 0.25), CLOTH[Math.floor(r() * CLOTH.length)]); u0 += cw + 1 + r() * 3 }
        }
        if (r() < 0.35) for (let k = 0; k < 5; k++) { const [x, z] = at(F, W / 2 - bwid / 2 + 2 + r() * 4, 10.2); add('leaf', b.px, b.bz, GU.sph0, MO(x, base + 6 - k * 2.6, z, 0, 0, 1.6, 1.8, 1.2), k % 2 ? '#3d7a2c' : '#4f8a34') }
      }
      if (b.shop) {
        const sw = W * 0.82, open = b.feat || r() < 0.55
        for (const s of [-1, 1]) T2('plaster', W / 2 + s * (sw / 2 + 1.6), SLAB + 17, 1.3, GU.box, 3.2, 32, 2.6, trim)
        if (open) {
          T2('glow', W / 2, SLAB + 16, 0.3, GU.plane, sw, 30, 1, '#ffffff', RA.shop)
          { const [x, z] = at(F, W / 2, 0); props.spill.push([x, z, F.ry, sw]) }
          T2('metal', W / 2, SLAB + 31.5, 2, GU.box, sw, 3.6, 3.4, '#9aa2a4')
          T2('plaster', W / 2, SLAB + 4, 5, GU.box, sw * 0.7, 6.5, 5, '#6a4a30')
          // goods out front: crates of fruit, sacks
          for (let k = 0; k < 3; k++) {
            const u = W / 2 - sw / 2 + 6 + k * (sw - 12) / 2; if (r() < 0.35) continue
            T2('plaster', u, SLAB + 2.4, 9, GU.box, 8, 4.8, 6, '#a06a3a')
            for (let f = 0; f < 6; f++) T2('plaster', u - 2.6 + (f % 3) * 2.6, SLAB + 5.4, 8 + (f > 2 ? 1.6 : -1.6), GU.sph0, 1.2, 1.1, 1.2, ['#f2a71c', '#e8b33a', '#d84a2a', '#7aa83a'][Math.floor(r() * 4)])
          }
        } else T2('atlas', W / 2, SLAB + 16.5, 0.6, GU.box, sw, 30, 0.8, ['#a8b2b4', '#6a8a9a', '#8a9a7a', '#b8a890', '#8aa0b8'][Math.floor(r() * 5)], RA.shutter)
        const sk = Math.floor(r() * SIGNS.length)
        T2('atlas', W / 2, SLAB + 40, 1.4, GU.box, W * 0.88, 10, 1.4, '#ffffff', RA.sign(sk))
        if (r() < 0.6) T2('glow', W / 2, SLAB + 45.6, 2.6, GU.box, W * 0.6, 0.5, 0.5, '#ffffff', RA.white)
        T2('awn', W / 2, SLAB + 34, 6.6, GU.box, W * 0.9, 0.5, 13, '#ffffff', strip(RS.awn(Math.floor(r() * 4)), W * 0.9 / 32), 0.34)
        if (open) T2('glow', W / 2, SLAB + 30, 3, GU.box, sw * 0.6, 0.6, 0.6, '#ffffff', RA.white)
      } else if (b.edgeZ !== undefined) {
        // a compound wall along the plot edge with a gate and pillars
        const gw = 16, out = Math.abs(b.edgeZ - (b.bz + b.face * b.d / 2)) - 1.5
        const segW = (W - gw) / 2 - 1
        if (out > 4 && !b.camRow) {
          for (const s of [-1, 1]) { T2('plaster', W / 2 + s * (gw / 2 + segW / 2 + 0.5), SLAB + 5, out, GU.box, segW, 10, 2.2, b.cwall || (b.cwall = WALLS[Math.floor(r() * WALLS.length)])); T2('plaster', W / 2 + s * (gw / 2 + segW / 2 + 0.5), SLAB + 10.4, out, GU.box, segW + 0.4, 0.8, 3, CREAM) }
          T2('cut', W / 2, SLAB + 5.5, out, GU.plane, gw, 11, 1, ['#1d4a32', '#5a1f1f', '#2a2a30', '#1f3f6a'][Math.floor(r() * 4)], strip(RS.gate, gw / 20))
          for (const s of [-1, 1]) { T2('plaster', W / 2 + s * (gw / 2 + 1.6), SLAB + 6.5, out, GU.box, 3.4, 13, 3.4, CREAM); T2('glow', W / 2 + s * (gw / 2 + 1.6), SLAB + 14, out, GU.sph0, 1.1, 1.1, 1.1, '#ffd9a0', RA.white) }
          if (r() < 0.45 && keep()) { const [x, z] = at(F, W / 2 + (r() < 0.5 ? -1 : 1) * (gw / 2 + 8), out - 3); props.bike.push([x, z, F.ry + Math.PI / 2 + (r() - 0.5) * 0.3, Math.floor(r() * 7)]) }
          // bougainvillea over some walls
          if (r() < 0.3) for (let k = 0; k < 9; k++) { const [x, z] = at(F, W / 2 + (r() < 0.5 ? -1 : 1) * (gw / 2 + 4 + r() * segW * 0.8), out + (r() - 0.5) * 2); add('leaf', b.px, b.bz, GU.sph0, MO(x, SLAB + 9 + r() * 4, z, r() * 6, 0, 2 + r() * 1.6, 1.6 + r(), 2 + r() * 1.6), k % 3 ? ['#c2185b', '#d81b7a', '#e04a9a'][k % 3] : '#3d6a2c') }
        }
      }
    }
  }
  function dressRoof(b, full) {
    const top = SLAB + b.H, { px, bz, w: W, d } = b
    const A = (mat, x, y, z, g, sx, sy, sz, c, uv, ry = 0, rx = 0) => add(mat, px, bz, g, MO(x, y, z, ry, rx, sx, sy, sz), c, uv, full ? PITCH : PITCH * 2)
    const ph = full ? 11 : 8
    A('plaster', px, top + ph / 2, bz + d / 2 - 0.8, GU.box, W, ph, 1.6, b.tint); A('plaster', px, top + ph / 2, bz - d / 2 + 0.8, GU.box, W, ph, 1.6, b.tint)
    A('plaster', px + W / 2 - 0.8, top + ph / 2, bz, GU.box, 1.6, ph, d - 3.2, b.tint); A('plaster', px - W / 2 + 0.8, top + ph / 2, bz, GU.box, 1.6, ph, d - 3.2, b.tint)
    if (full) for (const [x, z, sx, sz] of [[px, bz + d / 2 - 0.8, W + 1, 2.8], [px, bz - d / 2 + 0.8, W + 1, 2.8], [px + W / 2 - 0.8, bz, 2.8, d], [px - W / 2 + 0.8, bz, 2.8, d]]) A('plaster', x, top + ph + 0.4, z, GU.box, sx, 0.8, sz, CREAM)
        const S = full ? PITCH : PITCH * 2
    const tank = (x, z) => {
      const tc = ['#2b2c2e', '#2b2c2e', '#e8e4da', '#6e9cc0', '#d8c8a8'][Math.floor(r() * 5)]
      A('plaster', x, top + 2, z, GU.box, 10, 4, 10, '#8c5a44')
      A('metal', x, top + 8.5, z, GU.cyl, 4.8, 9, 4.8, tc); A('metal', x, top + 6.5, z, GU.cyl, 5.05, 0.7, 5.05, shade(tc, 0.8)); A('metal', x, top + 10.5, z, GU.cyl, 5.05, 0.7, 5.05, shade(tc, 0.8))
      A('metal', x, top + 13.5, z, GU.cone, 4.8, 1.6, 4.8, tc); A('metal', x, top + 14.6, z, GU.cyl, 1.5, 1, 1.5, shade(tc, 0.7))
    }
    const clothes = (x, z, yaw) => {
      const L = [['metal', GU.box, MO(-12, 5, 0, 0, 0, 0.5, 10, 0.5), '#8a8478'], ['metal', GU.box, MO(12, 5, 0, 0, 0, 0.5, 10, 0.5), '#8a8478'], ['metal', GU.box, MO(0, 9.6, 0, 0, 0, 24, 0.12, 0.12), '#e8e0d0']]
      for (let u = -10.5; u < 9;) { const cw = 2.6 + r() * 3.4, ch = 3.4 + r() * 5; L.push(['cloth', GU.box, MO(u + cw / 2, 9.5 - ch / 2, 0, 0, 0, cw, ch, 0.15, (r() - 0.5) * 0.08), CLOTH[Math.floor(r() * CLOTH.length)]]); u += cw + 0.5 }
      addParts(px, bz, L, MO(x, top, z, yaw), S)
    }
    // a stair room with a door and a bulb, its own little parapet and a vent, in a corner
    const sx = r() < 0.5 ? -1 : 1, sz = r() < 0.5 ? -1 : 1
    const stair = r() < (full ? 0.75 : 0.4)
    if (stair) {
      const x = px + sx * (W / 2 - 12), z = bz + sz * (d / 2 - 12), face = -sz
      A('plaster', x, top + 12, z, GU.box, 18, 24, 18, b.tint)
      A('plaster', x, top + 24.6, z, GU.box, 19.5, 1.2, 19.5, CREAM)
      if (full) {
        A('atlas', x - sx * 3, top + 7.5, z + face * 9.05, GU.plane, 7, 15, 1, '#ffffff', RA.wood, face > 0 ? 0 : Math.PI)
        A('plaster', x - sx * 3, top + 15.6, z + face * 10, GU.box, 9, 0.8, 2.4, CREAM)
        if (r() < 0.6) A('glow', x - sx * 3, top + 17, z + face * 9.6, GU.sph0, 0.9, 0.9, 0.9, '#ffd59a', RA.white)
        A('metal', x + 7, top + 28, z - 6, GU.cyl6, 0.6, 9, 0.6, '#9a9488')
        if (r() < 0.5) tank(x, z + 0.01 - 0.01) // a tank on the stair room's roof
      }
    }
    if (!full) { if (r() < 0.5) tank(px + (r() - 0.5) * (W - 20), bz + (r() - 0.5) * (d - 20)); if (r() < 0.25) clothes(px, bz, r() * 3); return }
    // the rest of the terrace in slots, so every roof is lived in
    const slots = []
    const nx = Math.max(1, Math.floor((W - 8) / 22)), nz = Math.max(1, Math.floor((d - 8) / 22))
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = px - (W - 8) / 2 + (i + 0.5) * (W - 8) / nx, z = bz - (d - 8) / 2 + (j + 0.5) * (d - 8) / nz
      if (stair && Math.abs(x - (px + sx * (W / 2 - 12))) < 20 && Math.abs(z - (bz + sz * (d / 2 - 12))) < 20) continue
      slots.push([x, z, (i === 0 || i === nx - 1 || j === 0 || j === nz - 1)])
    }
    for (let k = slots.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [slots[k], slots[j]] = [slots[j], slots[k]] }
    const use = Math.min(slots.length, hi ? 2 + Math.floor(slots.length * 0.75) : 1 + Math.floor(slots.length * 0.4))
    const kinds = ['tank', 'clothes', 'clothes', 'pots', 'solar', 'chairs', 'cot', 'drums', 'dish', 'skylight', 'pots', 'clothes']
    let tanks = 0
    for (let k = 0; k < use; k++) {
      const [x, z, edge] = slots[k]
      let kind = k === 0 ? 'tank' : kinds[Math.floor(r() * kinds.length)]
      if (kind === 'tank' && tanks++ > 1) kind = 'pots'
      const yaw = d > W ? Math.PI / 2 : 0
      if (kind === 'tank') tank(x, z)
      else if (kind === 'clothes') clothes(x, z, yaw + (r() - 0.5) * 0.3)
      else if (kind === 'solar') addParts(px, bz, [['metal', GU.box, MO(0, 3, 0, 0, 0, 0.5, 6, 9), '#9a9a9a'], ['atlas', GU.box, MO(0, 4.5, 0, 0, -0.55, 12, 0.4, 9), '#ffffff', RA.solar], ['metal', GU.cyl, MO(0, 7.4, -4.6, 0, 0, 1.6, 12, 1.6, Math.PI / 2), '#eeeeea']], MO(x, top, z, Math.round(r() * 3) * Math.PI / 2), S)
      else if (kind === 'dish') { A('metal', x, top + 2.5, z, GU.cyl6, 0.3, 5, 0.3, '#888'); A('metal', x, top + 6, z, GU.sph, 3, 1.2, 3, '#e8e8e8', null, r() * 6, -0.9) }
      else if (kind === 'skylight') { A('glow', x, top + 1, z, GU.box, 7, 1.2, 7, '#ffd9a0', RA.white); A('plaster', x, top + 0.8, z, GU.box, 8.4, 1.2, 8.4, CREAM) }
      else if (kind === 'chairs') { const c = ['#f2f0ea', '#c0392b', '#2a6fb0'][Math.floor(r() * 3)]; for (const s of [-1, 1]) addParts(px, bz, [['plaster', GU.box, MO(0, 2.4, 0, 0, 0, 4, 0.6, 4), c], ['plaster', GU.box, MO(0, 4.6, -1.8, 0, -0.15, 4, 4.6, 0.5), c], ['plaster', GU.box, MO(0, 1.2, 0, 0, 0, 3.6, 2.4, 3.6), shade(c, 0.85)]], MO(x + s * 4, top, z, (s > 0 ? Math.PI : 0) + yaw + 0.4), S); A('plaster', x, top + 2.6, z + 0.5, GU.cyl, 2, 0.4, 2, '#f2f0ea') }
      else if (kind === 'cot') addParts(px, bz, [['plaster', GU.box, MO(0, 3.6, 0, 0, 0, 10, 0.9, 20), '#6a4a2a'], ['cloth', GU.box, MO(0, 4, 0, 0, 0, 9, 0.4, 19), '#d8b880'], ['cloth', GU.box, MO(0, 4.4, -6, 0, 0, 9.2, 0.6, 5), CLOTH[Math.floor(r() * CLOTH.length)]], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, c]) => ['plaster', GU.box, MO(a * 4.6, 1.6, c * 9.4, 0, 0, 0.8, 3.2, 0.8), '#5a3a20'])], MO(x, top, z, yaw + (r() - 0.5) * 0.4), S)
      else if (kind === 'drums') for (let q = 0; q < 2; q++) A('metal', x + q * 5 - 2.5, top + 3.6, z + (r() - 0.5) * 3, GU.cyl, 2.2, 7.2, 2.2, ['#2a6fb0', '#2a6fb0', '#e8b33a'][Math.floor(r() * 3)])
      else for (let q = 0; q < 3; q++) addParts(px, bz, potParts(Math.floor(r() * 3), 0.9 + r() * 0.3).map(([g, m, c]) => [g === GU.sph || g === GU.sph0 || g === GU.bush ? 'leaf' : 'plaster', g, m, c]), MO(x + (q - 1) * 6, top, z + (r() - 0.5) * 3, r() * 6), S)
    }
    // pigeons on the coping
    if (r() < 0.35) for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
      const x = px + (r() - 0.5) * (W - 6), z = bz + (r() < 0.5 ? -1 : 1) * (d / 2 - 0.8), yy = top + ph + 0.8, yaw = r() * 6
      A('plaster', x, yy + 1.1, z, GU.ball, 1.1, 1.0, 1.7, '#8a8c94', null, yaw); A('plaster', x + Math.sin(yaw) * 1.2, yy + 2.3, z + Math.cos(yaw) * 1.2, GU.ball, 0.65, 0.65, 0.65, '#6a7080', null, yaw)
    }
    if (r() < 0.08) props.roofPeople.push([px + (r() - 0.5) * (W - 20), top, bz + (r() - 0.5) * (d - 20), r() * 6])
  }
  for (const b of blds) {
    if (b.detail === 2) {
      dressFace(b, frameOf(b, 'z', b.face), true)
      if (b.sideWin && hi) for (const s of [-1, 1]) dressFace(b, frameOf(b, 'x', s), false)
      if (b.feat && b.end) { const F = frameOf(b, 'x', b.x0 < 100 ? -1 : 1), W = F.W, sk = Math.floor(r() * SIGNS.length)
        const T2 = (mat, u, y, out, g, sx, sy, sz, c, uv, rx = 0) => { const [x, z] = at(F, u, out); add(mat, b.px, b.bz, g, MO(x, y, z, F.ry, rx, sx, sy, sz), c, uv) }
        T2('glow', W * 0.35, SLAB + 16, 0.3, GU.plane, W * 0.5, 30, 1, '#ffffff', RA.shop); T2('metal', W * 0.35, SLAB + 31.5, 2, GU.box, W * 0.5, 3.6, 3.4, '#9aa2a4')
        T2('atlas', W / 2, SLAB + 40, 1.4, GU.box, W * 0.8, 10, 1.4, '#ffffff', RA.sign(sk)); T2('glow', W / 2, SLAB + 45.6, 2.6, GU.box, W * 0.5, 0.5, 0.5, '#ffffff', RA.white)
        T2('awn', W * 0.35, SLAB + 34, 6.6, GU.box, W * 0.55, 0.5, 13, '#ffffff', strip(RS.awn(sk % 4), W * 0.55 / 32), 0.34) }
      dressRoof(b, !b.viewOnly)
      if (r() < 0.42 && keep()) props.tree.push([b.px + (r() - 0.5) * (b.w - 14), b.edgeZ + b.face * 8, 0.78 + r() * 0.3, r() < 0.3 ? 1 : 0])
      if (b.shop && r() < 0.6) for (let k = 0; k < 1 + Math.floor(r() * 2); k++) if (keep(hi ? 0.8 : 0.5)) props[r() < 0.85 || !hi ? 'bike' : 'cycle'].push([b.px - b.w * 0.3 + k * 10 + r() * 3, b.edgeZ + b.face * 11, (b.face > 0 ? Math.PI : 0) + (r() - 0.5) * 0.3, Math.floor(r() * 7)])
    } else if (b.detail === 1) { dressRoof(b, false); if (hi && r() < 0.35) props.farTree.push([b.px + (r() - 0.5) * (b.w - 14), b.edgeZ + b.face * 8, 0.8 + r() * 0.35, 0]) }
  }
  // trees along the warehouse street and the house street; a gulmohar near the house
  for (const [x, z, s, k] of [[40, -56, 1.0, 0], [300, -56, 0.95, 0], [-340, 56, 1.0, 1], [-330, -58, 1.05, 0], [-232, -58, 0.9, 0], [-480, -56, 1.0, 0], [-470, 56, 0.9, 0], [560, 894, 1.15, 1], [470, 786, 1.0, 0], [820, 894, 1.05, 0], [474, 470, 0.95, 0], [474, 640, 1.0, 1], [366, 300, 1.0, 0]]) props.tree.push([x, z, s, k])
  // ---- clear the tracking camera's lane and the doorstep ----
  const nearHouse = (x, z) => Math.abs(x - HOUSE.x) < 60 && Math.abs(z - HOUSE.z) < 40
  for (const k of ['tree', 'bike', 'cycle']) props[k] = props[k].filter(([x, z]) => !clearCam(x, z) && !nearHouse(x, z))
  makeTrees(sc, props.tree, props.farTree, U, hi)
  const bikeCols = ['#b8312f', '#2a6fb0', '#f2f0ea', '#1d1d1f', '#6a7a82', '#d8a22a', '#3a8a5a']
  for (const [x, z, ry, c] of props.bike) addParts(x, z, bikeParts(bikeCols[c]), MO(x, SLAB, z, ry, 0, 1, 1, 1, 0.12))
  for (const [x, z, ry, c] of props.cycle) addParts(x, z, cycleParts(bikeCols[c]), MO(x, SLAB, z, ry, 0, 1, 1, 1, 0.1))
  // a few cars and autos parked along the kerbs near the route
  const carCols = ['#e8e4dc', '#b02e2a', '#2a4a7a', '#c8c8c8', '#1e1e20', '#d8b040']
  for (const [x, z, ry, c] of [[420 - 33, 380, 0, 2], [420 + 33, 560, Math.PI, 4], [420 - 33, 140, 0, 3], [870, 873, Math.PI / 2, 5], [560, 807, -Math.PI / 2, 3]]) addParts(x, z, carParts(carCols[c]), MO(x, 0, z, ry))
  for (const [x, z, ry] of [[150, -32, -Math.PI / 2 + 0.15], [420 + 32, 690, Math.PI], [800, 808, Math.PI / 2]]) addParts(x, z, autoParts(), MO(x, 0, z, ry))
  // the chai stall and a fruit cart on the north footpath of the warehouse street
  {
    const cx = 92, cz = -54
    const chai = [
      ['plaster', GU.box, MO(0, 6, 0, 0, 0, 22, 12, 9), '#7a4a28'], ['plaster', GU.box, MO(0, 12.4, 0, 0, 0, 23, 0.8, 10), '#5a3a20'], ['atlas', GU.plane, MO(0, 6.5, 4.6, 0, 0, 20, 9, 1), '#ffffff', RA.chai],
      ['metal', GU.box, MO(0, 28, -1, 0, 0.1, 30, 0.6, 16), '#6a7a7c'], ...[[-13, -7], [13, -7], [-13, 5], [13, 5]].map(([x, z]) => ['metal', GU.cyl6, MO(x, 14, z, 0, 0, 0.4, 28, 0.4), '#3a3a3a']),
      ['metal', GU.cyl, MO(-5, 16, -1, 0, 0, 3, 5, 3), '#c89a3a'], ['metal', GU.cone, MO(-5, 19.6, -1, 0, 0, 3, 2.2, 3), '#c89a3a'], ['metal', GU.cyl6, MO(-1.6, 16.6, -1, 0, 0, 0.3, 4, 0.3, -1), '#c89a3a'],
      ['glow', GU.cyl, MO(-5, 13.3, -1, 0, 0, 3.4, 0.6, 3.4), '#ff8a30', RA.white], ['glow', GU.sph0, MO(4, 24, 0, 0, 0, 1.2, 1.6, 1.2), '#fff0c0', RA.white], ['metal', GU.cyl6, MO(4, 26, 0, 0, 0, 0.1, 4, 0.1), '#222'],
      ...[0, 1, 2, 3, 4].map((k) => ['glow', GU.cyl, MO(2 + k * 2.4, 14.6, 2, 0, 0, 0.9, 2.4, 0.9), '#e8c080', RA.white]),
      ['plaster', GU.box, MO(-6, 3.2, 13, 0, 0, 14, 1, 4), '#6a4a30'], ['plaster', GU.box, MO(-6, 1.6, 13, 0, 0, 13, 3.2, 1), '#4a3020'], ['plaster', GU.box, MO(10, 3.2, 14, 0.3, 0, 10, 1, 4), '#6a4a30'],
    ]
    addParts(cx, cz, chai, MO(cx, SLAB, cz))
    const fx = 236, fz = -56, cart = [
      ['plaster', GU.box, MO(0, 9, 0, 0, 0, 22, 1.2, 11), '#8a5a32'], ['plaster', GU.box, MO(0, 10.4, 5, 0, 0, 22, 2, 0.8), '#6a4020'], ['plaster', GU.box, MO(0, 10.4, -5, 0, 0, 22, 2, 0.8), '#6a4020'],
      ['metal', GU.tor, MO(-6, 5, 6, 0, 0, 5, 5, 4), '#3a2a1a'], ['metal', GU.tor, MO(-6, 5, -6, 0, 0, 5, 5, 4), '#3a2a1a'], ['metal', GU.box, MO(14, 8.6, 0, 0, 0, 8, 0.6, 0.6), '#4a3020'],
      ['metal', GU.cyl6, MO(0, 19, 0, 0, 0, 0.3, 20, 0.3), '#555'], ['cloth', GU.cone, MO(0, 29, 0, 0, 0, 15, 4, 15), '#e86a2a'], ['glow', GU.sph0, MO(3, 24, 0, 0, 0, 1.1, 1.4, 1.1), '#ffe0a0', RA.white],
    ]
    const fr = rng(12)
    for (let k = 0; k < 46; k++) { const lay = k < 24 ? 0 : k < 38 ? 1 : 2, n = [24, 14, 8][lay], i = lay ? k - [0, 24, 38][lay] : k, xx = -9 + (i % [8, 7, 4][lay]) * [2.5, 2.6, 3][lay] + lay * 1.2, zz = -3.6 + Math.floor(i / [8, 7, 4][lay]) * 2.5 + lay * 1.2; void n; cart.push(['plaster', GU.ball, MO(xx, 10.9 + lay * 1.6, zz, fr() * 6, 0, 1.25, 1.1, 1.5), ['#f2a71c', '#f5b82a', '#e88a18', '#c8c03a'][Math.floor(fr() * 4)]]) }
    addParts(fx, fz, cart, MO(fx, SLAB, fz, 0.1))
  }
  // ---- merge the tiles ----
  const tiles = []
  const casts = new Set(['plaster', 'metal', 'atlas', 'leaf', 'vehicle', 'cut', 'awn', 'cloth'])
  for (const [key, l] of B.L) {
    const mat = key.split('|')[0], near = key.includes('|N')
    const mesh = new THREE.Mesh(Batch.merge(l), mats[mat])
    mesh.castShadow = hi && casts.has(mat) && near; mesh.receiveShadow = mat !== 'glow'
    mesh.userData.caster = mesh.castShadow; mesh.userData.sphere = mesh.geometry.boundingSphere
    mesh.matrixAutoUpdate = false
    sc.add(mesh); tiles.push(mesh)
  }
  for (const [key, list] of shells) {
    const mesh = new THREE.Mesh(shellGeometry(list), mats.shell)
    mesh.castShadow = key.startsWith('N'); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false
    sc.add(mesh); tiles.push(mesh)
  }
  // footpath slabs
  {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK + 30, SLAB, BLOCK + 30), slabMaterial(U), slabs.length)
    const m4 = new THREE.Matrix4(); slabs.forEach(([x, z], k) => im.setMatrixAt(k, m4.makeTranslation(x, SLAB / 2, z)))
    im.receiveShadow = true; sc.add(im)
  }
  // ---- street lamps (instanced across the city), their heads glow; the pools are painted by the road shaders ----
  const lamps = []
  const skip = (x, z) => (Math.abs(x - HOUSE.x) < 110 && Math.abs(z - HOUSE.z) < 60) || clearCam(x, z)
  for (let i = -3; i <= 5; i++) for (let z = -630; z <= 1600; z += 140) { const cc = z - PITCH * Math.round(z / PITCH); if (Math.abs(cc) >= 60 && !skip(PITCH * i + 47, z) && dRoute(PITCH * i + 47, z) < (hi ? 800 : 500)) lamps.push([PITCH * i + 47, z, 0]) }
  for (let j = -2; j <= 4; j++) for (let x = -820; x <= 1460; x += 140) { const cc = x - PITCH * Math.round(x / PITCH); if (Math.abs(cc) >= 60 && !skip(x, PITCH * j + 47) && dRoute(x, PITCH * j + 47) < (hi ? 800 : 500)) lamps.push([x, PITCH * j + 47, 1]) }
  const lampG = bake([[new THREE.CylinderGeometry(0.55, 1.0, 54, 6, 1, true), M(0, 27 + SLAB, 0)], [new THREE.CylinderGeometry(1.4, 1.6, 3, 6), M(0, SLAB + 1.5, 0)], [new THREE.TorusGeometry(6.5, 0.4, 4, 8, Math.PI / 2), M(-6.5, 52 + SLAB, 0)], [new THREE.CylinderGeometry(2.6, 1.2, 1.6, 8), M(-13, 57.8 + SLAB, 0), '#3a4a44']])
  const im = new THREE.InstancedMesh(lampG, vc(new THREE.MeshStandardMaterial({ color: '#5a6a64', roughness: 0.5, metalness: 0.4 })), lamps.length)
  const headsIm = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.2, 2.2, 0.4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc070').multiplyScalar(3) }), lamps.length)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
  lamps.forEach(([x, z, h], k) => {
    im.setMatrixAt(k, m4.compose(v.set(x, 0, z), q.setFromEuler(e.set(0, h ? -Math.PI / 2 : 0, 0)), one))
    headsIm.setMatrixAt(k, m4.compose(v.set(h ? x : x - 13, 56.9 + SLAB, h ? z - 13 : z), q.identity(), one))
  })
  sc.add(im, headsIm)
  // ---- utility poles along the route, sagging cables between them, festoon lights across the lanes ----
  const poles = [], wire = [], bulbs = []
  for (let k = 3; k <= 22; k++) {
    const u = k / 26, p = route.getPointAt(u), t = route.getTangentAt(clamp(u, 0.001, 0.999))
    const side = new THREE.Vector3(t.z, 0, -t.x).normalize()
    const pp = p.clone().addScaledVector(side, 41)
    if (Math.hypot(pp.x - HOUSE.x, pp.z - HOUSE.z) < 40 || clearCam(pp.x, pp.z)) continue
    poles.push([pp.x, pp.z, Math.atan2(t.x, t.z)])
  }
  const sag = (A, Bv, s, n = 10) => { const pts = []; for (let i = 0; i <= n; i++) { const f = i / n; const p = A.clone().lerp(Bv, f); p.y -= Math.sin(f * Math.PI) * s; pts.push(p) } return pts }
  for (let k = 0; k < poles.length - 1; k++) {
    const [x0, z0, a0] = poles[k], [x1, z1, a1] = poles[k + 1]
    if (Math.hypot(x1 - x0, z1 - z0) > 200) continue
    for (const off of [-4.5, 0, 4.5]) wire.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sag(new THREE.Vector3(x0 + Math.cos(a0) * off, 66, z0 - Math.sin(a0) * off), new THREE.Vector3(x1 + Math.cos(a1) * off, 66, z1 - Math.sin(a1) * off), 5 + Math.abs(off) * 0.3)), 10, 0.22, 3, false))
  }
  // festoons: catenaries of little bulbs across the house street and over the chai stall
  const fest = [[[560, 62, 790], [560, 60, 890]], [[620, 64, 790], [640, 62, 890]], [[760, 60, 792], [745, 62, 890]], [[40, 56, -58], [180, 58, -58]], [[200, 60, -58], [330, 58, -58]]]
  for (const x of [130, 250, 540, 650, 770, 900, 1030, 1160, 1290]) fest.push([[x, 62, -60], [x + 12, 60, 60]]) // strings across the warehouse street, receding east
  const bcol = ['#ffd27a', '#ff8a5a', '#ffb02a', '#ff6a8a', '#fff2c8', '#8affb0']
  for (const [a, b2] of fest) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b2), pts = sag(A, Bv, 9, 24)
    wire.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.15, 3, false))
    const n = Math.round(A.distanceTo(Bv) / 4.2)
    for (let i = 1; i < n; i++) { const f = i / n, p = A.clone().lerp(Bv, f); p.y -= Math.sin(f * Math.PI) * 9 + 1.1; bulbs.push([GU.sph0, MO(p.x, p.y, p.z, 0, 0, 0.8, 0.95, 0.8), bcol[i % bcol.length], RA.white]) }
  }
  const poleG = bake([[new THREE.CylinderGeometry(0.9, 1.3, 68, 5, 1, true), M(0, 34, 0)], [new THREE.BoxGeometry(12, 0.8, 0.8), M(0, 64, 0)], [new THREE.BoxGeometry(9, 0.6, 0.6), M(0, 60, 0)], [new THREE.CylinderGeometry(1.4, 1.4, 4, 6), M(3, 56, 0), '#5a5a5a']])
  const pim = new THREE.InstancedMesh(poleG, vc(new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: 0.9 })), poles.length)
  poles.forEach(([x, z, a], k) => pim.setMatrixAt(k, m4.compose(v.set(x, 0, z), q.setFromEuler(e.set(0, a + Math.PI / 2, 0)), one)))
  sc.add(pim)
  const wm = new THREE.Mesh(mergeGeometries(wire.map((g) => { g.deleteAttribute('uv'); return g })), new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.6 })); sc.add(wm)
  const bl = new Batch(); for (const [g, m, c, uv] of bulbs) bl.add('b', g, m, c, uv)
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, map: cityTex().atlas })
  const bulbMesh = new THREE.Mesh(Batch.merge(bl.L.get('b')), bulbMat); sc.add(bulbMesh)
  // warm light spilling from the open shops across the pavement and onto the wet road
  const spillMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uOp: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uOp; varying vec2 vUv; void main(){ float a = pow(1. - vUv.y, 1.6) * smoothstep(0., .25, vUv.x) * smoothstep(1., .75, vUv.x); gl_FragColor = vec4(vec3(1., .62, .3) * a * .5 * uOp, 1.); }',
  })
  const sp = []
  for (const [x, z, ry, w] of props.spill) for (const [y, a, b] of [[SLAB + 0.1, 0, 15], [0.1, 15, 46]]) { const g = new THREE.PlaneGeometry(w * 1.1, b - a); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, a / 46 + (1 - uv.getY(i)) * (b - a) / 46); g.rotateX(-Math.PI / 2); g.translate(0, y, (a + b) / 2); g.rotateY(ry); g.translate(x, 0, z); sp.push(g) }
  if (sp.length) { const sm = new THREE.Mesh(mergeGeometries(sp), spillMat); sm.renderOrder = 3; sc.add(sm) }
  return { headMat: headsIm.material, bulbMat, spillMat, tiles, lampCount: lamps.length, roofPeople: props.roofPeople }
}

// ---- Life: pedestrians, an auto-rickshaw and a cyclist passing, birds, kites, steam over the chai ----------------
/** Low-detail passers-by in a walking pose: a man in a kurta and a woman in a sari (clothes tinted per instance; skin and
 *  hair in a second mesh). */
function makeFigure() {
  const lathe = (pts, seg = 10) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)
  const limb = (a, b, r0, r1) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b); return [new THREE.CylinderGeometry(r1, r0, A.distanceTo(Bv), 6), new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()), new THREE.Vector3(1, 1, 1))] }
  const head = (bun) => [[new THREE.CylinderGeometry(0.75, 0.85, 2, 6), M(0, 23.6, 0), '#8d5b3d'], [new THREE.SphereGeometry(1, 10, 8), M(0, 26.2, 0.15, 0, 0, 0, 1.75, 2.15, 1.9), '#8d5b3d'], [new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 26.7, -0.25, -0.25, 0, 0, 1.9, 2.1, 2.05), '#1b130d'], ...(bun ? [[new THREE.SphereGeometry(0.95, 8, 6), M(0, 26.2, -2.1), '#1b130d']] : [])]
  // man: trousers, a kurta flaring to the knee, arms mid-swing
  const manC = [
    [lathe([[0, 22.6], [2.6, 22.4], [3.5, 21.4], [3.2, 18.6], [2.9, 16], [3.4, 12.5], [3.9, 9.6], [0, 9.6]]), M(0, 0, 0, 0, 0, 0, 1, 1, 0.72), '#ffffff'],
    [...limb([-1.1, 12, 0], [-1.3, 1.2, 2.4], 1.15, 0.85), '#4a4640'], [...limb([1.1, 12, 0], [1.3, 1.2, -2.2], 1.15, 0.85), '#4a4640'],
    [...limb([-3.3, 21.4, 0], [-3.8, 14, -2.2], 0.85, 0.7), '#ffffff'], [...limb([3.3, 21.4, 0], [3.8, 14, 2.2], 0.85, 0.7), '#ffffff'],
  ]
  const manB = [...head(false), [new THREE.SphereGeometry(0.75, 6, 5), M(-3.9, 13.2, -2.6), '#8d5b3d'], [new THREE.SphereGeometry(0.75, 6, 5), M(3.9, 13.2, 2.6), '#8d5b3d'], [new THREE.BoxGeometry(1.4, 0.8, 3), M(-1.3, 0.5, 2.8), '#2a1d14'], [new THREE.BoxGeometry(1.4, 0.8, 3), M(1.3, 0.5, -1.8), '#2a1d14']]
  // woman: a sari falling to the ground with the pallu over one shoulder
  const womanC = [
    [lathe([[0, 22.2], [2.4, 22], [3.2, 21], [2.9, 18.4], [2.5, 15.6], [3.1, 11], [3.6, 5], [4.1, 0.4], [0, 0.4]], 12), M(0, 0, 0, 0, 0, 0, 1, 1, 0.78), '#ffffff'],
    [new THREE.BoxGeometry(2.4, 13, 0.5), M(1.2, 17, -2.0, 0.1, 0, 0.5), '#e8d8b0'], [new THREE.BoxGeometry(2, 8, 0.4), M(2.4, 15.5, -2.4, 0.1, 0, 0.1), '#ffffff'],
    [...limb([-3, 21, 0], [-3.4, 14.2, 2], 0.75, 0.6), '#ffffff'], [...limb([3, 21, 0], [3.3, 14.2, -1.8], 0.75, 0.6), '#ffffff'],
  ]
  const womanB = [...head(true), [new THREE.SphereGeometry(0.7, 6, 5), M(-3.5, 13.4, 2.3), '#8d5b3d'], [new THREE.SphereGeometry(0.7, 6, 5), M(3.4, 13.4, -2.1), '#8d5b3d']]
  return { man: { clothes: bake(manC), skin: bake(manB) }, woman: { clothes: bake(womanC), skin: bake(womanB) } }
}
function makeLife(sc, T, U, route, roofPeople = []) {
  const life = new THREE.Group(); sc.add(life)
  const hi = T.name === 'high'
  // pedestrians on the footpaths along the route: a walk back and forth on a stretch of pavement (ambient)
  const fig = makeFigure()
  const walks = [[560, -52, 1, 100], [760, 54, 1, 120], [940, -52, 1, 100], [366, 200, 0, 200], [474, 120, 0, 260], [366, 600, 0, 180], [474, 760, 0, 80], [520, 894, 1, 120], [880, 894, 1, 90], [600, 790, 1, 160], [474, 420, 0, 120], [366, 420, 0, 140], [840, 790, 1, 120]]
  const n = hi ? walks.length : Math.ceil(walks.length * 0.6)
  const clothesM = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.8 })
  const skinM = vc(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }))
  const nr = roofPeople.length, total = n + nr
  const cols = ['#c0392b', '#2a6fb0', '#e8b33a', '#f2e6cf', '#8a3fa0', '#2e7d4f', '#e05a8a', '#6a7a82', '#d35400', '#36a3a0', '#f0d0a0', '#b8312f', '#3a5a8a', '#e8e0d0']
  // even slots are men, odd slots women; each kind is a clothes mesh and a skin mesh
  const kinds = ['man', 'woman'].map((kind, ki) => {
    const cnt = Math.ceil((total - ki) / 2)
    const c = new THREE.InstancedMesh(fig[kind].clothes, clothesM, Math.max(1, cnt)), sk = new THREE.InstancedMesh(fig[kind].skin, skinM, Math.max(1, cnt))
    c.count = sk.count = cnt
    for (let j = 0; j < cnt; j++) c.setColorAt(j, new THREE.Color(cols[(j * 2 + ki) % cols.length]))
    c.castShadow = sk.castShadow = hi; c.frustumCulled = sk.frustumCulled = false
    life.add(c, sk)
    return [c, sk]
  })
  const setPerson = (k, m) => { const [c, sk] = kinds[k % 2]; c.setMatrixAt(k >> 1, m); sk.setMatrixAt(k >> 1, m) }
  roofPeople.forEach(([x, y, z, a], k) => setPerson(n + k, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), new THREE.Vector3(1, 1, 1))))
  // the auto-rickshaw that passes behind the rider on the warehouse street, and a cyclist on the long street
  const autoB = new Batch()
  for (const [mat, g, m, c, uv] of autoParts()) autoB.add(mat === 'glow' ? 'g' : 'v', g, m, c, uv)
  const auto = new THREE.Group(); life.add(auto)
  auto.add(new THREE.Mesh(Batch.merge(autoB.L.get('v')), new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.35, clearcoat: 0.7 })))
  auto.add(new THREE.Mesh(Batch.merge(autoB.L.get('g')), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2c8').multiplyScalar(1.6) })))
  auto.children[0].castShadow = true
  const cyB = new Batch()
  for (const [, g, m, c] of cycleParts('#2a6fb0')) cyB.add('c', g, m, c)
  for (const [g, m, c] of [[new THREE.CapsuleGeometry(2.8, 6, 3, 8), MO(0, 24.5, 0, 0, 0.35, 1, 1, 0.75), '#f2e6cf'], [GU.ball, MO(0, 32.5, 2.4, 0, 0, 1.8, 2.2, 1.9), '#8d5b3d'], [GU.ball, MO(0, 33.3, 2.0, 0, 0, 1.9, 1.6, 2), '#1b130d'], [GU.cyl6, MO(-1.4, 14.5, 2.5, 0, -0.9, 1.1, 10, 1.1), '#3a3530'], [GU.cyl6, MO(1.4, 13.5, 0.5, 0, 0.3, 1.1, 10, 1.1), '#3a3530'], [GU.cyl6, MO(-2.4, 23.5, 4.4, 0, -1.05, 0.7, 9, 0.7), '#f2e6cf'], [GU.cyl6, MO(2.4, 23.5, 4.4, 0, -1.05, 0.7, 9, 0.7), '#f2e6cf']]) cyB.add('c', g, m, c)
  const cyclist = new THREE.Mesh(Batch.merge(cyB.L.get('c')), new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.6, metalness: 0.2 })); cyclist.castShadow = true; life.add(cyclist)
  // birds: a loose flock wheeling over the rooftops; wings flap in the vertex shader
  const nb = hi ? 28 : 16
  const bg = new THREE.BufferGeometry()
  bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.2, -3.2, 0.4, -0.6, 0, 0, -1.2, 0, 0, 1.2, 0, 0, -1.2, 3.2, 0.4, -0.6], 3)); bg.computeVertexNormals()
  const birdM = new THREE.MeshBasicMaterial({ color: '#2a2630', side: THREE.DoubleSide })
  birdM.onBeforeCompile = (s) => { s.uniforms.uTime = U.uTime; s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 11. + float(gl_InstanceID) * 1.7) * abs(position.x) * .7;') }
  birdM.customProgramCacheKey = () => 'mm-bird'
  const birds = new THREE.InstancedMesh(bg, birdM, nb); birds.frustumCulled = false; life.add(birds)
  // kites high over the neighbourhood, each with a tail and a string down to a roof
  const kites = []
  const kiteCols = [['#e8322a', '#ffd23a'], ['#2a6fd0', '#ffffff'], ['#f2a01a', '#2e8a4a'], ['#d23c8c', '#ffd23a']]
  ;[[470, 240, 640], [575, 270, 760], [420, 220, 520], [660, 300, 690]].slice(0, hi ? 4 : 2).forEach(([x, y, z], k) => {
    const g = new THREE.Group(); g.position.set(x, y, z); life.add(g)
    const kb = new Batch()
    kb.add('k', new THREE.CircleGeometry(1, 4), MO(0, 0, 0, 0, 0, 7, 9, 1), kiteCols[k][0]); kb.add('k', new THREE.CircleGeometry(1, 4), MO(0, 0, 0.05, 0, 0, 3, 4, 1), kiteCols[k][1])
    for (let i = 0; i < 5; i++) kb.add('k', GU.plane, MO(Math.sin(i) * 0.6, -10 - i * 3.2, 0, 0, 0, 1.2 - i * 0.12, 3, 1, Math.sin(i * 1.3) * 0.3), kiteCols[k][i % 2])
    const km = new THREE.Mesh(Batch.merge(kb.L.get('k')), new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, emissive: '#ffffff', emissiveIntensity: 0.05 }))
    g.add(km)
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -4, 0), new THREE.Vector3(30 - k * 20, -y + 70, 60 - k * 30)]), new THREE.LineBasicMaterial({ color: '#f2e6cf', transparent: true, opacity: 0.35 }))
    g.add(line)
    kites.push(g)
  })
  // steam over the chai kettle
  const ns = 26, sp = new Float32Array(ns * 3), sa = new Float32Array(ns)
  for (let i = 0; i < ns; i++) { sp[i * 3] = 87 + Math.sin(i * 7.1) * 0.8; sp[i * 3 + 1] = SLAB + 21; sp[i * 3 + 2] = -55; sa[i] = i / ns }
  const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sgeo.setAttribute('aS', new THREE.BufferAttribute(sa, 1))
  const steam = new THREE.Points(sgeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime: U.uTime, uOp: { value: 0.5 } },
    vertexShader: 'attribute float aS; uniform float uTime; varying float vA; void main(){ float k = fract(uTime * .22 + aS); vec3 p = position + vec3(sin(uTime * .9 + aS * 30.) * k * 3., k * 22., cos(uTime * .7 + aS * 20.) * k * 2.); vA = sin(k * 3.14159) * (1. - k); vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = (2. + k * 6.) * 600. / -mv.z; }',
    fragmentShader: 'uniform float uOp; varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(1., .97, .92), smoothstep(.5, .0, d) * vA * uOp); }',
  }))
  steam.frustumCulled = false; life.add(steam)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1)
  return {
    group: life, kites, birds, cyclist, auto, steam,
    update(t, time) {
      for (let k = 0; k < n; k++) {
        const [x, z, ax, L] = walks[k], sp = 7 + (k % 4) * 1.5, ph = (time * sp + k * 37) % (2 * L), s = ph < L ? ph : 2 * L - ph, dir = ph < L ? 1 : -1
        const px = ax ? x + s - L / 2 : x, pz = ax ? z : z + s - L / 2
        const bob = Math.abs(Math.sin((time * sp + k * 37) * 0.45)) * 0.6
        m4.compose(v.set(px, SLAB + bob, pz), q.setFromEuler(e.set(0, ax ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), Math.sin(time * sp * 0.45 + k) * 0.03)), sv)
        setPerson(k, m4)
      }
      for (const [c, sk] of kinds) c.instanceMatrix.needsUpdate = sk.instanceMatrix.needsUpdate = true
      // the auto passes behind the rider in the tracking shot (a pure function of t)
      const ka = clamp((t - 0.2) / 0.24)
      auto.visible = t > 0.18 && t < 0.47
      auto.position.set(lerp(520, -320, ka), Math.sin(time * 18) * 0.15, -27); auto.rotation.set(0, -Math.PI / 2, 0)
      // the cyclist rides down the long street during the crane shot
      const kc = clamp((t - 0.33) / 0.3)
      cyclist.visible = t > 0.3 && t < 0.66
      cyclist.position.set(447, SLAB * 0, lerp(260, 760, kc)); cyclist.rotation.set(0, 0, Math.sin(time * 3) * 0.03)
      // birds wheel (ambient)
      for (let k = 0; k < nb; k++) {
        // two loose flocks: one wheeling over the long street (seen from the crane), one over the far end of the warehouse street
        const B2 = k % 2, a = time * (B2 ? 0.22 : 0.16) + k * 0.23 + Math.sin(k * 3.7) * 0.4, rad = (B2 ? 90 : 150) + Math.sin(k * 1.9) * 40 + Math.sin(time * 0.3 + k) * 10
        const x = (B2 ? 760 : 520) + Math.cos(a) * rad, z = (B2 ? -60 : 660) + Math.sin(a) * rad * (B2 ? 0.5 : 1), y = (B2 ? 120 : 210) + Math.sin(k * 2.3) * 25 + Math.sin(time * 0.7 + k) * 6
        m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, -a, 0.2)), sv.setScalar(1.4)); birds.setMatrixAt(k, m4)
      }
      sv.set(1, 1, 1)
      birds.instanceMatrix.needsUpdate = true
      kites.forEach((g, k) => { g.rotation.set(Math.sin(time * 0.8 + k) * 0.12, Math.sin(time * 0.3 + k * 2) * 0.4, Math.sin(time * 1.1 + k * 3) * 0.25) })
    },
  }
}

/** The far skyline in three hazy layers: apartment blocks, a water tower, a temple tower, trees, with lit windows. */
function makeSkyline(sc, U) {
  const out = []
  const layer = (seed, w) => canvasTex(2048, 256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 256)
    const r = rng(seed)
    const win = []
    let x = 0
    while (x < 2048) {
      const kind = r(), bw = 30 + r() * 90 * w
      let h
      g.fillStyle = '#f00'
      if (kind < 0.55) { h = 40 + r() * 120 * w; g.fillRect(x, 256 - h, bw, h); for (let yy = 256 - h + 8; yy < 250; yy += 10) for (let xx = x + 5; xx < x + bw - 5; xx += 9) if (r() < 0.22) win.push([xx, yy]) }
      else if (kind < 0.75) { h = 18 + r() * 30; g.beginPath(); g.ellipse(x + bw / 2, 256 - h * 0.6, bw / 2, h * 0.6, 0, 0, 6.3); g.fill(); g.fillRect(x, 256 - h * 0.6, bw, h) }
      else if (kind < 0.84) { h = 120 * w + 30; g.fillRect(x + bw / 2 - 3, 256 - h, 6, h); g.beginPath(); g.ellipse(x + bw / 2, 256 - h, 22, 14, 0, 0, 6.3); g.fill(); g.fillRect(x + bw / 2 - 14, 256 - h * 0.6, 4, h * 0.6); g.fillRect(x + bw / 2 + 10, 256 - h * 0.6, 4, h * 0.6) }
      else if (kind < 0.9) { h = 150 * w + 40; g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 4, 256 - h * 0.35); g.quadraticCurveTo(x + 10, 256 - h * 0.9, x + 30, 256 - h); g.quadraticCurveTo(x + 50, 256 - h * 0.9, x + 56, 256 - h * 0.35); g.lineTo(x + 60, 256); g.fill(); g.fillRect(x + 28, 256 - h - 12, 4, 12); g.beginPath(); g.arc(x + 30, 256 - h - 14, 4, 0, 6.3); g.fill(); g.fillRect(x - 20, 256 - h * 0.3, 100, h * 0.3); x += 60 }
      else { h = 50 + r() * 40; g.fillRect(x + bw * 0.3, 256 - h, bw * 0.4, h); g.beginPath(); g.arc(x + bw / 2, 256 - h, bw * 0.3, Math.PI, 0); g.fill() }
      x += bw + (r() < 0.3 ? r() * 30 : 0)
    }
    g.fillStyle = '#ff0'; for (const [xx, yy] of win) g.fillRect(xx, yy, 4, 5)
  }, { srgb: false, repeat: true })
  const mat = (tex, near, far, hgt) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTex: { value: tex }, uCol: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uK: { value: near }, uLit: U.uLit, uTop: { value: far } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uCol, uHaze; uniform float uK, uLit, uTop; varying vec2 vUv;
      void main(){ vec4 t = texture2D(uTex, vec2(vUv.x * 3., vUv.y)); if (t.r < .5) discard;
        float h = vUv.y; vec3 c = mix(uCol, uHaze, uK + (1. - uK) * (1. - h) * .5);
        c += vec3(1., .7, .4) * t.g * step(.5, t.g) * uLit * 1.6 * (1. - uK * .6);
        gl_FragColor = vec4(c, 1.); }`,
  })
  ;[[2300, 0.12, 1, 300], [2800, 0.3, 0.8, 380], [3300, 0.5, 0.6, 470]].forEach(([R, k, w, H], i) => {
    const g = new THREE.CylinderGeometry(R, R, H, 64, 1, true)
    const m = mat(layer(11 + i * 7, w), k, 0, H)
    m.side = THREE.BackSide
    const mesh = new THREE.Mesh(g, m); mesh.position.set(420, H / 2 - 10, 420); mesh.renderOrder = -5 + i * -1; mesh.frustumCulled = false
    sc.add(mesh); out.push(m)
  })
  return out
}

// ---- The customer's house: a pale teal two-storey front with cream trims; a panelled teak door in a stepped surround
// under a mango-leaf toran, a kolam on the step and the pavement, a brass bell, a porch lantern throwing a pool of
// light, curtained windows lit from inside, bougainvillea, a tulsi planter and pots, a cat on the window ledge. -------
function buildHouse(sc, mats, hi = true) {
  const T = textures()
  const g = new THREE.Group(); g.position.copy(HOUSE); sc.add(g)
  const hb = new Batch()
  const A = (mat, geo, x, y, z, sx = 1, sy = 1, sz = 1, c = '#ffffff', uv = null, ry = 0, rx = 0, rz = 0) => hb.add(mat, geo, MO(x, y, z, ry, rx, sx, sy, sz, rz), c, uv)
  const WALL = '#a8cbbf', TRIM = '#f4ead6', PLINTH = '#9a4a32', STEP = '#b9ab98'
  const W = 130, D = 110, H1 = 54, H2 = 52, GF = PORCH_Y + H1 - 3.6
  // walls around the doorway, the upper storey, bands, a parapet with coping, a plinth
  for (const sx of [-1, 1]) A('plaster', GU.box, sx * (W / 4 + 6.6), GF / 2, D / 2, W / 2 - 13.2, GF, D, WALL)
  A('plaster', GU.box, 0, PORCH_Y + 41 + (GF - PORCH_Y - 41) / 2, D / 2, 26.4, GF - PORCH_Y - 41, D, WALL)
  A('plaster', GU.box, 0, PORCH_Y / 2, D / 2, 26.4, PORCH_Y, D, PLINTH)
  A('plaster', GU.box, 0, PORCH_Y + H1 + H2 / 2 - 3.6, D / 2, W, H2, D, WALL)
  A('plaster', GU.box, 0, PORCH_Y + H1 - 3.6, D / 2, W + 2, 3, D + 2, TRIM)
  { const y0 = PORCH_Y + H1 + H2 - 3.6; for (const [x, z, sx, sz] of [[0, 0.8, W, 1.6], [0, D - 0.8, W, 1.6], [W / 2 - 0.8, D / 2, 1.6, D], [-W / 2 + 0.8, D / 2, 1.6, D]]) { A('plaster', GU.box, x, y0 + 5, z, sx, 10, sz, WALL); A('plaster', GU.box, x, y0 + 10.5, z, sx + 1.4, 1.4, sz + 1.4, TRIM) } }
  A('plaster', GU.box, 0, 2.6, -0.5, W + 1, 5.2, 1.4, PLINTH)
  for (const sx of [-1, 1]) A('plaster', GU.box, sx * (W / 2 - 1.5), (PORCH_Y + H1 + H2) / 2, -0.6, 3, PORCH_Y + H1 + H2, 1.6, TRIM) // corner quoins
  // the terrace: red tiles, a stair room, the tank, a clothesline, a cot, pots along the parapet
  const RT = PORCH_Y + H1 + H2 - 3.6
  A('plaster', GU.box, 0, RT + 0.2, D / 2, W - 2, 0.4, D - 2, '#a8583a')
  A('plaster', GU.box, -44, RT + 12, 82, 22, 24, 22, WALL); A('plaster', GU.box, -44, RT + 24.6, 82, 23.5, 1.2, 23.5, TRIM)
  A('atlas', GU.plane, -40, RT + 8, 70.9, 7, 15, 1, '#ffffff', RA.wood, Math.PI); A('glow', GU.sph0, -40, RT + 17, 70.2, 0.9, 0.9, 0.9, '#ffd59a', RA.white)
  A('plaster', GU.box, 32, RT + 2, 40, 10, 4, 10, '#8c5a44'); A('metal', GU.cyl, 32, RT + 8.5, 40, 4.6, 9, 4.6, '#26272a'); A('metal', GU.cone, 32, RT + 13.6, 40, 4.6, 1.6, 4.6, '#26272a')
  for (const x of [-16, 16]) A('metal', GU.box, x, RT + 5, 30, 0.5, 10, 0.5, '#8a8478')
  A('metal', GU.box, 0, RT + 9.6, 30, 32, 0.12, 0.12, '#e8e0d0')
  { const cr = rng(41); for (let u = -14; u < 13;) { const cw = 2.6 + cr() * 3.6, ch = 4 + cr() * 6; A('cloth', GU.box, u + cw / 2, RT + 9.5 - ch / 2, 30, cw, ch, 0.15, CLOTH[Math.floor(cr() * CLOTH.length)], null, 0, 0, (cr() - 0.5) * 0.08); u += cw + 0.5 } }
  A('plaster', GU.box, 30, RT + 3.6, 80, 10, 0.9, 20, '#6a4a2a'); A('cloth', GU.box, 30, RT + 4, 80, 9, 0.4, 19, '#d8b880'); A('cloth', GU.box, 30, RT + 4.4, 74, 9.2, 0.6, 5, '#c0392b')
  for (const [x, z] of [[-30, 4], [-10, 4], [12, 4], [44, 4], [56, 20], [56, 50]]) for (const [g2, m, c] of potParts(Math.floor(Math.abs(x) % 3), 0.85)) hb.add(g2 === GU.sph || g2 === GU.sph0 || g2 === GU.bush ? 'leaf' : 'plaster', g2, MO(x, RT + 0.4, z).multiply(m), c)
  // porch, step, edges in pale stone; red-oxide porch floor
  A('plaster', GU.box, 0, PORCH_Y / 2, -3.6, 44, PORCH_Y, 7.2, STEP)
  A('plaster', GU.box, 0, STEP_Y / 2, -9.5, 34, STEP_Y, 5.4, STEP)
  A('plaster', GU.box, 0, PORCH_Y + 0.05, -3.6, 44.6, 0.4, 7.8, '#8a3a28')
  A('plaster', GU.box, 0, STEP_Y + 0.05, -9.5, 34.6, 0.4, 6, '#d8cfc0')
  // the porch canopy (chhajja) on carved brackets
  A('plaster', GU.box, 0, PORCH_Y + 50, -7, 50, 1.8, 16, TRIM, null, 0, 0.04)
  A('plaster', GU.box, 0, PORCH_Y + 48.6, -14.6, 50, 1.4, 1.2, '#d8c8a8')
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) A('plaster', GU.box, s * 22, PORCH_Y + 48.4 - k * 2, -1.2 - (3 - k) * 1.6, 1.6, 2, (3 - k) * 3.2, TRIM)
  // the door surround: pilasters with capitals, a stepped teak frame, a lintel cornice
  for (const s of [1, -1]) {
    A('plaster', GU.box, s * 16.2, PORCH_Y + 22, -1.2, 4.4, 44, 2.4, TRIM)
    A('plaster', GU.box, s * 16.2, PORCH_Y + 44.6, -1.6, 5.6, 1.6, 3.2, TRIM)
    A('plaster', GU.box, s * 16.2, PORCH_Y + 1.2, -1.6, 5.6, 2.4, 3.2, '#d8c8a8')
  }
  A('plaster', GU.box, 0, PORCH_Y + 46.4, -2, 38, 2.2, 4.4, TRIM)
  A('plaster', GU.box, 0, PORCH_Y + 43.2, -1.4, 28, 4.4, 2.2, '#e8dcc4')
  const teak = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: woodTex(), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 })
  const frameParts = []
  for (const [w, h, x, y, z] of [[2.6, 41, -12.4, PORCH_Y + 20.5, -0.6], [2.6, 41, 12.4, PORCH_Y + 20.5, -0.6], [27.4, 2.8, 0, PORCH_Y + 41.4, -0.6], [1.2, 40, -11.2, PORCH_Y + 20, -1.6], [1.2, 40, 11.2, PORCH_Y + 20, -1.6], [23.6, 1.2, 0, PORCH_Y + 40, -1.6]]) frameParts.push([new THREE.BoxGeometry(w, h, 3.2), M(x, y, z)])
  const frame = new THREE.Mesh(bake(frameParts), teak); frame.castShadow = frame.receiveShadow = true; g.add(frame)
  // the door: a teak leaf with six raised panels each side and brass studs, on its hinge (opens inward)
  const hinge = new THREE.Group(); hinge.position.set(-11, PORCH_Y, 0.6); g.add(hinge)
  const dp = [[rbox(22, 39.5, 1.6, 0.12, 3), M(11, 19.8, 0)]]
  for (const zs of [-1, 1]) for (let rI = 0; rI < 3; rI++) for (const cx of [5.8, 16.2]) { const h = rI === 1 ? 8 : 10.4; dp.push([rbox(8.2, h, 0.7, 0.4, 2), M(cx, [8.4, 20.6, 31.8][rI], zs * 0.85)]) }
  const door = new THREE.Mesh(bake(dp), teak); door.castShadow = true; door.receiveShadow = true; hinge.add(door)
  const brass = new THREE.MeshStandardMaterial({ color: '#d8a640', metalness: 0.9, roughness: 0.26 })
  const bp = []
  for (const s of [-1, 1]) { bp.push([new THREE.CapsuleGeometry(0.35, 3.2, 4, 8), M(19, 19, s * 1.4)], [rbox(1.4, 5, 0.3, 0.4), M(19, 19, s * 0.95)]) }
  bp.push([new THREE.TorusGeometry(1.0, 0.18, 6, 16), M(11, 27, -1.25)])
  for (const x of [1.2, 20.8]) for (const y of [3, 13, 26, 36]) bp.push([new THREE.SphereGeometry(0.45, 8, 6), M(x, y, -0.95)])
  const bm = new THREE.Mesh(bake(bp), brass); hinge.add(bm)
  // the toran: mango leaves and marigolds on a cord across the top of the door
  for (let k = 0; k <= 22; k++) {
    const x = -12.6 + k * 1.15, f = k / 22, y = PORCH_Y + 42.6 - Math.sin(f * Math.PI) * 1.2
    if (k % 2 === 0) A('leaf', GU.sph, x, y - 2.8, -2.6, 0.75, 2.8, 0.22, ['#2f6a24', '#3f7a2a', '#4a8a30'][k % 3], null, 0, 0.12, Math.sin(k * 1.7) * 0.18)
    else { A('leaf', GU.sph0, x, y - 0.6, -2.7, 0.75, 0.75, 0.75, k % 4 === 1 ? '#f28a12' : '#f2c21a'); if (k % 4 === 1) A('leaf', GU.sph0, x, y - 4.6, -2.7, 0.6, 0.6, 0.6, '#f28a12') }
  }
  A('metal', GU.box, 0, PORCH_Y + 42.3, -2.6, 26, 0.25, 0.25, '#c8a040')
  // a brass bell hanging under the canopy, the bell push, a blank brass nameplate
  const bellParts = [[new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1.9, 0), new THREE.Vector2(1.7, 0.4), new THREE.Vector2(1.3, 1.6), new THREE.Vector2(1.1, 3.2), new THREE.Vector2(0.6, 3.9), new THREE.Vector2(0, 4.1)], 16), M(18.5, PORCH_Y + 35.4, -6)], [new THREE.CylinderGeometry(0.12, 0.12, 9, 4), M(18.5, PORCH_Y + 44, -6)], [new THREE.SphereGeometry(0.5, 8, 6), M(18.5, PORCH_Y + 35.2, -6)]]
  const hb2 = new THREE.Mesh(bake(bellParts), brass); hb2.castShadow = true; g.add(hb2)
  A('plaster', GU.box, 16.2, PORCH_Y + 17.5, -2.5, 2.4, 3.4, 0.6, TRIM)
  const bellM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(1.5) })
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16), bellM); bell.rotation.x = Math.PI / 2; bell.position.set(16.5, PORCH_Y + 17.5, -0.65); g.add(bell)
  const plate = new THREE.Mesh(rbox(3.4, 6, 0.3, 0.3), brass); plate.position.set(16.2, PORCH_Y + 29, -2.55); g.add(plate)
  // the porch lantern on its bracket, and the pool of light it throws on the wall and the floor
  A('metal', GU.box, -21, PORCH_Y + 35.5, -2.6, 0.6, 0.6, 4, '#1e1a14')
  A('metal', GU.box, -21, PORCH_Y + 36.2, -4.6, 3.8, 0.6, 3.8, '#1e1a14'); A('metal', GU.cone, -21, PORCH_Y + 37.4, -4.6, 2.8, 1.6, 2.8, '#1e1a14', null, Math.PI / 4)
  A('metal', GU.box, -21, PORCH_Y + 30.4, -4.6, 3.4, 0.6, 3.4, '#1e1a14')
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf80').multiplyScalar(1.45) })
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.8, 5.2, 2.8), lampM); glass.position.set(-21, PORCH_Y + 33.3, -4.6); g.add(glass)
  const poolM = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uOp: { value: 1 }, uCol: { value: new THREE.Color(1, 0.62, 0.3) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uOp; uniform vec3 uCol; varying vec2 vUv; void main(){ vec2 p = (vUv - .5) * 2.; p.y *= mix(1.6, .8, step(0., p.y)); float d = length(p); gl_FragColor = vec4(uCol * exp(-d * d * 3.2) * uOp * .55, 1.); }',
  })
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), poolM); pool.position.set(-21, PORCH_Y + 30, -0.12); pool.rotation.y = Math.PI; g.add(pool)
  const pool2 = new THREE.Mesh(new THREE.PlaneGeometry(36, 18), poolM); pool2.position.set(-14, PORCH_Y + 0.3, -4); pool2.rotation.x = -Math.PI / 2; g.add(pool2)
  // kolam on the step and a round one on the pavement beside it
  const kolamM = (tex) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 })
  const k1 = new THREE.Mesh(new THREE.PlaneGeometry(32, 4), kolamM(cityTex().kolamStrip)); k1.rotation.x = -Math.PI / 2; k1.position.set(0, STEP_Y + 0.3, -10); k1.receiveShadow = true; g.add(k1)
  const k2 = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), kolamM(cityTex().kolam)); k2.rotation.x = -Math.PI / 2; k2.position.set(40, SLAB + 0.06, -8.5); k2.receiveShadow = true; g.add(k2)
  // windows: curtained, lit from inside, with grilles, sunshades, sills and flower boxes
  const winTex = canvasTex(160, 200, (c, Wd, Hd) => {
    const gr = c.createLinearGradient(0, 0, 0, Hd); gr.addColorStop(0, '#ffe2a8'); gr.addColorStop(1, '#f0a050'); c.fillStyle = gr; c.fillRect(0, 0, Wd, Hd)
    c.fillStyle = 'rgba(255,250,235,.55)'; for (let x = 0; x < Wd; x += 8) c.fillRect(x, 0, 4, Hd)
    c.fillStyle = '#c2413a'; c.beginPath(); c.moveTo(0, 0); c.lineTo(46, 0); c.quadraticCurveTo(30, Hd * 0.5, 16, Hd); c.lineTo(0, Hd); c.fill()
    c.beginPath(); c.moveTo(Wd, 0); c.lineTo(Wd - 46, 0); c.quadraticCurveTo(Wd - 30, Hd * 0.5, Wd - 16, Hd); c.lineTo(Wd, Hd); c.fill()
    c.fillStyle = '#e8b33a'; c.fillRect(14, Hd * 0.52, 22, 5); c.fillRect(Wd - 36, Hd * 0.52, 22, 5)
    c.fillStyle = 'rgba(60,30,10,.55)'; c.beginPath(); c.ellipse(Wd / 2, Hd * 0.86, 16, 10, 0, 0, 6.3); c.fill(); c.fillRect(Wd / 2 - 8, Hd * 0.86, 16, 30)
    c.fillStyle = '#f4ead6'; c.fillRect(Wd / 2 - 3, 0, 6, Hd); c.fillRect(0, Hd * 0.38, Wd, 5); c.strokeStyle = '#f4ead6'; c.lineWidth = 10; c.strokeRect(0, 0, Wd, Hd)
  })
  const winM = new THREE.MeshStandardMaterial({ map: winTex, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.6, roughness: 0.25 })
  const winRow = [[-44, PORCH_Y + 20, 20, 25], [44, PORCH_Y + 20, 20, 25], [-40, PORCH_Y + H1 + 16, 18, 24], [0, PORCH_Y + H1 + 16, 18, 24], [40, PORCH_Y + H1 + 16, 18, 24]]
  for (const [x, y, w, h] of winRow) {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), winM); wm.position.set(x, y, -0.25); wm.rotation.y = Math.PI; g.add(wm)
    for (const s of [-1, 1]) A('plaster', GU.box, x + s * (w / 2 + 1), y, -0.9, 2, h + 4, 1.8, TRIM)
    A('plaster', GU.box, x, y + h / 2 + 1.2, -0.9, w + 4, 2, 1.8, TRIM)
    A('plaster', GU.box, x, y + h / 2 + 4.2, -3, w + 8, 1.2, 6, TRIM, null, 0, -0.1)
    A('plaster', GU.box, x, y - h / 2 - 1, -1.6, w + 5, 1.4, 3.4, TRIM)
    for (let k = 1; k < 5; k++) A('metal', GU.box, x - w / 2 + k * w / 5, y, -1.4, 0.45, h, 0.45, '#1e1a16')
    for (const yy of [-h / 4, h / 4]) A('metal', GU.box, x, y + yy, -1.4, w, 0.45, 0.45, '#1e1a16')
    if (y < PORCH_Y + 30) {
      A('plaster', GU.box, x, y - h / 2 - 4.2, -3.6, w + 2, 4, 5, TERRA)
      for (let k = 0; k < 9; k++) A('leaf', k % 3 ? GU.sph0 : GU.sph, x - w / 2 + 2 + k * (w - 4) / 8, y - h / 2 - 1.2 + (k % 2) * 0.8, -3.6 + (k % 3 - 1) * 1.2, k % 3 ? 1.1 : 1.6, k % 3 ? 1.1 : 1.3, k % 3 ? 1.1 : 1.6, k % 3 ? (k % 2 ? '#f28a12' : '#f2c21a') : '#3d6a2c')
    }
  }
  // the upper balcony with a railing, pots and a hanging fern
  A('plaster', GU.box, 0, PORCH_Y + H1 - 2.5, -6, W * 0.7, 1.6, 12, TRIM)
  A('cut', GU.plane, 0, PORCH_Y + H1 + 3.4, -11.8, W * 0.7, 9, 1, '#1d3a2a', strip(RS.rail, W * 0.7 / 16))
  A('metal', GU.box, 0, PORCH_Y + H1 + 8, -11.8, W * 0.7 + 1, 0.7, 1, '#1d3a2a')
  for (const x of [-36, -8, 26]) for (const [g2, m, c] of potParts(x > 0 ? 1 : 0, 0.8, true)) hb.add(g2 === GU.sph || g2 === GU.sph0 || g2 === GU.bush ? 'leaf' : 'plaster', g2, MO(x, PORCH_Y + H1 - 1.6, -8).multiply(m), c)
  // bougainvillea: up the right corner from a planter, over the balcony rail and along the canopy
  const br = rng(23)
  const flowerC = ['#c2185b', '#d81b7a', '#e04a9a', '#b0105a']
  const blob = (x, y, z, s) => { const fl = br() < 0.55; if (!hi && br() < 0.4) return; A('leaf', fl ? GU.sph0 : hi ? GU.bush : GU.sph, x, y, z, s * (fl ? 0.7 : 1.1) * (1 + br() * 0.5), s * (fl ? 0.6 : 0.9) * (1 + br() * 0.4), s * (fl ? 0.7 : 1) * (1 + br() * 0.5), fl ? flowerC[Math.floor(br() * 4)] : (br() < 0.5 ? '#2f5a24' : '#3d6a2c'), null, br() * 6) }
  A('plaster', GU.box, 58, SLAB + 4, -6, 12, 8, 10, '#d8c8a8')
  for (let k = 0; k < 70; k++) { const f = k / 70, x = 58 - f * 8 + Math.sin(k * 1.3) * 4, y = SLAB + 8 + f * (H1 + 4) + Math.sin(k) * 2, z = -6 + f * 3 + Math.sin(k * 2.1) * 2; blob(x, y, z, 2.4 - f * 0.6) }
  for (let k = 0; k < 40; k++) { const x = 44 - k * 1.2 + br() * 2, y = PORCH_Y + H1 + 8 - Math.abs(Math.sin(k * 0.7)) * 6 - br() * 3, z = -12.4 + br() * 1.5; blob(x, y, z, 1.8) }
  for (let k = 0; k < 26; k++) { const x = -24 + k * 0.6 * (k % 2 ? 1 : -1) * 0.2 - 2 + br() * 6, y = PORCH_Y + 50.6 + br() * 1.5 - (k % 5 === 0 ? 3 + br() * 4 : 0), z = -14 + br() * 12; blob(x - 4, y, z, 1.6) }
  // plants at a believable scale: a tulsi planter, pots by the door and on the step, a hibiscus bush
  hb.add('plaster', new THREE.CylinderGeometry(2.6, 3.4, 8, 4, 1), MO(29, SLAB + 5, -3.6, Math.PI / 4), '#f4ead6'); A('plaster', GU.box, 29, SLAB + 0.6, -3.6, 6.6, 1.2, 6.6, TERRA); A('plaster', GU.box, 29, SLAB + 9.3, -3.6, 5.2, 1, 5.2, TERRA)
  A('plaster', GU.box, 29, SLAB + 4.6, -6.15, 2, 2.6, 0.3, '#3a1a10'); A('glow', GU.sph0, 29, SLAB + 4.4, -6.4, 0.35, 0.6, 0.35, '#ffb040', RA.white)
  A('leaf', GU.bush, 29, SLAB + 12.4, -3.6, 2.4, 3.2, 2.4, '#4a6a2c'); A('leaf', GU.bush, 29.6, SLAB + 15, -3.2, 1.4, 1.8, 1.4, '#5a7a34')
  for (const [x, y, z, kind, s] of [[-17, PORCH_Y, -5, 0, 0.75], [17.5, PORCH_Y, -5.6, 1, 0.7], [-14, STEP_Y, -10.4, 1, 0.55], [13.6, STEP_Y, -10.4, 1, 0.55]]) for (const [g2, m, c] of potParts(kind, s, true)) hb.add(g2 === GU.sph || g2 === GU.sph0 || g2 === GU.bush ? 'leaf' : 'plaster', g2, MO(x, y, z).multiply(m), c)
  A('leaf', GU.bush, -31, SLAB + 6, -6, 6.4, 6, 4.4, '#2f6a28'); A('leaf', GU.bush, -28, SLAB + 10, -6.6, 3.6, 3.6, 3, '#3d7a30')
  for (let k = 0; k < 9; k++) A('leaf', GU.sph0, -31 + Math.cos(k * 1.9) * 4.6, SLAB + 6 + (k % 3) * 2.6, -9.6 + Math.sin(k * 1.9) * 1.2, 0.9, 0.9, 0.5, '#e0242a')
  // a ginger cat sitting on the pavement by the step, tail curling
  const cat = new THREE.Group(); cat.position.set(21, SLAB, -13.2); cat.rotation.y = -0.7; cat.scale.setScalar(0.8); g.add(cat)
  const catParts = [[new THREE.SphereGeometry(1, 12, 8), M(0, 2.2, 0, 0, 0, 0, 2.2, 2.8, 2.6), '#d8893a'], [new THREE.SphereGeometry(1, 12, 8), M(0, 5.6, -1.2, 0, 0, 0, 1.7, 1.6, 1.6), '#d8893a'], [new THREE.ConeGeometry(0.6, 1.3, 4), M(-0.9, 7.1, -1.2, 0, 0, 0.2), '#c0702a'], [new THREE.ConeGeometry(0.6, 1.3, 4), M(0.9, 7.1, -1.2, 0, 0, -0.2), '#c0702a'], [new THREE.SphereGeometry(1, 8, 6), M(0, 5.2, -2.6, 0, 0, 0, 0.8, 0.6, 0.5), '#f0d8b8'], [new THREE.SphereGeometry(1, 8, 6), M(-0.9, 0.5, -1.6, 0, 0, 0, 0.6, 0.5, 1), '#f0d8b8'], [new THREE.SphereGeometry(1, 8, 6), M(0.9, 0.5, -1.6, 0, 0, 0, 0.6, 0.5, 1), '#f0d8b8']]
  const catM = vc(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }))
  const catB = new THREE.Mesh(bake(catParts), catM); catB.castShadow = true; cat.add(catB)
  const tailPivot = new THREE.Group(); tailPivot.position.set(0, 1, 2.2); cat.add(tailPivot)
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 0.2, 2), new THREE.Vector3(2.4, 0.3, 2.6), new THREE.Vector3(3.4, 1.2, 1.4)]), 12, 0.45, 5), catM); tailPivot.add(tail)
  // the room behind the door: warm walls, a floor, a lamp, a framed picture, a side table with a plant
  const roomM = new THREE.MeshStandardMaterial({ color: '#f0c890', roughness: 0.9, map: T.wall, emissive: '#ffb060', emissiveIntensity: 0.0 })
  const room = new THREE.Group(); room.position.set(0, PORCH_Y, 0); g.add(room)
  const rm = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; room.add(m); return m }
  rm(new THREE.PlaneGeometry(24, 42), roomM, 0, 20, 44, Math.PI)
  rm(new THREE.PlaneGeometry(44, 42), roomM, -11.9, 20, 22, Math.PI / 2)
  rm(new THREE.PlaneGeometry(44, 42), roomM, 11.9, 20, 22, -Math.PI / 2)
  const fl = rm(new THREE.PlaneGeometry(24, 44), new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.5, map: T.panel }), 0, 0.1, 22); fl.rotation.x = -Math.PI / 2
  rm(new THREE.PlaneGeometry(9, 7), new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.6 }), 3, 24, 43.8, Math.PI)
  rm(new THREE.PlaneGeometry(7.4, 5.4), new THREE.MeshStandardMaterial({ color: '#f2e2b8', roughness: 0.8 }), 3, 24, 43.7, Math.PI)
  rm(new THREE.SphereGeometry(1.4, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd08a').multiplyScalar(4) }), -4, 36, 34)
  for (const [g2, m, c] of potParts(0, 0.9)) hb.add(g2 === GU.sph || g2 === GU.sph0 || g2 === GU.bush ? 'leaf' : 'plaster', g2, MO(-7, PORCH_Y, 38).multiply(m), c)
  // merge the house's static parts per material
  for (const [key, l] of hb.L) { const mesh = new THREE.Mesh(Batch.merge(l), mats[key]); mesh.castShadow = hi && key !== 'glow' && key !== 'leaf'; mesh.receiveShadow = true; g.add(mesh) }
  return { hinge, bell, glass, roomM, winM, poolM, tailPivot, group: g, room }
}
function woodTex() {
  return canvasTex(128, 256, (g, W, H) => {
    g.fillStyle = '#7a4522'; g.fillRect(0, 0, W, H)
    const r = rng(17)
    for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '40,18,6' : '160,96,52'},${0.08 + r() * 0.14})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = r() * W; g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 10, H * 0.3, x + (r() - 0.5) * 10, H * 0.7, x + (r() - 0.5) * 6, H); g.stroke() }
  })
}

// ---- Walking with planted feet ------------------------------------------------------------------------------------
/** A planted-foot walk from a to b (world xz) at progress w (0…1, eased by the caller). Each step lifts one foot,
 *  heel-off then heel-strike, onto the ground under it; the pelvis rides between the feet, bobs and sways. */
function gait(a, b, w, ground, { stride = 10.5, lead = 'L', width = 1.05, yaw = null } = {}) {
  const dx = b.x - a.x, dz = b.z - a.z, D = Math.max(0.001, Math.hypot(dx, dz))
  const dir = new THREE.Vector3(dx / D, 0, dz / D), left = new THREE.Vector3(dir.z, 0, -dir.x)
  const N = Math.max(1, Math.ceil(D / stride)), st = D / N, steps = N + 1
  const ph = clamp(w) * steps, k = Math.min(steps - 1, Math.floor(ph)), f = ph - k
  const at = (foot, j) => { let last = 0; for (let s = 1; s <= j; s++) if (((s % 2) === 1) === (foot === lead)) last = Math.min(s * st, D); return last }
  const out = { feet: {}, dir, left }
  let sum = 0
  for (const F of ['L', 'R']) {
    const from = at(F, k), to = at(F, k + 1), moving = to > from + 0.01 && w > 0 && w < 1
    const ff = moving ? f : 0
    const e = ff * ff * (3 - 2 * ff)
    const d = moving ? lerp(from, to, e) : (w >= 1 ? at(F, steps) : from)
    const p = a.clone().addScaledVector(dir, d).addScaledVector(left, F === 'L' ? width : -width)
    const g0 = ground(a.clone().addScaledVector(dir, from).x, a.clone().addScaledVector(dir, from).z), g1 = ground(a.clone().addScaledVector(dir, to).x, a.clone().addScaledVector(dir, to).z)
    const gy = moving ? lerp(g0, g1, smooth(0.25, 0.75, ff)) : ground(p.x, p.z)
    const lift = moving ? Math.sin(Math.PI * ff) * 1.5 + Math.max(0, g1 - g0) * Math.sin(Math.PI * Math.min(1, ff * 1.3)) : 0
    p.y = gy + 1.35 + lift
    const pitch = moving ? 0.55 * Math.sin(Math.PI * Math.min(1, ff * 1.6)) * (ff < 0.6 ? 1 : 0) - 0.32 * smooth(0.55, 0.85, ff) * (1 - smooth(0.9, 1, ff)) : 0
    out.feet[F] = { p, pitch, moving, d, toe: moving ? 0.5 * Math.sin(Math.PI * Math.min(1, ff * 2)) * (ff < 0.5 ? 1 : 0) : 0, ground: gy }
    sum += d
  }
  const walking = Math.min(1, w * steps * 1.2, (1 - w) * steps * 1.2)
  const mid = sum / 2 + (Math.sin(Math.PI * f) * 0.12 * st) * walking
  const swingL = out.feet.L.moving
  const sway = Math.sin(Math.PI * f) * 0.32 * (swingL ? -1 : 1) * walking
  const pel = a.clone().addScaledVector(dir, mid).addScaledVector(left, sway)
  const gmax = Math.max(out.feet.L.ground, out.feet.R.ground)
  out.hipY = gmax + 15.45 - 0.35 * walking - 0.35 * (1 - Math.sin(Math.PI * f)) * walking
  out.pos = pel
  out.yaw = yaw ?? Math.atan2(dir.x, dir.z)
  out.fwdL = (out.feet.L.d - mid) / st; out.fwdR = (out.feet.R.d - mid) / st
  out.walking = walking
  return out
}

const T_HI = (st) => st.tier.name === 'high'

export default class Door extends Stage {
  constructor(engine) {
    super(engine, { far: 5000 })
    const sc = this.scene, T = this.tier
    this.fov = 34
    this.frame = [0.16, 0]
    this.framePortrait = [0, -0.1]
    this.sky = skyDome(3600); sc.add(this.sky)
    const su = this.sky.userData.u
    su.uTop.value.set('#1c2e62'); su.uHor.value.set('#f0a070'); su.uBot.value.set('#1a1f2a')
    su.uClouds.value = 0.42; su.uCloudCol.value.set('#ffc090'); su.uCloudShade.value.set('#5a5470'); su.uStars.value = 0; su.uHaze.value = 0.8
    // evening: a low sun straight down the warehouse street, setting over the chapter
    this.sun.set(1, 0.12, -0.1).normalize()
    su.uSunDir.value.copy(this.sun); su.uSunCol.value.setRGB(1, 0.55, 0.25); su.uSunSize.value = 0.06
    this.sunCol.setRGB(1, 0.62, 0.34)
    sc.fog = new THREE.Fog('#b88a7a', 500, 2600)
    sc.environment = engine.env({ top: '#36588e', mid: '#d8a878', bottom: '#2a2622', sun: '#ffb070', sunDir: this.sun, sunPower: 3 })
    sc.environmentIntensity = 0.6

    this.sunL = new THREE.DirectionalLight('#ffc89a', 2.0)
    this.sunL.castShadow = true; this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    const sh = this.sunL.shadow.camera; sh.left = -110; sh.right = 110; sh.top = 110; sh.bottom = -110; sh.near = 10; sh.far = 520
    this.sunL.shadow.bias = -0.0005; this.sunL.shadow.normalBias = 0.5
    sc.add(this.sunL, this.sunL.target)
    this.fillL = new THREE.DirectionalLight('#c8d4ff', 0.8); sc.add(this.fillL, this.fillL.target)
    this.hemi = new THREE.HemisphereLight('#9fb4e0', '#4a3a30', 0.55); sc.add(this.hemi)

    this.U = { uLit: { value: 0 }, uLamp: { value: 1 }, uTime: { value: 0 } }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMaterial(this.U))
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground)

    // The route: along the street from the warehouse, two corners, to the kerb by the house.
    this.route = new THREE.CatmullRomCurve3([
      [-150, 0, 6], [-40, 0, 0], [200, 0, 0], [330, 0, 8], [405, 0, 70], [420, 0, 220], [420, 0, 620], [432, 0, 760], [500, 0, 832], [600, 0, 846], [672, 0, 852],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal')
    this.routeLen = this.route.getLength()
    this.mats = cityMaterials(this.U)
    this.city = buildCity(sc, T, this.U, this.route, this.mats)
    this.skyline = makeSkyline(sc, this.U)
    this.life = makeLife(sc, T, this.U, this.route, this.city.roofPeople)

    // The warehouse at the start: a plastered front with pilasters and the green band, two closed shutters and the
    // loading bay open on a lit room of racks and gold boxes, a platform, a canopy, the sign.
    {
      const wg = new THREE.Group(); sc.add(wg); this.warehouse = wg
      this.mats.glowWh = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.82, 0.78, 0.72), vertexColors: true, map: cityTex().atlas })
      const wb = new Batch(), A = (mat, g, x, y, z, sx, sy, sz, c, uv, ry = 0, rx = 0) => wb.add(mat, g, MO(x, y, z, ry, rx, sx, sy, sz), c, uv)
      const WC = '#e2cfa8', G = UNIFORM.green
      A('plaster', GU.box, -242.5, 45, -110, 115, 90, 120, WC); A('plaster', GU.box, -77.5, 45, -110, 75, 90, 120, WC)
      A('plaster', GU.box, -150, 69, -110, 70, 42, 120, WC); A('plaster', GU.box, -150, 24, -140, 70, 48, 60, WC)
      A('plaster', GU.box, -150, 0.2, -80, 70, 0.4, 60, '#6a5a48'); A('plaster', GU.box, -150, 47.8, -80, 70, 0.4, 60, '#8a7a64')
      A('glowWh', GU.plane, -150, 24, -109.8, 70, 48, 1, '#ffffff', RA.wh)
      for (const x of [-184.8, -115.2]) A('plaster', GU.box, x, 24, -80, 0.4, 48, 60, '#c8a878', 0)
      A('plaster', GU.box, -170, 4, -50, 262, 8, 2, '#8a7a68')
      A('plaster', GU.box, -170, 84, -50.5, 262, 7, 3, G); A('plaster', GU.box, -170, 90.6, -50.5, 264, 1.6, 4, CREAM)
      for (const x of [-298, -235, -190, -110, -46]) A('plaster', GU.box, x, 42, -49.2, 5, 84, 2.6, CREAM)
      for (const x of [-262, -72]) { A('atlas', GU.box, x, SLAB + 18, -49.6, 38, 34, 0.8, '#7f9a88', RA.shutter); A('plaster', GU.box, x, SLAB + 36.5, -49, 42, 2.4, 2.4, CREAM) }
      A('metal', GU.box, -150, 50.5, -51, 72, 5, 5, '#8a9496')
      A('metal', GU.box, -150, 2.4, -44, 80, 4.8, 12, '#5a5650'); A('metal', GU.box, -150, 4.9, -38, 80, 0.4, 0.6, '#e8b020')
      A('plaster', GU.box, -150, 58, -42, 90, 1.8, 18, G, null, 0, 0.12); A('glow', GU.box, -150, 56.6, -40, 50, 0.6, 1, '#ffffff', RA.white)
      for (const x of [-196, -104]) { A('metal', GU.box, x, 46, -48, 3, 4, 3, '#2a2a2a'); A('glow', GU.box, x, 43.6, -48, 2.4, 1.2, 2.4, '#ffd9a0', RA.white) }
      // inside: pallets of gold boxes, crates; hanging bulbs
      for (const [x, z, n] of [[-170, -78, 3], [-128, -92, 2], [-160, -100, 2]]) for (let k = 0; k < n; k++) { A('plaster', GU.box, x, 1.4, z, 16, 2.8, 12, '#8a6a44'); A('plaster', GU.box, x, 2.8 + 3.2 + k * 6.4, z, 14, 6.2, 10, UNIFORM.gold) }
      for (const x of [-170, -150, -130]) { A('metal', GU.cyl6, x, 44, -75, 0.1, 8, 0.1, '#222'); A('glow', GU.sph0, x, 39.5, -75, 1.4, 1.8, 1.4, '#fff0c8', RA.white) }
      // on the platform and the pavement: crates and gold boxes waiting
      for (const [x, y, z, c] of [[-196, SLAB + 2.8, -36, '#b07a48'], [-186, SLAB + 2.8, -36, '#b07a48'], [-191, SLAB + 8.4, -36, UNIFORM.gold], [-112, SLAB + 2.8, -34, UNIFORM.gold], [-104, SLAB + 2.8, -36, '#b07a48']]) A('plaster', GU.box, x, y, z, 9, 5.6, 7, c)
      for (const [key, l] of wb.L) { const m = new THREE.Mesh(Batch.merge(l), this.mats[key]); m.castShadow = key !== 'glow'; m.receiveShadow = true; wg.add(m) }
      const whSign = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ map: wordmarkTexture({ bg: UNIFORM.green }), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.15 }))
      whSign.position.set(-46, 66, -49.6); wg.add(whSign)
      this.dockLight = new THREE.PointLight('#ffb060', 900, 260, 1.5); this.dockLight.position.set(-150, 34, -62); sc.add(this.dockLight)
      this.bayPos = new THREE.Vector3(-150, 30, -70)
    }

    // The house.
    this.house = buildHouse(sc, this.mats, T.name === 'high')
    this.warm = new THREE.PointLight('#ffb460', 0, 160, 1.5); this.warm.position.copy(HOUSE).add(new THREE.Vector3(0, 30, 14)); sc.add(this.warm)
    this.faceLight = new THREE.PointLight('#ffc27a', 0, 60, 1.6); this.faceLight.position.copy(HOUSE).add(new THREE.Vector3(12, PORCH_Y + 31, -12)); sc.add(this.faceLight) // the porch light on both faces
    this.meetLight = new THREE.PointLight('#fff0dc', 0, 80, 1.6); sc.add(this.meetLight) // a soft key on the rider's face while we first meet him
    this.porch = new THREE.PointLight('#ffc070', 320, 130, 1.6); this.porch.position.copy(HOUSE).add(new THREE.Vector3(-21, PORCH_Y + 32, -8)); sc.add(this.porch)
    this.streetLamp = new THREE.PointLight('#ffc070', 500, 180, 1.5); this.streetLamp.position.set(PITCH * 2 - 120, 56, PITCH * 2 + 34); sc.add(this.streetLamp)
    this.bellPos = HOUSE.clone().add(new THREE.Vector3(16.5, PORCH_Y + 17.5, -0.9))
    this.doorGlow = HOUSE.clone().add(new THREE.Vector3(0, PORCH_Y + 26, 14))

    // The route line.
    const tube = new THREE.TubeGeometry(this.route, 400, 1.4, 6, false)
    tube.scale(1, 0.25, 1)
    this.routeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uHead: { value: 0 }, uTime: { value: 0 }, uOp: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0., .6, 0.), 1.); }',
      fragmentShader: /* glsl */ `uniform float uHead, uTime, uOp; varying vec2 vUv;
        void main(){ float x = vUv.x; float ahead = smoothstep(uHead, uHead + .02, x) * (1. - smoothstep(uHead + .1, uHead + .7, x));
          float behind = (1. - smoothstep(uHead - .01, uHead, x)) * .25;
          float dash = .55 + .45 * step(.5, fract(x * 160. - uTime * 1.5));
          gl_FragColor = vec4(vec3(1., .72, .2) * (ahead * dash * 2.2 + behind) * uOp, 1.); }`,
    })
    this.routeLine = new THREE.Mesh(tube, this.routeMat)
    // the crane's version: a warm trail lingering on the wet road behind him, a pool ahead, a faint gold line to the house
    { const t2 = new THREE.TubeGeometry(this.route, 400, 6, 6, false); t2.scale(1, 0.12, 1); this.routeMat2 = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uHead: { value: 0 }, uTime: { value: 0 }, uOp: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0., .5, 0.), 1.); }',
        fragmentShader: `uniform float uHead, uTime, uOp; varying vec2 vUv;
          void main(){ float d = uHead - vUv.x; float edge = 1. - abs(vUv.y * 2. - 1.); edge = edge * edge * 0.0 + 1.;
            float trail = step(0., d) * exp(-d * 22.) * 1.3;
            float pool = step(d, 0.) * exp(d * 70.) * 2.2;
            float future = step(d, 0.) * (.16 + .1 * step(.5, fract(vUv.x * 90. - uTime * .8)));
            gl_FragColor = vec4(vec3(1., .66, .3) * (trail + pool + future) * uOp, 1.); }`,
      }); this.routeWide = new THREE.Mesh(t2, this.routeMat2); this.routeWide.frustumCulled = false; sc.add(this.routeWide) }
    this.routeLine.frustumCulled = false
    sc.add(this.routeLine)

    // Haze lying low over the streets.
    this.mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color('#e8c0b0') }, uOp: { value: 0.3 } },
      vertexShader: 'varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: NOISE + /* glsl */ `uniform float uTime, uOp; uniform vec3 uCol; varying vec3 vWP;
        void main(){ float n = mmFbm2(vWP.xz * .006 + vec2(uTime * .01, uTime * .004)); float d = length(vWP.xz - cameraPosition.xz);
          float a = smoothstep(.35, .8, n) * uOp * smoothstep(60., 400., d); gl_FragColor = vec4(uCol, a); }`,
    })
    { const mist = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.mistMat); mist.rotation.x = -Math.PI / 2; mist.position.set(300, 14, 500); mist.renderOrder = 2; sc.add(mist) }

    // The scooter, the box, the rider, the loose helmet, the customer.
    this.scooter = makeScooter(); sc.add(this.scooter)
    this.box = makeBox(); sc.add(this.box)
    const lod = T.name === 'high' ? 0.78 : T.name === 'mid' ? 0.6 : 0.5 // two detailed people plus the street: full detail cost frames at the door
    this.person = new Person({ helmet: false, lod }); sc.add(this.person)
    this.looseHelmet = this.person.looseHelmet(); sc.add(this.looseHelmet)
    this.customer = new Person({ outfit: 'home', lod: lod * 0.85 }); sc.add(this.customer)
    // on smaller tiers the hands draw no shadow of their own
    if (T.name !== 'high') for (const who of [this.person, this.customer]) for (const k of ['wristL', 'wristR']) who.j[k]?.traverse((o) => { if (o.isMesh) o.castShadow = false })
    // A gold scarf that flutters behind him on the ride (a strip deformed every frame).
    const sg = new THREE.PlaneGeometry(1.4, 11, 1, 16); sg.translate(0, -5.5, 0)
    this.scarf = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: UNIFORM.gold, roughness: 0.7, side: THREE.DoubleSide }))
    this.scarf.castShadow = true
    this.scarfBase = sg.attributes.position.array.slice()
    this.person.j.chest.add(this.scarf)
    this.scarf.position.set(-0.9, 3.9, -1.5)

    this.dust = motes(Math.round(120 * T.particles + 30), new THREE.Box3(new THREE.Vector3(-200, 2, -100), new THREE.Vector3(800, 120, 950)), { size: 0.9, color: '#ffd9a8', drift: 4, opacity: 0.5, seed: 9 })
    sc.add(this.dust)
    this.tmp = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0)
  }

  /** Ground height (road 0, pavements, the step and the porch of the house). */
  ground(x, z) {
    const dx = x - HOUSE.x, dz = z - HOUSE.z
    if (Math.abs(dx) < 22 && dz > -7.2 && dz < 30) return PORCH_Y
    if (Math.abs(dx) < 17 && dz > -12.2 && dz <= -7.2) return STEP_Y
    const fx = ((x % PITCH) + PITCH) % PITCH, fz = ((z % PITCH) + PITCH) % PITCH
    return Math.abs(fx - PITCH / 2) < (BLOCK + 30) / 2 && Math.abs(fz - PITCH / 2) < (BLOCK + 30) / 2 ? SLAB : 0
  }

  /** Scooter pose on the route at u (0…1): position, heading, lean, steer. */
  ride(u, out) {
    const p = this.route.getPointAt(clamp(u, 0, 1))
    const tan = this.route.getTangentAt(clamp(u, 0.001, 0.999))
    const tan2 = this.route.getTangentAt(clamp(u + 0.02, 0.001, 0.999))
    let turn = Math.atan2(tan.x, tan.z) - Math.atan2(tan2.x, tan2.z)
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    out.p = p; out.yaw = Math.atan2(tan.x, tan.z); out.lean = clamp(turn * 6, -0.45, 0.45); out.tan = tan; out.turn = turn
    return out
  }

  update(i, tt, time, dt) {
    const t = clamp(tt, -0.2, 1)
    const P = this.person, C = this.customer, S = this.scooter, B = this.box, SU = S.userData
    // Beats.
    const rack = smoother(0.0, 0.07, t)          // box onto the rack
    const strap = smoother(0.06, 0.1, t)         // strap it
    const step1 = smoother(0.088, 0.112, t)      // a step forward to the helmet hook
    const helm = smoother(0.11, 0.155, t)        // helmet on
    const mount = smoother(0.155, 0.195, t)      // onto the scooter
    const glance = smooth(0.17, 0.185, t) * (1 - smooth(0.198, 0.215, t)) // over the right shoulder before pulling out
    const go = easeInOut(clamp((t - 0.2) / 0.38)) // ride (0.2–0.58)
    const standDown = Math.max(1 - smooth(0.195, 0.205, t), smooth(0.578, 0.59, t))
    const off = smoother(0.59, 0.615, t)         // off the scooter
    const toRack = smoother(0.612, 0.632, t)     // round to the rack
    const lift = smoother(0.632, 0.655, t)       // box off the rack, into both hands
    const walk = smoother(0.655, 0.75, t)        // to the door
    const ring = Math.sin(clamp((t - 0.752) / 0.034) * Math.PI) // balance the box, press the bell
    const open = smoother(0.77, 0.815, t)        // the door opens
    const give = smoother(0.81, 0.85, t)         // offered…
    const take = smoother(0.845, 0.875, t)       // …and taken
    const back = smoother(0.872, 0.905, t)       // he steps back
    const wave = smooth(0.88, 0.9, t) * (1 - smooth(0.985, 1, t))

    // ---- Scooter on the route ----
    const R = this.ride(go, {})
    const moving = go > 0 && go < 1
    const lean = R.lean * Math.sin(Math.PI * clamp(go)) * (moving ? 1 : 0)
    const speed = Math.max(0, Math.sin(Math.PI * clamp((t - 0.2) / 0.38)))
    S.position.copy(R.p)
    S.rotation.set(0, R.yaw, 0)
    S.rotateZ(-lean - 0.07 * standDown * (1 - (moving ? 1 : 0)))
    SU.chassis.position.y = Math.sin(time * 15) * 0.05 * speed + Math.sin(time * 6.3) * 0.03 * speed
    const steerA = moving ? clamp(R.turn * 5, -0.45, 0.45) * (1 - speed * 0.4) : (t < 0.2 ? 0.22 : 0.3)
    SU.steer.rotation.y = steerA
    S.updateMatrixWorld(true)
    const dist = go * this.routeLen
    SU.rear.rotation.x = dist / 4.25; SU.front.rotation.x = dist / 4.25
    SU.stand.rotation.set(lerp(-1.35, 0.42, standDown), 0, lerp(0, -0.38, standDown))
    const lightOn = smooth(0.15, 0.2, t) * (1 - smooth(0.585, 0.6, t))
    SU.spot.intensity = 900 * lightOn; SU.cone.visible = lightOn > 0.01; SU.cone.material.uniforms.uOp.value = lightOn
    SU.lens.material.color.setRGB(1, 0.95, 0.78).multiplyScalar(1 + lightOn * 6)
    this.routeMat.uniforms.uHead.value = go
    this.routeMat.uniforms.uOp.value = smooth(0.14, 0.22, t) * (1 - smooth(0.62, 0.7, t))
    this.routeMat.uniforms.uTime.value = time

    // ---- The rider ----
    const loc = (x, y, z) => SU.chassis.localToWorld(new THREE.Vector3(x, y, z))
    const yawS = R.yaw
    const g = (x, z) => this.ground(x, z)
    const blink = Person.blinkAt(time, 0)
    let feet = null, armSwing = null, base = { ...Person.STAND }
    let headTarget = null, headK = 0.75
    const seatRoot = loc(0, 2.3, -4.4)
    const boardFoot = (s) => loc(s * 2.5, 7.1, 2.4)
    if (t < 0.155) {
      // loading on the warehouse side of the scooter, facing it (and the camera): the box onto the rack, a look down
      // as he checks the strap, a look up the street, then the helmet off its hook and on
      const a = loc(10.5, 0, -11.5), b = loc(9.0, 0, -2.6)
      const face = yawS - Math.PI / 2
      const G = gait(a, b, step1, g, { stride: 10, lead: 'R', width: 1.1, yaw: lerp(face, face + 0.35, Math.sin(Math.PI * step1)) })
      P.position.set(G.pos.x, G.hipY - 15.45, G.pos.z)
      P.rotation.set(0, G.yaw, 0)
      feet = { L: G.feet.L, R: G.feet.R, yaw: G.yaw }
      const upStreet = smooth(0.098, 0.106, t) * (1 - smooth(0.112, 0.12, t))
      headTarget = t < 0.07 ? loc(0, 18, -14) : t < 0.1 ? B.localToWorld(new THREE.Vector3(4, 1 - strap * 4, 0)) : loc(2.6, 15, -0.6)
      if (upStreet > 0) headTarget = headTarget.clone().lerp(loc(-40, 27, -160), upStreet)
      if (helm > 0.3) headTarget = loc(-6, 24, 40)
      headK = 0.9
      // weight on one leg while he stands
      const still = 1 - Math.sin(Math.PI * step1)
      base = { ...base, hips: [0, 0, 0.06 * still], chest: [0.03, 0, -0.05 * still], spine: [0.04 + 0.06 * smooth(0.06, 0.075, t) * (1 - smooth(0.095, 0.105, t)), 0, 0] }
    } else if (t < 0.59) {
      // mounting, riding
      const a = loc(9.0, 0, -2.6)
      const k = mount
      const arc = Math.sin(Math.PI * clamp(k * 1.2)) * 2.2
      P.position.set(lerp(a.x, seatRoot.x, k), lerp(0, seatRoot.y, smooth(0.3, 1, k)) + arc, lerp(a.z, seatRoot.z, k))
      P.quaternion.setFromEuler(new THREE.Euler(0, lerp(yawS - Math.PI / 2, yawS, smooth(0, 0.6, k)), 0)).slerp(S.getWorldQuaternion(new THREE.Quaternion()), smooth(0.6, 1, k))
      // feet: he mounts from the warehouse side; one foot steps onto the board first, the other follows once seated
      const gl = loc(9.0 - 1.0, 0, -2.6 + 0.6), gr = loc(9.0 + 1.0, 0, -2.6 - 0.6)
      gl.y = 1.35; gr.y = 1.35
      const kl = smooth(0.05, 0.55, k), kr = smooth(0.55, 1, k)
      const fl = gl.clone().lerp(boardFoot(1), kl); fl.y += Math.sin(Math.PI * kl) * 4
      const fr = gr.clone().lerp(boardFoot(-1), kr); fr.y += Math.sin(Math.PI * kr) * 5
      feet = { L: { p: fl, pitch: 0, toe: 0 }, R: { p: fr, pitch: 0, toe: 0 }, yaw: lerp(yawS - Math.PI / 2, yawS, smooth(0, 0.6, k)), seated: k }
      base = { ...base, spine: [lerp(0.02, 0.24, k) + Math.sin(time * 6) * 0.008 * speed, 0, 0], chest: [lerp(0, 0.06, k), 0, -lean * 0.5] }
      const ahead = this.ride(clamp(go + 0.06), {}).p.clone().add(new THREE.Vector3(0, 24, 0))
      headTarget = k < 0.5 ? loc(0, 21, 6) : ahead
      if (glance > 0) headTarget = headTarget.clone().lerp(loc(-60, 24, -50), glance)
      headK = 0.8
    } else if (t < 0.655) {
      // off on the kerb side (his right), round to the rack, lift the box
      const a = loc(-9.0, 0, -4.0), b = loc(-9.5, 0, -14.0)
      if (off < 1) {
        const k = 1 - off
        const arc = Math.sin(Math.PI * clamp(k * 1.2)) * 2.0
        P.position.set(lerp(a.x, seatRoot.x, k), lerp(0, seatRoot.y, smooth(0.3, 1, k)) + arc, lerp(a.z, seatRoot.z, k))
        P.quaternion.setFromEuler(new THREE.Euler(0, lerp(yawS - Math.PI / 2, yawS, smooth(0, 0.6, k)), 0)).slerp(S.getWorldQuaternion(new THREE.Quaternion()), smooth(0.6, 1, k))
        const gr = loc(-10, 0, -3.4), gl = loc(-8, 0, -4.6); gr.y = 1.35; gl.y = 1.35
        const kr = smooth(0.05, 0.5, off), kl = smooth(0.5, 1, off)
        const fr = boardFoot(-1).lerp(gr, kr); fr.y += Math.sin(Math.PI * kr) * 4
        const fl = boardFoot(1).lerp(gl, kl); fl.y += Math.sin(Math.PI * kl) * 5
        feet = { L: { p: fl, pitch: 0, toe: 0 }, R: { p: fr, pitch: 0, toe: 0 }, yaw: lerp(yawS - Math.PI / 2, yawS, smooth(0, 0.6, k)), seated: k }
        headTarget = loc(-10, 16, -14)
      } else {
        const G = gait(a, b, toRack, g, { stride: 10, lead: 'L', width: 1.1, yaw: lerp(yawS - Math.PI / 2, yawS + Math.PI / 2 - 0.0, smooth(0.0, 1, toRack)) })
        P.position.set(G.pos.x, G.hipY - 15.45, G.pos.z)
        P.rotation.set(0, G.yaw, 0)
        feet = { L: G.feet.L, R: G.feet.R, yaw: G.yaw }
        armSwing = G
        headTarget = B.position.clone()
        base = { ...base, spine: [0.05 + lift * 0.0 + Math.sin(Math.PI * lift) * 0.25, 0, 0] }
      }
    } else {
      // the walk to the door with the box, the bell, the handover, a step back and a wave
      const a = loc(-9.5, 0, -14.0)
      const doorStand = HOUSE.clone().add(new THREE.Vector3(-1.5, 0, -6.8))
      const stepBack = HOUSE.clone().add(new THREE.Vector3(-13, 0, -9.5))
      let G
      if (back <= 0) {
        G = gait(a, doorStand, walk, g, { stride: 10.5, lead: 'L', width: 1.05 })
        G.yaw = lerp(G.yaw, 0.55 * smooth(0.8, 0.84, t), smooth(0.75, 1, walk))
      } else {
        G = gait(doorStand, stepBack, back, g, { stride: 7, lead: 'L', width: 1.05, yaw: lerp(0, 0.45, back) })
      }
      P.position.set(G.pos.x, G.hipY - 15.45, G.pos.z)
      P.rotation.set(0, G.yaw, 0)
      feet = { L: G.feet.L, R: G.feet.R, yaw: G.yaw }
      if (take > 0.6) armSwing = G
      const custFace = HOUSE.clone().add(new THREE.Vector3(0.5, PORCH_Y + 25.6, lerp(9, 1, smooth(0.79, 0.84, t)) - 1.2))
      headTarget = walk < 0.92 ? HOUSE.clone().add(new THREE.Vector3(0, 26, 0)) : ring > 0.05 ? this.bellPos : open > 0.3 ? (give > 0 && take < 0.5 ? B.position.clone().lerp(custFace, 0.5) : custFace) : HOUSE.clone().add(new THREE.Vector3(0, 30, 0))
      base = { ...base, spine: [0.04 + give * 0.08 * (1 - take), 0, 0] }
    }
    P.setHelmet(helm > 0.5)
    // ride pose details and arms swing
    base.smile = 0.45 + wave * 0.6 + open * 0.2
    base.blink = blink
    if (armSwing) {
      base.shoulderL = [-0.45 * armSwing.fwdR * armSwing.walking + 0.05, 0, 0.12]; base.shoulderR = [-0.45 * armSwing.fwdL * armSwing.walking + 0.05, 0, -0.12]
      base.elbowL = [-0.25 - 0.2 * Math.max(0, armSwing.fwdR) * armSwing.walking, 0, 0]; base.elbowR = [-0.25 - 0.2 * Math.max(0, armSwing.fwdL) * armSwing.walking, 0, 0]
      base.hips = [0, -0.1 * (armSwing.fwdL - armSwing.fwdR) * armSwing.walking, 0]; base.chest = [0.02, 0.08 * (armSwing.fwdL - armSwing.fwdR) * armSwing.walking, 0]
    }
    P.pose(base)
    P.updateMatrixWorld(true)
    // legs
    if (feet) {
      const seated = feet.seated || 0
      for (const s of ['L', 'R']) {
        const f = feet[s]
        const pole = seated > 0.5 ? loc(s === 'L' ? 6 : -6, 14, 14) : null
        P.foot(s, f.p, seated > 0.5 ? yawS : feet.yaw, f.pitch || 0, pole, f.toe || 0)
      }
    }
    P.updateMatrixWorld(true)

    // ---- The box: in his hands, onto the rack, strapped, rides, lifted off, carried, balanced, handed over ----
    const onRack = loc(0, 16.4 + 3.1, -14.6)
    const inHands = P.localToWorld(new THREE.Vector3(0, 17.6, 6.0))
    const onLeft = P.localToWorld(new THREE.Vector3(3.6, 16.4, 4.6))
    const handover = HOUSE.clone().add(new THREE.Vector3(-0.6, PORCH_Y + 18.6, -2.0))
    const custHold = C.localToWorld(new THREE.Vector3(0, 17.8, 5.6))
    const boxP = new THREE.Vector3()
    if (t < 0.6) boxP.copy(inHands).lerp(onRack, rack)
    else boxP.copy(onRack).lerp(inHands, lift)
    if (ring > 0) boxP.lerp(onLeft, ring)
    if (give > 0) boxP.lerp(handover, give)
    if (take > 0) boxP.lerp(custHold, take)
    B.position.copy(boxP)
    const qBody = new THREE.Quaternion().setFromAxisAngle(this.up, P.rotation.y)
    if (t < 0.6) B.quaternion.copy(qBody).slerp(S.getWorldQuaternion(new THREE.Quaternion()), rack)
    else B.quaternion.copy(S.getWorldQuaternion(new THREE.Quaternion())).slerp(qBody, lift)
    if (give > 0) B.quaternion.slerp(new THREE.Quaternion(), give)
    if (ring > 0) B.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.12 * ring))
    B.userData.strap.scale.set(1, Math.max(0.001, strap * (1 - lift)), 1)
    B.userData.strap.visible = strap > 0.01 && lift < 0.99

    // ---- Hands: by IK on the box sides, the strap, the helmet, the grips, the bell; a wave at the end ----
    const boxQ = B.quaternion
    const bx = (s) => B.localToWorld(new THREE.Vector3(s * 4.55, -0.9, -1.6))
    const sideQ = (s) => P.palmBasis(new THREE.Vector3(-s, 0.15, 0).applyQuaternion(boxQ), new THREE.Vector3(0, 0.35, 1).applyQuaternion(boxQ))
    const pole = (s) => P.localToWorld(new THREE.Vector3(s * 9, 12, -6))
    const grip = (s) => SU.steer.localToWorld(new THREE.Vector3(s * 6.0, 21.2, 5.2).applyMatrix4(SU.toSteer))
    const sq = S.getWorldQuaternion(new THREE.Quaternion())
    const gripQ = (s) => P.palmBasis(new THREE.Vector3(0, -1, 0.25).applyQuaternion(sq), new THREE.Vector3(-s, 0, 0.2).applyQuaternion(sq))
    const rest = (s) => P.localToWorld(new THREE.Vector3(s * 3.6, 11.0, 0.8))
    const restQ = (s) => P.palmBasis(new THREE.Vector3(-s, 0, 0).applyQuaternion(P.quaternion), new THREE.Vector3(0, -1, 0.1).applyQuaternion(P.quaternion))
    const hook = loc(2.6, 13.6, -0.6)
    const headTop = P.j.head.localToWorld(new THREE.Vector3(0, 0, 0))
    const hk = smoother(0.115, 0.15, t)
    this.looseHelmet.visible = helm < 0.5
    this.looseHelmet.position.copy(hook).add(new THREE.Vector3(0, -1.8, 0)).lerp(headTop, hk)
    this.looseHelmet.quaternion.copy(sq).slerp(P.j.head.getWorldQuaternion(new THREE.Quaternion()), hk)
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const carryK = Math.max(1 - smooth(0.066, 0.086, t), smooth(0.622, 0.64, t) * (1 - smooth(0.862, 0.878, t)))
      const carry = carryK > 0.5
      let p = rest(s), q = restQ(s)
      const useRest = !!armSwing && carryK <= 0
      if (carryK > 0) { p = p.clone().lerp(bx(s), carryK); q = q.clone().slerp(sideQ(s), carryK) }
      // helmet: both hands lift it from the hook and onto the head
      const hh = smooth(0.105, 0.12, t) * (1 - smooth(0.15, 0.165, t))
      if (hh > 0) { const hp = this.looseHelmet.position.clone().add(new THREE.Vector3(s * 2.7, 0.4, 0.3).applyQuaternion(this.looseHelmet.quaternion)); p = p.clone().lerp(hp, hh); q = q.clone().slerp(P.palmBasis(new THREE.Vector3(-s, 0.3, 0).applyQuaternion(P.quaternion), new THREE.Vector3(0, 1, 0.3).applyQuaternion(P.quaternion)), hh) }
      // strap: right hand runs it over the box
      if (s < 0 && strap > 0 && strap < 1) { const k = Math.sin(strap * Math.PI); const sp = B.localToWorld(new THREE.Vector3(-0.6, 4.2 - strap * 2, -4.2 + strap * 8)); p = p.clone().lerp(sp, k); q = q.clone().slerp(P.palmBasis(new THREE.Vector3(0, -1, 0).applyQuaternion(boxQ), new THREE.Vector3(0, 0, 1).applyQuaternion(boxQ)), k) }
      // riding: on the grips
      const gk = smooth(0.17, 0.198, t) * (1 - smooth(0.585, 0.6, t))
      if (gk > 0) { p = p.clone().lerp(grip(s), gk); q = q.clone().slerp(gripQ(s), gk) }
      // the bell (right hand); the box balanced on the left palm meanwhile
      if (s < 0 && ring > 0) { p = p.clone().lerp(this.bellPos.clone().add(new THREE.Vector3(0.2, -0.3, -1.4)), ring); q = q.clone().slerp(P.palmBasis(new THREE.Vector3(-0.3, 0, 1).normalize(), new THREE.Vector3(0.2, 0.3, 1)), ring) }
      if (s > 0 && ring > 0) { p = p.clone().lerp(B.localToWorld(new THREE.Vector3(0.6, -3.45, -0.6)), ring); q = q.clone().slerp(P.palmBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.3, 0, 1).applyQuaternion(boxQ)), ring) }
      // the wave (right)
      if (s < 0 && wave > 0) { const sw = Math.sin(time * 8) * 0.9; const wp = P.localToWorld(new THREE.Vector3(-5.8 + sw * 0.6, 27.5, 3.5)); p = p.clone().lerp(wp, wave); q = q.clone().slerp(P.palmBasis(new THREE.Vector3(0, 0, 1).applyQuaternion(P.quaternion), new THREE.Vector3(sw * 0.35, 1, 0).applyQuaternion(P.quaternion)), wave) }
      if (!(useRest && !(gk > 0) && !(hh > 0) && !(s < 0 && wave > 0))) P.reach(L, p, q, pole(s))
      P.pose({ ['curl' + L]: carry ? 0.5 : gk > 0.5 ? 0.85 : wave > 0.5 && s < 0 ? 0.05 : (s < 0 && ring > 0.5) ? 0.7 : 0.35, ['thumb' + L]: gk > 0.5 ? 0.9 : (s < 0 && ring > 0.5) ? 0.2 : 0.5, ['spread' + L]: wave > 0.5 ? 0.6 : 0.1 })
    }
    if (headTarget) P.lookAt(headTarget, headK, 1)

    // ---- The scarf flutters with speed ----
    const sitK = mount * (1 - off)
    const sp = this.scarf.geometry.attributes.position
    for (let k = 0; k < sp.count; k++) {
      const x0 = this.scarfBase[k * 3], y0 = this.scarfBase[k * 3 + 1]
      const along = -y0 / 11
      const bend = along * along * (2 + speed * 8)
      sp.setXYZ(k, x0 + Math.sin(time * 11 - along * 6) * along * speed * 1.6, y0 * (1 - speed * 0.5) + along * speed * 2, -bend - along * speed * 6 * sitK + Math.sin(time * 14 - along * 8) * along * speed * 1.2)
    }
    sp.needsUpdate = true; this.scarf.geometry.computeVertexNormals()
    this.scarf.visible = helm > 0.5 && t < 0.6

    // ---- The door, the warm light, the customer ----
    this.house.hinge.rotation.y = -open * 1.55
    this.warm.intensity = open * 300
    this.house.roomM.emissiveIntensity = 0.15 + open * 0.35
    this.house.bell.material.color.setRGB(1, 0.82, 0.48).multiplyScalar(1.5 + ring * 6)
    C.visible = open > 0.02
    C.position.copy(HOUSE).add(new THREE.Vector3(0.5, PORCH_Y, lerp(9, 1, smooth(0.79, 0.84, t))))
    C.rotation.set(0, Math.PI - 0.3 * smooth(0.8, 0.84, t), 0) // she opens a little towards the street
    const nod = t > 0.862 && t < 0.91 ? 0.17 * Math.sin(clamp((t - 0.862) / 0.048) * Math.PI) * Math.abs(Math.sin(clamp((t - 0.862) / 0.048) * Math.PI * 2)) : 0
    C.pose({ ...Person.STAND, spine: [0.03 + give * 0.06, 0, 0], smile: 0.4 + smooth(0.79, 0.84, t) * 0.5 + take * 0.3, blink: Person.blinkAt(time, 2.2) })
    C.updateMatrixWorld(true)
    for (const sd of [1, -1]) C.foot(sd > 0 ? 'L' : 'R', C.localToWorld(new THREE.Vector3(sd * 1.3, 1.35, 0)).setY(PORCH_Y + 1.35 * 0.94), Math.PI + sd * 0.1, 0)
    C.updateMatrixWorld(true)
    const handle = this.house.hinge.localToWorld(new THREE.Vector3(19, 19, 1.6))
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'
      const cq = C.getWorldQuaternion(new THREE.Quaternion())
      let p = C.localToWorld(new THREE.Vector3(s * 3.5, 10.5, 0.8)), q = C.palmBasis(new THREE.Vector3(-s, 0, 0).applyQuaternion(cq), new THREE.Vector3(0, -1, 0.1).applyQuaternion(cq))
      // her right hand on the inner handle as the door swings open
      const hd = smooth(0.762, 0.78, t) * (1 - smooth(0.812, 0.83, t))
      if (s < 0 && hd > 0) { p = p.clone().lerp(handle, hd); q = q.clone().slerp(C.palmBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -0.2, 1).applyQuaternion(cq)), hd) }
      const reachK = smoother(0.826, 0.856, t)
      if (reachK > 0) {
        const bp = B.localToWorld(new THREE.Vector3(s * -4.55, -0.9, 1.7)) // her left is the box's -x (she faces him)
        const bq = C.palmBasis(new THREE.Vector3(s, 0.15, 0).applyQuaternion(boxQ), new THREE.Vector3(0, 0.35, -1).applyQuaternion(boxQ))
        p = p.clone().lerp(bp, reachK); q = q.clone().slerp(bq, reachK)
      }
      C.reach(L, p, q, C.localToWorld(new THREE.Vector3(s * 9, 12, -6)))
      C.pose({ ['curl' + L]: reachK > 0.5 ? 0.5 : 0.3, ['thumb' + L]: 0.5, ['spread' + L]: 0.15 })
    }
    C.lookAt(P.j.head.localToWorld(new THREE.Vector3(0, 1.98, 1.0)), 0.85, 1)
    C.j.head.rotation.x += nod
    P.j.head.rotation.x += 0.14 * Math.sin(clamp((t - 0.85) / 0.04) * Math.PI) // his small nod as she takes it

    // ---- Light: the last gold of the day turning to blue hour ----
    const dusk = smooth(-0.1, 1, t), set = smooth(0, 0.62, t), k3s = smoother(0.52, 0.62, t)
    const el = 0.16 - 0.22 * Math.pow(clamp(t / 0.7), 1.5)
    this.sun.set(1, el, -0.1).normalize()
    const lampOn = smooth(0.06, 0.4, t), lit = lerp(0.1, 0.62, smooth(0.04, 0.8, t))
    const su = this.sky.userData.u
    su.uSunDir.value.copy(this.sun); su.uStars.value = lerp(0, 0.45, smooth(0.55, 1, t)); su.uTime.value = time
    const c3 = (a, b, c, k) => (k < 0.5 ? a.clone().lerp(b, k * 2) : b.clone().lerp(c, k * 2 - 1))
    const V = (r, g, b) => new THREE.Color(r, g, b)
    su.uTop.value.copy(c3(V(0.08, 0.15, 0.42), V(0.05, 0.09, 0.28), V(0.025, 0.04, 0.13), dusk))
    su.uHor.value.copy(c3(V(1, 0.68, 0.3), V(1, 0.54, 0.34), V(0.46, 0.36, 0.5), dusk)); su.uHaze.value = lerp(0.45, 0.3, dusk)
    su.uSunCol.value.copy(c3(V(1, 0.55, 0.22), V(1, 0.36, 0.18), V(0.7, 0.26, 0.24), dusk))
    su.uCloudCol.value.copy(c3(V(1, 0.72, 0.48), V(1, 0.52, 0.5), V(0.42, 0.34, 0.48), dusk)); su.uCloudShade.value.copy(c3(V(0.42, 0.34, 0.44), V(0.3, 0.24, 0.36), V(0.1, 0.1, 0.18), dusk))
    su.uSunGlow.value = lerp(0.6, 0.5, dusk)
    this.sunCol.copy(c3(V(1, 0.62, 0.34), V(1, 0.48, 0.34), V(0.62, 0.58, 0.86), dusk))
    this.sunL.intensity = Math.max(3.4 * smooth(-0.01, 0.09, el), 0.4)
    this.hemi.intensity = lerp(0.48, 0.62, dusk)
    this.hemi.color.copy(c3(V(0.6, 0.68, 0.9), V(0.46, 0.55, 0.88), V(0.36, 0.46, 0.85), dusk)); this.hemi.groundColor.setRGB(lerp(0.36, 0.2, dusk), lerp(0.26, 0.17, dusk), lerp(0.2, 0.18, dusk))
    const fogC = c3(V(0.72, 0.5, 0.36), V(0.55, 0.4, 0.42), V(0.24, 0.27, 0.42), dusk)
    this.scene.fog.color.copy(fogC); this.scene.fog.near = lerp(700, 380, dusk); this.scene.fog.far = lerp(4200, 2300, dusk)
    this.scene.environmentIntensity = lerp(0.45, 0.35, dusk)
    this.U.uLit.value = lit; this.U.uLamp.value = lerp(0.12, 1, lampOn); this.U.uTime.value = time
    this.city.headMat.color.setRGB(1, 0.75, 0.44).multiplyScalar(0.6 + 2.6 * lampOn)
    this.city.bulbMat.color.setScalar(0.4 + 2.6 * lampOn)
    this.mats.glow.color.setScalar(1.05 + 1.1 * lampOn)
    this.skyline.forEach((m, i) => { m.uniforms.uHaze.value.copy(su.uHor.value).lerp(fogC, 0.3); m.uniforms.uCol.value.copy(c3(V(0.2, 0.15, 0.24), V(0.13, 0.11, 0.2), V(0.05, 0.06, 0.12), dusk)).lerp(fogC, i * 0.12) })
    this.city.spillMat.uniforms.uOp.value = 0.25 + lampOn
    // the crane: festoons, lamp pools and above all the scooter's headlight path read strongly
    const crane = smooth(0.38, 0.44, t) * (1 - smooth(0.56, 0.6, t))
    this.city.bulbMat.color.multiplyScalar(1 - 0.5 * crane).lerp(V(0.55, 0.62, 0.8), 0.35 * crane); this.U.uLamp.value *= 1 - 0.5 * crane; this.city.headMat.color.multiplyScalar(1 - 0.5 * crane)
    this.house.glass.material.color.setRGB(1, 0.81, 0.5).multiplyScalar(1.45 + 3 * crane)
    this.routeMat.uniforms.uOp.value *= 1 + 1.6 * crane; { const u2 = this.routeMat2.uniforms; u2.uHead.value = this.routeMat.uniforms.uHead.value; u2.uTime.value = time; u2.uOp.value = crane; this.routeWide.visible = crane > 0.01 } SU.spot.intensity *= (1 + 2 * crane) * (1 - 0.6 * smoother(0.255, 0.305, t) * (1 - smoother(0.33, 0.42, t))); SU.cone.material.uniforms.uOp.value *= (1 + crane) * (1 - 0.9 * smoother(0.255, 0.305, t) * (1 - smoother(0.33, 0.42, t)))
    this.mistMat.uniforms.uTime.value = time; this.mistMat.uniforms.uOp.value = lerp(0.3, 0.2, dusk) * (1 - k3s); this.mistMat.uniforms.uCol.value.copy(fogC).lerp(su.uHor.value, 0.4)
    P.rimU.uRimCol.value.setRGB(1, lerp(0.7, 0.8, dusk), lerp(0.5, 0.62, dusk)); P.rimU.uRim.value = lerp(0.45, 0.3, dusk)
    C.rimU.uRimCol.value.setRGB(1, 0.8, 0.6); C.rimU.uRim.value = 0.3
    this.life.update(t, time)
    this.house.tailPivot.rotation.set(Math.sin(time * 1.3) * 0.12, Math.sin(time * 1.7) * 0.35, 0)
    this.house.poolM.uniforms.uOp.value = 0.25 + 0.35 * lampOn
    this.porch.intensity = 120 + 260 * lampOn
    this.faceLight.intensity = 140 * smooth(0.76, 0.82, t)
    this.dockLight.intensity = t < 0.47 ? 600 : 0
    this.warehouse.visible = t < 0.47
    this.house.room.visible = t > 0.5
    this.life.steam.visible = t < 0.47

    // ---- Camera ----
    const cam = new THREE.Vector3(), look = new THREE.Vector3()
    const side = new THREE.Vector3(Math.cos(R.yaw), 0, -Math.sin(R.yaw))
    const fwd = new THREE.Vector3(Math.sin(R.yaw), 0, Math.cos(R.yaw))
    // A: loading at the warehouse.
    const cA = loc(-26, 30, -52), lA = loc(10, 21, -6)
    // B1: tracking alongside.
    const cB = R.p.clone().add(side.clone().multiplyScalar(-68)).add(fwd.clone().multiplyScalar(10)).add(new THREE.Vector3(0, 20, 0)), lB = R.p.clone().add(new THREE.Vector3(0, 16, 0)).add(fwd.clone().multiplyScalar(9))
    // the ride-off: swing round behind his shoulder to look down the street into the afterglow
    { const kc = smoother(0.255, 0.305, t); this.fov = lerp(34, 46, kc * (1 - smoother(0.33, 0.4, t))); cB.lerp(R.p.clone().addScaledVector(fwd, -58).addScaledVector(side, -22).add(new THREE.Vector3(0, 27, 0)), kc); lB.lerp(R.p.clone().addScaledVector(fwd, 150).addScaledVector(side, this.camera.aspect < 1 ? 10 : -14).add(new THREE.Vector3(0, 40, 0)), kc) }
    // B2: above the rooftops.
    const cC = R.p.clone().add(new THREE.Vector3(-60, 500, -110)).add(fwd.clone().multiplyScalar(-70)), lC = R.p.clone().add(fwd.clone().multiplyScalar(55))
    // C/D: the door, three-quarter view from the street.
    const cD = HOUSE.clone().add(new THREE.Vector3(56, 30, -88)), lD = HOUSE.clone().add(new THREE.Vector3(-8, 21, -22))
    // E/F: close on the handover, then into the warm doorway.
    // E: a two-shot from the side: both faces and the box between them, the open door and the lit room behind
    const por = this.camera.aspect < 1
    const cE = HOUSE.clone().add(por ? new THREE.Vector3(48, 30, -34) : new THREE.Vector3(36, 26, -21)), lE = HOUSE.clone().add(new THREE.Vector3(por ? -5 : -12, por ? 21 : 23, -5))
    const cF = HOUSE.clone().add(new THREE.Vector3(-4, 29, -17)), lF = HOUSE.clone().add(new THREE.Vector3(0.5, 23, 6))
    const k1 = smoother(0.17, 0.25, t), k2 = smoother(0.33, 0.42, t), k3 = smoother(0.52, 0.62, t), k4 = smoother(0.745, 0.86, t), k5 = smoother(0.9, 1.0, t)
    cam.copy(cA).lerp(cB, k1).lerp(cC, k2).lerp(cD, k3).lerp(cE, k4).lerp(cF, k5)
    look.copy(lA).lerp(lB, k1).lerp(lC, k2).lerp(lD, k3).lerp(lE, k4).lerp(lF, k5)
    aim(this.camera, cam, look, -lean * 0.15 * (1 - k2))
    // the opening: his face is turned away from the lit bay, so give it a gentle key from the camera's side
    { const hp = P.j.head.getWorldPosition(this.tmpH || (this.tmpH = new THREE.Vector3())); this.meetLight.position.copy(cam).sub(hp).normalize().multiplyScalar(26).add(hp); this.meetLight.position.y += 8; this.meetLight.intensity = 400 * (1 - smooth(0.19, 0.27, t)) }
    // detail tiles far from the camera are not drawn (a pure function of the camera, so of t)
    { const cp = this.camera.position, lim = T_HI(this) ? 1150 : (k2 > 0.5 && k3 < 0.5 ? 560 : 700); for (const m of this.city.tiles) { const sp = m.userData.sphere; if (sp) m.visible = sp.center.distanceTo(cp) - sp.radius < lim } }
    const subject = k3 > 0.5 ? B.position : P.j.chest.getWorldPosition(this.tmp)
    this.post.focus = cam.distanceTo(subject); this.post.range = lerp(40, 25, k4); this.post.dof = lerp(3, 8, k4) * (1 - k2 * (1 - k3))
    this.focus.copy(B.position)
    // landscape: keep the rider to the right of and below the headline (top-left) while loading and riding off
    this.frame = [lerp(lerp(lerp(0.2, 0.42, k1), 0.1, k2), 0.16, k3), lerp(lerp(lerp(-0.04, -0.17, k1), -0.05, k2), 0, k3)]
    this.framePortrait = k1 < 0.5 ? [0.1, -0.08] : [0, -0.1]

    // Shadows follow the action.
    const center = k3 > 0.5 ? HOUSE : R.p
    this.sunL.position.copy(center).add(this.sun.clone().multiplyScalar(260)); this.sunL.target.position.copy(center)
    this.sunL.color.copy(this.sunCol)
    { const wide = k2 > 0.5 && k3 < 0.5, ext = wide && T_HI(this) ? 300 : 110, cs = this.sunL.shadow.camera; for (const m of this.city.tiles) if (m.userData.caster) m.castShadow = !wide; if (cs.right !== ext) { cs.left = cs.bottom = -ext; cs.right = cs.top = ext; cs.far = wide ? 1400 : 520; cs.updateProjectionMatrix() } if (wide) this.sunL.position.copy(center).add(this.sun.clone().multiplyScalar(700)) }
    this.look.bloom = lerp(0.5, 0.36, k3); this.look.threshold = lerp(1.0, 1.15, k3); this.look.exposure = lerp(0.95, 1.04, dusk) - k4 * 0.04; this.look.vig = 0.6
    this.grade([0.0, lerp(0.012, 0.016, dusk), lerp(0.03, 0.05, dusk)], [1.04, 0.99, lerp(0.92, 0.97, dusk)], 1.1)
    // light shafts: from the low sun behind the warehouse street, then from the porch lantern and the open door
    const doorRays = smooth(0.56, 0.64, t)
    if (doorRays > 0) {
      this.rayFrom = open > 0.2 ? this.doorGlow : this.house.glass.getWorldPosition(this.tmp2 || (this.tmp2 = new THREE.Vector3()))
      this.look.rays = lerp(0.18, 0.6, open) * doorRays; this.look.rayThreshold = 1.4; this.look.rayTint.setRGB(1, 0.78, 0.5)
    } else {
      this.rayFrom = null
      this.look.rays = lerp(0.45, 0.28, smooth(0.25, 0.3, t)) * (1 - k2) * smooth(-0.02, 0.06, el); this.look.rayThreshold = lerp(1.25, 1.7, smooth(0.25, 0.3, t)); this.look.rayTint.setRGB(1, 0.72, 0.45)
    }
    // the ride-off looks straight at the low sun and oncoming lamps: hold the bloom and shafts down so the street stays readable
    { const ck = smoother(0.255, 0.305, t) * (1 - smoother(0.33, 0.4, t)); this.look.bloom *= 1 - 0.55 * ck; this.look.threshold += 0.6 * ck; this.look.rays *= 1 - 0.7 * ck; this.look.exposure *= 1 - 0.08 * ck }
    this.fillL.position.copy(cam).add(new THREE.Vector3(0, 40, 0)); this.fillL.target.position.copy(subject)
    this.fillL.intensity = lerp(0.7, 0.9, dusk); this.fillL.color.setRGB(lerp(0.85, 0.72, dusk), lerp(0.85, 0.8, dusk), 1)
    this.dust.userData.u.uTime.value = time
  }
}
