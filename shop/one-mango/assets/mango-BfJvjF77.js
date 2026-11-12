import{a as e,o as t}from"./stage-DXACv1sO.js";import{P as n,S as r,T as i,X as a,Y as o,Z as s,at as c,bt as l,d as u,ht as d,i as f,q as p,r as m,tt as h,ut as g,vt as _,xt as v,z as y}from"./index-DF2JrahF.js";var b=(e,t,n)=>{let r=f((n-e)/(t-e));return r*r*(3-2*r)};function x(e,t,n,r=new v){let i=t,a=.67*(1+.05*i)*(1-.17*b(0,1,-i)**1.6),o=e*a*(1.01+.06*Math.tanh(e*5)),s=n*a*.84,c=i>0?i*.92:i*1;o+=-.34*Math.max(-i,0)**2+.05*i;let l=Math.max(-e,0),u=Math.max(e,0);o+=.05*u*Math.exp(-(((i-.42)/.32)**2)),c+=.045*u**1.4*b(.25,.85,i),c-=.025*l*b(.3,.9,i);let d=Math.exp(-(((i+.74)/.1)**2+(n/.3)**2))*l;o-=d*.085,o+=.015*l*Math.exp(-(((i+.5)/.1)**2+(n/.4)**2)),c-=Math.exp(-(e*e/.055+n*n/.04))*b(.6,1,i)*.07;let f=Math.sin(e*5.1+t*3.3)*Math.sin(n*4.2-t*2.1)*.012+Math.sin(e*2.3-n*3.1+t*1.7)*.008;return r.set(o*(1+f),c,s*(1+f))}function S(e=1){let t=new d(1,Math.round(96*e),Math.round(72*e)),n=t.attributes.position,r=new v,i=new v;for(let e=0;e<n.count;e++)r.fromBufferAttribute(n,e),x(r.x,r.y,r.z,i),n.setXYZ(e,i.x,i.y,i.z);return t.computeVertexNormals(),t.computeBoundingSphere(),t}function C(e=96,t=1){let n=[];for(let r=0;r<e;r++){let i=r/e*Math.PI*2,a=x(Math.cos(i),Math.sin(i),0);n.push(new l(a.x*t,a.y*t))}return n}var w=new v(.05,.86,0),T=`
uniform float uRipe; uniform float uTime; uniform float uGobo; uniform float uRim; uniform float uBruise; uniform float uBump;
uniform vec3 uBlushDir; uniform vec3 uBruiseDir; uniform vec3 uSunView; uniform vec3 uSunCol; uniform vec3 uSeed;
varying vec3 vObj; varying float vRipe; varying vec3 vSeed;
${t}
${e}
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
`,E=0;function D({ripe:e=.1,instanced:t=!1,seed:n=0}={}){let r=new a({roughness:.5,metalness:0,clearcoat:.32,clearcoatRoughness:.4,sheen:.45,sheenRoughness:.6,sheenColor:new i(`#cfe0c8`),envMapIntensity:.9}),o={uRipe:{value:e},uTime:{value:0},uGobo:{value:0},uRim:{value:1},uBruise:{value:0},uBump:{value:1},uBlushDir:{value:new v(.7,.55,.45).normalize()},uBruiseDir:{value:new v(-.6,-.3,.75).normalize()},uSunView:{value:new v(0,0,-1)},uSunCol:{value:new i(1,.85,.6)},uSeed:{value:new v(n*7.31,n*3.17,n*5.53)}};return r.userData.u=o,r.onBeforeCompile=e=>{Object.assign(e.uniforms,o),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\nvarying vec3 vObj; varying float vRipe; varying vec3 vSeed; uniform float uRipe; uniform vec3 uSeed;${t?`
attribute float aRipe;`:``}`).replace(`#include <begin_vertex>`,`#include <begin_vertex>\nvObj = position; vRipe = ${t?`aRipe`:`uRipe`}; vSeed = uSeed;
        #ifdef USE_INSTANCING
          vSeed += vec3(1., .61, .37) * floor(fract(float(gl_InstanceID) * .618034) * 37.) * 3.1; // stable while instances move
        #endif`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\n${T}`).replace(`#include <color_fragment>`,`#include <color_fragment>
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
      `).replace(`#include <roughnessmap_fragment>`,`#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(.56, .4, ripe) + bl * .22 + (mott - .5) * .14 + lent * .1 + bru * .3, .22, .95);`).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
normal = mmBump(-vViewPosition, normal, mmH, .0024 * uBump);`).replace(`#include <clearcoat_normal_fragment_maps>`,`#include <clearcoat_normal_fragment_maps>
clearcoatNormal = mmBump(-vViewPosition, clearcoatNormal, mmHc, .016 * uBump);`).replace(`#include <lights_physical_fragment>`,`#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        // a broad soft sheen, never a hard round hotspot: the coat is thinner and rougher where the bloom sits
        material.clearcoat = min(material.clearcoat, .55) * (1. - .75 * bl) * (.6 + .4 * mott) * (1. - bru);
        material.clearcoatRoughness = clamp(max(material.clearcoatRoughness, .4) + .16 * (mott2 - .3) + .25 * bl, .32, 1.);
      #endif
      #ifdef USE_SHEEN
        material.sheenColor *= .35 + 1.1 * bl;
      #endif`).replace(`#include <emissivemap_fragment>`,`#include <emissivemap_fragment>
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
      }`)},r.customProgramCacheKey=()=>`mango2`+(t?`I`:``),r}function O(e=`#ffd27a`){return new g({transparent:!0,depthWrite:!1,blending:2,uniforms:{uCol:{value:new i(e)},uOp:{value:1}},vertexShader:`varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,fragmentShader:`uniform vec3 uCol; uniform float uOp; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.6); gl_FragColor = vec4(uCol * (f * .8 + .06) * uOp, 1.); }`})}var k=null;function A(){return k||(k=m(1024,256,(e,t,n)=>{let r=t-40,i=n/2,a=n*.45,o=e=>a*Math.sin(Math.PI*e**.78)**.9*(1-.15*e),s=t=>{for(let n=0;n<=100;n++){let a=n/100;e.lineTo(20+a*r,i+t*o(a))}};e.beginPath(),e.moveTo(20,i),s(-1);for(let t=100;t>=0;t--){let n=t/100;e.lineTo(20+n*r,i+o(n))}e.closePath();let c=e.createLinearGradient(0,0,0,n);c.addColorStop(0,`#2c6a22`),c.addColorStop(.5,`#3f8a2c`),c.addColorStop(1,`#245a1c`),e.fillStyle=c,e.fill(),e.save(),e.clip();let l=u(5);for(let t=0;t<260;t++)e.fillStyle=`rgba(${l()<.5?`20,60,15`:`120,170,60`},${.04+l()*.06})`,e.beginPath(),e.ellipse(20+l()*r,i+(l()-.5)*n,20+l()*60,6+l()*16,0,0,7),e.fill();e.strokeStyle=`rgba(200,225,140,.38)`,e.lineWidth=2.2;for(let t=.06;t<.94;t+=.052){let n=20+t*r,a=o(t);for(let t of[-1,1])e.beginPath(),e.moveTo(n,i),e.quadraticCurveTo(n+r*.035,i+t*a*.5,n+r*.085,i+t*a*.92),e.stroke()}e.strokeStyle=`#d4dc98`,e.lineWidth=7,e.beginPath(),e.moveTo(20,i),e.lineTo(20+r*.98,i),e.stroke(),e.strokeStyle=`rgba(255,255,220,.5)`,e.lineWidth=2.5,e.beginPath(),e.moveTo(20,i-2),e.lineTo(20+r*.97,i-2),e.stroke(),e.restore(),e.strokeStyle=`rgba(15,40,10,.6)`,e.lineWidth=2,e.beginPath(),e.moveTo(20,i),s(-1),e.stroke(),e.beginPath(),e.moveTo(20,i),s(1),e.stroke()},{aniso:8}),k)}function j(e=1,t=.2,n=.18){let r=new h(1,.3,12,4);r.translate(.5,0,0);let i=r.attributes.position;for(let r=0;r<i.count;r++){let a=i.getX(r),o=i.getY(r);i.setXYZ(r,a*e,o*e,(Math.abs(o)*t-a*a*n)*e)}return r.computeVertexNormals(),r}function M({wind:e=0,transl:t=1}={}){let n=new s({map:A(),alphaTest:.5,side:2,roughness:.42,metalness:0,envMapIntensity:.7}),r={uSunView:{value:new v(0,0,-1)},uTransl:{value:t},uTime:{value:0},uWind:{value:e},uSunCol:{value:new i(1,.9,.6)}};return n.userData.u=r,n.onBeforeCompile=e=>{Object.assign(e.uniforms,r),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
uniform float uTime; uniform float uWind;`).replace(`#include <project_vertex>`,`
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wpos = modelMatrix * mvPosition;
        float ph = dot(wpos.xyz, vec3(.7, .3, .5));
        wpos.xyz += vec3(sin(uTime * 1.7 + ph), sin(uTime * 2.3 + ph * 1.3) * .6, cos(uTime * 1.3 + ph)) * uWind * (.4 + position.x);
        mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform vec3 uSunView; uniform float uTransl; uniform vec3 uSunCol;`).replace(`#include <emissivemap_fragment>`,`#include <emissivemap_fragment>
        { vec3 Vd = normalize(vViewPosition); float back = pow(clamp(dot(-Vd, normalize(uSunView)), 0., 1.), 3.);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.25, .55) * uSunCol * (back * 1.6 + .06) * uTransl; }`)},n.customProgramCacheKey=()=>`leaf`,n}var N=()=>new o({depthPacking:c,map:A(),alphaTest:.5}),P=null;function F(){return P||(P=m(256,512,(e,t,n)=>{e.fillStyle=`#4a3a2a`,e.fillRect(0,0,t,n);let r=u(9);for(let i=0;i<900;i++){let i=r()*t,a=r()*n,o=10+r()*60,s=40+r()*60;e.fillStyle=`rgba(${s+20},${s+8},${s-6},${.25+r()*.4})`,e.fillRect(i,a,1+r()*3,o)}for(let i=0;i<160;i++)e.fillStyle=`rgba(20,14,8,${.3+r()*.4})`,e.fillRect(r()*t,r()*n,1+r()*2,20+r()*80);for(let i=0;i<70;i++)e.fillStyle=`rgba(120,140,90,${.08+r()*.12})`,e.beginPath(),e.ellipse(r()*t,r()*n,6+r()*20,10+r()*30,0,0,7),e.fill()},{repeat:!0}),P)}function I(e,t=.04,n=.025,i=`#6b5a32`){let a=new r(e),o=new _(a,40,1,10,!1),c=o.attributes.position,l=o.attributes.normal,u=o.attributes.uv,d=new v;for(let e=0;e<c.count;e++){let r=u.getX(e);a.getPointAt(Math.min(1,r),d);let i=t+(n-t)*r;c.setXYZ(e,d.x+l.getX(e)*i,d.y+l.getY(e)*i,d.z+l.getZ(e)*i)}o.computeVertexNormals();let f=new s({color:i,roughness:.75,map:F()}),m=new p(o,f);return m.castShadow=!0,m.userData.curve=a,m}function L(e=1,t=.3,n=.1){let r=new h(1,.3,28,8);r.translate(.5,0,0);let i=r.attributes.position;for(let r=0;r<i.count;r++){let a=i.getX(r),o=i.getY(r),s=Math.abs(o),c=(s/.15)**.75*.15*t-a*a*n+Math.sin(a*23+Math.sign(o)*1.3)*.012*(s/.15),l=.3*a,u=Math.cos(l),d=Math.sin(l);i.setXYZ(r,a*e,(o*u-c*d)*e,(o*d+c*u)*e)}return r.computeVertexNormals(),r}function R(){let e=new y([[0,-.05],[.115,-.05],[.118,-.02],[.1,.008],[.074,.022],[.056,.034],[.05,.06],[0,.065]].map(([e,t])=>new l(e,t)),20);return e.computeVertexNormals(),e}var z=class extends n{constructor({ripe:e=.1,leaf:t=!0,detail:n=1,stem:r=!0,sap:i=!1}={}){if(super(),this.material=D({ripe:e,seed:t?0:++E}),this.body=new p(S(n),this.material),this.body.castShadow=!0,this.body.receiveShadow=!0,this.add(this.body),r){let e=w;this.stem=I([e.clone().add(new v(0,-.04,0)),e.clone().add(new v(.01,.08,0)),e.clone().add(new v(.03,.18,.01))],.05,.036,`#6a5c34`),this.collarMat=new s({color:`#56602a`,roughness:.62,map:F()}),this.collar=new p(R(),this.collarMat),this.collar.position.copy(w).add(new v(0,-.012,0)),this.collar.castShadow=!0,this.stem.add(this.collar),this.add(this.stem),i&&(this.sap=new p(new d(.034,16,12),new a({color:`#f2c460`,roughness:.06,clearcoat:1,clearcoatRoughness:.04,emissive:`#7a4a08`,emissiveIntensity:.35,transparent:!0,opacity:.9})),this.sap.scale.set(1,.72,1),this.sap.position.copy(w).add(new v(.03,.188,.01)),this.stem.add(this.sap))}t&&(this.leafMat=M({transl:1}),this.leafMat.roughness=.34,this.leaf=new p(L(.95,.3,.1),this.leafMat),this.leaf.customDepthMaterial=N(),this.leaf.castShadow=!0,this.leaf.position.copy(w).add(new v(.03,.16,0)),this.leaf.rotation.set(.35,-.5,.42),this.add(this.leaf))}set ripe(e){this.material.userData.u.uRipe.value=e,this.material.sheen=.45*(1-e)+.05}get ripe(){return this.material.userData.u.uRipe.value}get u(){return this.material.userData.u}tick(e,t,n){this.u.uTime.value=e,t&&this.u.uSunView.value.copy(t),n&&this.u.uSunCol.value.copy(n),this.leafMat&&(t&&this.leafMat.userData.u.uSunView.value.copy(t),this.leafMat.userData.u.uTime.value=e)}};export{N as a,S as c,x as d,I as f,O as i,D as l,w as n,j as o,F as r,M as s,z as t,C as u};