// A chapter's set: its own scene, camera, lights, look (bloom, exposure, grade, depth of field) and the "match" point
// that the iris transition opens from. Each chapter's update is a pure function of (chapter, t), so scrubbing back and
// forth is always exact; `time` only drives ambient motion (wind, bees, grain).
import * as THREE from 'three'
import { NOISE } from '../lib/glsl.js'

export class Stage {
  constructor(engine, opts = {}) {
    this.engine = engine
    this.tier = engine.tier
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, 1, opts.near || 0.05, opts.far || 400)
    this.fov = 35
    this.frame = [0, 0]           // subject offset as a share of the screen, landscape (x right, y up)
    this.framePortrait = [0, 0]
    this.focus = new THREE.Vector3() // the match point for the iris
    this.sun = new THREE.Vector3(0.5, 0.7, 0.3).normalize()
    this.sunCol = new THREE.Color(1, 0.88, 0.65)
    this.sunView = new THREE.Vector3()
    this.post = { dof: 0, focus: 5, range: 2 }
    this.look = {
      bloom: 0.55, threshold: 0.85, bloomRadius: 0.5, exposure: 1, ca: 0, radial: 0, rc: new THREE.Vector2(0.5, 0.5),
      lift: new THREE.Vector3(0, 0, 0), gain: new THREE.Vector3(1, 1, 1), sat: 1, vig: 0.5, grain: 0.05, fade: 0,
      // light shafts (engine.ray): strength 0 = off, about 0.4 to 1.2 is the useful range; threshold is the HDR
      // brightness a pixel needs before it throws a shaft; tint colours them. They come from `this.rayFrom` (a world
      // point: a lamp, a window, a skylight) or, when that is null, from the direction of `this.sun`.
      rays: 0, rayThreshold: 1.1, rayTint: new THREE.Color(1, 0.92, 0.74),
    }
    this.rayFrom = null
    this.parallax = 1
    this.drag = false
  }
  /** Called once a frame before update: refresh the sun's direction in view space (for rims and translucency). */
  sunToView() {
    this.camera.updateMatrixWorld()
    this.sunView.copy(this.sun).transformDirection(this.camera.matrixWorldInverse)
  }
  update() {}
  /** Sets lift/gain from two colours (shadows tint, highlights tint). */
  grade(lift, gain, sat = 1) {
    this.look.lift.set(lift[0], lift[1], lift[2]); this.look.gain.set(gain[0], gain[1], gain[2]); this.look.sat = sat
  }
}

/** Point the camera from a position at a target, with a roll. */
export function aim(cam, pos, target, roll = 0) {
  cam.position.copy(pos)
  cam.up.set(Math.sin(roll), Math.cos(roll), 0)
  cam.lookAt(target)
}

// ---- A painted sky dome: gradient by time of day, a sun disc with halo, stars, fbm clouds, a horizon haze. ----

export function skyDome(radius = 300) {
  const u = {
    uTop: { value: new THREE.Color('#2f6fb8') }, uHor: { value: new THREE.Color('#f4d9a0') }, uBot: { value: new THREE.Color('#2a3020') },
    uSunDir: { value: new THREE.Vector3(0.3, 0.4, -1).normalize() }, uSunCol: { value: new THREE.Color(1, 0.85, 0.55) }, uSunSize: { value: 0.035 },
    uStars: { value: 0 }, uClouds: { value: 0.4 }, uCloudCol: { value: new THREE.Color('#fff2e0') }, uCloudShade: { value: new THREE.Color('#8a7a80') }, uTime: { value: 0 },
    uHaze: { value: 0.35 }, uSunGlow: { value: 1 }, uCloudSpeed: { value: 0.004 },
  }
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: u,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHor, uBot, uSunDir, uSunCol, uCloudCol, uCloudShade; uniform float uSunSize, uStars, uClouds, uTime, uHaze, uSunGlow, uCloudSpeed;
      varying vec3 vD;
      ${NOISE}
      void main(){
        vec3 d = normalize(vD); float y = d.y;
        vec3 col = y > 0. ? mix(uHor, uTop, pow(clamp(y, 0., 1.), .55)) : mix(uHor, uBot, pow(clamp(-y * 3., 0., 1.), .5));
        float sd = dot(d, normalize(uSunDir));
        col += uSunCol * (pow(max(sd, 0.), 6.) * .45 + pow(max(sd, 0.), 60.) * .9) * uSunGlow;
        col = mix(col, uHor * 1.05, exp(-abs(y) * 9.) * uHaze);
        // stars
        if (uStars > .01 && y > 0.){
          vec3 sp = d * 220.; vec3 cell = floor(sp); vec3 f = fract(sp) - .5;
          float h = mmHash(cell); float st = step(.985, h) * smoothstep(.5, .0, length(f)) * (.6 + .4 * sin(uTime * 2. + h * 60.));
          col += vec3(1., .95, .85) * st * uStars * 2.5 * smoothstep(0., .25, y);
        }
        // clouds on a flat ceiling
        if (uClouds > .01 && y > .02){
          vec2 cp = d.xz / (y + .12) * 1.4 + vec2(uTime * uCloudSpeed * 10., uTime * uCloudSpeed * 4.);
          float n = mmFbm2(cp * .55);
          float c = smoothstep(.62 - uClouds * .35, .95 - uClouds * .25, n) * smoothstep(.02, .25, y);
          float lit = clamp(.55 + .6 * dot(normalize(vec3(d.x, .2, d.z)), normalize(uSunDir)), 0., 1.);
          vec3 cc = mix(uCloudShade, uCloudCol, lit) + uSunCol * pow(max(sd, 0.), 8.) * .8;
          col = mix(col, cc, c * .9);
        }
        // sun disc
        col += uSunCol * smoothstep(1. - uSunSize * .02, 1. - uSunSize * .016, sd) * 12. * uSunGlow;
        gl_FragColor = vec4(col, 1.);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), m)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  mesh.userData.u = u
  return mesh
}

/** Soft additive sprites (dust, spores, pollen, bokeh). Positions in a box; drift in the shader. */
export function motes(n, box, { size = 0.04, color = '#ffd78a', drift = 0.2, opacity = 1, seed = 1, sizeVar = 1 } = {}) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n)
  let r = seed * 99991
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < n; i++) {
    p[i * 3] = box.min.x + rnd() * (box.max.x - box.min.x)
    p[i * 3 + 1] = box.min.y + rnd() * (box.max.y - box.min.y)
    p[i * 3 + 2] = box.min.z + rnd() * (box.max.z - box.min.z)
    s[i] = 0.4 + rnd() * sizeVar
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setAttribute('aS', new THREE.BufferAttribute(s, 1))
  const u = { uTime: { value: 0 }, uSize: { value: size }, uCol: { value: new THREE.Color(color) }, uDrift: { value: drift }, uOp: { value: opacity }, uSlow: { value: 1 }, uPx: { value: 1 } }
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: u,
    vertexShader: /* glsl */ `attribute float aS; uniform float uTime, uSize, uDrift, uSlow, uPx; varying float vA;
      void main(){ vec3 p = position; float t = uTime * uSlow; float ph = aS * 40.;
        p += vec3(sin(t * .3 + ph), sin(t * .23 + ph * 1.7) * .7 + t * .02 * uDrift, cos(t * .27 + ph * 1.3)) * uDrift;
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * aS * uPx * 600. / -mv.z; vA = .5 + .5 * sin(t * 1.3 + ph); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uOp; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); gl_FragColor = vec4(uCol * a * a * uOp * (.55 + .45 * vA), 1.); }`,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  pts.userData.u = u
  return pts
}
