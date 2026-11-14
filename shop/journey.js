/* The 30-second film of a mango's journey, from the seed to the customer's door (assets/journey.mp4, recorded from the
   One Mango film). It lives at the top of the Legacy page (legacy.js legacyHomeView calls mmJourney on its markup):
   <video data-journey>, a label [data-journey-stage] and a button [data-journey-toggle] inside one container.
   It plays muted, in a loop, only while it is on screen; the label names each stage. Nothing is fetched until it is
   about to play (preload="none"). Reduced motion or data saver: it waits for the button. */
(() => {
  // [starts at second, what is on screen]
  const STAGES = [
    [0, 'It starts as a seed'], [4, 'Years of growing'], [6.4, 'Spring blossom'], [8.6, 'Ripened on the tree'], [10.8, 'Picked by hand'],
    [13.2, 'Rested in hay'], [15.4, 'On the road'], [18, 'Graded one by one'], [20.2, 'Packed in your box'], [22.4, 'Brought to your door'],
    [25.2, 'Sliced at your table'], [27.4, 'One mango, one journey'],
  ]
  const icon = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`
  let live = null // the film on the page now: { v, sync }

  function bind(root) {
    const v = (root || document).querySelector('video[data-journey]')
    if (!v || v.dataset.journeyOn) return
    v.dataset.journeyOn = '1'
    const box = v.parentElement, stage = box.querySelector('[data-journey-stage]'), btn = box.querySelector('[data-journey-toggle]')
    const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches || !!(navigator.connection && navigator.connection.saveData)
    let wanted = !quiet, onScreen = false, said = ''
    const paint = () => {
      if (!btn) return
      const playing = !v.paused
      btn.innerHTML = icon(playing ? 'pause' : 'play')
      btn.setAttribute('aria-label', playing ? 'Pause the video' : 'Play the video')
      btn.classList.toggle('is-paused', !playing)
    }
    const sync = () => {
      if (!v.isConnected) return
      if (wanted && onScreen && !document.hidden) { const p = v.play(); if (p && p.catch) p.catch(() => { wanted = false; paint() }) }
      else if (!v.paused) v.pause()
    }
    v.addEventListener('timeupdate', () => {
      let name = STAGES[0][1]
      for (const [at, text] of STAGES) if (v.currentTime >= at) name = text
      if (name !== said && stage) { said = name; stage.textContent = name }
    })
    v.addEventListener('play', paint)
    v.addEventListener('pause', paint)
    if (btn) { btn.addEventListener('click', () => { wanted = v.paused; sync() }); btn.hidden = false }
    // Off screen (scrolled past, or another page of the shop is open): it stops.
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting && e.intersectionRatio > 0.2); sync() }, { threshold: [0, 0.2, 0.6] }).observe(v)
    else { onScreen = true; sync() }
    live = { v, sync }
    paint()
  }
  document.addEventListener('visibilitychange', () => { if (live && live.v.isConnected) live.sync() })
  window.mmJourney = bind
  bind(document)
})()
