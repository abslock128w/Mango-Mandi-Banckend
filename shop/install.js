/* "Add to Home Screen" nudge. On a phone's first visit (home page, nothing else open) a sheet offers the
   app: Chrome/Android install through beforeinstallprompt, iPhone gets the Share → Add to Home Screen steps.
   Never shown once installed (standalone), and "Not now" rests it for a month (localStorage mm-install). */
(() => {
  const KEY = 'mm-install', REST_DAYS = 30, DELAY = 400
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  const ua = navigator.userAgent
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const phone = () => matchMedia('(max-width: 900px)').matches && matchMedia('(pointer: coarse)').matches
  const homePage = () => (location.pathname === '/' || location.pathname === '/index.html')
  let deferred = null, shown = false

  const rest = () => save(KEY, { at: Date.now(), done: false })
  const done = () => save(KEY, { at: Date.now(), done: true })
  function resting() {
    const s = read(KEY, null)
    if (!s) return false
    if (s.done) return true
    return Date.now() - (s.at || 0) < REST_DAYS * 864e5
  }

  function sheet() {
    let d = document.getElementById('install-dialog')
    if (d) return d
    d = document.createElement('dialog')
    d.id = 'install-dialog'
    d.className = 'sheet form-sheet install-sheet'
    d.setAttribute('aria-label', 'Add Mango Mandi to your home screen')
    document.body.appendChild(d)
    return d
  }

  const shareIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>'
  const plusIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'
  const dotsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>'

  const steps = () => iOS
    ? `<ol class="install-steps"><li><span class="install-key">${shareIcon}</span><span>Tap <strong>Share</strong> at the bottom of Safari</span></li><li><span class="install-key">${plusIcon}</span><span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong></span></li></ol>`
    : `<ol class="install-steps"><li><span class="install-key">${dotsIcon}</span><span>Open your browser’s <strong>menu</strong></span></li><li><span class="install-key">${plusIcon}</span><span>Choose <strong>Add to Home screen</strong> or <strong>Install app</strong></span></li></ol>`
  // One button. Chrome installs on the tap (beforeinstallprompt); Safari has no such call, so the tap shows the two Share steps.
  function html(showSteps) {
    return `<div class="install-top"><img src="assets/app-icon.png" alt="" width="64" height="64" class="install-icon"><div><p class="install-kicker">Mango Mandi</p><h2>Add the app to your home screen.</h2></div><button class="icon-button" data-close aria-label="Not now">${icon('close')}</button></div>
<p class="install-copy">No app store needed. It opens like an app and remembers your bag and delivery area.</p>
${showSteps ? steps() : `<button class="button primary full" type="button" data-install-go>${plusIcon} Add to Home Screen</button>`}<button class="text-button install-later" type="button" data-close>Not now</button>`
  }

  function show() {
    if (shown || standalone() || resting() || !phone() || !homePage()) return
    if (typeof openDialog !== 'function') return
    // Something else is already up (a deep link's product or order sheet): come back once it closes.
    const busy = document.querySelector('dialog[open]')
    if (busy || document.body.classList.contains('locked')) {
      if (busy) busy.addEventListener('close', () => setTimeout(show, 900), { once: true })
      else setTimeout(show, 1500)
      return
    }
    shown = true
    const d = sheet()
    d.innerHTML = html()
    d.addEventListener('close', () => { if (!read(KEY, null)?.done) rest() }, { once: true })
    openDialog('#install-dialog')
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (shown) { const d = document.getElementById('install-dialog'); if (d?.open) d.innerHTML = html() } })
  window.addEventListener('appinstalled', () => { done(); deferred = null; const d = document.getElementById('install-dialog'); if (d?.open) { d.close(); document.body.classList.remove('locked') } ; if (typeof toast === 'function') toast('Mango Mandi is on your home screen.') })

  document.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-install-go]')
    if (!go) return
    const d0 = document.getElementById('install-dialog')
    if (!deferred) { if (d0) d0.innerHTML = html(true); return }
    go.disabled = true
    const p = deferred; deferred = null
    try { p.prompt(); const r = await p.userChoice; if (r?.outcome === 'accepted') done(); else rest() } catch { rest() }
    const d = document.getElementById('install-dialog'); if (d?.open) { d.close(); document.body.classList.remove('locked') }
  })

  window.addEventListener('load', () => setTimeout(show, DELAY))
})()
