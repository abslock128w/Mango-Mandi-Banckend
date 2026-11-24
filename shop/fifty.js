/* The drifting gold pollen behind the "50 years" hero slide (#sun-s2), like the Legacy page's first screen.
   A small canvas of short streaks carried by a slow swirling flow. It runs only while the slide is on screen and
   the tab is visible, and not at all when the device asks for reduced motion. Loaded deferred, after home.js. */
(() => {
  const slide = document.querySelector('#sun-s2.sun-fifty')
  if (!slide || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const cv = document.createElement('canvas')
  cv.className = 'sf-pollen'
  cv.setAttribute('aria-hidden', 'true')
  slide.prepend(cv)
  const g = cv.getContext('2d')
  let w = 0, h = 0, dpr = 1, parts = [], raf = 0, seen = false, t = 0

  // A small seeded generator, so the field looks the same on every visit.
  let seed = 1976
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

  function size() {
    const r = slide.getBoundingClientRect()
    if (!r.width || !r.height) return
    dpr = Math.min(2, window.devicePixelRatio || 1)
    w = r.width; h = r.height
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    // The same density as the Legacy page's first screen: 3,000 per 1440x900 of area (1,500 on phones), 45% of them
    // far (slower, fainter, shorter).
    const n = Math.round((w < 760 ? 1500 : 3000) * Math.max(0.08, (w * h) / (1440 * 900)))
    parts = Array.from({ length: n }, (_, i) => { const far = i < n * 0.45; return { x: rnd() * w, y: rnd() * h, s: far ? 0.12 + rnd() * 0.3 : 0.4 + rnd() * 1.1, l: far ? 3 + rnd() * 5 : 5 + rnd() * 13, far, bright: !far && rnd() < 0.12 } })
  }

  // The direction of the flow at a point: a few slow sine swirls, drifting with time.
  const angle = (x, y) => Math.sin(x * 0.0041 + t * 0.00011) * 1.7 + Math.cos(y * 0.0057 - t * 0.00008) * 1.5 + Math.sin((x + y) * 0.0023 + t * 0.00005) * 1.2

  function frame(now) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(48, now - (frame.last || now)); frame.last = now
    t += dt
    g.clearRect(0, 0, w, h)
    g.lineCap = 'round'
    // Three batches (far, near, bright), one path each: thousands of streaks in three strokes.
    const paths = [new Path2D(), new Path2D(), new Path2D()]
    for (const p of parts) {
      const a = angle(p.x, p.y), vx = Math.cos(a), vy = Math.sin(a), sp = p.s * dt * 0.05
      p.x += vx * sp; p.y += vy * sp - (p.far ? 0.003 : 0.01) * dt
      if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20
      if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20
      const path = paths[p.far ? 0 : p.bright ? 2 : 1]
      path.moveTo(p.x, p.y); path.lineTo(p.x - vx * p.l, p.y - vy * p.l)
    }
    g.lineWidth = 0.8; g.strokeStyle = 'rgba(214, 196, 110, 0.22)'; g.stroke(paths[0])
    g.lineWidth = 1; g.strokeStyle = 'rgba(232, 214, 120, 0.42)'; g.stroke(paths[1])
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(255, 224, 130, 0.8)'; g.stroke(paths[2])
  }

  const run = () => { if (!raf && seen && !document.hidden) { if (!w) size(); frame.last = 0; raf = requestAnimationFrame(frame) } }
  const stop = () => { cancelAnimationFrame(raf); raf = 0 }
  new IntersectionObserver((es) => { seen = es.some((e) => e.isIntersecting && e.intersectionRatio > 0.2); seen ? run() : stop() }, { threshold: [0, 0.2, 0.6] }).observe(slide)
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : run()))
  let rz = 0
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(size, 150) })
})()
