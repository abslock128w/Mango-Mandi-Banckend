// Chapter 11 "Then it finishes ripening with you." A kitchen counter by a window. The box opens and our mango goes into
// a bowl; four days pass as sunlight sweeps across the room through the window bars (the mango's ripeness rises to gold
// with a blush); then it is cut: lying flat on a board, a knife passes through, the top cheek turns over, is scored
// into a grid and pushed inside out into the "hedgehog", juice catching the light.
// The room is a morning kitchen: a tiled backsplash, a window with a curtain stirring and a plant on the sill, a branch
// outside whose leaves throw moving shadows across the counter, a soft shaft of light with dust, a steel tumbler of chai
// steaming, the knife waiting on its board. The light warms day by day as the fruit deepens to gold, and at the end it
// glows faintly.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Stage, aim, motes } from './stage.js'
import { Mango, mangoOutline, mangoMaterial, leafGeometry, leafMaterial, leafDepthMaterial } from '../lib/mango.js'
import { beamMaterial, beam, glints, bokeh } from './grade.js'
import { kraftTexture, drawWordmark, strawMesh, woodTexture } from './crate-kit.js'
import { canvasTex, rng, clamp, lerp, smooth, smoother, easeInOut, expoOut, inv } from '../lib/util.js'

const DAYS = 4
const BOARD = new THREE.Vector3(4.8, 0.32, 2.2)
const BOWL = new THREE.Vector3(-0.6, 0, -0.2)
const CUT = 0.1 // the cut plane, just off the seed

/** Flesh: deep gold, juicy (clearcoat), a little glow for the light inside it. */
function fleshMaterial(map = null) {
  return new THREE.MeshPhysicalMaterial({ color: map ? '#ffffff' : '#ffa21a', map, roughness: 0.5, clearcoat: 0.28, clearcoatRoughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ffe0a0'), emissive: new THREE.Color('#ff7a00'), emissiveIntensity: 0.06 })
}

function fleshTexture(withSeed) {
  return canvasTex(512, 512, (g, W, H) => {
    const grd = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.55)
    grd.addColorStop(0, '#ffc23a'); grd.addColorStop(0.7, '#ffa418'); grd.addColorStop(1, '#f08a10')
    g.fillStyle = grd; g.fillRect(0, 0, W, H)
    const r = rng(withSeed ? 3 : 4)
    g.lineCap = 'round'
    for (let i = 0; i < 900; i++) { // fibres radiating from the seed
      const a = r() * Math.PI * 2, r0 = 40 + r() * 120, l = 20 + r() * 60
      g.strokeStyle = r() < 0.5 ? `rgba(255,220,120,${0.08 + r() * 0.12})` : `rgba(210,110,0,${0.06 + r() * 0.1})`
      g.lineWidth = 1 + r() * 2
      g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0 * 0.7, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * (r0 + l) * 0.7, H / 2 + Math.sin(a) * (r0 + l)); g.stroke()
    }
    if (withSeed) {
      g.fillStyle = '#f6dc9a'; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.17, H * 0.3, 0, 0, 7); g.fill()
      g.strokeStyle = 'rgba(180,130,60,.6)'; g.lineWidth = 3; g.stroke()
      for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(200,150,70,${0.2 + r() * 0.3})`; g.lineWidth = 1; const y = H / 2 + (r() - 0.5) * H * 0.5; g.beginPath(); g.moveTo(W / 2 - W * 0.12, y); g.quadraticCurveTo(W / 2, y + (r() - 0.5) * 20, W / 2 + W * 0.12, y); g.stroke() }
    }
  })
}

export default class Counter extends Stage {
  constructor(engine) {
    super(engine, { near: 0.1, far: 300 })
    engine.renderer.localClippingEnabled = true
    const sc = this.scene, T = this.tier
    this.fov = 32
    this.frame = [0.19, -0.07]
    this.framePortrait = [0, -0.16]
    sc.background = new THREE.Color('#e9dcc2')

    // Room: counter (warm terrazzo-like stone), back wall with a window opening (four blocks), mullions.
    const stone = canvasTex(1024, 512, (g, W, H) => {
      g.fillStyle = '#f0dfc0'; g.fillRect(0, 0, W, H)
      const r = rng(31)
      for (let i = 0; i < 2600; i++) { const c = ['#e6d0aa', '#d8bc90', '#fbf2e0', '#c8a878', '#ecd2a4'][Math.floor(r() * 5)]; g.fillStyle = c; g.globalAlpha = 0.25 + r() * 0.5; g.beginPath(); g.ellipse(r() * W, r() * H, 1 + r() * 4, 1 + r() * 3, r() * 3, 0, 7); g.fill() }
      g.globalAlpha = 1
    }, { repeat: true })
    stone.repeat.set(3, 1.5)
    const counterM = new THREE.MeshPhysicalMaterial({ map: stone, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.25 })
    const top = new THREE.Mesh(new RoundedBoxGeometry(44, 1.2, 15, 3, 0.25), counterM)
    top.position.set(0, -0.6, 0); top.receiveShadow = true; sc.add(top)
    const front = new THREE.Mesh(new THREE.BoxGeometry(44, 12, 0.5), new THREE.MeshStandardMaterial({ color: '#2a5a3e', roughness: 0.7 }))
    front.position.set(0, -7.2, 7.2); sc.add(front)
    const wallM = new THREE.MeshStandardMaterial({ color: '#efe3cc', roughness: 0.95, emissive: '#f3e6cc', emissiveIntensity: 0.32 })
    const WX0 = -3, WX1 = 9, WY0 = 1.0, WY1 = 11.5, WZ = -7.5
    const wall = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.8), wallM); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, WZ); m.castShadow = true; m.receiveShadow = true; sc.add(m) }
    wall(-40, WX0, -1, 30); wall(WX1, 40, -1, 30); wall(WX0, WX1, -1, WY0); wall(WX0, WX1, WY1, 30)
    const frameM = new THREE.MeshStandardMaterial({ color: '#f7f1e4', roughness: 0.6 })
    const bar = (x, y, w, h, d = 0.5) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameM); m.position.set(x, y, WZ + 0.1); m.castShadow = true; sc.add(m) }
    bar((WX0 + WX1) / 2, (WY0 + WY1) / 2, 0.32, WY1 - WY0); bar((WX0 + WX1) / 2, (WY0 + WY1) / 2, WX1 - WX0, 0.32)
    bar(WX0 + 0.2, (WY0 + WY1) / 2, 0.4, WY1 - WY0); bar(WX1 - 0.2, (WY0 + WY1) / 2, 0.4, WY1 - WY0); bar((WX0 + WX1) / 2, WY0 + 0.15, WX1 - WX0, 0.35, 1.4); bar((WX0 + WX1) / 2, WY1 - 0.2, WX1 - WX0, 0.4)
    // Outside the window: a bright garden, out of focus.
    const outside = canvasTex(512, 512, (g, W, H) => {
      // A garden in soft focus: a patch of sky, a tree (trunk and a branch), leaves in layers from far and pale to near
      // and dark, sunlit clusters, a few flowers low down. It is far and blurred, so it is painted soft.
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#dfeaf0'); grd.addColorStop(0.35, '#eef0dc'); grd.addColorStop(1, '#9cb27a')
      g.fillStyle = grd; g.fillRect(0, 0, W, H)
      // only the band the window shows (canvas y 0.3–0.82) matters: draw the garden into it
      g.save(); g.translate(0, H * 0.28); g.scale(1, 0.56)
      const r = rng(5)
      const blob = (x, y, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, r() * 3, 0, 7); g.fill() }
      g.filter = 'blur(10px)'
      for (let i = 0; i < 26; i++) blob(r() * W, H * (0.45 + r() * 0.3), 60 + r() * 80, 40 + r() * 50, `rgba(${120 + r() * 40},${160 + r() * 30},${100 + r() * 30},.55)`) // far trees, hazy
      g.filter = 'blur(5px)'
      g.fillStyle = '#5a4630'; g.beginPath(); g.moveTo(W * 0.62, H); g.bezierCurveTo(W * 0.64, H * 0.7, W * 0.6, H * 0.45, W * 0.66, H * 0.18); g.lineTo(W * 0.71, H * 0.2); g.bezierCurveTo(W * 0.67, H * 0.48, W * 0.7, H * 0.72, W * 0.7, H); g.fill() // trunk
      g.strokeStyle = '#5a4630'; g.lineWidth = 14; g.beginPath(); g.moveTo(W * 0.66, H * 0.42); g.quadraticCurveTo(W * 0.45, H * 0.3, W * 0.22, H * 0.34); g.stroke() // branch
      g.lineWidth = 8; g.beginPath(); g.moveTo(W * 0.68, H * 0.3); g.quadraticCurveTo(W * 0.82, H * 0.2, W * 0.98, H * 0.24); g.stroke()
      for (let i = 0; i < 60; i++) { const x = W * (0.1 + r() * 0.9), y = H * (0.05 + r() * 0.45); blob(x, y, 22 + r() * 40, 16 + r() * 28, `rgba(${40 + r() * 30},${90 + r() * 40},${35 + r() * 20},${0.55 + r() * 0.3})`) } // canopy
      for (let i = 0; i < 40; i++) { const x = W * (0.15 + r() * 0.85), y = H * (0.08 + r() * 0.4); blob(x, y, 8 + r() * 18, 6 + r() * 12, `rgba(${200 + r() * 40},${225 + r() * 25},${120 + r() * 50},${0.5 + r() * 0.4})`) } // sunlit leaves
      g.filter = 'blur(3px)'
      for (let i = 0; i < 30; i++) blob(r() * W, H * (0.72 + r() * 0.3), 30 + r() * 50, 20 + r() * 30, `rgba(${30 + r() * 25},${70 + r() * 35},${25 + r() * 20},${0.7 + r() * 0.25})`) // near bushes, dark
      for (let i = 0; i < 18; i++) blob(r() * W, H * (0.75 + r() * 0.2), 5 + r() * 5, 5 + r() * 5, r() < 0.6 ? 'rgba(255,170,40,.85)' : 'rgba(235,90,100,.75)')
      g.filter = 'none'
      g.restore()
    })
    this.outsideM = new THREE.MeshBasicMaterial({ map: outside, color: new THREE.Color(1.6, 1.55, 1.4) })
    const out = new THREE.Mesh(new THREE.PlaneGeometry(22, 10), this.outsideM)
    out.position.set((WX0 + WX1) / 2, 4.2, WZ - 4); sc.add(out)
    // A shelf and a jar on the wall, a plant on the counter, for a lived-in room (kept simple and soft).
    const shelf = new THREE.Mesh(new RoundedBoxGeometry(10, 0.4, 2.2, 2, 0.1), new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#d9b080', roughness: 0.6 }))
    shelf.position.set(24, 9, WZ + 1.4); shelf.castShadow = true; shelf.receiveShadow = true; sc.add(shelf)
    const jarM = new THREE.MeshPhysicalMaterial({ color: '#2f6a4a', roughness: 0.25, clearcoat: 1 })
    ;[[21, 1.6, 2.6], [23.5, 1.2, 2.0], [26, 1.4, 3.0]].forEach(([x, r, h]) => { const j = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 32), jarM); j.position.set(x, 9.2 + h / 2, WZ + 1.4); j.castShadow = true; sc.add(j) })

    // A tiled backsplash (cream glazed tiles, one green band), the plain wall above it.
    {
      const tileTex = canvasTex(512, 512, (g, Wd, Hd) => {
        g.fillStyle = '#e8dcc4'; g.fillRect(0, 0, Wd, Hd)
        const rr = rng(13), n = 8, s = Wd / n
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const band = j === 2
          const l = band ? 66 + rr() * 6 : 88 + rr() * 5
          g.fillStyle = band ? `hsl(${140 + rr() * 8},${22 + rr() * 8}%,${l}%)` : `hsl(${40 + rr() * 6},${30 + rr() * 10}%,${l}%)`
          g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4)
          const gr = g.createRadialGradient(i * s + s * 0.35, j * s + s * 0.3, 2, i * s + s / 2, j * s + s / 2, s * 0.7)
          gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(0,0,0,.06)')
          g.fillStyle = gr; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4)
        }
      }, { repeat: true })
      tileTex.repeat.set(5, 1)
      const tileM = new THREE.MeshPhysicalMaterial({ map: tileTex, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.18 })
      for (const [x0, x1] of [[-40, WX0], [WX1, 40]]) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 5.4), tileM); t.position.set((x0 + x1) / 2, 2.7, WZ + 0.42)
        t.material.map.repeat.set((x1 - x0) / 8, 1); t.receiveShadow = true; sc.add(t)
      }
      const under = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY0), tileM); under.position.set((WX0 + WX1) / 2, WY0 / 2, WZ + 0.42); under.receiveShadow = true; sc.add(under)
    }
    // A plant on the sill (a terracotta pot, a few leaves).
    {
      const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.62, 0.9), new THREE.Vector2(0.7, 0.95), new THREE.Vector2(0.7, 1.1), new THREE.Vector2(0.6, 1.1)]
      const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: '#b8603a', roughness: 0.85 }))
      pot.position.set(6.6, WY0 + 0.32, WZ + 0.1); pot.castShadow = true; pot.receiveShadow = true; sc.add(pot)
      this.plant = new THREE.Group(); this.plant.position.set(6.6, WY0 + 1.35, WZ + 0.1); sc.add(this.plant)
      const lm = leafMaterial({ transl: 1.2 }); this.plantLeafM = lm
      const lg = leafGeometry(1.3, 0.25, 0.25)
      const rr = rng(44)
      for (let k = 0; k < 11; k++) {
        const L = new THREE.Mesh(lg, lm); L.customDepthMaterial = leafDepthMaterial()
        const a = (k / 11) * Math.PI * 2 + rr() * 0.4
        L.rotation.set(0, a, 0.5 + rr() * 0.7); L.position.y = rr() * 0.5; L.scale.setScalar(0.75 + rr() * 0.45); L.castShadow = true
        const holder = new THREE.Group(); holder.rotation.y = a; holder.add(L); L.rotation.set(0, 0, 0.55 + rr() * 0.6); this.plant.add(holder)
      }
    }
    // A curtain at the window's left side, stirring.
    {
      const cg = new THREE.PlaneGeometry(3.2, 12.4, 18, 30); cg.translate(0, -6.2, 0)
      const ctex = canvasTex(256, 512, (g, Wd, Hd) => {
        g.fillStyle = '#f4ecdc'; g.fillRect(0, 0, Wd, Hd)
        g.fillStyle = 'rgba(200,150,60,.22)'
        for (let y = 20; y < Hd; y += 60) for (let x = (y / 60) % 2 ? 20 : 50; x < Wd; x += 60) { g.beginPath(); g.ellipse(x, y, 7, 11, 0.4, 0, 7); g.fill() }
        g.fillStyle = 'rgba(23,70,49,.35)'; g.fillRect(0, Hd - 26, Wd, 8)
      })
      this.curtainU = { uTime: { value: 0 } }
      const cm = new THREE.MeshStandardMaterial({ map: ctex, side: THREE.DoubleSide, roughness: 0.9, transparent: true, opacity: 0.9, emissive: '#fff0d0', emissiveIntensity: 0.25 })
      cm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.curtainU.uTime
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
          float hang = clamp(-position.y / 12.4, 0., 1.);
          transformed.z += (sin(position.x * 2.6 + uTime * .9) * .18 + sin(uTime * .53 + position.y * .4) * .35) * hang + sin(position.x * 5.5) * .12;
          transformed.x += sin(uTime * .41 + position.y * .3) * .25 * hang * hang;`)
      }
      this.curtain = new THREE.Mesh(cg, cm); this.curtain.scale.y = (WY1 - WY0 + 0.4) / 12.4; this.curtain.position.set(WX0 + 1.4, WY1 + 0.6, WZ + 0.75); this.curtain.castShadow = true; sc.add(this.curtain)
      // A half-curtain across the top of the window: light, plain, glowing softly with the day behind it.
      const vg = new THREE.PlaneGeometry(WX1 - WX0 + 0.4, 5.6, 24, 8); vg.translate(0, -2.8, 0)
      this.valance = new THREE.Mesh(vg, cm); this.valance.position.set((WX0 + WX1) / 2, WY1 + 0.3, WZ + 0.6); sc.add(this.valance)
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 14, 8), new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.6, roughness: 0.4 })); rod.rotation.z = Math.PI / 2; rod.position.set((WX0 + WX1) / 2, WY1 + 0.7, WZ + 0.8); sc.add(rod)
    }
    // A branch outside: leaves (backlit against the bright garden) that sway and throw moving shadows through the window.
    {
      const n = T.name === 'low' ? 16 : 24
      const lg = leafGeometry(1.25, 0.25, 0.2)
      this.branchM = leafMaterial({ transl: 1.4 })
      this.branch = new THREE.InstancedMesh(lg, this.branchM, n)
      this.branch.customDepthMaterial = leafDepthMaterial()
      this.branch.castShadow = true
      const rr = rng(71)
      this.branchSeeds = Array.from({ length: n }, (_, k) => {
        const along = rr()
        return [lerp(-6, 12, along) + (rr() - 0.5) * 2.5, lerp(7.5, 2.5, along) + (rr() - 0.5) * 3, WZ - 1.6 - rr() * 1.4, rr() * 6.28, rr() * 6.28, 0.7 + rr() * 0.5]
      })
      this.branch.frustumCulled = false
      sc.add(this.branch)
      const twig = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-7, 9.5, WZ - 2.4), new THREE.Vector3(0, 6.5, WZ - 2.2), new THREE.Vector3(6, 4, WZ - 2.4), new THREE.Vector3(12, 1.5, WZ - 2.6)]), 40, 0.12, 6), new THREE.MeshStandardMaterial({ color: '#4a3a24', roughness: 0.9 }))
      twig.castShadow = true; sc.add(twig); this.twig = twig
    }
    // A steel tumbler of chai on its little bowl, steaming.
    {
      const steel = new THREE.MeshPhysicalMaterial({ color: '#d8d8d4', metalness: 0.9, roughness: 0.66 })
      const tp = [new THREE.Vector2(0, 0), new THREE.Vector2(0.42, 0), new THREE.Vector2(0.45, 0.06), new THREE.Vector2(0.5, 1.3), new THREE.Vector2(0.56, 1.42), new THREE.Vector2(0.53, 1.44), new THREE.Vector2(0.47, 1.32), new THREE.Vector2(0.42, 0.1)]
      const tum = new THREE.Mesh(new THREE.LatheGeometry(tp, 40), steel)
      const bp = [new THREE.Vector2(0, 0), new THREE.Vector2(0.55, 0), new THREE.Vector2(0.95, 0.38), new THREE.Vector2(1.0, 0.42), new THREE.Vector2(0.92, 0.42), new THREE.Vector2(0.5, 0.08)]
      const dab = new THREE.Mesh(new THREE.LatheGeometry(bp, 40), steel)
      const chai = new THREE.Mesh(new THREE.CircleGeometry(0.47, 32), new THREE.MeshPhysicalMaterial({ color: '#b07a48', roughness: 0.25, clearcoat: 1 }))
      chai.rotation.x = -Math.PI / 2; chai.position.y = 1.25
      this.chai = new THREE.Group(); this.chai.add(dab, tum, chai); tum.position.y = 0.1; chai.position.y = 1.35
      this.chai.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      this.chai.position.set(2.7, 0, -3.3); sc.add(this.chai)
      this.steamU = { uTime: { value: 0 }, uOp: { value: 0.6 } }
      const stm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: this.steamU,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: /* glsl */ `uniform float uTime, uOp; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main(){
            vec2 p = vUv; float y = p.y;
            float x = p.x - .5 + sin(y * 4.5 - uTime * 1.1) * .16 * y + sin(y * 9. + uTime * .7) * .06 * y;
            float w = .03 + y * .1;
            float core = exp(-x * x / (w * w));
            float k = n(vec2(x * 7. + 3., y * 4. - uTime * .7)) * .6 + n(vec2(x * 15., y * 9. - uTime * 1.3)) * .4;
            float a = core * smoothstep(0., .12, y) * smoothstep(1., .35, y) * smoothstep(.45, .85, k) * 1.4;
            gl_FragColor = vec4(vec3(1.), a * uOp);
          }`,
      })
      this.steam = []
      for (let k = 0; k < 2; k++) { const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 4.2), stm); sp.position.set(2.7 + (k - 0.5) * 0.15, 1.55 + 2.1, -3.3); sp.renderOrder = 8; sc.add(sp); this.steam.push(sp) }
    }

    // Bright garden beyond the glass, out of focus: sunlit leaves as bokeh.
    this.gardenBok = bokeh(T.name === 'high' ? 40 : 22, new THREE.Box3(new THREE.Vector3(-4, 0.5, WZ - 16), new THREE.Vector3(11, 9, WZ - 9)), { size: 1.5, color: '#fff3c4', opacity: 0.5, drift: 0.35, seed: 14, rim: 0.4 })
    sc.add(this.gardenBok)
    // Things with colour and craft on the counter: a block-printed cloth under the bowl, a copper lota, a small steel plate,
    // marigolds in a glass of water.
    {
      const clothTex = canvasTex(512, 512, (g, Wd, Hd) => {
        g.fillStyle = '#f3e7cf'; g.fillRect(0, 0, Wd, Hd)
        const motif = (x, y, s, col) => {
          g.fillStyle = col
          for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.beginPath(); g.ellipse(x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.36, s * 0.2, a, 0, 7); g.fill() }
          g.fillStyle = '#f3e7cf'; g.beginPath(); g.arc(x, y, s * 0.22, 0, 7); g.fill()
          g.fillStyle = col; g.beginPath(); g.arc(x, y, s * 0.1, 0, 7); g.fill()
        }
        for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) motif(56 + i * 66 + (j % 2) * 33, 56 + j * 66, 34, j % 2 ? '#b23a2a' : '#25406e')
        g.strokeStyle = '#25406e'; g.lineWidth = 14; g.strokeRect(12, 12, Wd - 24, Hd - 24)
        g.strokeStyle = '#b23a2a'; g.lineWidth = 5; g.strokeRect(30, 30, Wd - 60, Hd - 60)
        const img = g.getImageData(0, 0, Wd, Hd), d = img.data, rr = rng(9)
        for (let i = 0; i < d.length; i += 4) { const n = (rr() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n }
        g.putImageData(img, 0, 0)
      })
      const cg = new THREE.PlaneGeometry(7.4, 7.4, 24, 24), cp = cg.attributes.position
      for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); const edge = Math.max(Math.abs(x), Math.abs(y)) > 3.4 ? 1 : 0; cp.setZ(i, 0.015 + 0.03 * Math.sin(x * 2.3 + y * 1.1) * Math.sin(y * 1.7) + edge * 0.02 * Math.sin(x * 9)) }
      cg.computeVertexNormals(); cg.rotateX(-Math.PI / 2)
      const cloth = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.92 }))
      cloth.position.set(BOWL.x, 0.005, BOWL.z); cloth.rotation.y = 0.35; cloth.receiveShadow = true; sc.add(cloth)

      const copper = new THREE.MeshPhysicalMaterial({ color: '#d9824a', metalness: 0.85, roughness: 0.7 })
      const lp = []
      for (let i = 0; i <= 24; i++) { const k = i / 24; const r = k < 0.62 ? 0.95 * Math.sin(Math.PI * (0.12 + k / 0.62 * 0.88)) + 0.08 : 0.32 + Math.pow((k - 0.62) / 0.38, 1.6) * 0.38; lp.push(new THREE.Vector2(Math.max(0.05, r), k * 2.3)) }
      const lota = new THREE.Mesh(new THREE.LatheGeometry(lp, 40), copper); lota.position.set(4.6, 0, -5.9); lota.castShadow = true; lota.receiveShadow = true; sc.add(lota)

      const steel = new THREE.MeshPhysicalMaterial({ color: '#dcdcd8', metalness: 0.9, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5 })
      const pp = [new THREE.Vector2(0, 0), new THREE.Vector2(1.25, 0), new THREE.Vector2(1.45, 0.16), new THREE.Vector2(1.5, 0.2), new THREE.Vector2(1.42, 0.2), new THREE.Vector2(1.22, 0.06), new THREE.Vector2(0, 0.06)]
      const plate = new THREE.Mesh(new THREE.LatheGeometry(pp, 48), steel); plate.position.set(-4.6, 0, 2.4); plate.receiveShadow = true; plate.castShadow = true; sc.add(plate)
      // a few cardamom pods and a spoon on the plate
      const podM = new THREE.MeshStandardMaterial({ color: '#7e9a4a', roughness: 0.7 })
      const pod = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), podM, 7); const M4 = new THREE.Matrix4(), rr = rng(19)
      for (let k = 0; k < 7; k++) pod.setMatrixAt(k, M4.compose(new THREE.Vector3(-4.6 + (rr() - 0.5) * 1.2, 0.14, 2.4 + (rr() - 0.5) * 1.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr() * 6, 0)), new THREE.Vector3(1.7, 0.9, 1)))
      sc.add(pod)
      const spoon = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.8, 4, 8), steel); spoon.rotation.set(Math.PI / 2, 0, 0.6); spoon.position.set(-4.3, 0.14, 2.2); sc.add(spoon)

      // marigolds in a glass
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.3, 32, 1, true), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.22, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }))
      glass.position.set(1.2, 0.65, -5.8); sc.add(glass)
      const water = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.35, 0.8, 24), new THREE.MeshPhysicalMaterial({ color: '#cfe6d8', roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false })); water.position.set(1.2, 0.42, -5.8); sc.add(water)
      const fg = new THREE.IcosahedronGeometry(0.34, 3), fp = fg.attributes.position, fv = new THREE.Vector3()
      for (let i = 0; i < fp.count; i++) { fv.fromBufferAttribute(fp, i); const a = Math.atan2(fv.z, fv.x), b = Math.acos(fv.y / fv.length()); const k = 1 + 0.16 * Math.pow(Math.abs(Math.sin(a * 9 + b * 6)), 2) + 0.1 * Math.sin(b * 14); fv.multiplyScalar(k); fv.y *= 0.75; fp.setXYZ(i, fv.x, fv.y, fv.z) }
      fg.computeVertexNormals()
      const flowerM = new THREE.MeshStandardMaterial({ color: '#ff9612', roughness: 0.75, emissive: '#ff6a00', emissiveIntensity: 0.12 })
      const heads = [[1.0, 2.35, -5.8, 1], [1.55, 2.1, -5.65, 0.9], [1.15, 1.95, -5.4, 0.85], [0.85, 2.05, -6.05, 0.8], [1.45, 2.55, -6.05, 0.75]]
      const fl = new THREE.InstancedMesh(fg, flowerM, heads.length)
      const stemG = new THREE.CylinderGeometry(0.03, 0.03, 1, 5); stemG.translate(0, 0.5, 0)
      const st = new THREE.InstancedMesh(stemG, new THREE.MeshStandardMaterial({ color: '#4c7a2a', roughness: 0.8 }), heads.length)
      heads.forEach(([x, y, z, s2], k) => {
        fl.setMatrixAt(k, M4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((k - 2) * 0.25, k, 0.2)), new THREE.Vector3(s2, s2, s2)))
        const base = new THREE.Vector3(1.2, 0.2, -5.8), top = new THREE.Vector3(x, y, z), d = top.clone().sub(base)
        st.setMatrixAt(k, M4.compose(base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, d.length(), 1)))
      })
      fl.castShadow = true; sc.add(fl, st)
    }

    // The far counter, soft: steel dabbas and a jar of pickle against the back wall to the left, a ladle hanging from a
    // hook, and the edge of the gas stove at the right. (Kept low: the wall above stays plain behind the headline.)
    {
      // steel that reads as steel even out of focus: the bands of reflection are painted in
      const bands = canvasTex(256, 32, (c) => { const g = c.createLinearGradient(0, 0, 256, 0); [[0, '#8c8f8c'], [0.1, '#f4f2ea'], [0.2, '#b9bbb6'], [0.34, '#6f7370'], [0.5, '#c9cac4'], [0.62, '#fffbee'], [0.72, '#a9aba6'], [0.86, '#646866'], [1, '#8c8f8c']].forEach(([o, col]) => g.addColorStop(o, col)); c.fillStyle = g; c.fillRect(0, 0, 256, 32); c.globalAlpha = 0.5; c.fillStyle = '#5a5d5a'; c.fillRect(0, 2, 256, 1); c.fillRect(0, 29, 256, 1) }) // two fine rings near the rim and the base
      bands.colorSpace = THREE.SRGBColorSpace; bands.wrapS = THREE.RepeatWrapping
      const steelD = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: bands, metalness: 0.1, roughness: 0.4, emissive: '#ffffff', emissiveMap: bands, emissiveIntensity: 0.2 }) // a little self-light, so the bands show in the shade of the back counter
      const dab = new THREE.CylinderGeometry(1, 1, 1, 32)
      const dabbas = new THREE.InstancedMesh(dab, steelD, 6), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion()
      ;[[-6.2, -6.3, 0.75, 1.5], [-7.9, -6.4, 0.65, 1.25], [-9.4, -6.2, 0.7, 1.7], [-6.2, -6.3, 0.78, 0.12], [-7.9, -6.4, 0.68, 0.12], [-9.4, -6.2, 0.73, 0.12]].forEach(([x, z, r2, h], k) => {
        const y = k < 3 ? h / 2 : [1.5, 1.25, 1.7][k - 3] + 0.06
        dabbas.setMatrixAt(k, M4.compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(r2, h, r2)))
      })
      dabbas.castShadow = true; dabbas.receiveShadow = true; sc.add(dabbas)
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.7, 28), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false }))
      jar.position.set(-4.6, 0.85, -6.5); sc.add(jar)
      const pickle = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 1.15, 24), new THREE.MeshStandardMaterial({ color: '#c8641c', roughness: 0.5 }))
      pickle.position.set(-4.6, 0.6, -6.5); sc.add(pickle)
      const jl = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.22, 28), new THREE.MeshStandardMaterial({ color: '#b23a2a', roughness: 0.6 })); jl.position.set(-4.6, 1.8, -6.5); sc.add(jl)
      // the ladle on its hook
      const ladle = new THREE.Group(); ladle.position.set(-11.2, 4.4, WZ + 0.55)
      const hk = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 14), steelD); hk.position.y = 0.1; ladle.add(hk)
      // what it hangs from: a small wooden rail on the wall with a brass peg
      { const rail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: '#8a5a34', roughness: 0.7 })); rail.position.set(0.9, 0.35, -0.2); ladle.add(rail); const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), new THREE.MeshStandardMaterial({ color: '#c9a04a', metalness: 0.6, roughness: 0.4 })); peg.rotation.x = Math.PI / 2; peg.position.set(0, 0.24, 0.05); ladle.add(peg) }
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.2, 8), steelD); handle.position.y = -1.6; ladle.add(handle)
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#d4d4d0', metalness: 0.9, roughness: 0.42, side: THREE.DoubleSide }))
      cup.position.y = -3.2; cup.rotation.x = -0.3; ladle.add(cup)
      ladle.traverse((o) => { if (o.isMesh) o.castShadow = true })
      sc.add(ladle); this.ladle = ladle
      // the gas stove's edge: a dark enamel body, a cast-iron grate and a brass burner
      const stove = new THREE.Group(); stove.position.set(12.5, 0, -3.2)
      const body = new THREE.Mesh(new RoundedBoxGeometry(9, 1.0, 5.2, 2, 0.15), new THREE.MeshStandardMaterial({ color: '#1c1f1d', roughness: 0.35, metalness: 0.3 })); body.position.y = 0.5; stove.add(body)
      const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.3, 24), new THREE.MeshStandardMaterial({ color: '#b8893a', metalness: 0.8, roughness: 0.35 })); brass.position.set(-2.2, 1.12, 0); stove.add(brass)
      const grate = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 0.14, 0.16), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }), 4)
      for (let k = 0; k < 4; k++) grate.setMatrixAt(k, M4.compose(new THREE.Vector3(-2.2, 1.35, 0), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (k / 4) * Math.PI), new THREE.Vector3(1, 1, 1)))
      stove.add(grate)
      stove.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      sc.add(stove)
    }

    // Light: the sun through the window (moves across four days), sky bounce, a warm room fill.
    this.sunL = new THREE.DirectionalLight('#ffe6b8', 7)
    this.sunL.castShadow = true
    this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    Object.assign(this.sunL.shadow.camera, { left: -22, right: 22, top: 18, bottom: -18, near: 1, far: 120 })
    this.sunL.shadow.bias = -0.0005; this.sunL.shadow.normalBias = 0.03; this.sunL.shadow.radius = 0.6
    sc.add(this.sunL, this.sunL.target)
    this.hemi = new THREE.HemisphereLight('#fff4e0', '#a08060', 0.5); sc.add(this.hemi)
    sc.environmentIntensity = 0.32
    this.fill = new THREE.PointLight('#ffd9a0', 11, 40, 1.6); this.fill.position.set(-8, 8, 10); sc.add(this.fill)
    sc.environment = engine.env({ top: '#fff4dc', mid: '#f2dcb4', bottom: '#8a6a48', sun: '#fff0d0', sunDir: new THREE.Vector3(0.4, 0.5, -1), sunPower: 6 })
    // Soft shafts from the window through the room's dust, turned with the sun.
    this.beamMat = beamMaterial('#fff0d0', 0.05)
    this.beams = [[-0.5, 8], [3, 6.5], [6.5, 5]].map(([x, y]) => { const b = beam(2.4, 34, this.beamMat, new THREE.Vector3(0, -1, 0)); b.position.set(x, y, WZ + 0.4); sc.add(b); return b })
    this.rayFrom = new THREE.Vector3((WX0 + WX1) / 2, (WY0 + WY1) / 2, WZ - 4)
    this.look.rayThreshold = 1.7; this.look.rayTint.setRGB(1, 0.9, 0.7)

    // The box from the warehouse, open, straw inside.
    const kraft = new THREE.MeshStandardMaterial({ map: kraftTexture(512, 256, (g, W, H) => drawWordmark(g, W / 2, H * 0.42, 70), 7), roughness: 0.85 })
    const kraftIn = new THREE.MeshStandardMaterial({ map: kraftTexture(256, 256, null, 9), color: '#e2c79a', roughness: 0.9 })
    this.box = new THREE.Group()
    const BW = 5.2, BD = 3.6, BH = 2.6
    const side = (w, h, x, z, ry, m) => { const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [kraftIn, kraftIn, kraftIn, kraftIn, m, kraftIn]); s.position.set(x, h / 2, z); s.rotation.y = ry; s.castShadow = true; s.receiveShadow = true; this.box.add(s) }
    side(BW, BH, 0, BD / 2, 0, kraft); side(BW, BH, 0, -BD / 2, Math.PI, kraft); side(BD, BH, BW / 2, 0, Math.PI / 2, kraftIn); side(BD, BH, -BW / 2, 0, -Math.PI / 2, kraftIn)
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(BW, 0.08, BD), kraftIn); bottom.position.y = 0.04; this.box.add(bottom)
    const straw = strawMesh(Math.round(600 * T.particles + 200), -BW / 2 + 0.2, BW / 2 - 0.2, -BD / 2 + 0.2, BD / 2 - 0.2, BH - 0.7, 12, 0.5)
    this.box.add(straw)
    this.lid = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.12, 0.1, BD + 0.12), [kraftIn, kraftIn, new THREE.MeshStandardMaterial({ map: kraftTexture(512, 360, (g, W, H) => drawWordmark(g, W / 2, H * 0.45, 64), 8), roughness: 0.85 }), kraftIn, kraftIn, kraftIn])
    this.lid.castShadow = true
    this.box.add(this.lid)
    this.box.position.set(-17, 0, -6.6); this.box.rotation.y = 0.3
    sc.add(this.box)
    // Two more mangoes still in the straw (the rest of the order).
    const m2 = new Mango({ ripe: 0.55, leaf: false, detail: 0.6, stem: false }), m3 = new Mango({ ripe: 0.7, leaf: false, detail: 0.6, stem: false })
    m2.position.set(-1.2, BH - 0.35, 0.3); m2.rotation.set(-Math.PI / 2, 0, 1.7); m3.position.set(1.3, BH - 0.4, -0.4); m3.rotation.set(-Math.PI / 2, 0, 1.3)
    this.box.add(m2, m3)

    // The bowl: glazed stoneware, cream inside, deep green outside, a gold lip.
    const prof = []
    for (let i = 0; i <= 24; i++) { const k = i / 24; prof.push(new THREE.Vector2((0.9 + Math.sin(k * Math.PI * 0.5) * 2.9) * 0.62, Math.pow(k, 1.5) * 1.9 * 0.62)) }
    for (let i = 24; i >= 0; i--) { const k = i / 24; prof.push(new THREE.Vector2((0.7 + Math.sin(k * Math.PI * 0.5) * 2.85) * 0.62, (0.18 + Math.pow(k, 1.5) * 1.72) * 0.62)) }
    const bowlG = new THREE.LatheGeometry(prof, 72)
    const bowlM = new THREE.MeshPhysicalMaterial({ color: '#1f4d36', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.38, side: THREE.DoubleSide })
    bowlM.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(.86,.80,.68);') }
    this.bowl = new THREE.Mesh(bowlG, bowlM)
    this.bowl.position.copy(BOWL); this.bowl.castShadow = true; this.bowl.receiveShadow = true
    sc.add(this.bowl)
    const lip = new THREE.Mesh(new THREE.TorusGeometry(3.71 * 0.62, 0.045, 8, 96), new THREE.MeshStandardMaterial({ color: '#ffb81f', metalness: 0.25, roughness: 0.55 }))
    lip.rotation.x = Math.PI / 2; lip.position.copy(BOWL).add(new THREE.Vector3(0, 1.9 * 0.62, 0)); sc.add(lip)

    // The board.
    const board = new THREE.Mesh(new RoundedBoxGeometry(8.4, 0.5, 5.6, 3, 0.18), new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#e2b27a', roughness: 0.55 }))
    board.position.copy(BOARD).add(new THREE.Vector3(0, -0.25, 0)); board.castShadow = true; board.receiveShadow = true; sc.add(board)

    // Our mango (the whole fruit until the cut).
    this.mango = new Mango({ ripe: 0.62, leaf: true })
    this.mango.material.emissive = new THREE.Color('#ff9418'); this.mango.material.emissiveIntensity = 0
    sc.add(this.mango)
    this.ready = glints(4, '#fff0c0'); sc.add(this.ready)
    // Light on the fruit: a warm bounce up from the sunlit cloth, and a narrow rim from the window behind it.
    this.bounce = new THREE.PointLight('#ffb25a', 0, 2.6, 1.6); sc.add(this.bounce)
    this.rimSpot = new THREE.SpotLight('#ffe6b8', 0, 30, 0.13, 0.7, 1.2); sc.add(this.rimSpot, this.rimSpot.target)
    { const rr = rng(3); this.readySeeds = Array.from({ length: 4 }, () => [rr() * 6.28, rr() * 2 - 1, rr() * 6.28, 0.7 + rr() * 0.6]) }

    // The two halves: the clipped skin plus a flesh cap on the cut.
    const outline = mangoOutline(96, 0.985)
    const shape = new THREE.Shape(outline)
    const capG = new THREE.ShapeGeometry(shape, 24)
    { // uv from the outline's box, so the flesh texture fits
      const p = capG.attributes.position, uv = capG.attributes.uv
      capG.computeBoundingBox(); const bb = capG.boundingBox
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y))
    }
    this.halves = []
    for (const k of [0, 1]) { // 0: bottom piece (with the seed), 1: top cheek
      const g = new THREE.Group()
      const skinM = mangoMaterial({ ripe: 1 })
      const plane = new THREE.Plane()
      skinM.clippingPlanes = [plane]; skinM.clipShadows = true
      const skin = new THREE.Mesh(this.mango.body.geometry, skinM); skin.castShadow = true; skin.receiveShadow = true
      const cap = new THREE.Mesh(capG, fleshMaterial(fleshTexture(k === 0)))
      cap.position.z = CUT; if (k === 1) cap.rotation.y = Math.PI
      if (k === 1) cap.scale.x = -1
      cap.receiveShadow = true
      g.add(skin, cap)
      g.userData = { plane, skinM, local: new THREE.Plane(new THREE.Vector3(0, 0, k === 0 ? -1 : 1), k === 0 ? CUT : -CUT) }
      sc.add(g)
      this.halves.push(g)
    }

    // The hedgehog: flesh cubes standing on a skin shell that turns inside out.
    this.buildHedgehog(outline)

    // The knife.
    this.knife = new THREE.Group()
    const blade = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.3, 0.05), new THREE.MeshPhysicalMaterial({ color: '#5c6065', metalness: 1, roughness: 0.62, clearcoat: 0, envMapIntensity: 0.6 }))
    blade.position.x = 3.25
    const handle = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.9, 0.55, 3, 0.2), new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 0.5 }))
    handle.position.x = -1.7
    this.knife.add(blade, handle)
    this.knife.traverse((o) => { if (o.isMesh) o.castShadow = true })
    sc.add(this.knife)

    // Juice: a few droplets that catch the light.
    const dropM = new THREE.MeshPhysicalMaterial({ color: '#ffcf6a', roughness: 0.3, transparent: true, opacity: 0.75, clearcoat: 0.6, clearcoatRoughness: 0.35, envMapIntensity: 1.2 })
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), dropM, 26)
    sc.add(this.drops)
    { const r = rng(77); this.dropSeeds = Array.from({ length: 26 }, () => [r(), r(), r(), r()]) }

    this.dust = motes(Math.round(120 * T.particles + 30), new THREE.Box3(new THREE.Vector3(-14, 0, -7), new THREE.Vector3(16, 14, 6)), { size: 0.05, color: '#fff2cf', drift: 0.3, opacity: 0.8, seed: 21 })
    sc.add(this.dust)
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.e = new THREE.Euler()
  }

  buildHedgehog(outline) {
    // Centre and radius per angle of the outline, for depth and inside tests.
    const c = outline.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / outline.length)
    const N = outline.length
    const R = (a) => { const f = ((a / (Math.PI * 2)) % 1 + 1) % 1 * N, i = Math.floor(f), k = f - i; const p = outline[i % N].clone().lerp(outline[(i + 1) % N], k); return p.distanceTo(c) }
    const ang = (x, y) => Math.atan2(y - c.y, x - c.x)
    const Dmax = 0.5
    const cells = [], step = 0.19
    for (let y = -1.2; y <= 1.2; y += step) for (let x = -1; x <= 1; x += step) {
      const cx = x + step / 2, cy = y + step / 2, a = ang(cx, cy), rho = Math.hypot(cx - c.x, cy - c.y) / R(a)
      if (rho < 0.9) cells.push({ x: cx, y: cy, rho })
    }
    this.hh = { c, R, Dmax, cells, step }
    const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12)
    const m = new THREE.InstancedMesh(geo, fleshMaterial(), cells.length)
    const col = new THREE.Color()
    cells.forEach((cl, i) => m.setColorAt(i, col.setHSL(0.1 + (Math.sin(i * 1.7) * 0.012), 1, 0.5 + 0.06 * Math.sin(i * 3.1) - cl.rho * 0.06)))
    m.castShadow = true; m.receiveShadow = true
    // Shell: rings × angles, deformed on the CPU each frame.
    const rings = 14, segs = 72
    const sg = new THREE.BufferGeometry(), pos = new Float32Array((rings + 1) * segs * 3), idx = []
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = r * segs + s, b = r * segs + (s + 1) % segs, cc = (r + 1) * segs + s, d = (r + 1) * segs + (s + 1) % segs; idx.push(a, cc, b, b, cc, d) }
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setIndex(idx)
    const shellM = mangoMaterial({ ripe: 1 }); shellM.side = THREE.DoubleSide
    const shell = new THREE.Mesh(sg, shellM)
    shell.castShadow = true; shell.receiveShadow = true
    this.hedge = new THREE.Group(); this.hedge.add(m, shell)
    this.hedgeCubes = m; this.shell = shell; this.shellRings = rings; this.shellSegs = segs
    this.scene.add(this.hedge)
  }

  /** e: 0 natural (flat cut face, skin dome below) … 1 inverted. score: 0 a solid face … 1 cut into cubes. */
  setHedge(e, score) {
    const { c, R, Dmax, cells, step } = this.hh
    const lift = lerp(-1, 0.45, e) // shell height factor (negative: dome below the cut face)
    const g = (rho) => Dmax * Math.sqrt(Math.max(0.03, 1 - rho * rho))
    const rhoAt = (x, y) => Math.min(0.995, Math.hypot(x - c.x, y - c.y) / R(Math.atan2(y - c.y, x - c.x)))
    const h = (x, y) => lift * g(rhoAt(x, y))
    const n = this.v, up = new THREE.Vector3(0, 0, 1), base = new THREE.Vector3(), sc = new THREE.Vector3()
    const gap = lerp(1.0, 0.88, score)
    cells.forEach((cl, i) => {
      const z0 = h(cl.x, cl.y), eps = 0.02
      n.set(-(h(cl.x + eps, cl.y) - h(cl.x - eps, cl.y)) / (2 * eps), -(h(cl.x, cl.y + eps) - h(cl.x, cl.y - eps)) / (2 * eps), 1).normalize()
      const len = g(cl.rho)
      this.q.setFromUnitVectors(up, n)
      base.set(cl.x, cl.y, z0).addScaledVector(n, len / 2)
      this.m4.compose(base, this.q, sc.set(step * gap, step * gap, len))
      this.hedgeCubes.setMatrixAt(i, this.m4)
    })
    this.hedgeCubes.instanceMatrix.needsUpdate = true
    const pos = this.shell.geometry.attributes.position
    for (let r = 0; r <= this.shellRings; r++) for (let s = 0; s < this.shellSegs; s++) {
      const a = (s / this.shellSegs) * Math.PI * 2, rho = (r / this.shellRings) * 0.99
      const x = c.x + Math.cos(a) * R(a) * rho, y = c.y + Math.sin(a) * R(a) * rho
      pos.setXYZ(r * this.shellSegs + s, x, y, h(x, y) - 0.02)
    }
    pos.needsUpdate = true
    this.shell.geometry.computeVertexNormals()
  }

  update(i, tt, time, dt) {
    const t = clamp(tt, -0.2, 1)
    // Phases.
    const open = smoother(-0.1, 0.06, t)                  // the lid lifts away
    const toBowl = easeInOut(inv(0.04, 0.2, t))           // out of the box, into the bowl
    const days = inv(0.2, 0.62, t)                        // four days on the counter
    const toBoard = easeInOut(inv(0.62, 0.68, t))         // onto the board
    const knife = inv(0.68, 0.75, t)                      // the knife passes
    const cut = t >= 0.715
    const flip = smooth(0.74, 0.808, t)                   // the top cheek turns over (an even turn: the cubic ease threw it across in a blink)
    const score = smooth(0.8, 0.85, t)
    const evert = easeInOut(inv(0.85, 0.94, t))           // pushed inside out
    const ripe = lerp(0.62, 1.0, smooth(0.0, 1.0, days))

    // Sunlight: four sweeps across the room, a dip between days.
    const dayF = days * DAYS, dayU = dayF - Math.floor(Math.min(dayF, DAYS - 0.0001))
    // The day the box arrives runs on into its evening, and the morning of the cut rises like the others: held at fixed
    // full light before and after the four days, the room snapped from noon to dawn at the first and from dusk to noon at
    // the last.
    const sweep = t < 0.2 ? lerp(0.25, 1, smooth(0.1, 0.2, t)) : t > 0.62 ? lerp(0, 0.62, smooth(0.62, 0.68, t)) : dayU
    const dip = t < 0.2 ? lerp(1, Math.sin(Math.PI * sweep), smooth(0.1, 0.14, t)) : t > 0.62 ? lerp(Math.sin(Math.PI * sweep), 1, smooth(0.66, 0.7, t)) : Math.sin(Math.PI * sweep)
    // The sun is the event of the shot. Each day a crisp patch of window light (with the shadows of the leaves outside
    // moving inside it) slides across the counter from right to left, over the bowl and the mango and on; the fruit is
    // in shade, then lit, then in shade again, and a little more golden each day. For the cut it rests on the board.
    const az = lerp(-0.95, 1.15, sweep), el = 0.36 + 0.12 * Math.sin(Math.PI * sweep)
    const Lday = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
    const Pboard = new THREE.Vector3(4.6, 0, 1.8)
    const Lboard = new THREE.Vector3(2.85, 5.9, -8.5).sub(Pboard).normalize()
    const kb = smooth(0.6, 0.68, t)
    this.sun.copy(Lday).lerp(Lboard, kb).normalize()
    const P = new THREE.Vector3(-0.6, 0, -0.2).lerp(Pboard, kb)
    this.sunL.position.copy(P).addScaledVector(this.sun, 60)
    this.sunL.target.position.copy(P)
    // the close board shots: gather the shadow map onto the board (spread over the whole kitchen its texels showed as
    // stair-steps along every shadow edge) and soften the edge a little
    { const cs = this.sunL.shadow.camera, hw = lerp(22, 10, kb), hh = lerp(18, 10, kb); if (cs.right !== hw) { cs.left = -hw; cs.right = hw; cs.top = hh; cs.bottom = -hh; cs.updateProjectionMatrix() } this.sunL.shadow.radius = lerp(0.6, 2.2, kb) }
    // Is the mango in the patch? (its ray to the sun passes through the open part of the window)
    {
      const m = new THREE.Vector3(BOWL.x + 0.1, 0.9, BOWL.z + 0.05), tt2 = (m.z + 7.5) / Math.max(0.05, -this.sun.z)
      const xw = m.x + this.sun.x * tt2, yw = m.y + this.sun.y * tt2
      this.mangoLit = smooth(-3, -1.8, xw) * (1 - smooth(7.8, 9, xw)) * smooth(1, 1.8, yw) * (1 - smooth(5.6, 6.3, yw)) * dip
    }
    this.sunL.intensity = 8 * (0.04 + 0.96 * Math.pow(dip, 0.6)) * (1 - 0.6 * smooth(0.6, 0.68, t)) // softer for the close board shots: wet flesh and steel catch it
    this.sunL.color.setRGB(1, lerp(0.6, 0.84, dip), lerp(0.32, 0.58, dip))
    this.sunCol.copy(this.sunL.color)
    this.outsideM.color.setRGB(lerp(0.6, 1.35, dip), lerp(0.5, 1.3, dip), lerp(0.45, 1.15, dip))
    this.hemi.intensity = lerp(0.24, 0.42, dip)
    // Each day the light is a little warmer, as the fruit deepens.
    const warm = smooth(0.15, 0.7, t)
    this.sunL.color.multiply(new THREE.Color(1, 1 - 0.1 * warm, 1 - 0.32 * warm)); this.sunCol.copy(this.sunL.color)
    this.hemi.color.setRGB(1, lerp(0.96, 0.88, warm), lerp(0.88, 0.7, warm))
    this.fill.color.setRGB(1, lerp(0.85, 0.74, warm), lerp(0.63, 0.45, warm))
    this.look.exposure = lerp(0.85, 0.95, dip)

    // The box: lid off, then it slides back out of the way.
    // The box is already open on the counter. Its lid used to float up off it as a loose board and blink out; with the
    // wall right behind the box there is no room to hinge it back either (it swung into the wall), and no hand to lift it.
    this.lid.visible = false
    // Once our mango is out, the box is set aside (it leaves the frame while the camera turns to the bowl).
    const aside = smoother(0.19, 0.32, t)
    this.box.position.set(lerp(-17, -26, aside), 0, lerp(-6.6, -9, aside))

    // Our mango: from the straw, an arc into the bowl, then onto the board.
    const M = this.mango
    M.ripe = ripe
    this.box.updateMatrixWorld(true)
    const inBox = this.box.localToWorld(new THREE.Vector3(0.1, 2.8, 0.1))
    const inBowl = BOWL.clone().add(new THREE.Vector3(0.1, 0.9, 0.05))
    const onBoard = BOARD.clone().add(new THREE.Vector3(0, 0.56, -1.2))
    const p = new THREE.Vector3()
    if (toBoard <= 0) {
      p.copy(inBox).lerp(inBowl, toBowl); p.y += Math.sin(Math.PI * toBowl) * 3.2
      M.position.copy(p)
      M.rotation.set(lerp(-1.3, -Math.PI / 2 + 0.22, toBowl), lerp(0.3, 0.05, toBowl), lerp(1.4, 1.15, toBowl) + Math.sin(toBowl * Math.PI) * 0.6)
    } else {
      p.copy(inBowl).lerp(onBoard, toBoard); p.y += Math.sin(Math.PI * toBoard) * 1.1
      M.position.copy(p)
      M.rotation.set(lerp(-Math.PI / 2 + 0.22, -Math.PI / 2, toBoard), lerp(0.05, 0, toBoard), lerp(1.15, 1.35, toBoard))
    }
    M.visible = !cut
    M.leaf.visible = toBoard < 0.5
    this.bounce.position.copy(M.position).add(new THREE.Vector3(0.2, -0.35, 0.95))
    this.bounce.intensity = (0.8 + 3.5 * (this.mangoLit || 0)) * (1 - toBoard) * (cut ? 0 : 1)
    this.rimSpot.position.copy(M.position).add(new THREE.Vector3(3.5, 4.2, -7.5)); this.rimSpot.target.position.copy(M.position)
    this.rimSpot.intensity = 26 * (0.25 + 0.75 * dip) * (1 - smooth(0.6, 0.66, t))

    // After the cut: two pieces where the fruit lay; the top cheek lifts and turns over beside it.
    M.updateMatrixWorld(true)
    const H0 = this.halves[0], H1 = this.halves[1]
    H0.visible = cut; H1.visible = cut && score < 0.5
    if (cut) {
      H0.position.copy(onBoard); H0.rotation.copy(M.rotation)
      const sep = smooth(0.715, 0.74, t)
      H1.position.copy(onBoard).add(new THREE.Vector3(0, 0.15 * sep, 0))
      H1.rotation.copy(M.rotation)
      if (flip > 0) {
        H1.position.copy(onBoard).add(new THREE.Vector3(-0.1, Math.sin(Math.PI * flip) * 2.2 + 0.15 * (1 - flip), lerp(0, 2.6, flip)))
        H1.rotation.set(-Math.PI / 2 + Math.PI * flip, 0, 1.35)
      }
      for (const H of this.halves) { H.updateMatrixWorld(true); H.userData.plane.copy(H.userData.local).applyMatrix4(H.matrixWorld) }
      H0.userData.skinM.userData.u.uRipe.value = ripe; H1.userData.skinM.userData.u.uRipe.value = ripe
    }
    // The hedgehog replaces the turned cheek once scoring starts (same place and outline).
    this.hedge.visible = cut && score >= 0.5
    if (this.hedge.visible) {
      // The cheek as turned: cut face up (hedgehog local z is up out of the cut, the skin shell below). Once
      // inverted it rests on its rim.
      this.hedge.position.set(onBoard.x - 0.1, BOARD.y + lerp(this.hh.Dmax, 0.04, evert), onBoard.z + 2.6)
      this.hedge.rotation.set(-Math.PI / 2, 0, 1.35)
      this.setHedge(evert, score)
      this.shell.material.userData.u.uRipe.value = ripe
    }

    // The knife waits on the board, then sweeps through along the cut plane, then is laid down again.
    this.knife.visible = true
    const kx = lerp(9, -4, smooth(0, 1, knife)) // an even draw through the fruit, not a snap across the frame
    const rest = BOARD.clone().add(new THREE.Vector3(-1.2, 0.04, 2.0))
    const cutPos = onBoard.clone().add(new THREE.Vector3(kx, CUT + 0.05, -0.3))
    const pick = smoother(0.64, 0.68, t), put = smoother(0.75, 0.82, t)
    const startPos = onBoard.clone().add(new THREE.Vector3(9, CUT + 0.05, -0.3)), endPos = onBoard.clone().add(new THREE.Vector3(-4, CUT + 0.05, -0.3))
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0)), cutQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0.15, 0))
    if (t < 0.68) { this.knife.position.lerpVectors(rest, startPos, pick); this.knife.position.y += Math.sin(pick * Math.PI) * 1.2; this.knife.quaternion.slerpQuaternions(restQ, cutQ, pick) }
    else if (t < 0.75) { this.knife.position.copy(cutPos); this.knife.quaternion.copy(cutQ) }
    // after the cut the knife carries on out of the picture the way it was going. Laid back down on the board it had to
    // cross the cheek that is turning over: lifted over it, it swung up to the lens as a dark bar; kept low, it went through it.
    else { this.knife.position.copy(endPos); this.knife.position.x -= 11 * put; this.knife.quaternion.copy(cutQ); this.knife.visible = put < 0.999 }

    // Juice droplets after the cut and when it opens.
    const juice = cut ? smooth(0.715, 0.73, t) * (1 - smooth(0.97, 1, t)) : 0
    this.drops.visible = juice > 0
    if (juice > 0) {
      const base = this.hedge.visible ? this.hedge.position : onBoard
      this.dropSeeds.forEach(([a, b, c2, d], k) => {
        const s = 0.025 + d * 0.05
        const pos = this.v.set(base.x + (a - 0.5) * 1.4, base.y + 0.1 + b * 0.25 + evert * 0.35 * (1 - Math.abs(a - 0.5) * 2), base.z + (c2 - 0.5) * 1.8)
        this.m4.compose(pos, this.q.identity(), new THREE.Vector3(s, s * 0.7, s))
        this.drops.setMatrixAt(k, this.m4)
      })
      this.drops.instanceMatrix.needsUpdate = true
    }

    // Camera: a warm wide on the box and bowl, a slow push while the days pass, then close on the board.
    const cam = new THREE.Vector3(), tgt = new THREE.Vector3()
    const A = { c: new THREE.Vector3(-14, 6.2, 5.1), t: new THREE.Vector3(-15.8, 2.0, -6.2) }
    const B = { c: new THREE.Vector3(2.2, 3.9, 10.6), t: new THREE.Vector3(0.4, 1.9, -1.6) }
    const C = { c: new THREE.Vector3(6.2, 5.4, 7.6), t: onBoard.clone().add(new THREE.Vector3(0, -0.1, 0.6)) }
    const D = { c: new THREE.Vector3(5.6, 4.8, 8.6), t: onBoard.clone().add(new THREE.Vector3(0, -0.2, 2.2)) }
    const k1 = smoother(0.03, 0.24, t), k2 = smoother(0.57, 0.715, t), k3 = smoother(0.78, 0.92, t)
    cam.copy(A.c).lerp(B.c, k1).lerp(C.c, k2).lerp(D.c, k3)
    tgt.copy(A.t).lerp(B.t, k1).lerp(C.t, k2).lerp(D.t, k3)
    cam.x += Math.sin(time * 0.15) * 0.15
    aim(this.camera, cam, tgt)
    const subject = this.hedge.visible ? this.hedge.position : M.position
    this.post.focus = cam.distanceTo(subject); this.post.range = lerp(5, 3, k2); this.post.dof = lerp(7, 10, k2)
    this.focus.copy(t < 0.1 ? this.box.position : subject)

    this.look.bloom = lerp(0.45, 0.2, k2); this.look.threshold = lerp(1.6, 3.2, k2); this.look.vig = 0.42; this.look.grain = 0.04
    this.look.exposure *= lerp(1, 0.8, k2)
    this.grade([0.01, 0.005, 0], [1.02, 0.99, 0.92], 1.08)
    this.dust.userData.u.uTime.value = time

    // The morning moving: leaves outside sway (their shadows cross the counter), the curtain stirs, the chai steams, the
    // shafts follow the sun.
    {
      const m4 = this.m4, q = this.q, e = this.e, sv = this.v
      const gust = 0.6 + 0.4 * Math.sin(time * 0.37) * Math.sin(time * 0.23 + 1)
      this.branchSeeds.forEach(([x, y, z, ph, yaw, sc], k) => {
        const sw = Math.sin(time * 1.3 + ph) * 0.25 * gust + Math.sin(time * 2.9 + ph * 2) * 0.08
        m4.compose(sv.set(x + Math.sin(time * 0.7 + ph) * 0.25 * gust, y + Math.sin(time * 0.9 + ph) * 0.15 * gust, z), q.setFromEuler(e.set(sw, yaw + sw * 0.5, -0.6 + sw)), new THREE.Vector3(sc, sc, sc))
        this.branch.setMatrixAt(k, m4)
      })
      this.branch.instanceMatrix.needsUpdate = true
      this.twig.rotation.z = Math.sin(time * 0.7) * 0.012 * gust
      this.curtainU.uTime.value = time
      this.plant.rotation.z = Math.sin(time * 0.8) * 0.02
      this.steamU.uTime.value = time
      this.steamU.uOp.value = 0.62 * (1 - smooth(0.6, 0.7, t))
      this.steam.forEach((sp, k) => { sp.rotation.y = Math.atan2(cam.x - sp.position.x, cam.z - sp.position.z) + (k - 0.5) * 0.9 })
      const bd = this.v.copy(this.sun).negate()
      this.beams.forEach((b) => b.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bd))
      this.beamMat.uniforms.uOp.value = 0.03 * Math.pow(dip, 1.5) * (1 - smooth(0.58, 0.66, t)) // the shafts cross the lens in the close board shots
      this.beamMat.uniforms.uTime.value = time
      this.look.rays = 0.3 * Math.pow(dip, 1.2) * (1 - 0.7 * smooth(0.58, 0.66, t))
      for (const lm of [this.branchM, this.plantLeafM]) lm.userData.u.uTime.value = time
      this.gardenBok.userData.u.uTime.value = time; this.gardenBok.userData.u.uScale.value = this.engine.h * this.engine.dpr / 900
      this.gardenBok.userData.u.uOp.value = 0.5 * (0.3 + 0.7 * dip)
    }
    // Ripe: a faint glow from inside the fruit, and a glint or two on its skin, as the fourth day ends.
    const glow = smooth(0.42, 0.62, t) * (1 - smooth(0.66, 0.7, t))
    M.material.emissiveIntensity = 0.14 * glow
    {
      const gp = this.ready.geometry.attributes.position, gk = this.ready.geometry.attributes.aK
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
      const toCam = cam.clone().sub(M.position).normalize()
      this.readySeeds.forEach(([a0, hh, ph, sp], k) => {
        const pp = M.position.clone().addScaledVector(right, Math.cos(a0) * 0.55).addScaledVector(upv, hh * 0.6).addScaledVector(toCam, 0.75)
        gp.setXYZ(k, pp.x, pp.y, pp.z)
        gk.setX(k, glow * Math.pow(Math.max(0, Math.sin(time * 1.1 * sp + ph)), 8) * (M.visible ? 1 : 0))
      })
      gp.needsUpdate = true; gk.needsUpdate = true
      this.ready.material.uniforms.uSize.value = 40 * this.engine.dpr * (this.engine.h / 900)
    }
  }

  afterCamera() {
    this.mango.tick(0, this.sunView, this.sunCol)
    for (const lm of [this.branchM, this.plantLeafM]) { lm.userData.u.uSunView.value.copy(this.sunView); lm.userData.u.uSunCol.value.copy(this.sunCol) }
    for (const H of this.halves) H.userData.skinM.userData.u.uSunView.value.copy(this.sunView)
  }
}
