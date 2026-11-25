/* The first page's sunny presentation (style.css "Sunny storefront" block, theme.css for dark):
   - the header's bag button says how many boxes are in it (its count is drawn by app.js updateCart; the badge hides
     at zero through html.no-bag-lines);
   - the hero carousel: three slides in one banner, swiped natively (scroll-snap), dots that are buttons, arrow keys,
     auto-advance every 6 s, paused while the slides are touched, hovered or focused (not the dots or the pause button),
     off screen or by its pause button, and never with reduced motion;
   - "Shop by variety": the grid shows two rows of cards until "See all" (remembered for the tab session); a ripeness
     filter, an occasion chip or a search always shows every match.
   Loaded after app.js and dock.js; reads app.js/shelf.js globals (filter, occasion, shelf) at call time. */
(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')

  // ---- Header bag: a spoken count.
  const bag = $('.header .bag-button')
  function bagLabel(t) {
    if (!bag) return
    const n = (t && t.count) || 0
    bag.setAttribute('aria-label', n ? `Open shopping bag, ${n} ${n === 1 ? 'box' : 'boxes'}` : 'Open shopping bag, empty')
  }
  window.addEventListener('mm:cart', (e) => bagLabel(e.detail))
  bagLabel(typeof bagTotals === 'function' ? bagTotals() : null)

  // ---- Hero carousel.
  const hero = $('.sun-hero')
  if (hero) {
    const track = $('.sun-track', hero), slides = $$('.sun-slide', hero), dots = $$('.sun-dot', hero), pauseBtn = $('.sun-pause', hero)
    let at = 0, timer = 0, userPaused = false, onScreen = true
    const hold = new Set() // why it is paused right now: hover, focus, touch
    const behavior = () => (reduced.matches ? 'instant' : 'smooth')

    function mark(i) {
      at = i
      slides.forEach((s, k) => {
        const on = k === i
        s.setAttribute('aria-hidden', String(!on))
        $$('a,button', s).forEach((el) => (on ? el.removeAttribute('tabindex') : el.setAttribute('tabindex', '-1')))
      })
      dots.forEach((d, k) => (k === i ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')))
    }
    function show(i) {
      i = (i + slides.length) % slides.length
      track.scrollTo({ left: i * track.clientWidth, behavior: behavior() })
      mark(i)
    }
    // Swiped by hand: which slide it settled on.
    let settle = 0
    track.addEventListener('scroll', () => {
      clearTimeout(settle)
      settle = setTimeout(() => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth))
        if (i !== at) mark(Math.min(slides.length - 1, Math.max(0, i)))
      }, 90)
    }, { passive: true })

    function running() { return !reduced.matches && !userPaused && onScreen && !document.hidden && !hold.size }
    function tick() {
      clearInterval(timer)
      timer = 0
      if (running()) timer = setInterval(() => show(at + 1), 6000)
    }
    const holdOn = (why) => { hold.add(why); tick() }
    const holdOff = (why) => { hold.delete(why); tick() }

    // Hover and focus hold the slides only while on the slides themselves (the track and its links), never on the dots
    // or the pause button: pressing Play leaves the focus on the button, and the slides must move again.
    track.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') holdOn('hover') })
    track.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') holdOff('hover') })
    track.addEventListener('focusin', () => holdOn('focus'))
    track.addEventListener('focusout', (e) => { if (!track.contains(e.relatedTarget)) holdOff('focus') })
    track.addEventListener('touchstart', () => holdOn('touch'), { passive: true })
    track.addEventListener('touchend', () => holdOff('touch'), { passive: true })
    track.addEventListener('touchcancel', () => holdOff('touch'), { passive: true })
    document.addEventListener('visibilitychange', tick)
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); tick() }, { threshold: 0.35 }).observe(hero)

    dots.forEach((d, k) => d.addEventListener('click', () => show(k)))
    hero.addEventListener('keydown', (e) => {
      if (!track.contains(e.target) && !e.target.closest('.sun-dots')) return
      const move = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: slides.length - 1 }[e.key]
      if (move === undefined) return
      e.preventDefault()
      show(move)
      if (e.target.classList.contains('sun-dot')) dots[at].focus()
    })
    // The pause button: shown only where the slides move by themselves.
    function paintPause() {
      if (!pauseBtn) return
      pauseBtn.hidden = reduced.matches
      pauseBtn.innerHTML = `<svg aria-hidden="true"><use href="#i-${userPaused ? 'play' : 'pause'}"/></svg>`
      pauseBtn.setAttribute('aria-label', userPaused ? 'Play the slides' : 'Pause the slides')
    }
    if (pauseBtn) pauseBtn.addEventListener('click', () => { userPaused = !userPaused; paintPause(); tick() })
    reduced.addEventListener?.('change', () => { paintPause(); tick() })
    // Keep the current slide in place when the banner changes width (rotation, resize).
    addEventListener('resize', () => { track.scrollTo({ left: at * track.clientWidth, behavior: 'instant' }) })
    // The later slides' photos come in once the page has loaded, so they are ready before their turn.
    addEventListener('load', () => setTimeout(() => $$('img[loading="lazy"]', track).forEach((img) => { img.loading = 'eager' }), 1200))

    mark(0)
    paintPause()
    tick()
  }

  // ---- "Shop by variety": two rows until See all.
  const grid = $('#products'), row = $('.see-all-row'), topBtn = $('.see-all-top'), KEY = 'mm-shelf-all'
  if (!grid || !row) return
  let all = false
  try { all = sessionStorage.getItem(KEY) === '1' } catch {}
  const columns = () => getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 2
  const shortCount = () => Math.max(4, columns() * 2)
  function narrowed() {
    const search = $('#search')
    return (typeof filter !== 'undefined' && filter !== 'all') || (typeof occasion !== 'undefined' && occasion !== 'all') || !!(search && search.value.trim())
  }
  function apply() {
    const cards = $$(':scope > .product-card', grid)
    const real = cards.filter((c) => !c.classList.contains('is-skeleton'))
    const short = shortCount()
    const collapse = !all && !narrowed() && cards.length > short
    grid.classList.toggle('is-short', collapse)
    cards.forEach((c, i) => c.classList.toggle('is-extra', collapse && i >= short))
    const offer = collapse && real.length > short
    row.hidden = !offer
    if (topBtn) topBtn.hidden = !offer
    if (offer) {
      const n = (typeof shelf !== 'undefined' && shelf.length) || real.length
      $('.see-all-n', row).textContent = `See all ${n} varieties`
      if (topBtn) topBtn.setAttribute('aria-label', `See all ${n} varieties`)
    }
  }
  function expand() {
    const short = shortCount()
    all = true
    try { sessionStorage.setItem(KEY, '1') } catch {}
    apply()
    const first = $$(':scope > .product-card', grid)[short]
    const target = first && first.querySelector('button:not([disabled]),a[href],[tabindex="0"]')
    if (target) target.focus({ preventScroll: false })
  }
  $$('[data-see-all]').forEach((b) => b.addEventListener('click', expand))
  new MutationObserver(apply).observe(grid, { childList: true })
  // A typed search changes the grid through renderProducts; an emptied field too.
  const search = $('#search')
  if (search) search.addEventListener('input', () => requestAnimationFrame(apply))
  let resizeQueued = 0
  addEventListener('resize', () => { cancelAnimationFrame(resizeQueued); resizeQueued = requestAnimationFrame(apply) })
  apply()
})()
