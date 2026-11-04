/* Liquid glass for the control layer: spring "jelly" physics, a light that follows the pointer,
   and edge refraction where the browser can do it (Chromium: an SVG displacement map in
   backdrop-filter; elsewhere the plain blur stays).

   window.Liquid = { press, release, pull, pop, flip, scan }
   - press/release: squash on touch, wobble back on release (delegated for JELLY below).
   - pull: hover magnet, the control leans toward the pointer (mouse only).
   - pop: a jiggle kick (bag count change, toast, dialog open).
   - flip: a lens slides from where it was to where it is now, stretching with its speed.
   - scan(root): give [data-refract] elements their refraction map.

   Motion uses the individual `translate` and `scale` properties, so it composes with GSAP's
   and the CSS `transform`s already on these elements. Loaded last, after dock.js. */
(() => {
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches
  const opaque = matchMedia('(prefers-reduced-transparency: reduce)').matches

  // ---- How liquid it is (fixed at the "medium" feel). damp sets the wobble (damping ratio
  // ≈ damp / 41, so ≈ 0.4 here); slideDamp a sliding lens (≈ 0.68, it never leaves its rail);
  // squash/widen the press; stretch the most a sliding lens stretches; pop the size of event
  // jiggles; reach the hover lean; bend the edge refraction.
  const tune = { damp: 17, slideDamp: 28, squash: 0.93, widen: 1.03, stretch: 0.18, pop: 0.55, reach: 0.55, bend: 0.75 }

  // ---- Springs.
  const STIFF = 420
  const bodies = new WeakMap(), active = new Set()
  const channel = (v) => ({ p: v, v: 0, t: v, d: null })
  let frame = 0, last = 0

  function body(el) {
    let b = bodies.get(el)
    if (!b) {
      b = { el, x: channel(0), y: channel(0), sx: channel(1), sy: channel(1), stretch: false }
      bodies.set(el, b)
    }
    return b
  }

  function paint(b) {
    let sx = b.sx.p, sy = b.sy.p
    if (b.stretch) {
      // A sliding lens stretches along its path and thins, like a drop of liquid.
      const s = Math.min(Math.abs(b.x.v) / 2400, tune.stretch)
      sx *= 1 + s
      sy *= 1 - s * 0.45
    }
    b.el.style.translate = `${b.x.p.toFixed(2)}px ${b.y.p.toFixed(2)}px`
    b.el.style.scale = `${sx.toFixed(4)} ${sy.toFixed(4)}`
  }

  function tick(now) {
    const dt = Math.min(0.032, (now - last) / 1000) || 0.016
    last = now
    for (const b of active) {
      let moving = false
      for (const k of ['x', 'y', 'sx', 'sy']) {
        const c = b[k], d = c.d ?? tune.damp
        for (let i = 0; i < 2; i++) {
          const a = -STIFF * (c.p - c.t) - d * c.v
          c.v += a * dt / 2
          c.p += c.v * dt / 2
        }
        if (Math.abs(c.v) > 0.01 || Math.abs(c.p - c.t) > 0.001) moving = true
        else {
          c.p = c.t
          c.v = 0
        }
      }
      paint(b)
      if (!moving) {
        active.delete(b)
        if (!b.x.t && !b.y.t && b.sx.t === 1 && b.sy.t === 1) {
          b.el.style.translate = ''
          b.el.style.scale = ''
          b.stretch = false
        }
      }
    }
    frame = active.size ? requestAnimationFrame(tick) : 0
  }

  function wake(b) {
    active.add(b)
    if (!frame) {
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
  }

  function press(el) {
    if (!motion || !el) return
    const b = body(el), r = el.getBoundingClientRect()
    const wide = r.width / Math.max(1, r.height) > 1.6
    // Pills squash wider and flatter; round and square controls shrink evenly.
    b.sx.t = wide ? tune.widen : tune.squash
    b.sy.t = tune.squash
    wake(b)
  }

  function release(el) {
    const b = el && bodies.get(el)
    if (!b) return
    b.sx.t = 1
    b.sy.t = 1
    wake(b)
  }

  function pull(el, dx, dy) {
    if (!motion || !el) return
    const b = body(el)
    b.x.t = dx * tune.reach
    b.y.t = dy * tune.reach
    wake(b)
  }

  function pop(el, amount = 1) {
    if (!motion || !el) return
    const b = body(el), k = amount * tune.pop
    b.sx.v += 3.2 * k
    b.sy.v -= 2.6 * k
    wake(b)
  }

  function flip(el, dx) {
    if (!el || !motion || !dx) return
    const b = body(el)
    // The slide is damped harder than the wobble so a lens never leaves its rail;
    // the jiggle comes from the stretch while it travels and the squash on landing.
    b.x.d = tune.slideDamp
    b.x.p += dx
    b.x.t = 0
    b.stretch = true
    b.sy.v -= 1.8 * tune.pop
    b.sx.v += 1.2 * tune.pop
    wake(b)
  }

  // ---- Who reacts. JELLY squashes on press; MAGNET also leans toward a mouse pointer;
  // MATERIAL (kept in step with the "Liquid glass material" block in style.css) catches the light.
  const JELLY = '.button, .quick-add, .icon-button, .bag-button, .occasion, .box-card, .stage-dot, .heart, .segmented button, .text-button, .bulk-shortcut, .photo-label, .quantity button, .guide-choice, .dock-orb, .dock-mini, .faq summary, .sort-select, .detail-thumbs button, .remove, .date-card, .slot-card, .address-card, .locate-button, .page-tabs a'
  const MAGNET = '.button, .quick-add, .icon-button, .bag-button, .occasion, .photo-label, .dock-orb, .bulk-shortcut, .sort-select'
  const MATERIAL = '.glass, .liquid'

  let held = null, magnet = null, lit = null

  function light(e) {
    const el = e.target instanceof Element ? e.target.closest(MATERIAL) : null
    if (lit && lit !== el) {
      lit.classList.remove('is-lit')
      lit = null
    }
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lx', `${Math.round(e.clientX - r.left)}px`)
    el.style.setProperty('--ly', `${Math.round(e.clientY - r.top)}px`)
    el.classList.add('is-lit')
    lit = el
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.button) return
    light(e)
    const el = e.target instanceof Element ? e.target.closest(JELLY) : null
    if (!el || el.disabled || el.closest('.liquid-rail')) return
    held = el
    press(el)
  }, { passive: true })

  const letGo = (e) => {
    if (held) release(held)
    held = null
    if (e.pointerType !== 'mouse' && lit) {
      lit.classList.remove('is-lit')
      lit = null
    }
  }
  document.addEventListener('pointerup', letGo, { passive: true })
  document.addEventListener('pointercancel', letGo, { passive: true })

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    light(e)
    const el = e.target instanceof Element ? e.target.closest(MAGNET) : null
    if (magnet && magnet !== el) {
      pull(magnet, 0, 0)
      magnet = null
    }
    if (!el || el.disabled || !tune.reach) return
    const r = el.getBoundingClientRect(), b = bodies.get(el)
    const cx = r.left + r.width / 2 - (b ? b.x.p : 0), cy = r.top + r.height / 2 - (b ? b.y.p : 0)
    const reach = Math.min(7, Math.max(3, r.height / 8))
    pull(el, ((e.clientX - cx) / r.width) * reach * 1.6, ((e.clientY - cy) / r.height) * reach)
    magnet = el
  }, { passive: true })

  document.addEventListener('pointerleave', () => {
    if (magnet) pull(magnet, 0, 0)
    magnet = null
  })

  // ---- Refraction: an edge-bending displacement map per size (cached), as in the dock's lens.
  // Not on touch devices: phone GPUs flicker redrawing displacement-mapped blur under sheets and scrolling.
  const coarse = matchMedia('(pointer: coarse)').matches
  const canRefract = !opaque && !coarse && CSS.supports('backdrop-filter', 'blur(2px) url(#mm-x)')
  let defs = null

  function refraction(w, h, r) {
    const scale = Math.round(Math.max(10, Math.min(28, h * 0.4)) * tune.bend)
    const id = `mm-refract-${w}x${h}x${r}x${scale}`
    if (document.getElementById(id)) return id
    if (!defs) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('aria-hidden', 'true')
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      svg.append(defs)
      document.body.append(svg)
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d'), map = ctx.createImageData(w, h)
    const bezel = Math.max(6, Math.min(18, h * 0.32))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x - w / 2 + 0.5, py = y - h / 2 + 0.5
        const qx = Math.max(Math.abs(px) - (w / 2 - r), 0), qy = Math.max(Math.abs(py) - (h / 2 - r), 0)
        const corner = qx > 0 && qy > 0
        // Distance in from the rounded edge, and the outward normal there.
        const edge = corner ? r - Math.hypot(qx, qy) : Math.min(w / 2 - Math.abs(px), h / 2 - Math.abs(py))
        const bend = edge >= 0 && edge < bezel ? Math.pow(1 - edge / bezel, 2) : 0
        let nx = 0, ny = 0
        if (corner) {
          const d = Math.hypot(qx, qy) || 1
          nx = (qx / d) * Math.sign(px)
          ny = (qy / d) * Math.sign(py)
        } else if (w / 2 - Math.abs(px) < h / 2 - Math.abs(py)) nx = Math.sign(px)
        else ny = Math.sign(py)
        const k = (y * w + x) * 4
        map.data[k] = 128 + nx * bend * 120
        map.data[k + 1] = 128 + ny * bend * 120
        map.data[k + 2] = 128
        map.data[k + 3] = 255
      }
    }
    ctx.putImageData(map, 0, 0)
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
    filter.id = id
    filter.setAttribute('x', '0')
    filter.setAttribute('y', '0')
    filter.setAttribute('width', '100%')
    filter.setAttribute('height', '100%')
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    filter.innerHTML = `<feImage href="${canvas.toDataURL()}" x="0" y="0" width="${w}" height="${h}" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`
    defs.append(filter)
    return id
  }

  function refract(el) {
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight)
    if (w < 16 || h < 16 || w * h > 400000) return
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
    const r = Math.round(Math.min(radius, h / 2, w / 2))
    el.style.setProperty('--refract', `url(#${refraction(w, h, r)})`)
    el.classList.add('is-refracting')
  }

  function scan(root = document) {
    if (!canRefract) return
    root.querySelectorAll('[data-refract]').forEach(refract)
  }

  // ---- Jiggle on events the page already has.
  const count = document.querySelector('.header .bag-count')
  if (count) {
    let shown = count.textContent
    new MutationObserver(() => {
      if (count.textContent === shown) return
      shown = count.textContent
      pop(document.querySelector('.bag-button'), 1)
      const mini = document.querySelector('.dock-mini')
      if (mini && !mini.hidden) pop(mini, 0.6)
    }).observe(count, { childList: true, characterData: true, subtree: true })
  }
  const toastEl = document.querySelector('.toast')
  if (toastEl) {
    new MutationObserver(() => {
      if (toastEl.classList.contains('show')) pop(toastEl, 0.8)
    }).observe(toastEl, { attributes: true, attributeFilter: ['class'] })
  }

  let resizing = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizing)
    resizing = setTimeout(() => scan(), 200)
  })
  document.fonts.ready.then(() => scan())
  scan()

  window.Liquid = { press, release, pull, pop, flip, scan }
})()
