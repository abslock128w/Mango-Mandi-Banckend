// The protagonist. An asymmetric mango body (a fuller dorsal shoulder, a beak, a shallow stem cavity), a skin shader whose
// colour follows one `ripeness` uniform (deep waxy green; a patchy turn to gold that starts at the shoulders and the sun
// side; saffron gold with a red-orange cheek), lenticels denser towards the tip, mottling, freckles by the stem, a pale
// bloom in broad patches, pores and a dimpled clear coat that breaks the highlight into a soft sheen, light through the
// thin edge, a fresnel rim and warm colour on the shadow side; a woody stem collar, and a glossy leaf.
// Everything is computed in object space, so it turns with the fruit.
import * as THREE from 'three'
import { NOISE, BUMP } from './glsl.js'
import { canvasTex, rng, clamp } from './util.js'

// ---- Geometry -------------------------------------------------------------------------------------------------------

const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }

/** The mango form, about 2 units long (y), 1.4 wide (x), 1.15 thick (z). Stem at the top.
   mangoPoint maps a point on the unit sphere to the mango surface. */
export function mangoPoint(vx, vy, vz, out = new THREE.Vector3()) {
  const u = vy // -1 bottom … 1 top
  // Width profile: broad, round shoulders; the lower half narrows toward the beak.
  const w = 0.67 * (1 + 0.05 * u) * (1 - 0.17 * Math.pow(sstep(0, 1, -u), 1.6))
  // The dorsal side (+x) is fuller than the ventral side.
  let x = vx * w * (1.01 + 0.06 * Math.tanh(vx * 5))
  const z = vz * w * 0.84
  let y = u > 0 ? u * 0.92 : u * 1.0
  // The body bends: the bottom swings to the ventral side, like the fruit in the wordmark.
  x += -0.34 * Math.pow(Math.max(-u, 0), 2.0) + 0.05 * u
  const ven = Math.max(-vx, 0), dor = Math.max(vx, 0)
  // The dorsal shoulder: fuller and a little higher than the ventral one, so the stem sits off the crown.
  x += 0.05 * dor * Math.exp(-Math.pow((u - 0.42) / 0.32, 2))
  y += 0.045 * Math.pow(dor, 1.4) * sstep(0.25, 0.85, u)
  // The ventral shoulder drops away a touch.
  y -= 0.025 * ven * sstep(0.3, 0.9, u)
  // The beak: a small pointed nub on the ventral side, low down, with the shallow sinus just above it.
  const bk = Math.exp(-(Math.pow((u + 0.74) / 0.1, 2) + Math.pow(vz / 0.3, 2))) * ven
  x -= bk * 0.085
  x += 0.015 * ven * Math.exp(-(Math.pow((u + 0.5) / 0.1, 2) + Math.pow(vz / 0.4, 2)))
  // A shallow, slightly oval cavity where the stem sits (same depth at its centre, so STEM_POINT is unchanged).
  y -= Math.exp(-(vx * vx / 0.055 + vz * vz / 0.04)) * sstep(0.6, 1, u) * 0.07
  // Gentle unevenness, so it does not look turned on a lathe.
  const n = Math.sin(vx * 5.1 + vy * 3.3) * Math.sin(vz * 4.2 - vy * 2.1) * 0.012 + Math.sin(vx * 2.3 - vz * 3.1 + vy * 1.7) * 0.008
  return out.set(x * (1 + n), y, z * (1 + n))
}
export function mangoGeometry(detail = 1) {
  const g = new THREE.SphereGeometry(1, Math.round(96 * detail), Math.round(72 * detail))
  const p = g.attributes.position
  const v = new THREE.Vector3(), o = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    mangoPoint(v.x, v.y, v.z, o)
    p.setXYZ(i, o.x, o.y, o.z)
  }
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}
/** The mango's outline in its flat (x-y) plane, as points (for cut faces). */
export function mangoOutline(n = 96, scale = 1) {
  const pts = []
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, o = mangoPoint(Math.cos(a), Math.sin(a), 0); pts.push(new THREE.Vector2(o.x * scale, o.y * scale)) }
  return pts
}
/** Where the stem meets the body, in mango space. */
export const STEM_POINT = new THREE.Vector3(0.05, 0.86, 0)

// ---- Skin ------------------------------------------------------------------------------------------------------------

const SKIN = /* glsl */ `
uniform float uRipe; uniform float uTime; uniform float uGobo; uniform float uRim; uniform float uBruise; uniform float uBump;
uniform vec3 uBlushDir; uniform vec3 uBruiseDir; uniform vec3 uSunView; uniform vec3 uSunCol; uniform vec3 uSeed;
varying vec3 vObj; varying float vRipe; varying vec3 vSeed;
${NOISE}
${BUMP}
// The ripening ramp: deep green, yellow-green, golden yellow, saffron gold (same stops as before: .36, .7, 1).
vec3 mmSkin(float k){
  vec3 c0 = vec3(.028,.082,.012), c1 = vec3(.17,.23,.026), c2 = vec3(.80,.50,.034), c3 = vec3(.92,.40,.024);
  return k < .36 ? mix(c0, c1, smoothstep(0., .36, k)) : (k < .7 ? mix(c1, c2, smoothstep(.36, .7, k)) : mix(c2, c3, (k - .7) / .3));
}
// One jittered dot per cell that never crosses its cell (one hash set, not 27). x: mask, y: id.
vec2 mmSpot(vec3 p, float rad, float keep){
  vec3 i = floor(p), f = fract(p);
  vec3 h = vec3(mmHash(i), mmHash(i + 19.1), mmHash(i + 41.7));
  float id = mmHash(i + 7.7);
  float d = length(f - (.5 + (h - .5) * (1. - 2. * rad)));
  return vec2(step(1. - keep, id) * (1. - smoothstep(rad * .3, rad, d)), id);
}
`

let seedN = 0
/** A MeshPhysicalMaterial with the mango skin injected. `instanced` reads ripeness per instance (aRipe).
   `seed` shifts the skin pattern (instances get their own shift). */
export function mangoMaterial({ ripe = 0.1, instanced = false, seed = 0 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.5, metalness: 0, clearcoat: 0.32, clearcoatRoughness: 0.4,
    sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color('#cfe0c8'), envMapIntensity: 0.9,
  })
  const u = {
    uRipe: { value: ripe }, uTime: { value: 0 }, uGobo: { value: 0 }, uRim: { value: 1 }, uBruise: { value: 0 }, uBump: { value: 1 },
    uBlushDir: { value: new THREE.Vector3(0.7, 0.55, 0.45).normalize() }, uBruiseDir: { value: new THREE.Vector3(-0.6, -0.3, 0.75).normalize() },
    uSunView: { value: new THREE.Vector3(0, 0, -1) }, uSunCol: { value: new THREE.Color(1, 0.85, 0.6) },
    uSeed: { value: new THREE.Vector3(seed * 7.31, seed * 3.17, seed * 5.53) },
  }
  m.userData.u = u
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj; varying float vRipe; varying vec3 vSeed; uniform float uRipe; uniform vec3 uSeed;${instanced ? '\nattribute float aRipe;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvObj = position; vRipe = ${instanced ? 'aRipe' : 'uRipe'}; vSeed = uSeed;
        #ifdef USE_INSTANCING
          vSeed += vec3(1., .61, .37) * floor(fract(float(gl_InstanceID) * .618034) * 37.) * 3.1; // stable while instances move
        #endif`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${SKIN}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
      float ripe = vRipe;
      vec3 P = vObj + vSeed;
      float yy = vObj.y;
      vec3 nO = normalize(vObj - vec3(0., .1, 0.));
      // how big one pixel is on the skin: fine detail fades to its average instead of shimmering
      float px = length(fwidth(vObj));
      float mott = mmFbm(P * 2.1);
      float mott2 = mmFbm(P * 6.3 + 2.);
      // Ripening does not tint the fruit evenly: the shoulders and the sun side turn first, in a patchy front,
      // while a ring round the stem and the shaded belly hold their green longest.
      float side = dot(nO, normalize(uBlushDir));
      float stemRing = exp(-(vObj.x * vObj.x + vObj.z * vObj.z) / .03) * smoothstep(.55, .85, yy);
      float lead = .42 * smoothstep(-.1, .7, yy) + .38 * side + .55 * (mott - .5) - .45 * stemRing - .12;
      float bell = 4. * ripe * (1. - ripe);
      float k = clamp(ripe + lead * .4 * bell + (mott2 - .5) * .06, 0., 1.);
      vec3 skin = mmSkin(k);
      // unripe green: lighter, yellower towards the tip and belly, darker under the shoulders
      skin *= mix(1., .85 + .3 * smoothstep(.4, -.8, yy), 1. - smoothstep(.2, .6, k));
      // the blush: a red-orange cheek on the sun side, breaking into flecks at its edge; a bronze hint while still green
      float bPatch = mmFbm(P * 2.9 + 4.);
      float fleck = mmNoise(P * 19.) * .6 + mmNoise(vec3(P.x * 34., P.y * 14., P.z * 34.)) * .4;
      // the cheek is an irregular, vertically drawn-out patch (it follows the shoulder down), never a round cap
      vec3 bd = normalize(uBlushDir);
      float bSide = dot(normalize(vec3(nO.x, nO.y * .55, nO.z)), normalize(vec3(bd.x, bd.y * .55, bd.z)));
      float bm = smoothstep(.1, 1.05, bSide + (bPatch - .5) * .8 + .12 * smoothstep(-.4, .6, yy));
      bm *= mix(.45 + .55 * smoothstep(.2, .8, fleck), 1., smoothstep(.45, .9, bm));
      float bAmt = smoothstep(.45, .95, ripe) * .62 + .12;
      vec3 bCol = mix(vec3(.2,.075,.02), vec3(.80,.15,.026), smoothstep(.3, .9, ripe));
      skin = mix(skin, bCol, clamp(bm * bAmt, 0., 1.));
      // faint mottling, and a finer grain so the colour never reads as paint
      skin *= (.86 + .28 * mott2) * (.95 + .1 * mmNoise(P * 15.));
      // lenticels: fine pale dots, denser and finer towards the tip
      float tipM = smoothstep(.4, -.7, yy);
      vec2 l1 = mmSpot(P * 21., .17, .4);
      vec2 l2 = mmSpot(P * 39. + 3., .22, .5 + .4 * tipM);
      float f1 = 1. - smoothstep(.3, .8, px * 21.), f2 = 1. - smoothstep(.3, .8, px * 39.);
      float lent = max(l1.x * (.35 + .65 * fract(l1.y * 7.)) * f1, l2.x * (.4 + .6 * fract(l2.y * 5.)) * f2);
      vec3 lCol = mix(vec3(.42,.5,.17), skin * vec3(1.15,1.3,1.1) + vec3(.1,.09,.04), smoothstep(.3, .8, ripe));
      skin = mix(skin, lCol, clamp(lent * mix(1., .65, ripe), 0., 1.));
      skin *= 1. + (.04 - .025 * ripe) * (1. - f2) * (1. - .5 * f1);
      // a few tiny sap marks and freckles near the stem
      float nearStem = smoothstep(.3, .78, yy);
      vec2 fr = mmSpot(P * 13. + 9., .28, .14);
      float frk = fr.x * nearStem * (1. - smoothstep(.15, .5, px * 13.));
      skin = mix(skin, vec3(.05,.025,.008), frk * .6);
      float sapBurn = smoothstep(.55, .8, mmFbm(P * 4.4 + 17.)) * nearStem * (.35 + .65 * smoothstep(.5, .95, ripe));
      skin = mix(skin, skin * vec3(.55,.42,.3), sapBurn * .55);
      // the waxy bloom, in broad soft patches; strongest on the green fruit
      float bl = (smoothstep(.4, .74, mmFbm(P * 1.25 + 9.)) * .9 + .1) * (1. - .9 * smoothstep(.2, .8, ripe));
      float lum = dot(skin, vec3(.3,.59,.11));
      skin = mix(skin, vec3(lum) * vec3(.95,1.05,1.08) + vec3(.03,.04,.045), bl * .42);
      // bruise
      float bru = smoothstep(.62, .95, dot(normalize(vObj), uBruiseDir)) * uBruise;
      skin = mix(skin, vec3(.05,.025,.01), bru * (.75 + .25 * mmNoise(vObj * 12.)));
      float gobo = smoothstep(.38, .72, mmFbm(vec3(vObj.xy * 1.4 + vec2(uTime * .09, -uTime * .05), uTime * .04)));
      skin *= mix(1., .62 + .85 * gobo, uGobo);
      diffuseColor.rgb = skin;
      // height for the bump: pores, a faint orange-peel dimple, raised lenticels, a soft dent where it is bruised
      float pfade = 1. - smoothstep(.15, .6, px * 150.);
      float mmH = mmNoise(P * 150.) * .35 * pfade + mmFbm(P * 26.) * .9 + mmFbm(P * 9. + 5.) * 1.4 + lent * .5 - bru * .8;
      float mmHc = mmFbm(P * 9.);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(.56, .4, ripe) + bl * .22 + (mott - .5) * .14 + lent * .1 + bru * .3, .22, .95);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = mmBump(-vViewPosition, normal, mmH, .0024 * uBump);`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>\nclearcoatNormal = mmBump(-vViewPosition, clearcoatNormal, mmHc, .016 * uBump);`)
      .replace('#include <lights_physical_fragment>', /* glsl */ `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        // a broad soft sheen, never a hard round hotspot: the coat is thinner and rougher where the bloom sits
        material.clearcoat = min(material.clearcoat, .55) * (1. - .75 * bl) * (.6 + .4 * mott) * (1. - bru);
        material.clearcoatRoughness = clamp(max(material.clearcoatRoughness, .4) + .16 * (mott2 - .3) + .25 * bl, .32, 1.);
      #endif
      #ifdef USE_SHEEN
        material.sheenColor *= .35 + 1.1 * bl;
      #endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
      {
        vec3 Vd = normalize(vViewPosition), L = normalize(uSunView);
        float nv = clamp(dot(normal, Vd), 0., 1.), nl = dot(normal, L);
        float back = pow(clamp(dot(-Vd, L), 0., 1.), 2.);
        // light through the flesh, seen at the thin edge when the sun is behind
        vec3 flesh = mix(vec3(.30,.62,.10), vec3(1.,.52,.10), smoothstep(.25, .8, ripe));
        float edge = pow(1. - nv, 1.8);
        float sunK = dot(uSunCol, vec3(.33));
        totalEmissiveRadiance += flesh * uSunCol * back * edge * (.55 + .45 * smoothstep(-.3, .3, nl)) * .85 * uRim;
        // a gentle fresnel rim in the skin's own colour
        vec3 sat = skin / max(max(skin.r, max(skin.g, skin.b)), .001);
        totalEmissiveRadiance += mix(sat * .5, flesh, .4) * uSunCol * pow(1. - nv, 3.2) * .1 * uRim;
        // warm scatter at the terminator and a coloured (never grey) shadow side
        float term = smoothstep(-.5, .05, nl) * (1. - smoothstep(-.05, .45, nl));
        totalEmissiveRadiance += skin * sat * vec3(1., .66, .42) * uSunCol * term * .35;
        totalEmissiveRadiance += skin * sat * sunK * (1. - smoothstep(-.2, .3, nl)) * .08;
      }`)
  }
  m.customProgramCacheKey = () => 'mango2' + (instanced ? 'I' : '')
  return m
}

/** A ghost of the mango: fresnel-only glass, for "what does not happen". */
export function ghostMaterial(color = '#ffd27a') {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uCol: { value: new THREE.Color(color) }, uOp: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uOp; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.6); gl_FragColor = vec4(uCol * (f * .8 + .06) * uOp, 1.); }`,
  })
}

// ---- Leaf ------------------------------------------------------------------------------------------------------------

let leafTexCache = null
/** A lanceolate mango leaf painted in a canvas: two-tone blade, pale midrib, curving veins, a waxy sheen. Along +x. */
export function leafTexture() {
  if (leafTexCache) return leafTexCache
  leafTexCache = canvasTex(1024, 256, (g, W, H) => {
    const L = W - 40, x0 = 20, cy = H / 2, half = H * 0.45
    const wAt = (t) => half * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.9) * (1 - 0.15 * t)
    const edge = (sgn) => { for (let i = 0; i <= 100; i++) { const t = i / 100; g.lineTo(x0 + t * L, cy + sgn * wAt(t)) } }
    g.beginPath(); g.moveTo(x0, cy); edge(-1); for (let i = 100; i >= 0; i--) { const t = i / 100; g.lineTo(x0 + t * L, cy + wAt(t)) } g.closePath()
    const grd = g.createLinearGradient(0, 0, 0, H)
    grd.addColorStop(0, '#2c6a22'); grd.addColorStop(0.5, '#3f8a2c'); grd.addColorStop(1, '#245a1c')
    g.fillStyle = grd; g.fill()
    g.save(); g.clip()
    // Mottle.
    const r = rng(5)
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '20,60,15' : '120,170,60'},${0.04 + r() * 0.06})`; g.beginPath(); g.ellipse(x0 + r() * L, cy + (r() - 0.5) * H, 20 + r() * 60, 6 + r() * 16, 0, 0, 7); g.fill() }
    // Secondary veins.
    g.strokeStyle = 'rgba(200,225,140,.38)'; g.lineWidth = 2.2
    for (let t = 0.06; t < 0.94; t += 0.052) {
      const x = x0 + t * L, w = wAt(t)
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x, cy); g.quadraticCurveTo(x + L * 0.035, cy + s * w * 0.5, x + L * 0.085, cy + s * w * 0.92); g.stroke() }
    }
    // Midrib.
    g.strokeStyle = '#d4dc98'; g.lineWidth = 7; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + L * 0.98, cy); g.stroke()
    g.strokeStyle = 'rgba(255,255,220,.5)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0, cy - 2); g.lineTo(x0 + L * 0.97, cy - 2); g.stroke()
    g.restore()
    g.strokeStyle = 'rgba(15,40,10,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, cy); edge(-1); g.stroke(); g.beginPath(); g.moveTo(x0, cy); edge(1); g.stroke()
  }, { aniso: 8 })
  return leafTexCache
}

/** A leaf blade: a plane folded along the midrib and drooping toward the tip. Base at the origin, along +x. */
export function leafGeometry(len = 1, fold = 0.2, droop = 0.18) {
  const g = new THREE.PlaneGeometry(1, 0.3, 12, 4)
  g.translate(0.5, 0, 0)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i)
    p.setXYZ(i, x * len, y * len, (Math.abs(y) * fold - x * x * droop) * len)
  }
  g.computeVertexNormals()
  return g
}

/** Leaf material: alpha-cut blade, glossy top, warm translucency when the sun is behind it, optional wind sway. */
export function leafMaterial({ wind = 0, transl = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.42, metalness: 0, envMapIntensity: 0.7 })
  const u = { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uTransl: { value: transl }, uTime: { value: 0 }, uWind: { value: wind }, uSunCol: { value: new THREE.Color(1, 0.9, 0.6) } }
  m.userData.u = u
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <project_vertex>', /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wpos = modelMatrix * mvPosition;
        float ph = dot(wpos.xyz, vec3(.7, .3, .5));
        wpos.xyz += vec3(sin(uTime * 1.7 + ph), sin(uTime * 2.3 + ph * 1.3) * .6, cos(uTime * 1.3 + ph)) * uWind * (.4 + position.x);
        mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform float uTransl; uniform vec3 uSunCol;')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 3.);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.25, .55) * uSunCol * (back * 1.6 + .06) * uTransl; }`)
  }
  m.customProgramCacheKey = () => 'leaf'
  return m
}

/** The depth material that keeps a leaf's cut-out in shadows. */
export const leafDepthMaterial = () => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTexture(), alphaTest: 0.5 })

// ---- Bark / stem ----------------------------------------------------------------------------------------------------

let barkCache = null
export function barkTexture() {
  if (barkCache) return barkCache
  barkCache = canvasTex(256, 512, (g, W, H) => {
    g.fillStyle = '#4a3a2a'; g.fillRect(0, 0, W, H)
    const r = rng(9)
    for (let i = 0; i < 900; i++) {
      const x = r() * W, y = r() * H, h = 10 + r() * 60, c = 40 + r() * 60
      g.fillStyle = `rgba(${c + 20},${c + 8},${c - 6},${0.25 + r() * 0.4})`
      g.fillRect(x, y, 1 + r() * 3, h)
    }
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(20,14,8,${0.3 + r() * 0.4})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 20 + r() * 80) }
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(120,140,90,${0.08 + r() * 0.12})`; g.beginPath(); g.ellipse(r() * W, r() * H, 6 + r() * 20, 10 + r() * 30, 0, 0, 7); g.fill() }
  }, { repeat: true })
  return barkCache
}

/** A curved, tapering stem along points (a peduncle or a twig). */
export function stemMesh(points, r0 = 0.04, r1 = 0.025, color = '#6b5a32') {
  const curve = new THREE.CatmullRomCurve3(points)
  const g = new THREE.TubeGeometry(curve, 40, 1, 10, false)
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv
  const pt = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    const t = uv.getX(i)
    curve.getPointAt(Math.min(1, t), pt)
    const r = r0 + (r1 - r0) * t
    p.setXYZ(i, pt.x + n.getX(i) * r, pt.y + n.getY(i) * r, pt.z + n.getZ(i) * r)
  }
  g.computeVertexNormals()
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, map: barkTexture() })
  const mesh = new THREE.Mesh(g, m)
  mesh.castShadow = true
  mesh.userData.curve = curve
  return mesh
}

// ---- The fruit ------------------------------------------------------------------------------------------------------

/** The hero's own leaf blade: like leafGeometry but finer, with a sharper crease along the midrib, a slight twist
   and a soft wave at the edge, so it reads as a real mango leaf at full size. Base at the origin, along +x. */
function heroLeafGeometry(len = 1, fold = 0.3, droop = 0.1) {
  const g = new THREE.PlaneGeometry(1, 0.3, 28, 8)
  g.translate(0.5, 0, 0)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), ay = Math.abs(y)
    const z = Math.pow(ay / 0.15, 0.75) * 0.15 * fold - x * x * droop + Math.sin(x * 23 + Math.sign(y) * 1.3) * 0.012 * (ay / 0.15)
    const tw = 0.3 * x, c = Math.cos(tw), s = Math.sin(tw)
    p.setXYZ(i, x * len, (y * c - z * s) * len, (y * s + z * c) * len)
  }
  g.computeVertexNormals()
  return g
}

/** The woody nub where the stem meets the fruit: a flared collar sunk in the stem cavity, then the neck. */
function collarGeometry() {
  const pr = [[0, -0.05], [0.115, -0.05], [0.118, -0.02], [0.1, 0.008], [0.074, 0.022], [0.056, 0.034], [0.05, 0.06], [0, 0.065]]
  const g = new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 20)
  g.computeVertexNormals()
  return g
}

/** One mango: body, a short stem stub and (optionally) the tiny leaf that makes it recognisable throughout.
   `sap: true` adds a bead of sap on the snapped stem (this.sap; scenes may show or hide it). */
export class Mango extends THREE.Group {
  constructor({ ripe = 0.1, leaf = true, detail = 1, stem = true, sap = false } = {}) {
    super()
    // the hero (the one with the leaf) keeps the same skin from scene to scene; the others vary
    this.material = mangoMaterial({ ripe, seed: leaf ? 0 : ++seedN })
    this.body = new THREE.Mesh(mangoGeometry(detail), this.material)
    this.body.castShadow = true
    this.body.receiveShadow = true
    this.add(this.body)
    if (stem) {
      const s = STEM_POINT
      this.stem = stemMesh([s.clone().add(new THREE.Vector3(0, -0.04, 0)), s.clone().add(new THREE.Vector3(0.01, 0.08, 0)), s.clone().add(new THREE.Vector3(0.03, 0.18, 0.01))], 0.05, 0.036, '#6a5c34')
      this.collarMat = new THREE.MeshStandardMaterial({ color: '#56602a', roughness: 0.62, map: barkTexture() })
      this.collar = new THREE.Mesh(collarGeometry(), this.collarMat)
      this.collar.position.copy(STEM_POINT).add(new THREE.Vector3(0, -0.012, 0))
      this.collar.castShadow = true
      this.stem.add(this.collar)
      this.add(this.stem)
      if (sap) {
        this.sap = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), new THREE.MeshPhysicalMaterial({
          color: '#f2c460', roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, emissive: '#7a4a08', emissiveIntensity: 0.35, transparent: true, opacity: 0.9,
        }))
        this.sap.scale.set(1, 0.72, 1)
        this.sap.position.copy(STEM_POINT).add(new THREE.Vector3(0.03, 0.188, 0.01))
        this.stem.add(this.sap)
      }
    }
    if (leaf) {
      this.leafMat = leafMaterial({ transl: 1 })
      this.leafMat.roughness = 0.34
      this.leaf = new THREE.Mesh(heroLeafGeometry(0.95, 0.3, 0.1), this.leafMat)
      this.leaf.customDepthMaterial = leafDepthMaterial()
      this.leaf.castShadow = true
      this.leaf.position.copy(STEM_POINT).add(new THREE.Vector3(0.03, 0.16, 0))
      this.leaf.rotation.set(0.35, -0.5, 0.42)
      this.add(this.leaf)
    }
  }
  set ripe(v) { this.material.userData.u.uRipe.value = v; this.material.sheen = 0.45 * (1 - v) + 0.05 }
  get ripe() { return this.material.userData.u.uRipe.value }
  get u() { return this.material.userData.u }
  /** Per-frame: time, and the sun direction in view space (for rim and translucency). */
  tick(time, sunView, sunCol) {
    this.u.uTime.value = time
    if (sunView) this.u.uSunView.value.copy(sunView)
    if (sunCol) this.u.uSunCol.value.copy(sunCol)
    if (this.leafMat) {
      if (sunView) this.leafMat.userData.u.uSunView.value.copy(sunView)
      this.leafMat.userData.u.uTime.value = time
    }
  }
}
