// Chapter 12 "From one flower to your table." The whole journey as one ribbon: a strip of twelve vignettes (stills
// rendered from the film itself at load) joined by a gold thread. The camera flies back along it in reverse, from the
// counter to the seed, then pulls out until the ribbon is a single line behind the headline, the numbers and the buttons.
// Quiet wonder around it: gold motes drifting at every depth (sharp far away, soft discs near the lens), a glow that
// travels along the thread, and each card catching that light as it passes beneath.
import * as THREE from 'three'
import { Stage, aim, motes } from './stage.js'
import { bokeh } from './grade.js'
import { CHAPTERS } from '../chapters.js'
import { clamp, lerp, smooth, smoother, SERIF, SANS } from '../lib/util.js'

const N = 12
const W = 6.4, H = 4.4
const cardPos = (k, out = new THREE.Vector3()) => out.set((k - 5.5) * 7.6, Math.sin(k * 0.8) * 0.9, -Math.sin(k * 0.55) * 4.5)

// The film's frames are already tone-mapped; this undoes the final pass's filmic curve so they show as captured.
const CARD_F = /* glsl */ `
uniform sampler2D map; uniform float uOp; uniform float uGlow; uniform float uSheen; uniform float uLit; uniform vec2 uSize; varying vec2 vUv;
vec3 lin(vec3 c){ return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 invAces(vec3 y){
  y = clamp(y, 0., .93);
  vec3 a = 2.43 * y - 2.51, b = .59 * y - .03, c = .14 * y;
  vec3 x = (-b - sqrt(max(b * b - 4. * a * c, 0.))) / (2. * a);
  return x / .6;
}
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
void main(){
  vec2 p = (vUv - .5) * uSize;
  float d = rbox(p, uSize * .5, .28);
  if (d > 0.) discard;
  vec3 col = invAces(lin(texture2D(map, vUv).rgb));
  float edge = smoothstep(-.06, -.01, d);
  col = mix(col, vec3(1.2, .72, .12) * 1.6, edge * max(uGlow, uLit * .55));
  col *= .85;
  // the passing light: a soft diagonal sheen across the glass of the card, and a warm lift from below
  float band = exp(-pow((vUv.x * .8 + vUv.y * .45 - uSheen) * 5., 2.));
  col += vec3(1., .78, .45) * band * uLit * .22 + vec3(.9, .55, .15) * (1. - vUv.y) * (1. - vUv.y) * uLit * .14;
  gl_FragColor = vec4(col * uOp, 1.);
}`

export default class Finale extends Stage {
  constructor(engine) {
    super(engine, { near: 0.5, far: 600 })
    const sc = this.scene, T = this.tier
    this.fov = 34
    this.frame = [0, 0]; this.framePortrait = [0, 0]
    sc.background = new THREE.Color('#06140d')
    sc.fog = new THREE.Fog('#06140d', 60, 170)
    // A soft green glow behind everything.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(400, 220), new THREE.ShaderMaterial({
      depthWrite: false, uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec2 vUv; uniform float uT; void main(){ vec2 q = vUv - vec2(.5,.45); float g = exp(-dot(q*vec2(1.4,2.6), q*vec2(1.4,2.6)) * 9.); gl_FragColor = vec4(vec3(.05,.16,.09) * g * 2.2 + vec3(.25,.13,.0) * exp(-dot(q*vec2(2.,5.), q*vec2(2.,5.)) * 8.) * uT, 1.); }',
    }))
    glow.position.set(0, 0, -90); sc.add(glow)
    this.glow = glow

    // The cards.
    this.cards = []
    const geo = new THREE.PlaneGeometry(W, H)
    for (let k = 0; k < N; k++) {
      const c = document.createElement('canvas'); c.width = 640; c.height = 440
      this.paintCard(c, k, null)
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4
      const m = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uOp: { value: 1 }, uGlow: { value: 0 }, uSheen: { value: 0 }, uLit: { value: 0 }, uSize: { value: new THREE.Vector2(W, H) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: CARD_F, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, m)
      cardPos(k, mesh.position)
      mesh.rotation.y = -Math.cos(k * 0.55) * 0.3
      mesh.userData = { canvas: c, tex, k }
      sc.add(mesh)
      this.cards.push(mesh)
    }
    // The gold thread through the cards, drawn in as the camera passes.
    const pts = []
    for (let k = -0.6; k <= N - 0.4; k += 0.1) pts.push(cardPos(k).add(new THREE.Vector3(0, -H / 2 - 0.55, 0)))
    this.curve = new THREE.CatmullRomCurve3(pts)
    const tg = new THREE.TubeGeometry(this.curve, 400, 0.045, 6, false)
    this.thread = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uDraw: { value: 1 }, uT: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec2 vUv; uniform float uDraw; uniform float uT; uniform float uPulse; void main(){ float a = step(1. - uDraw, vUv.x); float pulse = .6 + .4 * sin(vUv.x * 80. - uT * 3.); float d = vUv.x - uPulse; float trav = exp(-d * d * 9000.) * 5. + exp(-d * d * 300.) * 1.4 * step(d, 0.) + exp(-d * d * 1200.) * 1.2; gl_FragColor = vec4(vec3(1., .66, .15) * 2.4 * a * (pulse + trav), 1.); }',
    }))
    sc.add(this.thread)
    // Knots on the thread under each card.
    this.knots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.5) }), N)
    const m4 = new THREE.Matrix4()
    for (let k = 0; k < N; k++) this.knots.setMatrixAt(k, m4.makeTranslation(cardPos(k).add(new THREE.Vector3(0, -H / 2 - 0.55, 0))))
    sc.add(this.knots)

    this.dust = motes(Math.round(500 * T.particles + 100), new THREE.Box3(new THREE.Vector3(-60, -20, -60), new THREE.Vector3(60, 25, 30)), { size: 0.09, color: '#ffcf70', drift: 0.6, opacity: 0.9, seed: 12, sizeVar: 1.5 })
    sc.add(this.dust)
    // Soft out-of-focus discs drifting between the cards and the lens, and a few far ones deep in the green.
    this.bokNear = bokeh(T.name === 'high' ? 46 : 26, new THREE.Box3(new THREE.Vector3(-52, -7, 1), new THREE.Vector3(52, 9, 16)), { size: 0.55, color: '#ffc45a', opacity: 0.22, drift: 0.9, seed: 21, rim: 0.55 })
    this.bokFar = bokeh(T.name === 'high' ? 30 : 16, new THREE.Box3(new THREE.Vector3(-80, -25, -80), new THREE.Vector3(80, 30, -30)), { size: 2.6, color: '#e8a640', opacity: 0.1, drift: 2, seed: 8, rim: 0.3 })
    sc.add(this.bokNear, this.bokFar)
    // The travelling light: a soft glow that runs along the thread, from the seed's end to the counter's, and round again.
    this.traveller = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uOp: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform float uOp; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = exp(-d * d * 6.) * .5 + exp(-d * d * 60.) * 1.2; gl_FragColor = vec4(vec3(1., .72, .3) * a * uOp * smoothstep(1., .7, d), 1.); }',
    }))
    this.traveller.renderOrder = 9; sc.add(this.traveller)
    this.tlen = this.curve.getLength()
  }

  paintCard(c, k, img) {
    const g = c.getContext('2d'), Wc = c.width, Hc = c.height
    if (img) g.drawImage(img, 0, 0, Wc, Hc)
    else { const grd = g.createLinearGradient(0, 0, Wc, Hc); grd.addColorStop(0, '#174631'); grd.addColorStop(1, '#0b1f15'); g.fillStyle = grd; g.fillRect(0, 0, Wc, Hc) }
    const sh = g.createLinearGradient(0, Hc * 0.62, 0, Hc); sh.addColorStop(0, 'rgba(6,20,13,0)'); sh.addColorStop(1, 'rgba(6,20,13,.85)')
    g.fillStyle = sh; g.fillRect(0, Hc * 0.6, Wc, Hc * 0.4)
    g.fillStyle = '#ffb81f'; g.font = `700 18px ${SANS}`; g.textBaseline = 'alphabetic'
    g.fillText(String(k).padStart(2, '0'), 26, Hc - 54)
    g.fillStyle = '#f6efdc'; g.font = `400 34px ${SERIF}`
    g.fillText(CHAPTERS[k].name, 26, Hc - 20)
  }

  setShots(shots) {
    shots.forEach((src, k) => {
      if (!src || !this.cards[k]) return
      const img = new Image()
      img.onload = () => {
        const { canvas, tex } = this.cards[k].userData
        const draw = () => { this.paintCard(canvas, k, img); tex.needsUpdate = true }
        draw()
        document.fonts?.ready.then(draw)
      }
      img.src = src
    })
  }

  update(i, tt, time) {
    const t = clamp(tt, -0.2, 1)
    // Fly back along the ribbon (card 11 → 0), then pull out to the whole line.
    const fly = smoother(-0.14, 0.5, t)
    const out = smoother(0.38, 0.7, t)
    const c = lerp(N - 1, 0, fly)
    const at = cardPos(c)
    const near = new THREE.Vector3(at.x + 2.2, at.y + 0.6, at.z + lerp(6.5, 14, fly))
    const far = new THREE.Vector3(0, 3, 86)
    const cam = near.clone().lerp(far, out)
    const tgt = at.clone().lerp(new THREE.Vector3(0, this.camera.aspect < 1 ? 26 : 18.5, 0), out)
    aim(this.camera, cam, tgt, lerp(-0.05, 0, out))
    // Cards: the one we pass glows; all dim behind the headline at the end.
    // The travelling light (ambient: it runs on time), and the cards it lights as it passes beneath them.
    const u = (time * 0.045) % 1
    const kAt = -0.6 + u * (N + 0.2) // card index under the light
    this.curve.getPointAt(u, this.traveller.position)
    this.traveller.quaternion.copy(this.camera.quaternion)
    this.traveller.scale.setScalar(lerp(2.2, 5.5, out))
    this.traveller.material.uniforms.uOp.value = lerp(0.9, 0.7, out) * smooth(0, 0.05, u) * (1 - smooth(0.95, 1, u))
    this.thread.material.uniforms.uPulse.value = u
    this.cards.forEach((m) => {
      const k = m.userData.k, d = Math.abs(k - c)
      m.material.uniforms.uGlow.value = Math.max(0, 1 - d) * (1 - out)
      m.material.uniforms.uOp.value = lerp(1, 0.75, smooth(0.5, 0.75, t))
      const dk = kAt - k
      m.material.uniforms.uLit.value = Math.exp(-dk * dk * 2.2) * lerp(1, 0.6, out)
      m.material.uniforms.uSheen.value = 0.62 + dk * 0.9
    })
    this.thread.material.uniforms.uDraw.value = clamp(1 - (c - 0.4) / N + out)
    this.thread.material.uniforms.uT.value = time
    this.glow.material.uniforms.uT.value = smooth(0.5, 0.9, t)
    this.focus.copy(cardPos(N - 1))
    this.post.focus = cam.distanceTo(at); this.post.range = lerp(4, 40, out); this.post.dof = lerp(8, 3, out)
    this.look.bloom = 0.7; this.look.threshold = 1.35; this.look.vig = 0.55; this.look.exposure = 1; this.look.grain = 0.05
    this.grade([0, 0, 0], [1, 1, 1], 1)
    this.dust.userData.u.uTime.value = time
    for (const b of [this.bokNear, this.bokFar]) { b.userData.u.uTime.value = time; b.userData.u.uScale.value = this.engine.h * this.engine.dpr / 900 }
  }
}
