/* "Into the bag": when a box is added from a product (a card's Add or +, the product sheet's Add to bag), a round thumbnail
   of its picture lifts off the photo and flies on an arc to the bag that is on screen (on phones the bag bar above the dock
   when it is showing or sliding in, else the header's bag button), shrinking and turning; the bag bounces and its count pops
   as it lands. It follows the shop's own signal: a capturing listener remembers the product behind the last add tap, and the
   flight starts only when app.js's `mm:cart` (updateCart) then reports more boxes. So no flight on page load, on a restored
   bag, on removals, on the bag page's own steppers, or when the add was refused. pages.js calls MMFly.fly() for
   "Add to bulk list" (into the bulk list bar). Reduced motion: no flight, the count is lit for a moment.
   Transforms and opacity only (Web Animations API); the layer is fixed, ignores the pointer and leaves the DOM when done.
   Loaded after app.js and dock.js (their `mm:cart` listeners run first, so the bag bar is already marked as showing). */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  const ADD = '[data-add],[data-card-qty="1"],[data-detail-add],[data-gift-bag]'
  const MS = 700, SIZE = 64
  let pending = null
  let count = typeof bagTotals === 'function' ? bagTotals().count || 0 : 0
  const api = { took: false, fly }
  window.MMFly = api

  const onScreen = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return null
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null
    return r
  }

  // ---- What was tapped: the product's photo (its place on screen now; the card may be redrawn by the add).
  function sourceOf(b) {
    const host = b.closest('.product-card, .product-detail, .gift-card')
    if (!host) return null
    const img = host.querySelector('#detail-photo') || host.querySelector('.product-image img, .detail-image img, .gift-card-photo img')
    const box = (img && onScreen(img) && img) || host.querySelector('.product-image .fruit-photo, .detail-image, .gift-card-photo')
    let r = box && box.getBoundingClientRect()
    if (!r || !r.width) return null
    // The photo scrolled out of sight (a card's lower half, the sheet scrolled): lift off from the button tapped instead.
    const cy = r.top + r.height / 2
    if (cy < 0 || cy > innerHeight) r = b.getBoundingClientRect()
    return { from: r, src: img ? img.currentSrc || img.src : null }
  }
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest(ADD) : null
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return
    const s = sourceOf(b)
    pending = s ? { ...s, at: performance.now() } : null
  }, true)

  // ---- Where it lands: the bag that is actually on screen.
  function bagTarget() {
    const mini = document.querySelector('.dock-mini')
    if (mini && mini.classList.contains('is-shown') && getComputedStyle(mini).display !== 'none') {
      const icon = mini.querySelector('.mini-bag') || mini, r = icon.getBoundingClientRect()
      // The bar may still be sliding up: aim at where it comes to rest (its `translate` is the slide still to go).
      const slide = parseFloat((getComputedStyle(mini).translate || '').split(' ')[1]) || 0
      if (r.width) return { el: icon, badge: mini.querySelector('.bag-count'), x: r.left + r.width / 2, y: r.top - slide + r.height / 2 }
    }
    for (const b of document.querySelectorAll('.bag-button')) {
      const r = onScreen(b)
      if (!r) continue
      const svg = b.querySelector('svg'), s = (svg && svg.getBoundingClientRect().width && svg.getBoundingClientRect()) || r
      return { el: svg || b, badge: b.querySelector('.bag-count'), x: s.left + s.width / 2, y: s.top + s.height / 2 }
    }
    return null
  }

  window.addEventListener('mm:cart', (e) => {
    const now = e.detail && typeof e.detail.count === 'number' ? e.detail.count : count
    const p = pending, up = now > count
    count = now
    if (!p || performance.now() - p.at > 1500) { pending = null; return }
    if (!up) return
    pending = null
    // shelf.js add() pops the count itself unless a flight (or the reduced-motion light) takes the add.
    api.took = true
    requestAnimationFrame(() => { api.took = false })
    if (reduce.matches) { lightUp(document.querySelectorAll('.bag-count')); return }
    fly({ from: p.from, src: p.src, to: bagTarget })
  })

  function lightUp(els) {
    els.forEach((el) => {
      el.classList.remove('fly-lit')
      void el.offsetWidth
      el.classList.add('fly-lit')
      setTimeout(() => el.classList.remove('fly-lit'), 700)
    })
  }

  // The layer: one fixed, pointer-free box over the page (inside an open modal dialog when the flight starts in one,
  // so it shows above the sheet's backdrop; dialogs are in the top layer).
  function layerFor(rect) {
    const open = [...document.querySelectorAll('dialog[open]')].find((d) => {
      const r = d.getBoundingClientRect()
      return rect.left + rect.width / 2 >= r.left && rect.left + rect.width / 2 <= r.right && rect.top + rect.height / 2 >= r.top && rect.top + rect.height / 2 <= r.bottom
    })
    const host = open || document.body
    let layer = host.querySelector(':scope > .fly-layer')
    if (!layer) {
      layer = document.createElement('div')
      layer.className = 'fly-layer'
      layer.setAttribute('aria-hidden', 'true')
      host.appendChild(layer)
    }
    return layer
  }

  /** One flight. o: { from: DOMRect of the picture, src: its image or null, to: () => target ({ el, badge, x, y }) or an element }. */
  function fly(o) {
    const from = o.from
    if (!from) return
    const aim = () => {
      const t = typeof o.to === 'function' ? o.to() : o.to
      if (!t) return null
      if (t instanceof Element) {
        const r = onScreen(t)
        return r ? { el: t, badge: null, x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
      }
      return t
    }
    if (reduce.matches) { const t = aim(); if (t) lightUp([t.badge || t.el]); return }
    // A frame later: the add has redrawn the bag bar, the sheet may have closed.
    requestAnimationFrame(() => {
      const t = aim()
      if (!t) return
      const layer = layerFor(from)
      const dot = document.createElement('span')
      dot.className = 'fly-dot'
      if (o.src) {
        const img = document.createElement('img')
        img.src = o.src
        img.alt = ''
        img.decoding = 'async'
        dot.appendChild(img)
      } else dot.classList.add('is-plain')
      layer.appendChild(dot)
      const lr = layer.getBoundingClientRect()
      const size = Math.max(40, Math.min(SIZE, from.width * 0.5, from.height * 0.5))
      const x0 = from.left + from.width / 2 - lr.left, y0 = from.top + from.height / 2 - lr.top
      const x1 = t.x - lr.left, y1 = t.y - lr.top
      dot.style.width = dot.style.height = size + 'px'
      dot.style.left = x0 - size / 2 + 'px'
      dot.style.top = y0 - size / 2 + 'px'
      // A curve that rises above both ends; quick at first, settling into the bag.
      const cx = (x0 + x1) / 2 + (x1 - x0) * 0.1, cy = Math.max(size / 2 + 8 - lr.top, Math.min(y0, y1) - Math.max(90, Math.abs(x1 - x0) * 0.25)) // never above the screen's top
      const end = 22 / size, turn = x1 >= x0 ? 28 : -28
      const frames = []
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, k = 1 - Math.pow(1 - u, 3)
        const x = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * cx + k * k * x1
        const y = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * cy + k * k * y1
        const lift = u < 0.12 ? 1 + 0.18 * (u / 0.12) : 1.18 + (end - 1.18) * ((k - 0.33) / 0.67)
        frames.push({ offset: u, transform: `translate(${(x - x0).toFixed(1)}px,${(y - y0).toFixed(1)}px) rotate(${(turn * k).toFixed(1)}deg) scale(${Math.max(end, lift).toFixed(3)})`, opacity: u > 0.9 ? 1 - (u - 0.9) * 6 : 1 })
      }
      const anim = dot.animate(frames, { duration: MS, easing: 'linear', fill: 'forwards' })
      const done = () => {
        dot.remove()
        if (!layer.children.length) layer.remove()
      }
      anim.onfinish = () => { done(); land(t) }
      anim.oncancel = done
      setTimeout(done, MS + 400)
    })
  }

  function land(t) {
    if (t.el && t.el.animate) t.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(.94)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' })
    if (t.badge && t.badge.animate) t.badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.2,.8,.3,1)' })
  }
})()
