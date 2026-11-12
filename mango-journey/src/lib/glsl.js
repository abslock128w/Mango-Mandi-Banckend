// GLSL snippets written for this piece: hash, value noise, fbm, cell dots, bump from screen derivatives.
export const NOISE = /* glsl */ `
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
`

// Bump from a scalar height via screen-space derivatives (Mikkelsen), for shaders that have view position and normal.
export const BUMP = /* glsl */ `
vec3 mmBump(vec3 surfPos, vec3 surfNorm, float h, float scale){
  vec3 vSigmaX = dFdx(surfPos), vSigmaY = dFdy(surfPos), vN = surfNorm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * scale;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * vN - vGrad);
}
`
