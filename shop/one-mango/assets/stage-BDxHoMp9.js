import{$ as e,T as t,bt as n,ht as r,lt as i,q as a,rt as o,ut as s,v as c,xt as l,y as u}from"./index-Cn-b-kvA.js";var d=`
float mmHash(vec3 p){ p = fract(p * 0.3183099 + vec3(.1,.17,.13)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mmHash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mmNoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mmHash(i), mmHash(i + vec3(1,0,0)), f.x), mix(mmHash(i + vec3(0,1,0)), mmHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mmHash(i + vec3(0,0,1)), mmHash(i + vec3(1,0,1)), f.x), mix(mmHash(i + vec3(0,1,1)), mmHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float mmFbm(vec3 p){ float a = .5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * mmNoise(p); p = p * 2.03 + 11.7; a *= .5; } return s; }
float mmNoise2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mmHash2(i), mmHash2(i + vec2(1,0)), f.x), mix(mmHash2(i + vec2(0,1)), mmHash2(i + vec2(1,1)), f.x), f.y); }
float mmFbm2(vec2 p){ float a = .5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * mmNoise2(p); p = p * 2.02 + 7.3; a *= .5; } return s; }
// Dots on a jittered 3D grid: 1 at a dot's centre, 0 away from it. Returns dot mask, and its id in .y.
vec2 mmDots(vec3 p, float rad){
  vec3 i = floor(p), f = fract(p); float best = 1e9, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 o = vec3(x, y, z), h = vec3(mmHash(i + o), mmHash(i + o + 19.1), mmHash(i + o + 41.7));
    float d = length(o + h - f); if (d < best){ best = d; id = mmHash(i + o + 7.7); }
  }
  return vec2(1.0 - smoothstep(rad * .45, rad, best), id);
}
`,f=`
vec3 mmBump(vec3 surfPos, vec3 surfNorm, float h, float scale){
  vec3 vSigmaX = dFdx(surfPos), vSigmaY = dFdy(surfPos), vN = surfNorm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * scale;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * vN - vGrad);
}
`,p=class{constructor(r,a={}){this.engine=r,this.tier=r.tier,this.scene=new i,this.camera=new e(35,1,a.near||.05,a.far||400),this.fov=35,this.frame=[0,0],this.framePortrait=[0,0],this.focus=new l,this.sun=new l(.5,.7,.3).normalize(),this.sunCol=new t(1,.88,.65),this.sunView=new l,this.post={dof:0,focus:5,range:2},this.look={bloom:.55,threshold:.85,bloomRadius:.5,exposure:1,ca:0,radial:0,rc:new n(.5,.5),lift:new l(0,0,0),gain:new l(1,1,1),sat:1,vig:.5,grain:.05,fade:0,rays:0,rayThreshold:1.1,rayTint:new t(1,.92,.74)},this.rayFrom=null,this.parallax=1,this.drag=!1}sunToView(){this.camera.updateMatrixWorld(),this.sunView.copy(this.sun).transformDirection(this.camera.matrixWorldInverse)}update(){}grade(e,t,n=1){this.look.lift.set(e[0],e[1],e[2]),this.look.gain.set(t[0],t[1],t[2]),this.look.sat=n}};function m(e,t,n,r=0){e.position.copy(t),e.up.set(Math.sin(r),Math.cos(r),0),e.lookAt(n)}function h(e=300){let n={uTop:{value:new t(`#2f6fb8`)},uHor:{value:new t(`#f4d9a0`)},uBot:{value:new t(`#2a3020`)},uSunDir:{value:new l(.3,.4,-1).normalize()},uSunCol:{value:new t(1,.85,.55)},uSunSize:{value:.035},uStars:{value:0},uClouds:{value:.4},uCloudCol:{value:new t(`#fff2e0`)},uCloudShade:{value:new t(`#8a7a80`)},uTime:{value:0},uHaze:{value:.35},uSunGlow:{value:1},uCloudSpeed:{value:.004}},i=new s({side:1,depthWrite:!1,uniforms:n,vertexShader:`varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,fragmentShader:`
      uniform vec3 uTop, uHor, uBot, uSunDir, uSunCol, uCloudCol, uCloudShade; uniform float uSunSize, uStars, uClouds, uTime, uHaze, uSunGlow, uCloudSpeed;
      varying vec3 vD;
      ${d}
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
      }`}),o=new a(new r(e,48,24),i);return o.frustumCulled=!1,o.renderOrder=-10,o.userData.u=n,o}function g(e,n,{size:r=.04,color:i=`#ffd78a`,drift:a=.2,opacity:l=1,seed:d=1,sizeVar:f=1}={}){let p=new u,m=new Float32Array(e*3),h=new Float32Array(e),g=d*99991,_=()=>(g=g*16807%2147483647)/2147483647;for(let t=0;t<e;t++)m[t*3]=n.min.x+_()*(n.max.x-n.min.x),m[t*3+1]=n.min.y+_()*(n.max.y-n.min.y),m[t*3+2]=n.min.z+_()*(n.max.z-n.min.z),h[t]=.4+_()*f;p.setAttribute(`position`,new c(m,3)),p.setAttribute(`aS`,new c(h,1));let v={uTime:{value:0},uSize:{value:r},uCol:{value:new t(i)},uDrift:{value:a},uOp:{value:l},uSlow:{value:1},uPx:{value:1}},y=new s({transparent:!0,depthWrite:!1,blending:2,uniforms:v,vertexShader:`attribute float aS; uniform float uTime, uSize, uDrift, uSlow, uPx; varying float vA;
      void main(){ vec3 p = position; float t = uTime * uSlow; float ph = aS * 40.;
        p += vec3(sin(t * .3 + ph), sin(t * .23 + ph * 1.7) * .7 + t * .02 * uDrift, cos(t * .27 + ph * 1.3)) * uDrift;
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * aS * uPx * 600. / -mv.z; vA = .5 + .5 * sin(t * 1.3 + ph); }`,fragmentShader:`uniform vec3 uCol; uniform float uOp; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); gl_FragColor = vec4(uCol * a * a * uOp * (.55 + .45 * vA), 1.); }`}),b=new o(p,y);return b.frustumCulled=!1,b.userData.u=v,b}export{f as a,h as i,m as n,d as o,g as r,p as t};