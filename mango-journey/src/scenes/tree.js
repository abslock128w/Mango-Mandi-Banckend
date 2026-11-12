// Chapter 2: "Then it takes its time. Fifty summers of it."
// A time-lapse. A procedural mango tree grows from a two-leaf sapling into a broad, dense-domed tree: a short thick
// trunk splitting low into heavy limbs, generated once by seeded recursive branching inside a crown envelope. All
// branches are one merged geometry whose vertex shader grows each segment from its base at its own birth time,
// thickens older wood as the tree ages and sways tips in the wind (the shadow pass runs the same growth); old bark
// gathers moss and lichen. Instanced leaves open in whorls at the twig tips. The mature crown is built from rounded
// clumps at the branch ends: each clump is a dozen cards painted with whorls of long, narrow, drooping leaves, lit
// with the clump's own rounded normal blended with the dome's, so the crown models like a real tree (sunlit top and
// side, deep interior, sky-blue bounce, back-lit translucent rim, glints off single leaves, wet gloss in the rain).
// New growth comes in coppery bronze flushes that green over the years; at the very end a pale haze of blossom
// panicles appears on the crown. The orchard is the same tree, instanced and cheaper, with soft ground shadows and
// haze. The sky wheels through days and nights (moon, stars, fireflies), a monsoon (grey-green light, rain, one
// lightning flash that back-lights the whole tree), then washed, saturated post-rain light. The camera makes one
// slow spiral up and out.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Stage, aim, skyDome, motes } from './stage.js'
import { leafMaterial, leafDepthMaterial } from '../lib/mango.js'
import { NOISE } from '../lib/glsl.js'
import { rng, clamp, lerp, smooth, smoother, easeInOut, canvasTex } from '../lib/util.js'

const MAXD = 5
const CROWN_C = new THREE.Vector3(0, 4.9, 0)
const CROWN_R = new THREE.Vector3(5.9, 3.7, 5.9)
const SPEED = 0.073 // growth time per metre of wood (g runs 0…1)
const MOON = new THREE.Vector3(-0.55, 0.36, -0.75).normalize()
const BOLT = new THREE.Vector3(-0.2, 0.42, -1).normalize()

// ---- A painted sky (also used by the road): the stage's gradient, sun and haze, plus billowing clouds lit from the sun's
// side with silver linings (they can cover the sun, which is what throws light shafts), crisp pixel-sized stars in two
// layers, a milky band with dust lanes, one shooting star, and a rainbow. Same uniforms as stage.skyDome, plus extras.
export function paintSky(radius = 300) {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
  const u = {
    uTop: { value: new THREE.Color('#2f6fb8') }, uHor: { value: new THREE.Color('#f4d9a0') }, uBot: { value: new THREE.Color('#2a3020') },
    uSunDir: { value: V3(0.3, 0.4, -1).normalize() }, uSunCol: { value: new THREE.Color(1, 0.85, 0.55) }, uSunSize: { value: 0.035 },
    uStars: { value: 0 }, uClouds: { value: 0.4 }, uCloudCol: { value: new THREE.Color('#fff2e0') }, uCloudShade: { value: new THREE.Color('#8a7a80') }, uTime: { value: 0 },
    uHaze: { value: 0.35 }, uSunGlow: { value: 1 }, uCloudSpeed: { value: 0.004 },
    uCloudScale: { value: 1 }, uCloudSun: { value: 1 }, uCloudLow: { value: 0.13 }, uMilky: { value: 0 }, uMilkyAxis: { value: V3(0.42, 0.5, 0.76).normalize() },
    uMeteor: { value: 0 }, uMetA: { value: V3(-0.5, 0.6, -0.6).normalize() }, uMetB: { value: V3(-0.1, 0.35, -0.9).normalize() },
    uBow: { value: 0 }, uBowDir: { value: V3(0, -0.2, 1).normalize() }, uBowR: { value: 0.72 }, uStarK: { value: 1 },
  }
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: u, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHor, uBot, uSunDir, uSunCol, uCloudCol, uCloudShade, uMilkyAxis, uMetA, uMetB, uBowDir;
      uniform float uSunSize, uStars, uClouds, uTime, uHaze, uSunGlow, uCloudSpeed, uCloudScale, uCloudSun, uCloudLow, uMilky, uMeteor, uBow, uBowR, uStarK;
      varying vec3 vD;
      ${NOISE}
      float starLayer(vec3 d, float sc, float thr, float w){
        vec3 sp = d * sc; vec3 c = floor(sp); vec3 f = fract(sp);
        float h = mmHash(c);
        vec3 o = vec3(mmHash(c + 7.1), mmHash(c + 3.3), mmHash(c + 5.9)) * .6 + .2;
        float r = length(f - o);
        float m = clamp((h - thr) / (1. - thr), 0., 1.);
        float rad = w * sc * (.5 + m * .9);
        return step(thr, h) * smoothstep(rad, rad * .2, r) * (.3 + m * m * 2.6) * (.75 + .25 * sin(uTime * 2.6 + h * 97.));
      }
      void main(){
        vec3 d = normalize(vD); float y = d.y;
        float pw = length(fwidth(d)); // the size of a pixel on the dome
        float gy = pow(clamp(y, 0., 1.), .42);
        // through a pale azure midpoint, so a warm horizon and a blue zenith never meet in lavender grey
        vec3 lw = vec3(.3, .5, .2); vec3 mid0 = mix(uHor, uTop, .5); float mL = dot(mid0, lw);
        vec3 midC = mix(vec3(mL) * 1.05, uTop * mL / max(dot(uTop, lw), 1e-3), .32);
        vec3 col = y > 0. ? (gy < .5 ? mix(uHor, midC, gy * 2.) : mix(midC, uTop, gy * 2. - 1.)) : mix(uHor, uBot, pow(clamp(-y * 3., 0., 1.), .5));
        vec3 sdir = normalize(uSunDir);
        float sd = dot(d, sdir);
        col += uSunCol * (pow(max(sd, 0.), 6.) * .45 + pow(max(sd, 0.), 60.) * .9) * uSunGlow;
        col = mix(col, uHor * 1.05, exp(-abs(y) * 9.) * uHaze);
        float hz = smoothstep(0., .22, y);
        // the milky band and the stars
        if (uStars > .01 && y > -.02){
          float gb = dot(d, uMilkyAxis);
          float band = exp(-gb * gb / .03) * uMilky;
          if (uMilky > .01){
            float mw = mmFbm(d * 3.2 + 2.);
            float lanes = smoothstep(.42, .66, mmFbm(d * 7.5 + 9.)) * exp(-gb * gb / .006);
            vec3 mc = mix(vec3(.42, .5, .78), vec3(.9, .8, .66), smoothstep(.3, .7, mmNoise(d * 2.5)));
            col += mc * band * (.2 + .9 * mw) * (1. - lanes * .75) * .14 * uStars * hz;
          }
          float st = starLayer(d, 150., .998 - band * .02, pw) * 1.6 + starLayer(d, 330., .9968 - band * .04, pw) * .85 + starLayer(d, 620., .9968 - band * .07, pw) * .5;
          col += vec3(1., .96, .88) * st * uStars * uStarK * smoothstep(-.02, .2, y);
        }
        // a shooting star
        if (uMeteor > .001 && uMeteor < .999){
          vec3 H = normalize(mix(uMetA, uMetB, uMeteor)), Tl = normalize(mix(uMetA, uMetB, max(uMeteor - .3, 0.)));
          vec3 ab = H - Tl; float s = clamp(dot(d - Tl, ab) / max(dot(ab, ab), 1e-6), 0., 1.);
          float dist = length(d - (Tl + ab * s));
          col += vec3(1., .95, .85) * smoothstep(pw * 1.8, 0., dist) * s * s * sin(uMeteor * 3.14159) * 5. * uStars;
        }
        // a rainbow
        if (uBow > .01){
          float a = acos(clamp(dot(d, normalize(uBowDir)), -1., 1.));
          float x = (a - uBowR) / .045;
          vec3 spec = clamp(abs(fract((1. - clamp(x * .5 + .5, 0., 1.)) * .78 + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.);
          float k = smoothstep(1., .55, abs(x)) * smoothstep(-.02, .12, y);
          col += spec * k * uBow * .22 + vec3(.06) * smoothstep(0., -2., x) * smoothstep(-6., -2., x) * uBow * k;
        }
        // clouds on a flat ceiling: billowing, lit from the sun's side, with a silver lining
        float c = 0.;
        if (uClouds > .01 && y > .0){
          vec2 wind = vec2(uTime * uCloudSpeed * 10., uTime * uCloudSpeed * 4.);
          vec2 cp = d.xz / (y + .1) * uCloudScale + wind;
          vec2 wq = vec2(mmFbm2(cp * .32 + 5.), mmFbm2(cp * .32 + 11.));
          vec2 q = cp * .55 + (wq - .5) * 1.5;
          float n = mmFbm2(q);
          vec2 sxz = sdir.xz / (length(sdir.xz) + 1e-4);
          float n2 = mmFbm2(q + sxz * .14);
          float cov = .64 - uClouds * .36;
          c = smoothstep(cov, cov + .2, n) * smoothstep(.015, uCloudLow, y);
          float lit = clamp(.55 + (n - n2) * 7. * uCloudSun, 0., 1.);
          float thick = smoothstep(cov + .05, cov + .45, n);
          vec3 cc = mix(uCloudShade, uCloudCol, lit * (1. - thick * .45));
          float edge = 1. - smoothstep(cov, cov + .16, n);
          cc += uSunCol * pow(max(sd, 0.), 6.) * (.35 + edge * 2.6) * uCloudSun;
          cc = mix(cc, uHor * 1.02, exp(-y * 7.) * .55 * uHaze + .0);
          col = mix(col, cc, c * .96);
        }
        // the disc, hidden by the clouds that pass over it
        col += uSunCol * smoothstep(1. - uSunSize * .02, 1. - uSunSize * .016, sd) * 12. * uSunGlow * (1. - c * .92);
        gl_FragColor = vec4(col, 1.);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), m)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  mesh.userData.u = u
  return mesh
}

/** Gentle rolling ground around the tree: flat at the foot, swelling with distance. The same formula in GLSL below. */
export const groundH = (x, z) => {
  const r = Math.hypot(x, z), k = smooth(9, 45, r), f = smooth(100, 300, r)
  return k * (1.1 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.4) + 0.6 * Math.sin(x * 0.021 - z * 0.03 + 2) + 0.3 * Math.sin(x * 0.11 + z * 0.07)) + f * (6 + 5 * Math.sin(Math.atan2(z, x) * 3 + 1))
}
const GROUND_GLSL = /* glsl */ `
float gSm(float a, float b, float v){ float t = clamp((v - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
float groundH(vec2 p){ float r = length(p), k = gSm(9., 45., r), f = gSm(100., 300., r);
  return k * (1.1 * sin(p.x * .045 + 1.3) * cos(p.y * .038 - .4) + .6 * sin(p.x * .021 - p.y * .03 + 2.) + .3 * sin(p.x * .11 + p.y * .07)) + f * (6. + 5. * sin(atan(p.y, p.x) * 3. + 1.)); }
`

// ---- Growth (shared by the bark and its shadow) ---------------------------------------------------------------------
const GROW_PARS = /* glsl */ `
attribute vec3 aAxis; attribute vec3 aBase; attribute vec2 aBirth; attribute float aH; attribute float aTop; attribute float aTB; varying float vYoung;
uniform float uG; uniform float uTime; uniform float uWind;
`
const GROW_VERT = /* glsl */ `
  float gr = smoothstep(aBirth.x, aBirth.x + aBirth.y, uG);
  float th = mix(.016, 1., pow(smoothstep(aTB, 1., uG), 1.25)) * mix(1., .18, aTop * (1. - gr));
  vYoung = 1. - smoothstep(aTB, aTB + .1 + .25 * step(aTB, .01), uG);
  vec3 ax = aBase + (aAxis - aBase) * gr;
  vec3 transformed = ax + (position - aAxis) * th;
  if (uG <= aBirth.x) transformed = aBase;
  float sw = aH * aH * uWind;
  transformed.x += sin(uTime * 1.3 + aH * 2.1 + aBase.z) * sw;
  transformed.z += cos(uTime * 1.1 + aH * 2.7 + aBase.x) * sw * .7;
`
function injectGrowth(m, u, color = false) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + GROW_PARS + (color ? 'varying vec4 vBW;' : ''))
      .replace('#include <begin_vertex>', GROW_VERT + (color ? '\nvBW = vec4(transformed, objectNormal.y);' : ''))
    if (!color) return
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vYoung; varying vec4 vBW; uniform float uMoss; uniform float uWet;\n${NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.24, .25, .08), vYoung * .85);
        {
          // moss on the shaded, upward and lower faces of old wood; pale lichen; dark when wet
          float mn = mmFbm(vBW.xyz * vec3(2.2, .8, 2.2));
          float moss = smoothstep(.5, .74, mn + vBW.w * .22 - smoothstep(.6, 5., vBW.y) * .28) * uMoss;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.045, .075, .022) * (.7 + mn * .6), moss * .6);
          float li = smoothstep(.72, .82, mmNoise(vBW.xyz * vec3(16., 6., 16.)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.3, .32, .26), li * .25 * uMoss * (1. - moss));
          diffuseColor.rgb *= mix(1., .55, uWet);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .32, uWet);')
  }
}

// ---- Painted textures ------------------------------------------------------------------------------------------------

/** Four whorls of long, narrow, drooping mango leaves (2×2 atlas). Data, not colour: R = shade, G = leaf id,
    B = midrib, A = cut-out. The shader turns them into glossy green or coppery new growth. */
function whorlAtlas() {
  return canvasTex(1024, 1024, (g) => {
    const r = rng(612)
    const leaf = (cx, cy, a, L, id, front) => {
      const d = [Math.sin(a), Math.cos(a)]
      const c1 = [cx + d[0] * L * 0.55, cy + d[1] * L * 0.55]
      const bd = [d[0], d[1] + 1.15]; const bl = Math.hypot(bd[0], bd[1])
      const e = [c1[0] + (bd[0] / bl) * L * 0.5, c1[1] + (bd[1] / bl) * L * 0.5]
      const P = (s) => [(1 - s) * (1 - s) * cx + 2 * (1 - s) * s * c1[0] + s * s * e[0], (1 - s) * (1 - s) * cy + 2 * (1 - s) * s * c1[1] + s * s * e[1]]
      const Tn = (s) => { const x = 2 * (1 - s) * (c1[0] - cx) + 2 * s * (e[0] - c1[0]), y = 2 * (1 - s) * (c1[1] - cy) + 2 * s * (e[1] - c1[1]); const l = Math.hypot(x, y) || 1; return [x / l, y / l] }
      const wh = L * (0.1 + r() * 0.03)
      const w = (s) => wh * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 0.85) * (1 - 0.2 * s)
      const N = 26
      const base = 0.18 + front * 0.12
      for (const side of [1, -1]) {
        g.beginPath()
        for (let i = 0; i <= N; i++) { const s = i / N, p = P(s); g.lineTo(p[0], p[1]) }
        for (let i = N; i >= 0; i--) { const s = i / N, p = P(s), t = Tn(s), ww = w(s) * side; g.lineTo(p[0] - t[1] * ww, p[1] + t[0] * ww) }
        g.closePath()
        const k = side > 0 ? 0.1 : -0.08
        const gr = g.createLinearGradient(cx, cy, e[0], e[1])
        const col = (v) => `rgb(${Math.round(clamp(v + k) * 255)},${id},0)`
        gr.addColorStop(0, col(base)); gr.addColorStop(0.45, col(base + 0.48)); gr.addColorStop(1, col(base + 0.36))
        g.fillStyle = gr; g.fill()
        g.strokeStyle = `rgb(${Math.round((base * 0.6) * 255)},${id},0)`; g.lineWidth = 1.4; g.stroke()
      }
      g.beginPath(); for (let i = 0; i <= N - 1; i++) { const p = P(i / N); g.lineTo(p[0], p[1]) }
      g.strokeStyle = `rgb(${Math.round((base + 0.4) * 255)},${id},255)`; g.lineWidth = 2.6; g.stroke()
    }
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2) * 512, oy = Math.floor(q / 2) * 512
      g.save(); g.beginPath(); g.rect(ox + 2, oy + 2, 508, 508); g.clip()
      // sprays rather than one star: several small rosettes hang from twigs at different heights, their leaves drooping
      // (none points straight up), so up close a card reads as overlapping foliage, not a starburst
      const twig = (x0, y0, x1, y1) => { g.strokeStyle = 'rgb(40,10,0)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 20, x1, y1); g.stroke() }
      const spray = (cx, cy, n, sc, front) => {
        const W = []
        for (let k = 0; k < n; k++) {
          const a = (r() * 2 - 1) * (1.15 + r() * 0.75)
          W.push({ a, len: (120 + r() * 110) * sc, id: Math.round(20 + r() * 230), down: Math.cos(a) })
        }
        W.sort((A, B) => A.down - B.down)
        for (const l of W) leaf(cx + (r() - 0.5) * 14 * sc, cy + (r() - 0.5) * 10 * sc, l.a, l.len, l.id, clamp(front + 0.3 * l.down + (r() - 0.5) * 0.15, 0, 1))
      }
      const S = []
      for (let k = 0; k < 6; k++) S.push({ x: ox + 70 + r() * 372, y: oy + 50 + Math.pow(r(), 0.8) * 260, sc: 0.42 + r() * 0.36 })
      S.sort((A, B) => A.y - B.y)
      for (let k = 1; k < S.length; k++) if (r() < 0.6) twig(S[k - 1].x, S[k - 1].y, S[k].x, S[k].y)
      S.forEach((o, k) => spray(o.x, o.y, 6 + Math.floor(r() * 4), o.sc, 0.12 + (k / S.length) * 0.4))
      g.restore()
    }
  }, { srgb: false, aniso: 8 })
}

/** Fissured, platey mango bark with lichen (tiles in both directions). */
function barkTex() {
  const draw = (g, W, H) => {
    const r = rng(19)
    g.fillStyle = '#54473b'; g.fillRect(0, 0, W, H)
    const wrap = (f) => { for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) { g.save(); g.translate(dx, dy); f(); g.restore() } }
    for (let i = 0; i < 1500; i++) {
      const x = r() * W, y = r() * H, c = r()
      g.fillStyle = c < 0.5 ? `rgba(118,104,88,${0.08 + r() * 0.16})` : c < 0.8 ? `rgba(40,32,24,${0.1 + r() * 0.16})` : `rgba(96,98,84,${0.08 + r() * 0.12})`
      g.beginPath(); g.ellipse(x, y, 3 + r() * 14, 6 + r() * 26, 0, 0, 7); g.fill()
    }
    // plates
    for (let i = 0; i < 520; i++) {
      const x = r() * W, y = r() * H, w = 10 + r() * 22, h = 18 + r() * 46
      const f = () => { g.fillStyle = `rgba(${130 + r() * 30},${116 + r() * 26},${98 + r() * 20},${0.18 + r() * 0.22})`; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.9, y + h * 0.1); g.lineTo(x + w, y + h * 0.85); g.lineTo(x + w * 0.15, y + h); g.closePath(); g.fill() }
      if (x < 40 || x > W - 40 || y < 70 || y > H - 70) wrap(f); else f()
    }
    // fissures
    for (let i = 0; i < 90; i++) {
      let x = r() * W, y = r() * H
      const len = 120 + r() * 520, lw = 1.5 + r() * 4.5, pts = []
      for (let s = 0; s < len; s += 10) { pts.push([x, y + s]); x += (r() - 0.5) * 7 }
      wrap(() => { g.strokeStyle = `rgba(22,16,11,${0.6 + r() * 0.3})`; g.lineWidth = lw; g.beginPath(); pts.forEach((p) => g.lineTo(p[0], p[1])); g.stroke() })
    }
    // lichen
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = r() * H, s = 4 + r() * 12
      wrap(() => { for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(${150 + r() * 30},${158 + r() * 30},${130 + r() * 20},${0.2 + r() * 0.25})`; g.beginPath(); g.arc(x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s * 2, 1 + r() * s * 0.5, 0, 7); g.fill() } })
    }
  }
  const map = canvasTex(256, 512, draw, { repeat: true, aniso: 8 })
  const bump = new THREE.CanvasTexture(map.image)
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 4
  return { map, bump }
}

/** A dry fallen leaf: tan to rust, pale midrib. Along +x. */
function dryLeafTex() {
  return canvasTex(256, 64, (g, W, H) => {
    const cy = H / 2, x0 = 6, L = W - 12, wAt = (t) => H * 0.42 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9)
    g.beginPath(); g.moveTo(x0, cy)
    for (let i = 0; i <= 60; i++) { const t = i / 60; g.lineTo(x0 + t * L, cy - wAt(t)) }
    for (let i = 60; i >= 0; i--) { const t = i / 60; g.lineTo(x0 + t * L, cy + wAt(t)) }
    g.closePath()
    const gr = g.createLinearGradient(0, 0, W, 0)
    gr.addColorStop(0, '#6e5a42'); gr.addColorStop(0.5, '#9c8462'); gr.addColorStop(1, '#86694a')
    g.fillStyle = gr; g.fill()
    g.save(); g.clip()
    const r = rng(4)
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '90,50,24' : '200,170,110'},${0.15 + r() * 0.25})`; g.beginPath(); g.ellipse(x0 + r() * L, cy + (r() - 0.5) * H * 0.6, 4 + r() * 14, 2 + r() * 5, 0, 0, 7); g.fill() }
    g.restore()
    g.strokeStyle = 'rgba(235,215,160,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + L * 0.97, cy); g.stroke()
  }, { aniso: 4 })
}

/** A mango panicle: a cone of tiny cream and blush flowers on a reddish stalk. Base at the bottom. */
function panicleTex() {
  // an open, branched pyramid: a pink-red rachis, laterals that rise and fork, little clusters of flowers at their ends
  // with sky between them (a dense cone read as a candle)
  return canvasTex(256, 256, (g, W, H) => {
    const r = rng(33)
    const cx = W / 2, top = 18, bot = H - 6
    const flowers = (x, y, n, sp) => {
      for (let i = 0; i < n; i++) {
        const fx = x + (r() - 0.5) * sp, fy = y + (r() - 0.5) * sp * 0.8, rad = 1.7 + r() * 2.2, c = r()
        g.fillStyle = c < 0.4 ? '#f8f0da' : c < 0.65 ? '#f1dfa6' : c < 0.88 ? '#eab7a0' : '#c4503c'
        for (let p = 0; p < 5; p++) { const a = p * 1.2566 + r(); g.beginPath(); g.arc(fx + Math.cos(a) * rad * 0.7, fy + Math.sin(a) * rad * 0.7, rad * 0.55, 0, 7); g.fill() }
        g.fillStyle = '#d88a3a'; g.beginPath(); g.arc(fx, fy, rad * 0.35, 0, 7); g.fill()
      }
    }
    g.lineCap = 'round'
    g.strokeStyle = '#b4584a'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(cx, bot); g.quadraticCurveTo(cx + 6, (top + bot) / 2, cx + 2, top); g.stroke()
    const NL = 9
    for (let i = 0; i < NL; i++) {
      const s = i / NL, y = bot - 22 - s * (bot - top - 30), side = i % 2 ? 1 : -1
      const len = (1 - s) * 92 + 14, ang = 0.75 + r() * 0.35
      const ex = cx + side * Math.sin(ang) * len, ey = y - Math.cos(ang) * len
      g.strokeStyle = '#c0705a'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + side * len * 0.5, y - 4, ex, ey); g.stroke()
      // two forks with flower clusters, and one at the tip
      for (const f of [0.45, 0.75]) {
        const bx = cx + side * len * 0.5 * f * 1.6, by = y - (y - ey) * f
        const fx2 = bx + side * 12 * (1 - s), fy2 = by - 14
        g.lineWidth = 1.1; g.beginPath(); g.moveTo(bx, by); g.lineTo(fx2, fy2); g.stroke()
        flowers(fx2, fy2, 3 + Math.floor(r() * 3), 14)
      }
      flowers(ex, ey, 4 + Math.floor(r() * 3), 18 * (1 - s * 0.5))
    }
    flowers(cx + 2, top + 6, 5, 14)
  }, { aniso: 4 })
}

// ---- Geometry helpers ------------------------------------------------------------------------------------------------

/** The leaf blade of lib/mango.js with fewer segments (thousands are instanced). Base at the origin, along +x. */
function lowLeaf(len = 1, fold = 0.22, droop = 0.16, sx = 6) {
  const g = new THREE.PlaneGeometry(1, 0.3, sx, 2)
  g.translate(0.5, 0, 0)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setXYZ(i, x * len, y * len, (Math.abs(y) * fold - x * x * droop) * len) }
  g.computeVertexNormals()
  return g
}
function cardGeo(seg) {
  const g = new THREE.PlaneGeometry(1, 1, seg, seg)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -(x * x + y * y) * 0.35) }
  g.computeVertexNormals()
  return g
}
/** An orthonormal frame whose +z faces n and whose +y is as close to world-up as it can be. */
function faceQuat(n, roll = 0) {
  const z = n.clone().normalize()
  let up = new THREE.Vector3(0, 1, 0)
  if (Math.abs(z.y) > 0.92) up = new THREE.Vector3(z.x, 0, z.z).lengthSq() > 1e-6 ? new THREE.Vector3(-z.x, 0, -z.z).normalize() : new THREE.Vector3(0, 0, 1)
  const x = new THREE.Vector3().crossVectors(up, z).normalize()
  const y = new THREE.Vector3().crossVectors(z, x)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll))
}

// ---- Foliage material ------------------------------------------------------------------------------------------------
// Per instance: aClump (clump centre, radius), aCrown (crown centre, how much of the dome's normal to blend in),
// aInfo (atlas cell offset, flush phase, baked occlusion), aTree (orchard tree origin x/z, 1 for orchard cards: those
// scale about their tree's foot by uOrchK, so the orchard grows without touching instance matrices).
const FOL_VERT_PARS = /* glsl */ `
attribute vec4 aClump; attribute vec4 aCrown; attribute vec4 aInfo; attribute vec3 aTree;
uniform float uTime; uniform float uWind; uniform float uOrchK; uniform float uG; uniform vec3 uCrownR;
varying vec4 vF; varying vec3 vGN;
vec3 orchP(vec3 p){ if (aTree.z > .5) { vec3 o = vec3(aTree.x, aTree.z - 10., aTree.y); return o + (p - o) * uOrchK; } return p; }
`
const FOL_WIND = /* glsl */ `
  vec4 mvPosition = instanceMatrix * vec4(transformed, 1.);
  vec4 wp = modelMatrix * mvPosition; wp.xyz = orchP(wp.xyz);
  float wph = dot(wp.xyz, vec3(.5, .3, .7));
  wp.xyz += vec3(sin(uTime * 1.4 + wph), sin(uTime * 2.1 + wph) * .35, cos(uTime * 1.1 + wph)) * uWind * (.6 + vF.z);
  mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
`
function foliageMaterial(map, U) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, envMapIntensity: 0.55 })
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + FOL_VERT_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * .5 + aInfo.xy;')
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        vec3 cwp = orchP((modelMatrix * instanceMatrix * vec4(position, 1.)).xyz);
        vec3 cc = orchP(aClump.xyz), kc = orchP(aCrown.xyz);
        float cr = aClump.w * (aTree.z > .5 ? uOrchK : 1.);
        vec3 cN = normalize(cwp - cc + vec3(0., .0001, 0.));
        vec3 kq = (cwp - kc) / (uCrownR * (aTree.z > .5 ? uOrchK * .85 : 1.));
        vec3 kN = normalize(kq + vec3(0., .0001, 0.));
        vec3 Nw = normalize(mix(cN, kN, aCrown.w));
        vec3 gN = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));
        gN *= dot(gN, Nw) < 0. ? -1. : 1.;
        vGN = normalize((viewMatrix * vec4(gN, 0.)).xyz);
        Nw = normalize(Nw + gN * .14);
        vec3 objectNormal = transpose(mat3(instanceMatrix)) * (transpose(mat3(modelMatrix)) * Nw);
        // occlusion: inner cards of a clump, its underside, the crown's core
        float cd = length(cwp - cc) / max(cr, .01);
        vF.y = aInfo.w * mix(.35, 1., smoothstep(.1, .95, cd)) * mix(.42, 1., .5 + .5 * cN.y);
        vF.z = aTree.z > .5 ? .7 : smoothstep(.62, 1.02, length(kq));
        // bronze flushes: every card is coppery when it opens, and again in some later flushes, greening each time
        float fx = (uG - aInfo.z) * 5.; float cyc = floor(fx); float fr = fract(fx);
        float orch = step(.5, aTree.z);
        float on = (cyc < .5 ? 1. : step(fract(sin(cyc * 12.9898 + aInfo.z * 78.233) * 43758.5453), .2) * (1. - orch * .8)) * (1. - orch * .7);
        vF.x = fx < 0. ? 1. - orch * .85 : on * (1. - smoothstep(.12, .5, fr)) * (cyc < .5 ? 1. : smoothstep(0., .03, fr));
        vF.x *= 1. - orch * .9;
        vF.w = 0.;`)
      .replace('#include <project_vertex>', FOL_WIND)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = wp;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform vec3 uSunView; uniform vec3 uSunCol; uniform vec3 uBackView; uniform vec3 uBackCol; uniform float uWet;
        varying vec4 vF; varying vec3 vGN;`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec4 tx = texture2D(map, vMapUv);
        diffuseColor.a *= tx.a;
        float lsh = tx.r, lid = tx.g, rib = tx.b;
        vec3 gD = vec3(.010, .034, .009), gM = vec3(.032, .11, .018), gL = vec3(.14, .27, .035);
        vec3 green = lsh < .5 ? mix(gD, gM, lsh * 2.) : mix(gM, gL, lsh * 2. - 1.);
        float jit = fract(lid * 17.31);
        green *= .8 + .4 * jit;
        green = mix(green, vec3(.13, .26, .035) * (.55 + lsh), step(.88, fract(lid * 5.13)) * .6);
        vec3 bronze = mix(vec3(.16, .03, .016), vec3(.72, .2, .08), lsh) * (.85 + .3 * jit);
        float br = clamp(vF.x * smoothstep(.2, .5, lid), 0., 1.);
        vec3 alb = mix(green, bronze, br);
        alb += rib * (.4 * alb + vec3(.015, .022, .006));
        alb = mix(alb, alb * mix(vec3(.95, 1.3, .75), vec3(1.05), br), uWet);
        diffuseColor.rgb *= alb * mix(1., vF.y, .8);`)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = gl_FrontFacing ? 1. : -1.; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(.72, .5, rib + lsh * .3), .42, uWet);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(.12)); reflectedLight.indirectDiffuse *= .85;')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 Vd = normalize(vViewPosition);
          vec3 Ls = normalize(uSunView), Lb = normalize(uBackView);
          float rim = pow(1. - clamp(dot(normal, Vd), 0., 1.), 2.);
          float occ = vF.y;
          // back-lit translucency: the rim of the crown glows yellow-green with the sun behind it
          float back = pow(clamp(dot(-Vd, Ls), 0., 1.), 2.5);
          totalEmissiveRadiance += alb * mix(vec3(1.35, 1.7, .45), vec3(2.1, 1.0, .5), br) * uSunCol * back * (.2 + rim * 1.4) * (.25 + .75 * vF.z) * occ * 1.6;
          // glints: the sun off single glossy leaves
          vec3 gn = normalize(normalize(vGN) + vec3(fract(lid * 13.7) - .5, fract(lid * 29.3) - .5, 0.) * .7);
          float spec = pow(clamp(dot(gn, normalize(Vd + Ls)), 0., 1.), 140.) * step(0., dot(gn, Ls));
          totalEmissiveRadiance += uSunCol * spec * (.3 + 1.1 * uWet) * (.4 + lsh) * occ * occ * tx.a;
          // moon (or lightning) behind: a cool rim and a little translucency
          float bb = pow(clamp(dot(-Vd, Lb), 0., 1.), 2.);
          float rimB = rim * clamp(dot(normal, Lb) + .45, 0., 1.);
          totalEmissiveRadiance += uBackCol * (alb * mix(5., 2., br) * bb * (.25 + .75 * vF.z) * occ + rimB * (.035 + alb * 2.5) * (.3 + .7 * occ));
        }`)
  }
  m.customProgramCacheKey = () => 'treeFoliage'
  return m
}

export default class Tree extends Stage {
  constructor(engine) {
    super(engine, { far: 600 })
    const sc = this.scene, T = this.tier
    this.fov = 36
    this.frame = [0.13, 0.05]
    this.framePortrait = [0, -0.1]
    this.camera.near = 0.05
    const R = rng(1976)
    const R2 = rng(5150)

    // ---- Sky, fog, light
    this.sky = paintSky(420); sc.add(this.sky)
    { const su = this.sky.userData.u; su.uMilkyAxis.value.set(0.12, -0.77, -0.63).normalize(); su.uMetA.value.set(-0.93, 0.26, 0.3).normalize(); su.uMetB.value.set(-0.97, 0.09, -0.18).normalize() }
    this.sky.userData.u.uCloudScale.value = 0.62
    sc.fog = new THREE.Fog('#c9d6c0', 30, 240)
    this.sunL = new THREE.DirectionalLight('#fff1d6', 3)
    this.sunL.castShadow = true
    this.sunL.shadow.mapSize.set(T.shadow, T.shadow)
    const sh = this.sunL.shadow.camera
    sh.left = -13; sh.right = 13; sh.top = 13; sh.bottom = -13; sh.near = 1; sh.far = 80
    this.sunL.shadow.bias = -0.0005; this.sunL.shadow.normalBias = 0.04; this.sunL.shadow.radius = 3
    sc.add(this.sunL, this.sunL.target)
    this.moon = new THREE.DirectionalLight('#8fa8ff', 0); this.moon.position.copy(MOON).multiplyScalar(40); sc.add(this.moon)
    this.boltL = new THREE.DirectionalLight('#dcd8ff', 0); this.boltL.position.copy(BOLT).multiplyScalar(40); sc.add(this.boltL)
    this.hemi = new THREE.HemisphereLight('#cfe2ff', '#3a3420', 1); sc.add(this.hemi)
    this.envDay = engine.env({ top: '#5f8fd0', mid: '#e8e4c8', bottom: '#3a4a26', sun: '#fff4d8', sunDir: new THREE.Vector3(0.3, 0.9, 0.2), sunPower: 5 })
    this.envDawn = engine.env({ top: '#33476e', mid: '#f0a868', bottom: '#2a2418', sun: '#ffc890', sunDir: new THREE.Vector3(0.9, 0.12, -0.3), sunPower: 5 })
    this.envNight = engine.env({ top: '#1a2a58', mid: '#3a4e78', bottom: '#0e1418', sun: '#b8c8ff', sunDir: MOON, sunPower: 1 })
    this.envStormNight = engine.env({ top: '#1c2430', mid: '#2c3638', bottom: '#0c100e', sun: '#8090a0', sunDir: new THREE.Vector3(0, 1, 0), sunPower: 0.4 })
    this.envStorm = engine.env({ top: '#56645c', mid: '#8a9886', bottom: '#2a3222', sun: '#c8d4c0', sunDir: new THREE.Vector3(0, 1, 0), sunPower: 1.5 })
    sc.environment = this.envDawn

    // ---- The branching
    const segs = [], tips = [], earlyLeafAt = [], masses = [], twigLeafAt = [], laterals = [], forks = []
    const up = new THREE.Vector3(0, 1, 0)
    const rotAround = (v, axis, a) => v.clone().applyAxisAngle(axis, a)
    const perp = (d) => { const a = Math.abs(d.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0); return new THREE.Vector3().crossVectors(d, a).normalize() }
    const inCrown = (p) => { const q = p.clone().sub(CROWN_C); return (q.x / CROWN_R.x) ** 2 + (q.y / CROWN_R.y) ** 2 + (q.z / CROWN_R.z) ** 2 }
    const branch = (p0, dir, len, r0, depth, birth) => {
      // fit inside the crown envelope (the dome)
      if (depth >= 2) {
        let L = len
        for (let k = 0; k < 8 && inCrown(p0.clone().addScaledVector(dir, L)) > 1; k++) L *= 0.8
        len = Math.max(0.35, L)
      }
      const n = depth === 0 ? 8 : depth === 1 ? 5 : depth <= 3 ? 3 : 2
      const r1 = r0 * (depth === 0 ? 0.72 : 0.6)
      const dur = SPEED * len
      let p = p0.clone(), d = dir.clone(), b = birth
      for (let k = 0; k < n; k++) {
        const L = len / n
        const j = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(depth === 0 ? 0.07 : depth === 1 ? 0.24 : 0.32)
        d.add(j)
        if (depth >= 3) d.y -= 0.06 * k // twigs arch over
        if (depth === 0) d.x += 0.035 * Math.sin(k * 0.9 + 0.5) // a gentle S in the young stem
        if (depth === 1) d.y += 0.06 * (k - 1.5) // limbs leave the trunk low and then turn up
        d.normalize()
        const q = p.clone().addScaledVector(d, L)
        segs.push({ p0: p.clone(), p1: q, ra: lerp(r0, r1, k / n), rb: lerp(r0, r1, (k + 1) / n), birth: b, dur: dur / n, depth, tb: birth })
        // a few early leaves along young wood (they drop as the crown closes)
        if (depth <= 2 || (depth === 3 && k === n - 1)) earlyLeafAt.push({ p: q.clone(), d: d.clone(), birth: b + dur / n, depth, p0: p.clone(), sb: b, sd: dur / n })
        if (depth >= 3 && k < n - 1) twigLeafAt.push({ p: q.clone(), d: d.clone(), birth: b + dur / n })
        if (depth === 1 && k === 2) laterals.push({ p: q.clone(), d: d.clone(), b: b + dur / n, r: lerp(r0, r1, (k + 1) / n) })
        p = q; b += dur / n
      }
      // a side branch from mid-limb: the young tree bushes out early
      while (laterals.length && depth === 1) {
        const lt = laterals.pop()
        const ax = rotAround(perp(lt.d), lt.d, R() * Math.PI * 2)
        const ld = rotAround(lt.d, ax, 0.6 + R() * 0.3)
        ld.y = Math.max(ld.y, 0.15); ld.normalize()
        branch(lt.p, ld, 1.6, lt.r * 0.72, 2, lt.b)
      }
      if (depth >= MAXD) { tips.push({ p: p.clone(), d: d.clone(), birth: b, depth }); return }
      if (depth === 3) masses.push({ p: p.clone(), birth: b, r: 1.0 + R() * 0.45 })
      if (depth === 2) masses.push({ p: p.clone().add(new THREE.Vector3(0, 0.5, 0)), birth: b + 0.1, r: 1.5 + R() * 0.4 })
      if (depth === 4) forks.push({ p: p.clone(), d: d.clone(), birth: b })
      const kids = depth === 0 ? 4 : depth === 1 ? 3 : depth === 2 ? 3 : depth === 3 ? (R() < 0.5 ? 2 : 3) : 2
      const LEN = [1.6, 2.5, 2.0, 1.45, 1.05, 0.75]
      const az0 = R() * Math.PI * 2
      for (let c = 0; c < kids; c++) {
        let nd
        if (depth === 0) {
          const az = az0 + (c / kids) * Math.PI * 2 + (R() - 0.5) * 0.5, tilt = 0.62 + R() * 0.3
          nd = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az))
        } else {
          const ax = rotAround(perp(d), d, az0 + (c / kids) * Math.PI * 2)
          nd = rotAround(d, ax, 0.42 + R() * 0.35)
          const out = new THREE.Vector3(p.x, 0, p.z); if (out.lengthSq() > 1e-4) out.normalize()
          nd.addScaledVector(out, 0.28).addScaledVector(up, depth <= 2 ? 0.12 : 0.02).normalize()
        }
        branch(p, nd, LEN[depth + 1] * (0.82 + R() * 0.36), r1 * (depth === 0 ? 0.72 : 0.82), depth + 1, b + (R() * 0.02))
      }
      // the trunk's buttress roots, and a flare where trunk meets ground
      if (depth === 0) {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + R() * 0.4, rd = new THREE.Vector3(Math.cos(a), -0.3, Math.sin(a)).normalize()
          const o = new THREE.Vector3(Math.cos(a) * 0.14, 0.42, Math.sin(a) * 0.14)
          segs.push({ p0: o, p1: o.clone().addScaledVector(rd, 1.25), ra: 0.27, rb: 0.05, birth: 0.05, dur: 0.12, depth: 0, tb: 0.05, root: true })
        }
        segs.push({ p0: new THREE.Vector3(0, -0.12, 0), p1: new THREE.Vector3(0.01, 0.55, 0.005), ra: 0.66, rb: 0.45, birth: 0.0, dur: 0.05, depth: 0, tb: 0.0 })
      }
    }
    branch(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0.04, 1, 0.02).normalize(), 1.7, 0.44, 0, 0)
    // normalise births so the last twig opens at g ≈ 0.86
    const maxB = Math.max(...tips.map((t) => t.birth))
    const kB = 0.84 / maxB
    for (const s of segs) { s.birth *= kB; s.tb *= kB; s.dur *= kB }
    // the buttress roots only creep out once the trunk has some girth (no spider legs on the sapling)
    for (const s of segs) if (s.root) { s.birth = 0.3; s.dur = 0.34; s.tb = 0.3 }
    for (const a of [tips, earlyLeafAt, masses, twigLeafAt, forks]) for (const o of a) { o.birth *= kB; if (o.sb !== undefined) { o.sb *= kB; o.sd *= kB } }
    this.tips = tips

    // ---- Bark: one merged geometry
    const geos = []
    const yAxis = new THREE.Vector3(0, 1, 0), qq = new THREE.Quaternion()
    const segGeo = (s, rs, grow) => {
      const len = s.p0.distanceTo(s.p1)
      const g0 = new THREE.CylinderGeometry(s.rb, s.ra, len, rs, 1, true)
      g0.translate(0, len / 2, 0)
      // a small rounded cap, so a growing tip is never an open pipe
      const cap = new THREE.ConeGeometry(s.rb, s.rb * 1.6, rs, 1, true)
      cap.translate(0, len + s.rb * 0.8, 0)
      { const cu = cap.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setY(i, 1) }
      const g = mergeGeometries([g0.toNonIndexed(), cap.toNonIndexed()], false)
      g0.dispose(); cap.dispose()
      const dir = s.p1.clone().sub(s.p0).normalize()
      qq.setFromUnitVectors(yAxis, dir)
      g.applyQuaternion(qq); g.translate(s.p0.x, s.p0.y, s.p0.z)
      const n = g.attributes.position.count
      const uv = g.attributes.uv
      const axis = new Float32Array(n * 3), base = new Float32Array(n * 3), birth = new Float32Array(n * 2), hh = new Float32Array(n), topA = new Float32Array(n), tbA = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const top = uv.getY(i) > 0.5
        const a = top ? s.p1 : s.p0
        axis.set([a.x, a.y, a.z], i * 3); base.set([s.p0.x, s.p0.y, s.p0.z], i * 3)
        birth.set([s.birth, Math.max(0.01, s.dur)], i * 2)
        hh[i] = clamp(a.y / 9, 0, 1)
        topA[i] = top ? 1 : 0
        tbA[i] = s.tb
        uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(s.ra * 9)), uv.getY(i) * len * 1.3)
      }
      if (grow) {
        g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3))
        g.setAttribute('aBase', new THREE.BufferAttribute(base, 3))
        g.setAttribute('aBirth', new THREE.BufferAttribute(birth, 2))
        g.setAttribute('aH', new THREE.BufferAttribute(hh, 1))
        g.setAttribute('aTop', new THREE.BufferAttribute(topA, 1))
        g.setAttribute('aTB', new THREE.BufferAttribute(tbA, 1))
      }
      return g
    }
    for (const s of segs) geos.push(segGeo(s, s.depth === 0 ? 16 : s.depth <= 2 ? 10 : s.depth <= 3 ? 7 : 5, true))
    const barkG = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    this.gu = { uG: { value: 0 }, uTime: { value: 0 }, uWind: { value: 0.035 }, uMoss: { value: 0 }, uWet: { value: 0 } }
    const bt = barkTex()
    const bark = new THREE.MeshStandardMaterial({ map: bt.map, bumpMap: bt.bump, bumpScale: 3, color: '#ddd0bc', roughness: 0.9 })
    injectGrowth(bark, this.gu, true)
    bark.customProgramCacheKey = () => 'treeBark2'
    this.bark = new THREE.Mesh(barkG, bark)
    this.bark.frustumCulled = false
    this.bark.castShadow = true; this.bark.receiveShadow = true
    const bd = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    injectGrowth(bd, this.gu)
    bd.customProgramCacheKey = () => 'treeBarkDepth'
    this.bark.customDepthMaterial = bd
    sc.add(this.bark)

    // ---- Leaves: whorls at twig tips (persistent), clusters on young wood (they fall later)
    const L = []
    const dens = T.leaves >= 1 ? 1 : T.leaves >= 0.6 ? 0.72 : 0.55
    const sizeK = 1 / Math.sqrt(dens)
    const leafAt = (p, d, birth, n, persistent, spread = 1, size = 0.55, ride = null) => {
      const side = perp(d)
      for (let k = 0; k < n; k++) {
        const az = (k / n) * Math.PI * 2 + R() * 0.6
        const radial = rotAround(side, d, az)
        // drooping, mostly outward, facing up
        const dir = d.clone().multiplyScalar(0.55).addScaledVector(radial, 0.95 * spread).add(new THREE.Vector3(0, -0.45 - R() * 0.6, 0)).normalize()
        const z = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize()
        const y = new THREE.Vector3().crossVectors(z, dir)
        const qOpen = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, y, z))
        qOpen.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (R() - 0.5) * 1.2))
        const dz = d.clone(); const zz = perp(dz); const yy = new THREE.Vector3().crossVectors(zz, dz)
        const qFold = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dz, yy, zz))
        const off = p.clone().addScaledVector(d, -R() * 0.25 * spread).addScaledVector(radial, 0.03)
        const b = birth + R() * 0.03
        const lf = { p: off, qOpen, qFold, s: size * sizeK * (0.75 + R() * 0.5), birth: b, death: persistent ? 9 : b + 0.24 + R() * 0.1, tint: 0.85 + R() * 0.3 }
        if (ride) { lf.ride = ride; lf.rel = radial.clone().multiplyScalar(0.02).addScaledVector(d, -0.03); lf.birth = ride.sb + R() * 0.01; lf.death = ride.sb + ride.sd + 0.02 }
        L.push(lf)
      }
    }
    for (const t of tips) {
      leafAt(t.p, t.d, t.birth, Math.round((11 + R() * 4) * dens), true, 1, 0.48)
      // a second, inner whorl a little back along the twig
      leafAt(t.p.clone().addScaledVector(t.d, -0.3), t.d, t.birth + 0.01, Math.round((8 + R() * 3) * dens), true, 1.25, 0.5)
    }
    for (const w of twigLeafAt) leafAt(w.p, w.d, w.birth, Math.round(9 * dens), true, 1.1, 0.46)
    // the very first pair of seed leaves
    const seedAt = L.length
    leafAt(new THREE.Vector3(0.02, 0.25, 0), new THREE.Vector3(0, 1, 0), 0.0, 2, false, 1.1, 0.2)
    for (let k = seedAt; k < L.length; k++) L[k].death = 0.3
    let phy = 0
    const sideLeaf = (p, d, birth, size) => {
      phy += 2.39996
      const radial = rotAround(perp(d), d, phy)
      const dir = d.clone().multiplyScalar(0.75).addScaledVector(radial, 0.85).add(new THREE.Vector3(0, -0.15 - R() * 0.35, 0)).normalize()
      const z = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize()
      const y = new THREE.Vector3().crossVectors(z, dir)
      const qOpen = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, y, z))
      qOpen.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (R() - 0.5) * 0.8))
      const zz = perp(d), yy = new THREE.Vector3().crossVectors(zz, d)
      const qFold = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(d.clone(), yy, zz))
      // the leaf stands off the stem on a short petiole, so it never looks glued in a ring
      const pos = p.clone().addScaledVector(radial, 0.035 + size * 0.12).addScaledVector(d, size * 0.06)
      L.push({ p: pos, qOpen, qFold, s: size * sizeK * (0.8 + R() * 0.4), birth, death: birth + 0.26 + R() * 0.1, tint: 0.85 + R() * 0.3 })
    }
    for (const e of earlyLeafAt) {
      const size = e.depth === 0 ? 0.5 : 0.46
      // two or three leaves along the segment, born as the tip passes them
      const fr = e.depth === 0 ? [0.3, 0.65, 0.95] : [0.25, 0.6, 0.92]
      for (const f of fr) sideLeaf(e.p0.clone().lerp(e.p, f), e.d, e.sb + e.sd * f, size)
      // a small bronze tuft that rides the growing tip and gives way once the segment is done
      const before = L.length
      leafAt(e.p, e.d, e.birth, e.depth === 0 ? 7 : 5, false, 0.8, size * 0.95, { p0: e.p0, p1: e.p, sb: e.sb, sd: e.sd })
      for (let k = before; k < L.length; k++) L[k].death = e.sb + e.sd * 2.2
    }
    this.L = L
    this.leafMat = leafMaterial({ wind: 0.035, transl: 1.1 })
    {
      const base = this.leafMat.onBeforeCompile
      this.leafMat.onBeforeCompile = (sh, r) => {
        base(sh, r)
        sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(.3));')
      }
      this.leafMat.customProgramCacheKey = () => 'leafTree'
    }
    this.leaves = new THREE.InstancedMesh(lowLeaf(1, 0.22, 0.16, 4), this.leafMat, L.length)
    this.leaves.customDepthMaterial = leafDepthMaterial()
    this.leaves.castShadow = true; this.leaves.receiveShadow = true
    this.leaves.frustumCulled = false
    this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.leaves.setColorAt(0, new THREE.Color())
    sc.add(this.leaves)

    // ---- The crown: rounded clumps of painted whorls at the branch ends
    this.atlas = whorlAtlas()
    this.folU = {
      uTime: { value: 0 }, uWind: { value: 0.03 }, uOrchK: { value: 1 }, uG: { value: 0 }, uCrownR: { value: CROWN_R.clone() },
      uSunView: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uBackView: { value: new THREE.Vector3(0, 0, -1) }, uBackCol: { value: new THREE.Color(0, 0, 0) }, uWet: { value: 0 },
    }
    this.folMat = foliageMaterial(this.atlas, this.folU)
    const clumps = []
    const crownOut = (p) => p.clone().sub(CROWN_C).divide(CROWN_R)
    const lump = (v) => 0.78 + 0.42 * (0.5 + 0.5 * Math.sin(v.x * 2.3 + v.z * 1.7 + 0.6) * Math.cos(v.y * 2.4 - v.x * 1.3))
    for (const t of tips) {
      const c = t.p.clone().addScaledVector(t.d, 0.12).add(new THREE.Vector3(0, 0.1, 0))
      const e = crownOut(c), gap = R2(), rr = R2()
      // the lowest twigs keep only their own leaves, so the trunk and limbs show beneath the crown; a few gaps
      if (c.y < 2.5 || (c.y < 3.3 && gap < 0.5) || gap < 0.08) { clumps.push({ c, r: 0, birth: t.birth, outer: true, tip: t, skip: true }); continue }
      clumps.push({ c: c.addScaledVector(e.clone().normalize(), (lump(e) - 0.9) * 0.8), r: (0.6 + rr * 0.24) * lump(e), birth: t.birth, outer: true, tip: t })
    }
    for (const f of forks) if (f.p.y > 2.8) clumps.push({ c: f.p.clone().add(new THREE.Vector3(0, 0.15, 0)), r: 0.74 + R2() * 0.2, birth: f.birth + 0.05, outer: false })
    this.clumps = clumps.filter((c) => !c.skip)
    const C = []
    for (const cl of clumps) {
      if (cl.skip) continue
      const e = crownOut(cl.c), el = e.length()
      const ao = (cl.outer ? 1 : 0.6) * lerp(0.3, 1, smooth(0.3, 0.95, el)) * lerp(0.72, 1, smooth(-0.7, 0.3, e.y))
      const outDir = e.clone().normalize().add(new THREE.Vector3(0, 0.35, 0)).normalize()
      const nc = Math.round((cl.outer ? 11 : 6) * (0.4 + 0.6 * dens))
      for (let k = 0; k < nc; k++) {
        const u = R2() * 2 - 1, a = R2() * Math.PI * 2, rr = Math.sqrt(1 - u * u)
        const dir = new THREE.Vector3(rr * Math.cos(a), u, rr * Math.sin(a)).addScaledVector(outDir, 0.9).normalize()
        const p = cl.c.clone().addScaledVector(dir, cl.r * (0.35 + R2() * 0.45))
        const n = dir.clone().add(new THREE.Vector3(R2() - 0.5, R2() - 0.5, R2() - 0.5).multiplyScalar(0.7)).normalize()
        const q = faceQuat(n, (R2() - 0.5) * 0.7)
        const cell = Math.floor(R2() * 4)
        C.push({ p, q, s: cl.r * (1.45 + R2() * 0.55) * (1 / Math.sqrt(0.4 + 0.6 * dens)), birth: cl.birth + 0.012 + (k / nc) * 0.1 + R2() * 0.02, cl, cell, ao, tint: 0.85 + R2() * 0.3 })
      }
    }
    this.C = C
    const cGeo = cardGeo(3)
    const mkAttr = (n, k) => new THREE.InstancedBufferAttribute(new Float32Array(n * k), k)
    const aClump = mkAttr(C.length, 4), aCrown = mkAttr(C.length, 4), aInfo = mkAttr(C.length, 4), aTree = mkAttr(C.length, 3)
    C.forEach((o, i) => {
      aClump.setXYZW(i, o.cl.c.x, o.cl.c.y, o.cl.c.z, o.cl.r)
      aCrown.setXYZW(i, CROWN_C.x, CROWN_C.y, CROWN_C.z, 0.55)
      aInfo.setXYZW(i, (o.cell % 2) * 0.5, Math.floor(o.cell / 2) * 0.5, o.birth, o.ao)
    })
    cGeo.setAttribute('aClump', aClump); cGeo.setAttribute('aCrown', aCrown); cGeo.setAttribute('aInfo', aInfo); cGeo.setAttribute('aTree', aTree)
    this.cards = new THREE.InstancedMesh(cGeo, this.folMat, C.length)
    {
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.atlas, alphaTest: 0.5 })
      dm.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, this.folU)
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + FOL_VERT_PARS)
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * .5 + aInfo.xy; vF = vec4(0., 0., .5, 0.);')
          .replace('#include <project_vertex>', FOL_WIND)
      }
      dm.customProgramCacheKey = () => 'treeFoliageDepth'
      this.cards.customDepthMaterial = dm
    }
    this.cards.castShadow = true; this.cards.receiveShadow = true; this.cards.frustumCulled = false
    this.cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    { const c = new THREE.Color(); C.forEach((o, i) => this.cards.setColorAt(i, c.setRGB(o.tint, o.tint * (0.95 + R2() * 0.1), o.tint))) }
    sc.add(this.cards)

    // ---- Blossom: a pale haze of panicles on the upper crown at the very end
    this.bloomU = { uBloom: { value: 0 } }
    const pg = (() => {
      const a = new THREE.PlaneGeometry(0.5, 0.5); a.translate(0, 0.25, 0)
      const b = a.clone(); b.rotateY(Math.PI / 2)
      return mergeGeometries([a, b])
    })()
    const bloomMat = new THREE.MeshStandardMaterial({ map: panicleTex(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, emissive: '#2a2418' })
    bloomMat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.bloomU)
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBloom; attribute float aDel;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= max(smoothstep(aDel, aDel + .35, uBloom), 1e-4);')
    }
    bloomMat.customProgramCacheKey = () => 'treeBloom'
    const PB = []
    const endCam = new THREE.Vector3(Math.sin(1.9) * 21, 7.6, Math.cos(1.9) * 21)
    let best = tips[0], bs = -1e9
    for (const t of tips) { const sc2 = t.p.clone().sub(CROWN_C).normalize().dot(endCam.clone().sub(CROWN_C).normalize()) + t.p.y * 0.02; if (sc2 > bs) { bs = sc2; best = t } }
    this.blossomPt = best.p.clone()
    for (const cl of clumps) {
      if (!cl.outer) continue
      const e = crownOut(cl.c)
      const isBest = cl.tip === best
      if (!isBest && (e.y < -0.1 || R2() > 0.7)) continue
      const nb = isBest ? 3 : 1
      for (let k = 0; k < nb; k++) {
        const o = e.clone().normalize().add(new THREE.Vector3(0, 1.4, 0)).normalize()
        const p = cl.c.clone().addScaledVector(o, cl.r * (0.62 + R2() * 0.3)).add(new THREE.Vector3((R2() - 0.5) * 0.4, 0, (R2() - 0.5) * 0.4))
        const tilt = o.clone().add(new THREE.Vector3((R2() - 0.5) * 0.9, 0, (R2() - 0.5) * 0.9)).normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(up, tilt).multiply(new THREE.Quaternion().setFromAxisAngle(up, R2() * 3))
        PB.push({ p, q, s: 0.55 + R2() * 0.3, del: isBest ? 0 : R2() * 0.6 })
      }
    }
    this.blooms = new THREE.InstancedMesh(pg, bloomMat, PB.length)
    {
      const m = new THREE.Matrix4(), del = new Float32Array(PB.length)
      PB.forEach((b, i) => { this.blooms.setMatrixAt(i, m.compose(b.p, b.q, new THREE.Vector3().setScalar(b.s))); del[i] = b.del })
      pg.setAttribute('aDel', new THREE.InstancedBufferAttribute(del, 1))
    }
    this.blooms.frustumCulled = false; this.blooms.castShadow = false; this.blooms.receiveShadow = true
    sc.add(this.blooms)

    // ---- Ground: dry gold → lush green, with patches, shade under the crown, wet sheen after rain
    const groundTex = canvasTex(512, 512, (g, W, H) => {
      g.fillStyle = '#8a8a58'; g.fillRect(0, 0, W, H)
      const r = rng(3)
      for (let i = 0; i < 2600; i++) {
        const c = r()
        g.fillStyle = c < 0.4 ? `rgba(60,80,30,${0.15 + r() * 0.2})` : c < 0.7 ? `rgba(150,140,80,${0.12 + r() * 0.2})` : `rgba(90,70,40,${0.1 + r() * 0.15})`
        g.beginPath(); g.ellipse(r() * W, r() * H, 3 + r() * 16, 2 + r() * 8, r() * 3, 0, 7); g.fill()
      }
    }, { repeat: true })
    groundTex.repeat.set(60, 60)
    this.groundU = { uCanopy: { value: 0.5 }, uWet: { value: 0 }, uSky: { value: new THREE.Color() } }
    this.groundMat = new THREE.MeshStandardMaterial({ map: groundTex, color: '#c9b070', roughness: 1 })
    this.groundMat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.groundU)
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.)).xyz;')
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGW; uniform float uCanopy; uniform float uWet; uniform vec3 uSky;\n${NOISE}`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          float gn1 = mmFbm2(vGW.xz * .035), gn2 = mmNoise2(vGW.xz * .35);
          diffuseColor.rgb *= .72 + .55 * gn1 + .12 * gn2;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.02, .7), smoothstep(.55, .75, gn1) * .5);
          float gr0 = length(vGW.xz);
          float under = 1. - smoothstep(uCanopy * .4, uCanopy * 1.08, gr0 + (gn2 - .5) * 1.2);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.13, .085, .045), under * .55);
          diffuseColor.rgb *= mix(1., .6, uWet);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(1., .7, uWet * smoothstep(.25, .7, gn2));')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { // after rain, shallow puddles in the hollows mirror the sky
            float pud = smoothstep(.66, .76, mmNoise2(vGW.xz * .21 + 4.) * .7 + gn2 * .3) * uWet * (1. - under * .7) * smoothstep(1.5, 3., length(vGW.xz));
            vec3 vd = normalize(vGW - cameraPosition); float fr = .2 + .8 * pow(1. - abs(vd.y), 4.);
            totalEmissiveRadiance += uSky * pud * fr * fr * (.8 + .2 * sin(vGW.x * 9. + vGW.z * 7.));
            diffuseColor.rgb *= 1. - pud * .75; }`)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= 1. - under * .6; reflectedLight.indirectSpecular *= 1. - under * .5; reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(.15 - uWet * .12)); reflectedLight.indirectSpecular *= 1. - uWet * .5;')
    }
    this.groundMat.customProgramCacheKey = () => 'treeGround'
    const ground = new THREE.Mesh((() => {
      const NR = 52, NA = 112, v = [], uv = [], idx = []
      for (let i = 0; i <= NR; i++) {
        const rr = 400 * Math.pow(i / NR, 2.1)
        for (let j = 0; j <= NA; j++) {
          const a = (j / NA) * Math.PI * 2, x = Math.cos(a) * rr, z = Math.sin(a) * rr
          v.push(x, groundH(x, z), z); uv.push(x / 800 + 0.5, z / 800 + 0.5)
          if (i < NR && j < NA) { const A = i * (NA + 1) + j, B = A + NA + 1; idx.push(A, A + 1, B, A + 1, B + 1, B) }
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals()
      return g
    })(), this.groundMat)
    ground.receiveShadow = true
    sc.add(ground)
    const soilTex = canvasTex(256, 256, (g, W, H) => {
      const r = rng(8), gr = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 2)
      gr.addColorStop(0, 'rgba(92,66,40,1)'); gr.addColorStop(0.55, 'rgba(105,80,50,.9)'); gr.addColorStop(1, 'rgba(110,90,55,0)')
      g.fillStyle = gr; g.fillRect(0, 0, W, H)
      for (let i = 0; i < 500; i++) { const a = r() * 6.28, d = Math.pow(r(), 0.6) * W * 0.45; g.fillStyle = `rgba(${r() < 0.5 ? '60,42,26' : '140,115,80'},${0.2 + r() * 0.3})`; g.beginPath(); g.ellipse(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, 1 + r() * 4, 1 + r() * 3, r() * 3, 0, 7); g.fill() }
    })
    const mound = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), new THREE.MeshStandardMaterial({ map: soilTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }))
    mound.rotation.x = -Math.PI / 2; mound.position.y = 0.01; mound.receiveShadow = true
    sc.add(mound)
    this.mound = mound

    // leaf litter under the crown, gathering as the tree ages
    const dryTex = dryLeafTex()
    const litterMat = new THREE.MeshStandardMaterial({ map: dryTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 })
    const ln = Math.round(380 * (0.4 + 0.6 * T.particles))
    const LT = []
    for (let i = 0; i < ln; i++) {
      const rad = 0.5 + Math.pow(R2(), 0.75) * 6.6, a = R2() * Math.PI * 2
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (R2() - 0.5) * 0.4, 0, R2() * 6.28, 'XZY'))
      LT.push({ p: new THREE.Vector3(Math.cos(a) * rad, 0.03 + R2() * 0.02, Math.sin(a) * rad), q, s: 0.3 + R2() * 0.18, birth: 0.4 + (rad / 6.6) * 0.35 + R2() * 0.12 })
    }
    this.LT = LT
    this.litter = new THREE.InstancedMesh(lowLeaf(1, 0.12, -0.05, 3), litterMat, ln)
    this.litter.receiveShadow = true; this.litter.frustumCulled = false
    { const c = new THREE.Color(); for (let i = 0; i < ln; i++) { const k = R2(); this.litter.setColorAt(i, k < 0.12 ? c.setRGB(0.32, 0.5, 0.22) : k < 0.5 ? c.setRGB(0.42 + R2() * 0.2, 0.36 + R2() * 0.15, 0.3 + R2() * 0.12) : c.setRGB(0.6 + R2() * 0.3, 0.52 + R2() * 0.2, 0.4 + R2() * 0.15)) } }
    sc.add(this.litter)

    // leaves drifting down (ambient: driven by time)
    this.fallU = { uTime: { value: 0 }, uFall: { value: 0 } }
    const fallMat = new THREE.MeshStandardMaterial({ map: dryTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 })
    fallMat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.fallU)
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uFall; attribute vec4 aSeed;')
        .replace('#include <project_vertex>', /* glsl */ `
          float FT = uTime * (.09 + aSeed.y * .05) + aSeed.x * 7.;
          float cyc = fract(FT), kk = floor(FT);
          vec2 st = (vec2(fract(sin(kk * 12.9 + aSeed.z * 50.) * 4375.85), fract(sin(kk * 7.1 + aSeed.w * 30.) * 4375.85)) - .5) * 10.;
          float top = 3.2 + 4. * aSeed.w;
          float ang = FT * 14. + aSeed.z * 6.;
          vec3 ax = normalize(vec3(.6, .3 + aSeed.y, .5));
          float ca = cos(ang), sa = sin(ang);
          vec3 tv = transformed - vec3(.12, 0., 0.);
          tv = tv * ca + cross(ax, tv) * sa + ax * dot(ax, tv) * (1. - ca);
          float sc = uFall * (1. - smoothstep(.9, 1., cyc)) * smoothstep(0., .05, cyc);
          vec3 fp = vec3(st.x, top * (1. - cyc) + .05, st.y) + vec3(sin(FT * 9. + aSeed.z * 9.) * .5, 0., cos(FT * 7. + aSeed.w * 9.) * .5);
          vec4 mvPosition = viewMatrix * vec4(fp + tv * sc, 1.);
          gl_Position = projectionMatrix * mvPosition;`)
    }
    fallMat.customProgramCacheKey = () => 'treeFall'
    const fn = 16, fg = lowLeaf(0.26, 0.15, 0.05, 3), seed = new Float32Array(fn * 4)
    for (let i = 0; i < fn * 4; i++) seed[i] = R2()
    fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
    this.falling = new THREE.InstancedMesh(fg, fallMat, fn)
    this.falling.frustumCulled = false
    { const c = new THREE.Color(); for (let i = 0; i < fn; i++) this.falling.setColorAt(i, c.setRGB(0.8 + R2() * 0.4, 0.75 + R2() * 0.3, 0.5 + R2() * 0.3)) }
    sc.add(this.falling)

    // grass: clumps of three blades, height and colour varying across the field
    const gn = Math.round(6000 * T.particles + 1000)
    const blades = []
    for (let k = 0; k < 3; k++) {
      const b = new THREE.PlaneGeometry(0.055, 0.42, 1, 2)
      b.translate(0, 0.21, 0)
      const p = b.attributes.position
      const lean = 0.06 + k * 0.03, hk = [1, 0.8, 0.65][k]
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 0.42; p.setX(i, p.getX(i) * (1 - y * 0.85)); p.setY(i, p.getY(i) * hk); p.setZ(i, y * y * lean) }
      b.rotateY(k * 2.1 + 0.3); b.translate(Math.cos(k * 2.1) * 0.035, 0, Math.sin(k * 2.1) * 0.035)
      blades.push(b)
    }
    const blade = mergeGeometries(blades); blade.computeVertexNormals()
    this.grassU = { uTime: { value: 0 }, uTint: { value: new THREE.Color('#c8b060') }, uLush: { value: 0 } }
    const gm = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide })
    gm.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.grassU)
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime; varying float vGy; varying vec2 vGn;\n${NOISE}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGy = position.y / .42;`)
        .replace('#include <project_vertex>', `vec4 gb = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
          vGn = vec2(mmNoise2(gb.xz * .16), mmNoise2(gb.xz * .9 + 3.));
          vec3 gt = transformed; gt.y *= mix(.5, 1.7, vGn.x); gt.xz *= mix(.8, 1.3, vGn.x);
          vec4 mvPosition = instanceMatrix * vec4(gt, 1.); vec4 wp = modelMatrix * mvPosition;
          float ph = wp.x * .35 + wp.z * .27; float gy2 = vGy * vGy;
          wp.x += sin(uTime * 1.6 + ph) * .07 * gy2; wp.z += cos(uTime * 1.2 + ph) * .05 * gy2;
          mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`)
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uLush; varying float vGy; varying vec2 vGn;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 gtint = uTint * mix(vec3(1.12, .98, .72), vec3(.82, 1.06, .95), vGn.x);
          gtint = mix(gtint, vec3(.95, .82, .5) * uTint.r * 1.3, smoothstep(.62, .85, vGn.y) * smoothstep(.5, 1., vGy) * (1. - uLush * .6));
          diffuseColor.rgb *= gtint * mix(.3, 1.15, vGy);`)
    }
    gm.customProgramCacheKey = () => 'treeGrass2'
    this.grass = new THREE.InstancedMesh(blade, gm, gn)
    this.grass.receiveShadow = true; this.grass.frustumCulled = false
    {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color()
      for (let i = 0; i < gn; i++) {
        let rad = 1.6 + Math.pow(R(), 0.7) * 34
        if (rad < 5 && R2() < 0.55) rad = 5 + R2() * 8 // thin under the crown's shade
        const a = R() * Math.PI * 2
        p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad); p.y = groundH(p.x, p.z) - 0.02
        q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.5, R() * 6.28, (R() - 0.5) * 0.5))
        const k = (0.6 + R() * 0.9) * (0.45 + 0.55 * smooth(2, 9, rad))
        s.set(k, k * (0.7 + R() * 0.8), k)
        this.grass.setMatrixAt(i, m.compose(p, q, s))
        this.grass.setColorAt(i, c.setRGB(0.8 + R() * 0.4, 0.85 + R() * 0.3, 0.7 + R() * 0.3))
      }
    }
    sc.add(this.grass)

    // ---- A meadow in the grass: wildflowers near the tree, tall seed-headed grasses that glow when the sun is behind them
    {
      const atlas = canvasTex(512, 512, (g) => {
        const r = rng(808)
        const blade = (x, y, h, lean, col, w = 2.2) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.3, y - h * 0.6, x + lean, y - h); g.stroke() }
        const flower = (x, y, rad, petal, eye, n = 6) => {
          g.fillStyle = petal
          for (let k = 0; k < n; k++) { const a = (k / n) * 6.283 + r(); g.beginPath(); g.ellipse(x + Math.cos(a) * rad * 0.62, y + Math.sin(a) * rad * 0.5, rad * 0.5, rad * 0.26, a, 0, 7); g.fill() }
          g.fillStyle = eye; g.beginPath(); g.arc(x, y, rad * 0.28, 0, 7); g.fill()
        }
        for (let q = 0; q < 4; q++) {
          const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256, base = oy + 252
          g.save(); g.beginPath(); g.rect(ox + 1, oy + 1, 254, 254); g.clip()
          for (let k = 0; k < 14; k++) blade(ox + 30 + r() * 196, base, 50 + r() * (q === 2 ? 190 : 110), (r() - 0.5) * 70, ['#5f7a2e', '#7d8f3a', '#a39a52', '#4c6a28'][Math.floor(r() * 4)])
          if (q === 2) { // seed grasses: thin stems, feathery heads
            for (let k = 0; k < 7; k++) {
              const x = ox + 40 + r() * 176, h = 150 + r() * 90, lean = (r() - 0.5) * 80
              blade(x, base, h, lean, '#b9a868', 1.6)
              const tx = x + lean, ty = base - h
              for (let j = 0; j < 14; j++) { const s = j / 14; g.fillStyle = `rgba(${236 - j * 3},${216 - j * 4},${150 - j * 4},.95)`; g.beginPath(); g.ellipse(tx - lean * 0.12 * s + (j % 2 ? 3 : -3), ty + s * 48, 2.6, 6, (j % 2 ? 0.5 : -0.5), 0, 7); g.fill() }
            }
          } else {
            const n = q === 3 ? 6 : 7
            for (let k = 0; k < n; k++) {
              const x = ox + 36 + r() * 184, h = 70 + r() * 120, lean = (r() - 0.5) * 50
              blade(x, base, h, lean, '#557a2c', 1.8)
              const fx = x + lean, fy = base - h
              if (q === 0) flower(fx, fy, 15 + r() * 7, '#ffcf2e', '#c8661c', 8)
              else if (q === 1) flower(fx, fy, 17 + r() * 7, r() < 0.5 ? '#fbf3ea' : '#f4a9c0', '#e8b030', 8)
              else for (let j = 0; j < 9; j++) { g.fillStyle = j % 2 ? '#8a6cd8' : '#b49af0'; g.beginPath(); g.ellipse(fx + (j % 2 ? 4 : -4), fy + j * 6, 5, 4, 0, 0, 7); g.fill() }
            }
          }
          g.restore()
        }
      })
      const pl = new THREE.PlaneGeometry(1, 1, 1, 2); pl.translate(0, 0.5, 0)
      const pl2 = pl.clone().rotateY(Math.PI / 2)
      const mg = mergeGeometries([pl, pl2])
      { const n = mg.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0) }
      const NM = Math.round(2600 * T.particles + 300)
      const cell = new Float32Array(NM * 2)
      this.meadowU = { uTime: { value: 0 }, uSunV: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() }, uWindM: { value: 1 } }
      const mm = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 })
      mm.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, this.meadowU)
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell; uniform float uTime; uniform float uWindM; varying float vMy;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * .5 + aCell; vMy = uv.y;')
          .replace('#include <project_vertex>', `vec4 mvPosition = instanceMatrix * vec4(transformed, 1.); vec4 wp = modelMatrix * mvPosition;
            float ph = wp.x * .41 + wp.z * .33; float k = uv.y * uv.y * uWindM;
            wp.x += sin(uTime * 1.5 + ph) * .06 * k; wp.z += cos(uTime * 1.1 + ph * 1.3) * .045 * k;
            mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`)
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunV; uniform vec3 uSunC; varying float vMy;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunV)), 0., 1.), 3.);
              totalEmissiveRadiance += diffuseColor.rgb * uSunC * (back * 1.3 + .05) * smoothstep(.3, 1., vMy); }`)
      }
      mm.customProgramCacheKey = () => 'treeMeadow'
      this.meadow = new THREE.InstancedMesh(mg, mm, NM)
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sv = new THREE.Vector3(), mr = rng(77)
      for (let i = 0; i < NM; i++) {
        const near = i < NM * 0.35
        const rad = near ? 1.4 + Math.pow(mr(), 1.4) * 6 : 4 + Math.pow(mr(), 0.8) * 30
        const a = mr() * Math.PI * 2
        p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad); p.y = groundH(p.x, p.z) - 0.02
        // flowers gather in drifts; the tall grasses keep away from the young tree so they never hide it
        const drift = Math.sin(p.x * 0.35 + 1) * Math.cos(p.z * 0.29) > -0.1
        let c = rad < 5 ? (mr() < 0.5 ? 0 : mr() < 0.6 ? 1 : 3) : mr() < 0.42 ? 2 : drift ? Math.floor(mr() * 2) * (mr() < 0.3 ? 3 : 1) : 2
        if (c === 2 && rad < 5) c = 0
        const sz = c === 2 ? 0.6 + mr() * 0.45 : (rad < 3 ? 0.2 : 0.3) + mr() * 0.22
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), mr() * 6.28)
        this.meadow.setMatrixAt(i, M.compose(p, q, sv.set(sz * (0.8 + mr() * 0.4), sz, sz)))
        cell[i * 2] = (c % 2) * 0.5; cell[i * 2 + 1] = (1 - Math.floor(c / 2)) * 0.5
      }
      mg.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2))
      this.meadow.receiveShadow = true; this.meadow.frustumCulled = false
      sc.add(this.meadow)
    }

    // ---- Small lives: butterflies round the grown tree, pollen and gnats glinting in the sun, birds far behind
    {
      const wingTex = canvasTex(128, 128, (g, W, H) => {
        g.fillStyle = '#ffffff'
        g.beginPath(); g.moveTo(4, 64); g.bezierCurveTo(40, -10, 130, 0, 120, 40); g.bezierCurveTo(116, 62, 90, 64, 70, 66); g.bezierCurveTo(110, 80, 112, 122, 80, 122); g.bezierCurveTo(50, 124, 20, 90, 4, 64); g.fill()
        g.globalCompositeOperation = 'source-atop'
        g.fillStyle = '#1a120c'; g.lineWidth = 8; g.strokeStyle = '#1a120c'
        g.beginPath(); g.moveTo(4, 64); g.bezierCurveTo(40, -10, 130, 0, 120, 40); g.bezierCurveTo(116, 62, 90, 64, 70, 66); g.bezierCurveTo(110, 80, 112, 122, 80, 122); g.bezierCurveTo(50, 124, 20, 90, 4, 64); g.stroke()
        for (const [x, y] of [[100, 22], [108, 34], [86, 110]]) { g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill() }
      })
      const wg = new THREE.BufferGeometry()
      // two wings hinged on the body (along z); x is the span
      wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 1, 0, -0.5, 1, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 0, 0, 0.5, 0, 0, -0.5, -1, 0, 0.5, -1, 0, -0.5, 0, 0, -0.5, 0, 0, 0.5, -1, 0, 0.5], 3))
      wg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1], 2))
      wg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(36).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
      this.bfU = { uTime: { value: 0 }, uShow: { value: 0 } }
      const bm = new THREE.MeshStandardMaterial({ map: wingTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15 })
      bm.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, this.bfU)
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uShow;')
          .replace('#include <project_vertex>', `
            float id = float(gl_InstanceID), tt = uTime * (.22 + fract(id * .37) * .1) + id * 2.3;
            float R = 2.6 + mod(id, 3.) * 1.6;
            vec3 c = vec3(cos(tt) * R, .7 + .55 * sin(tt * 2.7 + id) + mod(id, 2.) * .9, sin(tt * 1.3) * R * .8);
            vec3 c2 = vec3(cos(tt + .05) * R, c.y, sin((tt + .05) * 1.3) * R * .8);
            vec3 fw = normalize(c2 - c + vec3(0., .0001, 0.)); vec3 sd = normalize(cross(vec3(0., 1., 0.), fw));
            float fl = sin(uTime * (13. + fract(id * .71) * 5.) + id * 4.) * .95 + .25;
            vec3 lp = transformed; float sp = abs(lp.x); float sg = sign(lp.x);
            vec3 wl = sd * sg * sp * cos(fl) + vec3(0., 1., 0.) * sp * sin(fl) + fw * -lp.z;
            vec4 mvPosition = viewMatrix * vec4(c + wl * .11 * uShow, 1.); gl_Position = projectionMatrix * mvPosition;`)
      }
      bm.customProgramCacheKey = () => 'treeButterfly'
      const NB = T.name === 'low' ? 4 : 8
      this.butterflies = new THREE.InstancedMesh(wg, bm, NB)
      const bc = ['#ff9a1c', '#ffd23a', '#fff4e0', '#ff7a2a', '#ffc43a', '#f6f0ff', '#ffa83a', '#ffe070']
      for (let i = 0; i < NB; i++) { this.butterflies.setMatrixAt(i, new THREE.Matrix4()); this.butterflies.setColorAt(i, new THREE.Color(bc[i])) }
      this.butterflies.frustumCulled = false
      sc.add(this.butterflies)

      this.pollen = motes(Math.round(220 * (0.4 + 0.6 * T.particles)), new THREE.Box3(new THREE.Vector3(-8, 0.3, -8), new THREE.Vector3(8, 7.5, 8)), { size: 0.04, color: '#ffe3a0', drift: 0.45, opacity: 0, seed: 23, sizeVar: 0.9 })
      sc.add(this.pollen)

      const bg = new THREE.BufferGeometry()
      bg.setAttribute('position', new THREE.Float32BufferAttribute([0.12, 0, 0, -0.1, 0, -0.05, 0.05, 0.05, -0.75, 0.12, 0, 0, -0.1, 0, -0.05, 0.05, 0.05, 0.75], 3))
      const bmat = new THREE.MeshBasicMaterial({ color: '#2a2622', side: THREE.DoubleSide, fog: true })
      bmat.onBeforeCompile = (s) => {
        s.uniforms.uTime = this.bfU.uTime
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += sin(uTime * 7. + float(gl_InstanceID) * 1.9) * abs(position.z) * .8;')
      }
      bmat.customProgramCacheKey = () => 'treeBird'
      this.birds = new THREE.InstancedMesh(bg, bmat, 9)
      this.birds.frustumCulled = false
      this.birdOff = Array.from({ length: 9 }, (_, k) => new THREE.Vector3(-Math.abs(k - 4) * 2.2 + (R2() - 0.5), (R2() - 0.5) * 1.2, (k - 4) * 2.4 + (R2() - 0.5)))
      sc.add(this.birds)
    }

    // ---- The orchard: rows of the same tree, planted the same year, growing with ours
    const rows = []
    for (let x = -96; x <= 96; x += 16) for (let z = -96; z <= 96; z += 16) {
      const ox = x + 8, oz = z + 8 // our tree sits between rows
      const d = Math.hypot(ox, oz)
      if (d < 26 || d > (T.name === 'high' ? 118 : 96)) continue
      rows.push({ x: ox + (R2() - 0.5) * 2, z: oz + (R2() - 0.5) * 2, s: 0.68 + R2() * 0.26, ry: R2() * Math.PI * 2, ph: R2() })
      rows[rows.length - 1].y = groundH(rows[rows.length - 1].x, rows[rows.length - 1].z) - 0.05
    }
    this.rows = rows
    // the skeleton: the hero's trunk and main limbs, final thickness
    const skel = mergeGeometries(segs.filter((s) => s.depth <= 1).map((s) => segGeo(s, 3, false)), false)
    this.orchBarkMat = new THREE.MeshStandardMaterial({ map: bt.map, color: '#c8baa4', roughness: 0.95 })
    this.orchSkel = new THREE.InstancedMesh(skel, this.orchBarkMat, rows.length)
    this.orchSkel.frustumCulled = false
    // the crown: a few clumps of the hero's, two cards each, scaled about each tree's foot in the shader
    const outerCl = clumps.filter((c) => c.outer)
    const pick = []
    const ocn = T.leaves >= 1 ? 34 : T.leaves >= 0.6 ? 26 : 20
    for (let i = 0; i < ocn; i++) pick.push(outerCl[Math.floor((i + R2() * 0.9) / ocn * outerCl.length)])
    const OC = []
    const m4 = new THREE.Matrix4(), tq = new THREE.Quaternion()
    rows.forEach((r, ti) => {
      tq.setFromAxisAngle(up, r.ry)
      const tr = (v) => v.clone().applyQuaternion(tq).multiplyScalar(r.s).add(new THREE.Vector3(r.x, r.y, r.z))
      for (const cl of pick) {
        const cw = tr(cl.c), e = crownOut(cl.c)
        for (let k = 0; k < (T.leaves >= 1 ? 3 : 2); k++) {
          const dir = e.clone().normalize().add(new THREE.Vector3((R2() - 0.5) * 1.4, (R2() - 0.4) * 1.0, (R2() - 0.5) * 1.4)).normalize().applyQuaternion(tq)
          const p = cw.clone().addScaledVector(dir, cl.r * r.s * 0.9)
          OC.push({ p, q: faceQuat(dir, (R2() - 0.5) * 0.8), s: cl.r * r.s * (3.4 + R2() * 1.0), c: cw, cr: cl.r * r.s * 2, crown: tr(CROWN_C), tree: r, cell: Math.floor(R2() * 4), ao: lerp(0.55, 1, smooth(-0.8, 0.5, e.y)), ph: r.ph * 0.6 + R2() * 0.3, ti })
        }
      }
    })
    this.OC = OC
    const oGeo = cardGeo(2)
    const oA = [mkAttr(OC.length, 4), mkAttr(OC.length, 4), mkAttr(OC.length, 4), mkAttr(OC.length, 3)]
    OC.forEach((o, i) => {
      oA[0].setXYZW(i, o.c.x, o.c.y, o.c.z, o.cr)
      oA[1].setXYZW(i, o.crown.x, o.crown.y, o.crown.z, 0.55)
      oA[2].setXYZW(i, (o.cell % 2) * 0.5, Math.floor(o.cell / 2) * 0.5, o.ph, o.ao)
      oA[3].setXYZ(i, o.tree.x, o.tree.z, 10 + o.tree.y) // > .5 marks an orchard card; minus 10 is its foot's height
    })
    oGeo.setAttribute('aClump', oA[0]); oGeo.setAttribute('aCrown', oA[1]); oGeo.setAttribute('aInfo', oA[2]); oGeo.setAttribute('aTree', oA[3])
    this.orchCards = new THREE.InstancedMesh(oGeo, this.folMat, OC.length)
    this.orchCards.frustumCulled = false
    {
      const c = new THREE.Color(), sv = new THREE.Vector3()
      OC.forEach((o, i) => {
        this.orchCards.setMatrixAt(i, m4.compose(o.p, o.q, sv.setScalar(o.s)))
        const k = 0.85 + o.tree.ph * 0.3
        this.orchCards.setColorAt(i, c.setRGB(k * (0.9 + R2() * 0.15), k * (0.95 + R2() * 0.1), k * 0.9))
      })
    }
    // soft ground shadows: occlusion under each tree plus a sun shadow cast along the light
    this.shU = { uSunOff: { value: new THREE.Vector2() }, uAO: { value: 0.4 }, uSunK: { value: 0.4 }, uFogN: { value: 30 }, uFogF: { value: 240 } }
    const shG = new THREE.PlaneGeometry(1, 1, 4, 4); shG.rotateX(-Math.PI / 2)
    this.orchShadow = new THREE.InstancedMesh(shG, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: this.shU, polygonOffset: true, polygonOffsetFactor: -4,
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vC; varying float vR;
        ${GROUND_GLSL}
        void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); w.y = groundH(w.xz) + .04; vW = w.xyz; vC = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
          vR = length(instanceMatrix[0].xyz) / 4.; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec2 uSunOff; uniform float uAO; uniform float uSunK; uniform float uFogN; uniform float uFogF;
        varying vec3 vW; varying vec3 vC; varying float vR;
        void main(){
          vec2 p = vW.xz - vC.xz; float R = vR;
          float ao = 1. - smoothstep(.15 * R, 1.1 * R, length(p));
          vec2 off = uSunOff * R * .8; vec2 q = p - off;
          vec2 sd = normalize(uSunOff + vec2(1e-4)); float st = 1. + length(uSunOff) * .35;
          float sh = 1. - smoothstep(.4 * R, 1.05 * R, length(vec2(dot(q, sd) / st, dot(q, vec2(-sd.y, sd.x)))));
          float a = max(ao * uAO, sh * uSunK);
          a *= 1. - smoothstep(uFogN, uFogF, distance(cameraPosition, vW));
          gl_FragColor = vec4(0., .004, 0., a);
        }`,
    }), rows.length)
    this.orchShadow.frustumCulled = false
    sc.add(this.orchShadow, this.orchSkel, this.orchCards)

    // ---- Distant hills in three hazy layers, and older orchard blocks on the swells between, rows receding into the haze
    this.ridgeU = []
    for (let L = 0; L < 3; L++) {
      const rad = 250 + L * 55, SEG = 200, v = [], uv = [], idx = []
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2, x = Math.cos(a) * rad, z = Math.sin(a) * rad
        const top = 5 + L * 4.5 + (5 + L * 3) * (0.5 + 0.5 * Math.sin(a * (3 + L) + L * 2.1)) * (0.6 + 0.4 * Math.sin(a * (9.3 + L * 2) + 1)) + (2.5 + L) * Math.sin(a * 23.7 + L)
        v.push(x, -10, z, x, top, z); uv.push(j / SEG, 0, j / SEG, 1)
        if (j < SEG) { const b2 = j * 2; idx.push(b2, b2 + 2, b2 + 1, b2 + 1, b2 + 2, b2 + 3) }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx)
      const u = { uC: { value: new THREE.Color() }, uF: { value: new THREE.Color() }, uSunW: { value: this.sun }, uSunC: { value: new THREE.Color() } }
      this.ridgeU.push(u)
      const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: u, side: THREE.DoubleSide, fog: false,
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */ `uniform vec3 uC, uF, uSunW, uSunC; varying vec2 vUv; varying vec3 vW;
          void main(){
            vec3 dir = normalize(vW - cameraPosition);
            float sunA = pow(max(dot(dir, normalize(uSunW)), 0.), 5.);
            vec3 col = uC * (.8 + .3 * vUv.y);
            col = mix(col, uF + uSunC * .5, sunA * .55);
            col = mix(col, uF, (1. - smoothstep(.05, .7, vUv.y)) * .8);
            gl_FragColor = vec4(col, 1.);
          }`,
      }))
      mesh.renderOrder = -5 + L * 0; mesh.frustumCulled = false
      sc.add(mesh)
    }
    {
      const far = [], fr = rng(404)
      const nMax = T.name === 'high' ? 380 : T.name === 'mid' ? 240 : 150
      for (let x = -236; x <= 236 && far.length < nMax; x += 9) for (let z = -236; z <= 236 && far.length < nMax; z += 7.5) {
        const d = Math.hypot(x, z); if (d < 128 || d > 236) continue
        const blk = Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.027 - 0.6) + Math.sin(Math.atan2(z, x) * 5) * 0.4
        if (blk < 0.05 || fr() < 0.12) continue
        far.push({ x: x + (fr() - 0.5) * 1.2, z: z + (fr() - 0.5) * 1.2, s: 2.3 + fr() * 0.9 })
      }
      const cg = new THREE.IcosahedronGeometry(1, 1)
      { const p = cg.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y < -0.2 ? -0.2 + (y + 0.2) * 0.3 : y) } cg.scale(1.25, 0.8, 1.25); cg.translate(0, 1.6, 0); cg.computeVertexNormals() }
      const tg = new THREE.CylinderGeometry(0.15, 0.22, 1.2, 5); tg.translate(0, 0.6, 0)
      const fm = new THREE.MeshStandardMaterial({ color: '#40602c', roughness: 0.95 })
      this.farOrch = new THREE.InstancedMesh(mergeGeometries([cg, tg].map((x) => (x.index ? x.toNonIndexed() : x))), fm, far.length)
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color()
      far.forEach((f, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fr() * 6.28)
        this.farOrch.setMatrixAt(i, M.compose(new THREE.Vector3(f.x, groundH(f.x, f.z) - 0.2, f.z), q, new THREE.Vector3(f.s, f.s * (0.85 + fr() * 0.3), f.s)))
        this.farOrch.setColorAt(i, c.setRGB(0.8 + fr() * 0.35, 0.85 + fr() * 0.3, 0.8 + fr() * 0.2))
      })
      this.farOrch.frustumCulled = false
      sc.add(this.farOrch)
    }

    // ---- Monsoon rain: streaks falling in a box around the tree
    const rn = Math.round(2600 * T.particles + 400)
    const rp = new Float32Array(rn * 6), re = new Float32Array(rn * 2)
    for (let i = 0; i < rn; i++) {
      const x = (R() - 0.5) * 50, y = R() * 30, z = (R() - 0.5) * 50
      rp.set([x, y, z, x, y, z], i * 6); re.set([0, 1], i * 2)
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1))
    this.rainU = { uTime: { value: 0 }, uRain: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uRainCol: { value: new THREE.Color(0.62, 0.7, 0.82) } }
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.rainU,
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCenter; varying float vE;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime * 26. , 30.) - 2.; p.y += aEnd * .9; p.x += aEnd * .14 + uCenter.x; p.z += uCenter.z; vE = aEnd;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
      fragmentShader: `uniform float uRain; uniform vec3 uRainCol; varying float vE; void main(){ gl_FragColor = vec4(uRainCol * uRain * (.25 + .5 * vE), 1.); }`,
    }))
    this.rain.frustumCulled = false
    sc.add(this.rain)

    // ---- The lightning bolt: a jagged ribbon far behind the tree, lit for a frame
    {
      const pts = [], br = rng(77)
      let p = new THREE.Vector3(10, 120, -190)
      const end = new THREE.Vector3(30, 6, -175)
      const n = 26
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3().lerpVectors(p, end, t).add(new THREE.Vector3((br() - 0.5) * 9 * Math.sin(t * Math.PI), 0, 0))) }
      const strip = (ps, w) => {
        const pos = []
        for (let i = 0; i < ps.length - 1; i++) {
          const a = ps[i], b = ps[i + 1], ww = w * (1 - (i / ps.length) * 0.5)
          pos.push(a.x - ww, a.y, a.z, a.x + ww, a.y, a.z, b.x + ww, b.y, b.z, a.x - ww, a.y, a.z, b.x + ww, b.y, b.z, b.x - ww, b.y, b.z)
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g
      }
      const parts = [strip(pts, 0.55)]
      for (const at of [8, 15]) {
        const bp = [pts[at].clone()]
        for (let i = 1; i < 8; i++) bp.push(bp[i - 1].clone().add(new THREE.Vector3((at === 8 ? 1 : -1) * (2 + br() * 4), -4 - br() * 3, 0)))
        parts.push(strip(bp, 0.3))
      }
      this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })
      this.bolt = new THREE.Mesh(mergeGeometries(parts), this.boltMat)
      this.bolt.frustumCulled = false
      sc.add(this.bolt)
    }

    // ---- Fireflies on the clear night after the rain
    this.flies = motes(Math.round(340 * (0.4 + 0.6 * T.particles)), new THREE.Box3(new THREE.Vector3(-23, 0.12, -23), new THREE.Vector3(23, 2.2, 23)), { size: 0.1, color: '#d2f25a', drift: 0.5, opacity: 0, seed: 11, sizeVar: 0.8 })
    sc.add(this.flies)

    this.lastG = -1
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sv = new THREE.Vector3(); this.c = new THREE.Color()
    this.young = new THREE.Color(2.9, 0.42, 0.36); this.mature = new THREE.Color(0.4, 0.58, 0.38)
    this.tmpV = new THREE.Vector3(); this.tmpP = new THREE.Vector3(); this.tmpQ = new THREE.Quaternion()
    this.backView = new THREE.Vector3(); this.backCol = new THREE.Color(); this.backDir = new THREE.Vector3()
  }

  /** Leaf, card, litter and orchard instances follow growth (CPU, only when growth changes). */
  setGrowth(g) {
    if (Math.abs(g - this.lastG) < 1e-5) return
    this.lastG = g
    const { m4, q, sv, c, L } = this
    // individual leaves: only the living ones are drawn (packed to the front)
    let n = 0
    for (let i = 0; i < L.length; i++) {
      const l = L[i]
      if (g < l.birth || g > l.death + 0.05) continue
      const open = smooth(l.birth, l.birth + 0.05, g), fall = smooth(l.death, l.death + 0.05, g)
      const s = l.s * open * (1 - fall)
      if (s < 1e-4) continue
      q.copy(l.qFold).slerp(l.qOpen, smoother(0, 1, open))
      sv.setScalar(s)
      if (l.ride) {
        const gr = smooth(l.ride.sb, l.ride.sb + l.ride.sd, g)
        this.tmpP.copy(l.ride.p0).lerp(l.ride.p1, gr).add(l.rel)
        m4.compose(this.tmpP, q, sv)
      } else m4.compose(l.p, q, sv)
      this.leaves.setMatrixAt(n, m4)
      const age = smooth(l.birth + 0.05, l.birth + 0.26, g)
      c.copy(this.young).lerp(this.mature, age).multiplyScalar(l.tint)
      this.leaves.setColorAt(n, c)
      n++
    }
    this.leaves.count = n
    this.leaves.instanceMatrix.needsUpdate = true
    this.leaves.instanceColor.needsUpdate = true
    // crown cards open, unfolding from their twig
    for (let i = 0; i < this.C.length; i++) {
      const l = this.C[i]
      const open = smooth(l.birth, l.birth + 0.07, g)
      this.tmpQ.setFromAxisAngle(this.tmpV.set(1, 0, 0), (1 - open) * 1.1)
      q.copy(l.q).multiply(this.tmpQ)
      this.tmpP.copy(l.cl.c).lerp(l.p, 0.3 + 0.7 * open)
      this.cards.setMatrixAt(i, m4.compose(this.tmpP, q, sv.setScalar(Math.max(l.s * open, 1e-4))))
    }
    this.cards.instanceMatrix.needsUpdate = true
    // leaf litter
    for (let i = 0; i < this.LT.length; i++) {
      const l = this.LT[i], k = smooth(l.birth, l.birth + 0.06, g)
      this.litter.setMatrixAt(i, m4.compose(l.p, l.q, sv.setScalar(Math.max(l.s * k, 1e-4))))
    }
    this.litter.instanceMatrix.needsUpdate = true
    // the orchard
    const K = lerp(0.1, 1, smooth(0.05, 1, g))
    this.folU.uOrchK.value = K
    this.rows.forEach((r, i) => {
      const S = r.s * K
      q.setFromAxisAngle(this.tmpV.set(0, 1, 0), r.ry)
      this.orchSkel.setMatrixAt(i, m4.compose(this.tmpP.set(r.x, r.y, r.z), q, sv.setScalar(S)))
      this.orchShadow.setMatrixAt(i, m4.compose(this.tmpP.set(r.x, 0, r.z), q.identity(), sv.setScalar(6 * S * 4)))
    })
    this.orchSkel.instanceMatrix.needsUpdate = true
    this.orchShadow.instanceMatrix.needsUpdate = true
  }

  update(i, tt, time, dt) {
    const t = clamp(tt, -0.2, 1)
    const g = lerp(0.012, 1, 0.13 * smooth(-0.12, 0.22, t) + 0.87 * smoother(0.06, 0.84, t))
    this.gu.uG.value = g
    this.folU.uG.value = g
    this.setGrowth(g)

    // ---- Sky: days and nights, a monsoon, then noon. phi counts days from sunrise (0) ; 0.25 is noon.
    // the last day runs on into a low gold afternoon, the sun behind the crown and to the right
    // after the misty dawn the sun races across to a low gold afternoon (f ≈ .45) and stays there to the end
    const phi = lerp(lerp(0.03, 2.25, easeInOut(clamp((t - 0.04) / 0.86))), 2.45, smooth(0.64, 0.7, t))
    const f = phi - Math.floor(phi)
    const ang = f * Math.PI * 2
    const elev = Math.sin(ang)
    // sunrise in the east (+x, slightly behind the tree from the camera's first view), arcing low (a tropical winter sun,
    // so most of every day is gold) over to the west
    const elevV = elev * lerp(0.6, 0.37, smooth(0.64, 0.7, t))
    this.sun.set(Math.cos(ang) * 0.9, elevV + 0.02, lerp(0.38, -0.04, smooth(0.62, 0.7, t))).normalize()
    const day = smooth(-0.12, 0.18, elev)
    const dusk = Math.exp(-Math.pow(elevV / 0.24, 2)) // near the horizon: warm
    const summer = 1 - smooth(0.33, 0.38, t) // the hot dry season before the first monsoon
    const mist = smooth(0.6, 0.64, t) * (1 - smooth(0.69, 0.73, t)) // the cool-season morning
    const morn = 0 // (the late-morning stage is gone: the dawn hands straight over to the gold afternoon)
    const gold = smooth(0.645, 0.7, t) // the grown tree's long gold afternoon
    const duskW = Math.max(dusk, gold * 0.55)
    // weather: the storm comes in at the first dusk, rains through that night and the next day, clears at the second dusk
    const monsoon = smooth(0.35, 0.4, t) * (1 - smooth(0.53, 0.575, t))
    const wet = Math.max(monsoon, smooth(0.4, 0.45, t) * (1 - smooth(0.6, 0.78, t)))
    const washed = smooth(0.6, 0.67, t) * (1 - smooth(0.8, 0.92, t))
    const flash = Math.exp(-Math.pow((t - 0.418) / 0.0045, 2)) + 0.45 * Math.exp(-Math.pow((t - 0.4245) / 0.0022, 2))
    const lush = smooth(0.38, 0.54, t)
    const su = this.sky.userData.u
    const night = 1 - day
    const clearNight = night * (1 - monsoon)
    // top colour
    su.uTop.value.setRGB(lerp(0.05, 0.1, day), lerp(0.08, 0.27, day), lerp(0.2, 0.72, day))
    su.uTop.value.lerp(this.c.setRGB(lerp(0.03, 0.12, day), lerp(0.045, 0.17, day), lerp(0.13, 0.36, day)), dusk * 0.85)
    su.uTop.value.lerp(this.c.setRGB(0.18, 0.44, 0.92), summer * day * (1 - dusk) * 0.8)
    su.uTop.value.lerp(this.c.setRGB(0.06, 0.17, 0.5), gold * 0.75)
    su.uTop.value.lerp(this.c.setRGB(0.2, 0.46, 0.92), morn * 0.75)
    su.uTop.value.lerp(this.c.setRGB(lerp(0.07, 0.24, day), lerp(0.085, 0.28, day), lerp(0.1, 0.29, day)), monsoon * 0.85)
    su.uHor.value.setRGB(lerp(0.09, 0.62, day), lerp(0.13, 0.76, day), lerp(0.27, 0.9, day))
    su.uHor.value.lerp(this.c.setRGB(1.0, 0.8, 0.52), summer * day * 0.62)
    su.uHor.value.lerp(this.c.setRGB(1.0, 0.56, 0.26), duskW * 0.85 * (1 - monsoon * 0.7) * smooth(-0.15, 0.05, elev))
    su.uHor.value.lerp(this.c.setRGB(0.78, 0.8, 0.84), mist * 0.6)
    su.uHor.value.lerp(this.c.setRGB(1.0, 0.72, 0.44), gold * 0.75)
    su.uHor.value.lerp(this.c.setRGB(1.0, 0.8, 0.64), morn * 0.45)
    su.uHor.value.lerp(this.c.setRGB(lerp(0.13, 0.48, day), lerp(0.16, 0.55, day), lerp(0.17, 0.52, day)), monsoon * 0.8)
    this.fogCol = (this.fogCol || new THREE.Color()).copy(su.uHor.value)
    // a pale break low in the storm clouds
    su.uHor.value.lerp(this.c.setRGB(0.84, 0.86, 0.76), monsoon * day * 0.3)
    su.uTop.value.lerp(this.c.setRGB(0.55, 0.52, 0.85), clamp(flash) * 0.7)
    su.uHor.value.lerp(this.c.setRGB(0.8, 0.78, 1.0), clamp(flash) * 0.75)
    su.uBot.value.copy(su.uHor.value).multiplyScalar(0.5)
    // clouds race through the years and slow to a drift for the grown tree
    su.uTime.value = lerp(t * 1400, 1400 * 0.72 + (t - 0.72) * 120, smooth(0.66, 0.8, t)) + time * 0.4
    su.uCloudSpeed.value = 0.004
    su.uStars.value = smooth(0.4, 1, night) * (1 - monsoon)
    su.uStarK.value = 1 + smooth(0.53, 0.58, t) * 0.6
    su.uMilky.value = clearNight * smooth(0.53, 0.58, t) * (1 - smooth(0.6, 0.63, t))
    su.uMeteor.value = clamp((t - 0.585) / 0.014)
    su.uClouds.value = lerp(lerp(0.42, 0.3, summer) - washed * 0.1 + gold * 0.05, 0.98, monsoon)
    su.uCloudLow.value = lerp(lerp(0.13, 0.06, gold), 0.22, monsoon)
    su.uCloudScale.value = lerp(0.62, 0.9, monsoon)
    su.uCloudCol.value.setRGB(1, 0.95, 0.88).multiplyScalar(lerp(0.15, 1.15, day) * (1 - monsoon * 0.5))
    su.uCloudCol.value.lerp(this.c.setRGB(1.25, 0.72, 0.42), duskW * day * 0.7)
    su.uCloudShade.value.setRGB(0.5, 0.52, 0.6).multiplyScalar(lerp(0.12, 1, day) * (1 - monsoon * 0.45))
    su.uCloudShade.value.lerp(this.c.setRGB(0.5, 0.36, 0.42), duskW * day * 0.6)
    su.uCloudShade.value.lerp(this.c.setRGB(0.62, 0.72, 0.92), morn * 0.7)
    su.uCloudCol.value.lerp(this.c.setRGB(1.3, 1.18, 1.05), morn * 0.6)
    su.uHaze.value = 0.4 * (1 - duskW * 0.7) * (1 - summer * day * 0.3) * (1 - morn * 0.35) + monsoon * 0.22 - washed * 0.15
    // the disc is the sun by day and the moon on a clear night
    const moonK = clearNight * smooth(0.55, 0.95, night)
    if (moonK > day * (1 - monsoon * 0.85)) {
      su.uSunDir.value.copy(MOON)
      su.uSunCol.value.setRGB(0.62, 0.7, 0.95).multiplyScalar(0.32 * moonK)
      su.uSunSize.value = 0.026; su.uSunGlow.value = 0.7
    } else {
      su.uSunDir.value.copy(this.sun)
      su.uSunCol.value.setRGB(1, lerp(0.9, 0.6, duskW), lerp(0.72, 0.32, duskW)).multiplyScalar(day * (1 - monsoon * 0.85))
      su.uSunSize.value = lerp(0.03, 0.036, dusk); su.uSunGlow.value = lerp(1, 0.45, dusk) * (1 - gold * 0.3)
    }

    // lights
    this.sunCol.setRGB(1, lerp(lerp(0.9, 0.84, summer), 0.6, duskW), lerp(lerp(0.76, 0.62, summer), 0.34, duskW)).lerp(this.c.setRGB(0.86, 0.92, 0.84), monsoon)
    this.sunL.color.copy(this.sunCol)
    this.sunL.intensity = day * lerp(3.5, 2.2, dusk) * (1 - monsoon * 0.72) * (1 + washed * 0.08) * (1 - mist * 0.35)
    this.sunL.position.copy(this.sun).multiplyScalar(40).add(this.tmpV.set(0, 3, 0))
    this.sunL.target.position.set(0, 3, 0)
    this.moon.color.setRGB(0.58, 0.68, 1.0)
    this.moon.intensity = night * (0.35 + 1.15 * (1 - monsoon))
    this.boltL.intensity = flash * 1.1
    // hemisphere: blue sky over warm ground by day, moonlit blue at night, grey-green under the monsoon
    this.hemi.color.setRGB(lerp(0.36, 0.85, day), lerp(0.46, 0.9, day), lerp(0.85, 1, day))
    this.hemi.color.lerp(this.c.setRGB(0.66, 0.76, 0.68), monsoon * day)
    this.hemi.color.lerp(this.c.setRGB(0.55, 0.62, 0.9), dusk * day * 0.5)
    this.hemi.groundColor.setRGB(lerp(0.07, 0.32, day), lerp(0.08, 0.3, day), lerp(0.1, 0.18, day))
    this.hemi.groundColor.lerp(this.c.setRGB(0.18, 0.24, 0.14), monsoon * day * 0.8)
    this.hemi.intensity = lerp(0.7, 1.15, day) * (1 + monsoon * 0.15) + flash * 0.05
    this.scene.environment = monsoon > 0.5 ? (day > 0.4 ? this.envStorm : this.envStormNight) : night > 0.6 ? this.envNight : dusk > 0.5 && day > 0.2 ? this.envDawn : this.envDay
    this.scene.fog.color.copy(this.fogCol).lerp(this.c.setRGB(0.55, 0.55, 0.75), clamp(flash) * 0.3).lerp(this.c.setRGB(0.5, 0.56, 0.52), monsoon * day * 0.5)
    this.scene.fog.color.lerp(this.c.setRGB(0.82, 0.83, 0.86), mist * 0.75)
    this.scene.fog.near = lerp(lerp(lerp(lerp(34, 14, monsoon), 50, washed), 22, gold), 4, mist); this.scene.fog.far = lerp(lerp(lerp(lerp(250, 170, monsoon), 300, washed), 210, gold), 95, mist)
    if (!this.ridgeCol) this.ridgeCol = new THREE.Color()
    this.ridgeU.forEach((u, L) => {
      u.uF.value.copy(this.scene.fog.color)
      u.uC.value.setRGB(0.24, 0.32, 0.36).multiplyScalar(lerp(0.25, 1, day)).lerp(this.c.setRGB(0.07, 0.13, 0.12), monsoon * 0.7).lerp(this.scene.fog.color, [0.45, 0.62, 0.76][L] * (1 - monsoon * 0.45) + mist * 0.2)
      u.uSunC.value.copy(su.uSunCol.value).multiplyScalar(0.3)
    })
    this.shU.uFogN.value = this.scene.fog.near; this.shU.uFogF.value = this.scene.fog.far
    // the light behind the crown: the moon, or for an instant the lightning
    const fk = clamp(flash * 2)
    this.backDir.copy(MOON).lerp(BOLT, fk).normalize()
    this.backCol.setRGB(0.3, 0.42, 0.9).multiplyScalar(night * (0.25 + 0.75 * (1 - monsoon)) * 1.4)
    this.backCol.add(this.c.setRGB(0.9, 0.9, 1.25).multiplyScalar(flash * 2.6))

    // seasons on the ground
    this.grassU.uTint.value.setRGB(lerp(0.85, 0.42, lush), lerp(0.72, 0.68, lush), lerp(0.38, 0.22, lush)).lerp(this.c.setRGB(0.3, 0.78, 0.2), wet * 0.45)
    this.grassU.uLush.value = lush
    this.groundMat.color.setRGB(lerp(0.85, 0.5, lush), lerp(0.72, 0.62, lush), lerp(0.45, 0.32, lush))
    this.groundU.uCanopy.value = lerp(0.6, 6.6, smooth(0.3, 0.88, g))
    this.groundU.uWet.value = wet
    this.rainU.uRain.value = monsoon * (1 + night * 0.4)
    this.rainU.uRainCol.value.setRGB(0.62, 0.7, 0.82).lerp(this.c.setRGB(1, 1, 1.25), clamp(flash))
    this.rainU.uTime.value = time
    this.gu.uWind.value = 0.035 + monsoon * 0.08
    this.gu.uMoss.value = smooth(0.45, 0.95, g)
    this.gu.uWet.value = wet
    this.leafMat.userData.u.uWind.value = 0.03 + monsoon * 0.09
    this.leafMat.userData.u.uTime.value = time
    this.leafMat.roughness = lerp(0.42, 0.26, wet)
    this.folU.uTime.value = time; this.folU.uWind.value = 0.022 + monsoon * 0.07
    this.folU.uWet.value = wet
    this.gu.uTime.value = time
    this.grassU.uTime.value = time * (1 + monsoon * 1.5)
    this.bloomU.uBloom.value = smooth(0.7, 0.87, t)
    this.fallU.uTime.value = time; this.fallU.uFall.value = smooth(0.58, 0.7, t)
    const fu = this.flies.userData.u
    fu.uTime.value = time; fu.uOp.value = clearNight * smooth(0.535, 0.57, t) * (1 - smooth(0.615, 0.64, t)) * 16
    // small lives in the grown tree's afternoon
    const life = smooth(0.66, 0.74, t) * day * (1 - monsoon)
    this.bfU.uTime.value = time; this.bfU.uShow.value = life
    this.butterflies.visible = life > 0.01
    const pu = this.pollen.userData.u
    pu.uTime.value = time; pu.uOp.value = life * 1.3 * (0.4 + 0.6 * duskW); pu.uPx.value = this.engine.dpr || 1
    this.pollen.visible = life > 0.01
    this.meadowU.uTime.value = time; this.meadowU.uWindM.value = 1 + monsoon * 2
    this.meadowU.uSunC.value.copy(this.sunCol).multiplyScalar(this.sunL.intensity / 3.4)
    fu.uPx.value = this.engine.dpr || 1
    this.boltMat.color.setRGB(2.4, 2.3, 3.2).multiplyScalar(clamp(flash))
    // on a tall screen the headline fills the top of the sky: the bolt strikes lower down
    this.bolt.scale.y = this.camera.aspect < 1 ? 0.5 : 1
    // the orchard's ground shadows follow the sun
    const sy = Math.max(this.sun.y, 0.16)
    this.shU.uSunOff.value.set(-this.sun.x / sy, -this.sun.z / sy)
    if (this.shU.uSunOff.value.length() > 1.6) this.shU.uSunOff.value.setLength(1.6)
    this.shU.uSunK.value = 0.42 * day * (1 - monsoon * 0.8) * smooth(0.1, 0.4, g)
    this.shU.uAO.value = (0.3 + 0.12 * (1 - day)) * smooth(0.1, 0.4, g)

    // ---- Camera: one slow spiral up and out around the tree.
    const s = easeInOut(clamp((t + 0.14) / 1.14))
    const th = lerp(-1.75, 1.9, s)
    // the camera keeps the young plant framed while it is small, then spirals up and out
    const PH = [[0, 0.06], [0.15, 1.7], [0.37, 3.6], [0.55, 5.4], [0.84, 8.2], [1, 8.4]]
    let plantH = 8.4
    for (let k = 0; k < PH.length - 1; k++) if (g <= PH[k + 1][0]) { plantH = lerp(PH[k][1], PH[k + 1][1], (g - PH[k][0]) / (PH[k + 1][0] - PH[k][0])); break }
    // on a tall screen the grown crown is wider than the frame: stand further back
    const tall = this.camera.aspect < 1 ? lerp(1, 1.34, smooth(0.3, 0.8, s)) : 1
    // landscape: while the headline (top left) and year (bottom right) are up, the tree stands right of centre and a
    // little further off, clear of both; it drifts back to centre for the push into the blossom
    const hk = this.camera.aspect >= 1 ? smooth(-0.12, 0.04, t) * (1 - smooth(0.8, 0.9, t)) : 0
    const grownK = smooth(0.3, 0.45, t)
    this.frame[0] = lerp(0.13, lerp(0.2, 0.25, grownK) + 0.03 * smooth(0.33, 0.4, t) * (1 - smooth(0.52, 0.6, t)), hk); this.frame[1] = lerp(0.05, lerp(0.06, 0.11, grownK), hk)
    const wideK = lerp(1, 1.42, hk * smooth(0.22, 0.5, s))
    const rad = Math.max(lerp(1.1, 21, smoother(0, 1, s)), 0.75 + plantH * 2.1) * tall * wideK
    const h = Math.max(lerp(0.62, 7.6, Math.pow(s, 1.3)), 0.12 + plantH * 0.42)
    const look = new THREE.Vector3(0, Math.max(lerp(0.05, 4.3, smoother(0, 0.8, s)), plantH * 0.42), 0)
    // at the very start look east toward the sunrise, through the seedling
    const sunward = smooth(0.06, -0.14, t)
    look.add(this.tmpV.set(0.9, 0.22, 0.35).multiplyScalar(sunward))
    const cam = new THREE.Vector3(Math.sin(th) * rad, h, Math.cos(th) * rad)
    const push = smoother(0.8, 1.0, t)
    if (push > 0) {
      const near = this.blossomPt.clone().add(cam.clone().sub(this.blossomPt).normalize().multiplyScalar(5.5))
      cam.lerp(near, push * 0.75); look.lerp(this.blossomPt, push)
    }
    aim(this.camera, cam, look, 0)
    this.camera.far = 600
    {
      const bv = smooth(0.7, 0.74, t) * (1 - smooth(0.9, 0.93, t)) * day
      this.birds.visible = bv > 0.01
      if (this.birds.visible) {
        const fw = this.tmpP.copy(look).sub(cam).setY(0).normalize(), rt = this.tmpV.set(-fw.z, 0, fw.x)
        const k = (t - 0.7) / 0.23
        const c0 = look.clone().addScaledVector(fw, 70).addScaledVector(rt, lerp(-75, 75, k)).add(new THREE.Vector3(0, 20 + 4 * k, 0))
        const yaw = Math.atan2(-rt.z, rt.x)
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        this.birdOff.forEach((o, kk) => {
          const pp = o.clone().applyQuaternion(this.q).add(c0).add(new THREE.Vector3(0, Math.sin(time * 1.1 + kk) * 0.5, 0))
          this.birds.setMatrixAt(kk, this.m4.compose(pp, this.q, this.sv.setScalar(1.6)))
        })
        this.birds.instanceMatrix.needsUpdate = true
      }
    }
    this.rainU.uCenter.value.set(cam.x * 0.4, 0, cam.z * 0.4)
    // the storm by day: a pale break low in the cloud behind the crown rims the leaves and catches the rain
    {
      const brk = monsoon * lerp(0.45, 1, day) * (1 - clamp(flash * 3))
      const fw = this.tmpP.copy(look).sub(cam).setY(0).normalize()
      const bd = (this.brkDir || (this.brkDir = new THREE.Vector3())).set(fw.x - fw.z * 0.3, 0.14, fw.z + fw.x * 0.3).normalize()
      if (brk > 0.001) {
        su.uSunDir.value.lerp(bd, smooth(0, 0.4, brk)).normalize()
        su.uSunCol.value.lerp(this.c.setRGB(lerp(0.55, 1.0, day), lerp(0.65, 0.94, day), lerp(0.9, 0.78, day)), brk * 0.6)
        su.uSunSize.value = lerp(su.uSunSize.value, 0.004, brk); su.uSunGlow.value = lerp(su.uSunGlow.value, 1.2, brk)
        this.backDir.lerp(bd, brk).normalize()
        this.backCol.add(this.c.setRGB(0.95, 0.92, 0.78).multiplyScalar(brk * 0.55))
        this.rainU.uRainCol.value.lerp(this.c.setRGB(0.95, 0.95, 0.9), brk * 0.5)
      }
      this.groundU.uSky.value.copy(su.uHor.value).multiplyScalar(0.35 + brk * 0.15)
    }

    // match points: the sun at dawn, a blossoming twig at the end
    const sunPt = cam.clone().addScaledVector(this.sun, 300)
    this.focus.copy(t < 0.4 ? sunPt : this.blossomPt)

    // post
    this.post.focus = cam.distanceTo(look) * 0.95
    this.post.range = lerp(1.2, 14, s)
    this.post.dof = lerp(9, 2.5, s) * (1 - clearNight * 0.85)
    this.look.exposure = lerp(1.18, 1.0, day) * (1 - dusk * 0.15) * (1 + monsoon * 0.12) + flash * 0.3
    this.look.bloom = 0.5 + dusk * 0.12 + night * 0.15 + flash * 0.3
    this.look.threshold = 1.0
    // shafts: the low sun through the young tree, the clearing storm, the grown crown
    this.look.rays = lerp(0.55 + 0.5 * dusk, 0.36, gold) * day * (1 - monsoon * 0.9) * (1 - mist * 0.5)
    this.look.rayThreshold = lerp(1.05, 1.35, gold)
    this.look.rayTint.setRGB(1, lerp(0.9, 0.74, duskW), lerp(0.72, 0.48, duskW))
    this.rayFrom = null
    this.look.vig = 0.5 + duskW * 0.25
    this.grade([0.006 * night + mist * 0.01, 0.014 * night + 0.004 * monsoon + mist * 0.012, 0.04 * night + mist * 0.02], [1 + duskW * 0.06 + summer * day * 0.04, 1 + monsoon * 0.02, 1 - duskW * 0.07 + night * 0.05 - summer * day * 0.05], lerp(0.74, 1.08, day) - monsoon * 0.06 + washed * 0.1 - mist * 0.12)
  }

  afterCamera() {
    const u = this.leafMat.userData.u
    const sunK = this.sunL.intensity / 3.4
    this.backView.copy(this.backDir).transformDirection(this.camera.matrixWorldInverse)
    // by night the leaves glow against the moon instead of the sun
    const useBack = this.backCol.r + this.backCol.g + this.backCol.b > (this.sunCol.r + this.sunCol.g + this.sunCol.b) * sunK
    u.uSunView.value.copy(useBack ? this.backView : this.sunView)
    if (useBack) u.uSunCol.value.copy(this.backCol).multiplyScalar(0.8)
    else u.uSunCol.value.copy(this.sunCol).multiplyScalar(sunK)
    this.folU.uSunView.value.copy(this.sunView)
    this.meadowU.uSunV.value.copy(this.sunView)
    this.folU.uSunCol.value.copy(this.sunCol).multiplyScalar(sunK)
    this.folU.uBackView.value.copy(this.backView)
    this.folU.uBackCol.value.copy(this.backCol)
  }
}
