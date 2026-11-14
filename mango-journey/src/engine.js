// The stage. One WebGL renderer and a small hand-written pipeline:
//   1. the current chapter's scene → HDR target A (with depth); during a transition the next scene → target B
//   2. composite: depth-of-field on each (gathered from depth), then an iris that opens B inside a circle centred on the
//      "match" object (seed → sun → mango → headlight → scan light → label dot → plate), with a gold hairline at the edge
//   3. bloom (three's UnrealBloomPass, added back into the composite)
//   4. final: radial blur (bullet-time), chromatic aberration on fast moves, exposure, ACES filmic, per-chapter grade,
//      vignette and animated film grain, sRGB out.
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

export const TIERS = {
  high: { name: 'high', pixels: 3.4e6, msaa: 4, taps: 24, shadow: 2048, leaves: 1, particles: 1, bloomScale: 0.5 },
  mid: { name: 'mid', pixels: 1.9e6, msaa: 2, taps: 14, shadow: 1024, leaves: 0.6, particles: 0.6, bloomScale: 0.5 },
  low: { name: 'low', pixels: 1.05e6, msaa: 0, taps: 8, shadow: 1024, leaves: 0.4, particles: 0.4, bloomScale: 0.35 },
}

export function detectTier() {
  const q = new URLSearchParams(location.search).get('q')
  if (q && TIERS[q]) return TIERS[q]
  const coarse = matchMedia('(pointer: coarse)').matches
  const small = Math.min(screen.width, screen.height) < 820
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8
  if (coarse && (mem <= 4 || cores <= 4)) return TIERS.low
  if (coarse || small) return TIERS.mid
  if (mem <= 4 || cores <= 4) return TIERS.mid
  return TIERS.high
}

const QUAD_V = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`

const COMPOSITE_F = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tA; uniform sampler2D tB; uniform sampler2D dA; uniform sampler2D dB;
uniform vec2 uNFA; uniform vec2 uNFB; uniform vec3 uDofA; uniform vec3 uDofB;
uniform float uMix; uniform float uHasB; uniform vec2 uCenter; uniform vec2 uRes; uniform vec3 uRing;
uniform vec4 uRayA; uniform vec4 uRayB; uniform vec3 uRayColA; uniform vec3 uRayColB; // xy light on screen, z strength, w threshold
// Guard against NaN/Inf from any scene (one bad pixel would otherwise bloom across the whole frame) and fireflies.
vec3 S(vec3 c){ return min(max(c, vec3(0.)), vec3(48.)); }
float lin(float d, vec2 nf){ float z = d * 2. - 1.; return 2. * nf.x * nf.y / (nf.y + nf.x - z * (nf.y - nf.x)); }
float coc(float z, vec3 p){ return clamp(abs(z - p.x) / p.y, 0., 1.) * p.z; }
vec3 dof(sampler2D t, sampler2D d, vec2 uv, vec2 nf, vec3 p){
  vec3 c0 = S(texture2D(t, uv).rgb);
  if (p.z < .5) return c0;
  float z = lin(texture2D(d, uv).r, nf), cc = coc(z, p);
  vec3 acc = c0; float w = 1.;
  for (int i = 0; i < TAPS; i++){
    float a = float(i) * 2.39996, r = sqrt((float(i) + .5) / float(TAPS));
    vec2 o = vec2(cos(a), sin(a)) * r * p.z / uRes;
    float zs = lin(texture2D(d, uv + o).r, nf), cs = coc(zs, p), dist = r * p.z;
    float ww = zs < z - .02 ? smoothstep(dist * .4, dist + .5, cs) : smoothstep(dist * .4, dist + .5, min(cc, cs + 1.));
    acc += S(texture2D(t, uv + o).rgb) * ww; w += ww;
  }
  return acc / w;
}
// Light shafts: march from the pixel towards the light on screen and gather whatever is brighter than the threshold
// (the sun and sky seen between leaves, a lamp, a window). Occluders cut the gather, which is what draws the shafts.
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
vec3 rays(sampler2D t, vec2 uv, vec4 r, vec3 tint){
#if RAYS > 0
  if (r.z < .002) return vec3(0.);
  vec2 d = (r.xy - uv) * (.92 / float(RAYS));
  vec2 p = uv + d * ign(uv * uRes);
  vec3 acc = vec3(0.); float w = 1.;
  for (int i = 0; i < RAYS; i++){
    vec3 s = min(S(texture2D(t, p).rgb), vec3(6.));
    float l = max(s.r, max(s.g, s.b));
    float ins = step(0., p.x) * step(p.x, 1.) * step(0., p.y) * step(p.y, 1.);
    acc += s * smoothstep(r.w, r.w * 1.8, l) * w * ins;
    w *= .94; p += d;
  }
  vec2 q = (r.xy - uv) * vec2(uRes.x / uRes.y, 1.);
  return acc / float(RAYS) * r.z * tint / (1. + 1.6 * dot(q, q));
#else
  return vec3(0.);
#endif
}
void main(){
  vec3 a = dof(tA, dA, vUv, uNFA, uDofA) + rays(tA, vUv, uRayA, uRayColA);
  vec3 col = a;
  if (uHasB > .5){
    vec3 b = dof(tB, dB, vUv, uNFB, uDofB) + rays(tB, vUv, uRayB, uRayColB);
    vec2 asp = vec2(uRes.x / uRes.y, 1.);
    float dist = length((vUv - uCenter) * asp);
    float maxR = length(max(uCenter, 1. - uCenter) * asp) + .02;
    float r = uMix * uMix * (3. - 2. * uMix) * maxR * 1.02;
    float edge = .006 + .02 * (1. - uMix);
    float m = 1. - smoothstep(r - edge, r, dist);
    col = mix(a, b, m);
    float ring = exp(-pow((dist - r) / (.0035 + .006 * uMix), 2.)) * smoothstep(0., .05, uMix) * (1. - smoothstep(.85, 1., uMix));
    col += uRing * ring * 3.;
  }
  gl_FragColor = vec4(S(col), 1.);
}`

const FINAL_F = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tC; uniform float uExposure; uniform float uTime; uniform float uCA; uniform float uRadial; uniform vec2 uRC;
uniform vec3 uLift; uniform vec3 uGain; uniform float uSat; uniform float uVig; uniform float uGrain; uniform vec2 uRes; uniform float uFade; uniform vec3 uFadeCol;
vec3 aces(vec3 x){ // Narkowicz ACES fit, with the sRGB→ACEScg-ish input tweak three uses
  x *= .6;
  return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv, d = uv - uRC;
  vec3 col;
  if (uRadial > .0005){
    col = vec3(0.); float wsum = 0.;
    for (int i = 0; i < 12; i++){ float k = float(i) / 11.; float w = 1. - k * .6; col += texture2D(tC, uv - d * uRadial * k).rgb * w; wsum += w; }
    col /= wsum;
  } else col = texture2D(tC, uv).rgb;
  if (uCA > .0002){
    vec2 o = d * uCA;
    col.r = mix(col.r, texture2D(tC, uv + o).r, .9);
    col.b = mix(col.b, texture2D(tC, uv - o).b, .9);
  }
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, uSat);
  col = col * uGain + uLift * (1. - col);
  vec2 q = (uv - .5) * vec2(uRes.x / uRes.y, 1.);
  col *= 1. - uVig * smoothstep(.35, 1.25, length(q));
  col = toSRGB(clamp(col, 0., 1.));
  float g = h(uv * uRes + fract(uTime * 7.3) * 91.7) - .5;
  col += g * uGrain * (1.2 - l);
  col = mix(col, uFadeCol, uFade);
  gl_FragColor = vec4(col, 1.);
}`

export class Engine {
  constructor(canvas, tier) {
    this.tier = tier
    this.canvas = canvas
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false })
    r.outputColorSpace = THREE.LinearSRGBColorSpace
    r.toneMapping = THREE.NoToneMapping
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    r.setClearColor(0x0b1f15, 1)
    this.pmrem = new THREE.PMREMGenerator(r)
    this.w = 1; this.h = 1; this.dpr = 1; this.dprScale = 1
    const mk = () => {
      const t = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: tier.msaa })
      t.depthTexture = new THREE.DepthTexture(4, 4)
      t.depthTexture.type = THREE.UnsignedIntType
      return t
    }
    this.rtA = mk(); this.rtB = mk()
    this.rtC = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })
    this.comp = new FullScreenQuad(new THREE.ShaderMaterial({
      defines: { TAPS: tier.taps, RAYS: tier.name === 'high' ? 18 : tier.name === 'mid' ? 10 : 0 },
      uniforms: {
        tA: { value: this.rtA.texture }, tB: { value: this.rtB.texture }, dA: { value: this.rtA.depthTexture }, dB: { value: this.rtB.depthTexture },
        uNFA: { value: new THREE.Vector2(0.1, 100) }, uNFB: { value: new THREE.Vector2(0.1, 100) },
        uDofA: { value: new THREE.Vector3(5, 2, 0) }, uDofB: { value: new THREE.Vector3(5, 2, 0) },
        uMix: { value: 0 }, uHasB: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uRes: { value: new THREE.Vector2(1, 1) },
        uRing: { value: new THREE.Color(1.0, 0.62, 0.12) },
        uRayA: { value: new THREE.Vector4(0.5, 0.5, 0, 1.1) }, uRayB: { value: new THREE.Vector4(0.5, 0.5, 0, 1.1) },
        uRayColA: { value: new THREE.Color(1, 1, 1) }, uRayColB: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: QUAD_V, fragmentShader: COMPOSITE_F, depthTest: false, depthWrite: false,
    }))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.9)
    this.final = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tC: { value: this.rtC.texture }, uExposure: { value: 1 }, uTime: { value: 0 }, uCA: { value: 0 }, uRadial: { value: 0 }, uRC: { value: new THREE.Vector2(0.5, 0.5) },
        uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uVig: { value: 0.45 }, uGrain: { value: 0.05 },
        uRes: { value: new THREE.Vector2(1, 1) }, uFade: { value: 0 }, uFadeCol: { value: new THREE.Color(0.043, 0.122, 0.082) },
      },
      vertexShader: QUAD_V, fragmentShader: FINAL_F, depthTest: false, depthWrite: false,
    }))
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3()
  }

  setSize(w, h) {
    this.w = w; this.h = h
    const dev = Math.min(window.devicePixelRatio || 1, 2)
    this.dpr = Math.max(0.5, Math.min(dev, Math.sqrt(this.tier.pixels / (w * h))) * this.dprScale)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    const W = Math.round(w * this.dpr), H = Math.round(h * this.dpr)
    // A resized target must be rebuilt as a framebuffer before anything samples its textures. Otherwise the composite
    // (which always has tB/dB bound) uploads them as plain textures first, and the next transition then renders into an
    // incomplete framebuffer: an empty frame for the whole iris. So: size the depth textures too, and set each up now.
    for (const t of [this.rtA, this.rtB, this.rtC]) {
      t.setSize(W, H)
      if (t.depthTexture) { t.depthTexture.image.width = W; t.depthTexture.image.height = H; t.depthTexture.needsUpdate = true }
      this.renderer.initRenderTarget(t)
    }
    this.bloom.setSize(Math.round(W * this.tier.bloomScale * 2), Math.round(H * this.tier.bloomScale * 2))
    this.comp.material.uniforms.uRes.value.set(W, H)
    this.final.material.uniforms.uRes.value.set(W, H)
  }

  /** Screen position (0..1, y up) of a world point seen by a camera. */
  project(p, cam, out = new THREE.Vector2()) {
    this._v.copy(p).project(cam)
    return out.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5)
  }

  frameCamera(stage) {
    const cam = stage.camera, W = this.w, H = this.h, aspect = W / H
    cam.aspect = aspect
    const portrait = aspect < 1
    // Keep compositions: on a tall screen widen the vertical field so the subject keeps its width.
    // main.js steadies the field of view and the picture's offset (stage._fov, _frame), and opens the view a little while the scroll is fast
    const base = (stage._fov ?? stage.fov) + (this.fovKick || 0)
    const widen = portrait ? Math.pow(Math.min(2.4, (16 / 9) / aspect / 1.15), 0.62) : 1
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) * widen))
    const f = portrait ? (stage._framePortrait || stage.framePortrait) : (stage._frame || stage.frame)
    cam.setViewOffset(W, H, -f[0] * W, f[1] * H, W, H)
    cam.updateProjectionMatrix()
  }

  /** Light shafts for one stage: where its light (stage.rayFrom, or its sun) sits on screen, faded out as it goes behind the camera. */
  ray(stage, u, col) {
    const L = stage.look, s = L.rays || 0
    if (!(s > 0)) { u.value.z = 0; return }
    const cam = stage.camera, p = this._v
    if (stage.rayFrom) p.copy(stage.rayFrom); else p.copy(stage.sun).multiplyScalar(cam.far * 0.5).add(cam.position)
    const facing = this._v2.copy(p).sub(cam.position).normalize().dot(cam.getWorldDirection(this._v3))
    const k = Math.min(1, Math.max(0, (facing - 0.05) / 0.3))
    p.project(cam)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { u.value.z = 0; return }
    u.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, s * k * k * (3 - 2 * k), L.rayThreshold || 1.1)
    if (L.rayTint) col.value.copy(L.rayTint); else col.value.setRGB(1, 0.92, 0.74)
  }

  render(A, B, mix, center, time, look) {
    const r = this.renderer, cu = this.comp.material.uniforms, fu = this.final.material.uniforms
    const shadowA = A.scene
    r.shadowMap.needsUpdate = true
    r.setRenderTarget(this.rtA); r.render(shadowA, A.camera)
    cu.uNFA.value.set(A.camera.near, A.camera.far)
    this.ray(A, cu.uRayA, cu.uRayColA)
    cu.uDofA.value.set(A.post.focus, A.post.range, A.post.dof * this.dpr * (this.tier.taps < 10 ? 0.6 : 1))
    if (B) {
      r.setRenderTarget(this.rtB); r.render(B.scene, B.camera)
      cu.uNFB.value.set(B.camera.near, B.camera.far)
      this.ray(B, cu.uRayB, cu.uRayColB)
      cu.uDofB.value.set(B.post.focus, B.post.range, B.post.dof * this.dpr * (this.tier.taps < 10 ? 0.6 : 1))
      cu.tB.value = this.rtB.texture; cu.dB.value = this.rtB.depthTexture
      cu.uHasB.value = 1; cu.uMix.value = Number.isFinite(mix) ? mix : 1
      // A match point behind or on the camera plane projects to Inf/NaN: keep the iris centre on screen.
      cu.uCenter.value.set(Number.isFinite(center.x) ? Math.min(1.2, Math.max(-0.2, center.x)) : 0.5, Number.isFinite(center.y) ? Math.min(1.2, Math.max(-0.2, center.y)) : 0.5)
    } else { cu.uHasB.value = 0; cu.tB.value = this.rtA.texture; cu.dB.value = this.rtA.depthTexture } // never sample a target that was not drawn this frame
    if (this.lite) { cu.uDofA.value.z = 0; cu.uDofB.value.z = 0; cu.uRayA.value.z = 0; cu.uRayB.value.z = 0 } // a struggling device: no depth of field, no shafts
    r.setRenderTarget(this.rtC); this.comp.render(r)
    this.bloom.strength = look.bloom; this.bloom.threshold = look.threshold; this.bloom.radius = look.bloomRadius
    this.bloom.render(r, null, this.rtC, 0.016, false)
    r.setRenderTarget(null)
    fu.uExposure.value = look.exposure; fu.uTime.value = time; fu.uCA.value = look.ca; fu.uRadial.value = look.radial
    fu.uRC.value.copy(look.rc); fu.uLift.value.copy(look.lift); fu.uGain.value.copy(look.gain); fu.uSat.value = look.sat
    fu.uVig.value = look.vig; fu.uGrain.value = look.grain; fu.uFade.value = look.fade
    this.final.render(r)
  }

  /** An environment map from a few emissive shapes (a sky gradient and a sun), for reflections on skin and wax. */
  env({ top = '#7fa8d8', mid = '#f2d9a8', bottom = '#2a3a22', sun = '#fff1c8', sunDir = new THREE.Vector3(0.5, 0.6, 0.3), sunPower = 6, extra = null } = {}) {
    const s = new THREE.Scene()
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { a: { value: new THREE.Color(top) }, b: { value: new THREE.Color(mid) }, c: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 a; uniform vec3 b; uniform vec3 c; varying vec3 vP; void main(){ float y = vP.y; vec3 col = y > 0. ? mix(b, a, pow(y, .6)) : mix(b, c, pow(-y, .4)); gl_FragColor = vec4(col, 1.); }',
    }))
    s.add(sky)
    const disc = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(sun).multiplyScalar(sunPower) }))
    disc.position.copy(sunDir).normalize().multiplyScalar(8)
    s.add(disc)
    if (extra) extra(s)
    const rt = this.pmrem.fromScene(s, 0.02)
    s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
    return rt.texture
  }
}
