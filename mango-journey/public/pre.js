// The opening card's picture: a mango that gathers itself out of gold dust as the film loads.
//
// A few thousand points. Each has a place on a mango (and, last, on its stem and leaf) and a place in a slow ring of
// dust around it. As the load goes from 0 to 1 the points are called in, the fruit building from its tip upwards and
// ripening from green to gold as it fills; the whole thing turns slowly and leans a little towards the pointer. When
// the visitor presses Begin the fruit bursts outwards past the lens and the film takes over.
//
// It is its own small plain script (public/pre.js, outside the film's bundle), so it is on screen while the film's
// code is still on its way. It reads everything from the card itself: `--p` (0 to 1) for the load, and the classes main.js sets
// (`is-gate`: ready, `is-crack`: begun). The shop serves the film under a policy that allows no inline script, which
// is why this is a file.
;(() => {
const pre = document.getElementById('pre')
// Embedded in the shop's Legacy page, the shop's own opening is the loading screen: no card here, and no second
// animation competing with the page around it for the same main thread.
if (pre && /[?&]embed(=|&|$)/.test(location.search) && window.parent !== window) { pre.remove(); return }
const cv = pre && pre.querySelector('[data-pre-canvas]')

if (cv && cv.getContext) {
  const g = cv.getContext('2d')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const small = Math.min(innerWidth, innerHeight) < 700
  const N = small ? 2000 : 4200, NL = small ? 170 : 300 // the fruit, and its stem and leaf
  let W = 0, H = 0, dpr = 1

  // A seeded generator, so the fruit is the same fruit on every visit.
  let seed = 20260
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

  // A point on the mango's skin: an egg, fuller at the shoulder, with the lean of a mango and a beak at the tip.
  const skin = (u, v) => {
    const th = Math.acos(1 - 2 * u), ph = v * Math.PI * 2
    const cy = Math.cos(th), sy = Math.sin(th)
    const wide = 1 + 0.2 * cy // fuller towards the stem
    const x = sy * Math.cos(ph) * wide + 0.2 * (cy * cy - 0.42) + 0.1 * Math.max(0, -cy) ** 3
    return [x, cy * 1.3, sy * Math.sin(ph) * 0.8 * wide]
  }

  const P = []
  for (let i = 0; i < N + NL; i++) {
    let t, n, kind = 0, th
    if (i < N) {
      const u = rnd(), v = rnd()
      t = skin(u, v)
      const l = Math.hypot(t[0], t[1] / 1.3, t[2] / 0.8) || 1
      n = [t[0] / l, t[1] / 1.3 / l, t[2] / 0.8 / l]
      th = 0.04 + 0.66 * ((t[1] + 1.3) / 2.6) + rnd() * 0.2 // from the tip up
    } else if (i < N + NL * 0.22) { // the stem
      const k = rnd()
      t = [0.06 + k * 0.1 + (rnd() - 0.5) * 0.03, 1.28 + k * 0.34, (rnd() - 0.5) * 0.03]; n = [0, 0.3, -1]; kind = 1; th = 0.9 + rnd() * 0.04
    } else { // the leaf: a blade off the stem, curling away
      const k = rnd(), w = (rnd() - 0.5) * 2, half = Math.sin(Math.PI * Math.pow(k, 0.8)) * 0.2
      t = [0.16 + k * 0.92, 1.58 + k * 0.26 - k * k * 0.3 + Math.abs(w) * 0.03, w * half]; n = [-0.2, 0.9, -0.3]; kind = 2; th = 0.93 + rnd() * 0.05
    }
    P.push({
      t, n, kind, th,
      r: 1.9 + rnd() * 2.4, a: rnd() * Math.PI * 2, h: (rnd() - 0.5) * 1.5, sp: 0.05 + rnd() * 0.12, // its place in the dust
      k: 0, tw: rnd() * 6.28, s: 0.7 + rnd() * 0.9, j: rnd(),
    })
  }

  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1)
    W = cv.clientWidth; H = cv.clientHeight
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
  }
  size(); addEventListener('resize', size)

  let px = 0, py = 0, tx = 0, ty = 0
  addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2 }, { passive: true })

  const mix = (a, b, k) => a + (b - a) * k
  const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k) }
  // unripe, turning, ripe: the fruit's colour as it fills
  const GREEN = [96, 158, 62], YELLOW = [255, 205, 56], GOLD = [255, 158, 22], BLUSH = [255, 96, 40], LEAF = [92, 190, 84], DUST = [255, 196, 110]

  const t0 = performance.now()
  let shown = 0, left = 0, last = t0
  function frame(now) {
    if (!cv.isConnected) return
    requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    const time = still ? 4 : (now - t0) / 1000
    // the load: what main.js says, and until it speaks a slow first breath so the dust is never just dust
    const said = parseFloat(pre.style.getPropertyValue('--p')) || 0
    const goal = pre.classList.contains('is-gate') || pre.classList.contains('is-crack') ? 1 : Math.max(said, Math.min(0.07, time * 0.025))
    // never faster than a couple of seconds from nothing to whole, however fast the film arrives: the gathering is the point
    shown += Math.max(-1, Math.min(goal - shown, dt * 0.5))
    if (pre.classList.contains('is-crack')) left += dt
    const burst = Math.min(1, left / 1.1), b2 = burst * burst
    px += (tx - px) * Math.min(1, dt * 2.5); py += (ty - py) * Math.min(1, dt * 2.5)

    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, W, H)
    const cx = W / 2, cy = H * (W < 700 ? 0.47 : 0.53), S = Math.min(W * (W < 700 ? 0.33 : 0.2), H * (W < 700 ? 0.2 : 0.225)) * (1 + b2 * 1.6)
    // a pool of dark behind the fruit, so it stands in front of the title instead of dissolving into it
    const pool = g.createRadialGradient(cx, cy, S * 0.4, cx, cy, S * 2.1)
    pool.addColorStop(0, `rgba(6,14,9,${0.86 * sm(0.05, 0.6, shown) * (1 - b2)})`); pool.addColorStop(1, 'rgba(6,14,9,0)')
    g.fillStyle = pool; g.fillRect(0, 0, W, H)
    // the warmth behind it grows with the fruit
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, S * 4.2)
    glow.addColorStop(0, `rgba(255,170,50,${(0.05 + 0.2 * shown) * (1 - b2)})`); glow.addColorStop(0.45, `rgba(255,120,20,${0.06 * shown * (1 - b2)})`); glow.addColorStop(1, 'rgba(255,120,20,0)')
    g.fillStyle = glow; g.fillRect(0, 0, W, H)

    g.globalCompositeOperation = 'lighter'
    const rot = time * 0.32 + px * 0.5, cr = Math.cos(rot), sr = Math.sin(rot), tilt = -0.16 + py * 0.14, ct = Math.cos(tilt), st = Math.sin(tilt)
    const ripe = sm(0.15, 0.95, shown), F = 5.2
    // once it is whole, a slow glint crosses it, so "ready" is something you see
    const glintOn = shown > 0.985 && !left && !still, glintX = cx + (((time * 0.3) % 1.6) * 2 - 1.6) * S * 1.6
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      // called in when the load passes its mark; settles like something with weight
      const want = shown >= p.th ? 1 : 0
      p.k += (want - p.k) * Math.min(1, dt * (still ? 60 : 2.2 + p.j * 2))
      const k = p.k * p.k * (3 - 2 * p.k)
      // its place in the dust: a wide slow ring, tipped towards us
      const an = p.a + time * p.sp, wob = Math.sin(time * 0.5 + p.tw) * 0.12
      let dx = Math.cos(an) * p.r, dy = p.h * 0.5 + wob, dz = Math.sin(an) * p.r
      // its place on the fruit, turned
      const X = p.t[0] * cr + p.t[2] * sr, Z = -p.t[0] * sr + p.t[2] * cr, Y = p.t[1]
      const nx = p.n[0] * cr + p.n[2] * sr, nz = -p.n[0] * sr + p.n[2] * cr, ny = p.n[1]
      let x = mix(dx, X, k), y = mix(dy, Y, k), z = mix(dz, Z, k)
      if (b2 > 0) { const out = b2 * (2.2 + p.j * 3.4); x += nx * out; y += ny * out; z += nz * out - b2 * 2.4 * p.j }
      // tip the whole thing, then onto the screen
      const y2 = y * ct - z * st, z2 = y * st + z * ct
      const pr = F / (F + z2)
      if (pr <= 0 || pr > 6) continue
      const sx = cx + x * S * pr, sy = cy - y2 * S * pr
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue
      // light from the upper left, towards us
      const lit = Math.max(0, nx * -0.5 + ny * 0.62 + nz * -0.6)
      let c, al, sz
      if (p.kind === 2) c = LEAF
      else if (p.kind === 1) c = [150, 120, 60]
      else {
        const base = ripe < 0.5 ? [mix(GREEN[0], YELLOW[0], ripe * 2), mix(GREEN[1], YELLOW[1], ripe * 2), mix(GREEN[2], YELLOW[2], ripe * 2)] : [mix(YELLOW[0], GOLD[0], ripe * 2 - 1), mix(YELLOW[1], GOLD[1], ripe * 2 - 1), mix(YELLOW[2], GOLD[2], ripe * 2 - 1)]
        const blush = ripe * sm(0.2, 0.95, p.t[1] / 1.3) * sm(-0.2, 0.8, p.n[0]) * 0.7 // the sun-side shoulder reddens
        c = [mix(base[0], BLUSH[0], blush), mix(base[1], BLUSH[1], blush), mix(base[2], BLUSH[2], blush)]
      }
      const shade = 0.3 + 0.9 * lit
      const twinkle = 0.55 + 0.45 * Math.sin(time * 1.7 + p.tw)
      al = mix(0.2 * twinkle, 0.42 + 0.58 * lit, k) * (1 - b2 * 0.92)
      sz = mix(1.1, 2.3, k) * p.s * pr * (1 + b2 * 0.7)
      const gl = glintOn && k > 0.9 ? Math.exp(-(((sx - glintX) / (S * 0.3)) ** 2)) : 0
      const r = Math.round(mix(DUST[0], Math.min(255, c[0] * shade), k)), gg = Math.round(mix(DUST[1], Math.min(255, c[1] * shade), k)), bb = Math.round(mix(DUST[2], Math.min(255, c[2] * shade), k))
      g.fillStyle = `rgba(${Math.min(255, r + gl * 90)},${Math.min(255, gg + gl * 90)},${Math.min(255, bb + gl * 110)},${Math.min(1, al + gl * 0.4).toFixed(3)})`
      g.fillRect(sx - sz / 2, sy - sz / 2, sz, sz)
      // and a wider, fainter one under it: the fruit glows as a body, not a net of dots
      if (k > 0.5 && p.kind === 0 && b2 < 0.25) { g.fillStyle = `rgba(${r},${gg},${bb},${(0.07 * k * (0.4 + lit) * (1 - b2)).toFixed(3)})`; g.fillRect(sx - sz * 2, sy - sz * 2, sz * 4, sz * 4) }
    }
  }
  requestAnimationFrame(frame)
}
})()
