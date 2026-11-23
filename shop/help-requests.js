/* Your help requests: the list on the Help page (#your-requests), a link on the Account page, and one request's
   thread at /help/requests/:id with a reply box. The API's help centre (mango-api care-routes.js, HELP_CENTRE):
   GET /v1/me/help/requests, GET /v1/me/help/requests/:id, POST /v1/me/help/requests/:id/messages. While the switch
   is off (the policy's care.helpCentre) nothing here shows and the routes answer 404.
   A staff reply the customer has not opened yet shows a dot: the time of the last message seen on each request is kept
   on this device (localStorage mm-help-seen), since the API keeps no "read" mark.
   Loaded after help.js and before app.js (it adds to PAGES). Styles: style.css (.req-). */
(() => {
  const SEEN = 'mm-help-seen'
  const STATUS = { OPEN: 'Waiting for our reply', WAITING_CUSTOMER: 'We replied', RESOLVED: 'Resolved' }
  const STAFF = (from) => from && from !== 'You' && from !== 'YOU'
  const day = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

  PAGES.push([/^\/help\/requests\/([^/]+)\/?$/, (m) => signedInThen('Your help request', () => threadView(decodeURIComponent(m[1])))])

  /** The help centre is on: from the policy app.js has loaded, else asked for once. */
  let asked = null
  async function helpOn() {
    let p = typeof policy !== 'undefined' && policy ? policy : null
    if (!p) p = await (asked ??= MM.policy().catch(() => null))
    return Boolean(p && p.care && p.care.helpCentre)
  }

  const seenMap = () => { const m = read(SEEN, {}); return m && typeof m === 'object' ? m : {} }
  function markSeen(t) {
    const last = (t.messages || []).at(-1)
    if (!last) return
    const m = seenMap()
    m[t.id] = last.at
    // only the latest 60 requests are remembered
    save(SEEN, Object.fromEntries(Object.entries(m).slice(-60)))
  }
  const unread = (t) => {
    const last = t.lastMessage
    if (!last || !STAFF(last.from)) return false
    const seen = seenMap()[t.id]
    return !seen || Date.parse(last.at) > Date.parse(seen)
  }
  const who = (from) => (STAFF(from) ? 'VMR Mangoes' : 'You')

  function row(t) {
    const fresh = unread(t), last = t.lastMessage
    return `<li><a class="help-way req-row${fresh ? ' is-unread' : ''}" href="/help/requests/${encodeURIComponent(t.id)}" data-route>
      ${fresh ? '<span class="req-dot" aria-hidden="true"></span>' : icon('chat')}
      <span><strong>${esc(t.topicLabel || 'Help request')}${fresh ? '<span class="sr-only"> (new reply)</span>' : ''}</strong>
        <small class="req-meta"><span class="req-status is-${esc(String(t.status).toLowerCase())}">${esc(STATUS[t.status] || t.status)}</span> · ${esc(t.number || '')}${t.order ? ` · Order ${esc(orderNo(t.order.number))}` : ''}</small>
        ${last ? `<small class="req-last">${esc(who(last.from))}: ${esc(last.preview)}${last.preview && last.preview.length >= 140 ? '…' : ''} <span class="no-wrap">· ${esc(day(last.at))}</span></small>` : ''}
      </span>${icon('arrow')}</a></li>`
  }

  /** The Help page's "Your requests" (help.js calls it once the session is known). */
  window.helpRequestsBox = async function helpRequestsBox() {
    const box = $('#your-requests')
    if (!box) return
    if (!(await helpOn()) || !box.isConnected) { box.hidden = true; return }
    box.hidden = false
    const body = $('.req-body', box)
    if (!MM.profile()) {
      body.innerHTML = `<p>Sign in to see the requests you have sent us and our replies.</p><div class="help-actions"><a class="button secondary" href="/login?next=%2Fhelp" data-route>Sign in to see your requests ${icon('arrow')}</a></div>`
      return
    }
    body.setAttribute('aria-busy', 'true')
    let items
    try { items = (await MM.helpRequests()).items || [] } catch (e) {
      body.removeAttribute('aria-busy')
      if (e.status === 404) { box.hidden = true; return }
      body.innerHTML = `<p class="prototype-tag" role="alert">${esc(e.message || 'We couldn’t load your requests just now. Please try again.')}</p>`
      return
    }
    if (!body.isConnected) return
    body.removeAttribute('aria-busy')
    const fresh = items.filter(unread).length
    body.innerHTML = items.length
      ? `${fresh ? `<p class="req-new" role="status"><span class="req-dot" aria-hidden="true"></span>${fresh === 1 ? 'We’ve replied to one of your requests.' : `We’ve replied to ${fresh} of your requests.`}</p>` : ''}<ul class="req-list">${items.map(row).join('')}</ul>`
      : '<p class="page-note">No requests yet. When you send us one, it shows here with our replies.</p>'
    if (location.hash === '#your-requests') box.scrollIntoView({ block: 'start' })
  }

  /** The Account page's link to them, with the dot when a reply is waiting (pages.js accountView calls it). */
  window.helpAccountLink = async function helpAccountLink(seq) {
    const slot = $('[data-help-link]', host())
    if (!slot || !MM.profile() || !(await helpOn())) return
    let items = null
    try { items = (await MM.helpRequests()).items || [] } catch { items = null }
    if (!alive(seq) || !slot.isConnected || items === null) return
    const fresh = items.filter(unread).length, open = items.filter((t) => t.status !== 'RESOLVED').length
    const note = fresh ? (fresh === 1 ? 'A new reply from us' : `${fresh} new replies from us`) : open ? `${open} open ${open === 1 ? 'request' : 'requests'}` : items.length ? 'Your requests and our replies' : 'Ask us anything. Our replies show here.'
    slot.innerHTML = `<h3>Help</h3><a class="help-way req-row${fresh ? ' is-unread' : ''}" href="/help#your-requests" data-route>${fresh ? '<span class="req-dot" aria-hidden="true"></span>' : icon('chat')}<span><strong>Your help requests</strong><small>${esc(note)}</small></span>${icon('arrow')}</a>`
    slot.hidden = false
  }

  // ---- One request: its messages and a reply box.

  function messageHTML(m) {
    const staff = STAFF(m.from)
    return `<li class="req-msg ${staff ? 'from-staff' : 'from-you'}"><div class="req-bubble"><p class="req-from"><strong>${staff ? 'VMR Mangoes' : 'You'}</strong> <time datetime="${esc(m.at)}">${esc(day(m.at))}</time></p><p class="req-text">${esc(m.body)}</p></div></li>`
  }

  function threadHTML(t) {
    const resolved = t.status === 'RESOLVED'
    return `<section class="page-card help-card req-head">
        <p class="req-meta"><span class="req-status is-${esc(String(t.status).toLowerCase())}">${esc(STATUS[t.status] || t.status)}</span> · ${esc(t.number || '')} · Sent ${esc(day(t.createdAt))}</p>
        <h2 class="flow-head">${esc(t.topicLabel || 'Help request')}</h2>
        ${t.order ? `<p>About order <a href="/orders/${encodeURIComponent(t.order.id)}" data-route>${esc(orderNo(t.order.number))}</a></p>` : ''}
      </section>
      <section class="page-card help-card">
        <h2 class="flow-head">Messages</h2>
        <ol class="req-thread" aria-label="Messages on this request">${(t.messages || []).map(messageHTML).join('')}</ol>
      </section>
      <section class="page-card help-card">
        <form id="req-reply" novalidate>
          <p class="prototype-tag req-error" role="alert" hidden></p>
          ${resolved ? '<p class="page-note">We marked this request resolved. Writing again opens it back up, and we’ll answer.</p>' : ''}
          <label class="field">Your reply<textarea name="message" rows="4" required maxlength="2000" placeholder="Write to us here."></textarea></label>
          <div class="help-actions"><button class="button primary" type="submit">Send reply ${icon('arrow')}</button><a class="button secondary" href="/help#your-requests" data-route>All your requests</a></div>
        </form>
      </section>`
  }

  async function threadView(id, quiet = false, seq = ++sheetSeq) {
    document.title = 'Your help request · VMR Mangoes'
    if (!quiet) host().innerHTML = head('Help request') + marker(seq) + '<p>Loading your request…</p>'
    let t
    try { t = await MM.helpThread(id) } catch (e) {
      if (!alive(seq) || quiet) return
      host().innerHTML = head('Help request') + marker(seq) + `<section class="page-card help-card"><p class="prototype-tag" role="alert">${esc(e.status === 404 ? 'We couldn’t find that request. It may belong to another account.' : e.message)}</p><div class="help-actions"><a class="button secondary" href="/help" data-route>Go to Help ${icon('arrow')}</a></div></section>`
      return
    }
    if (!alive(seq)) return
    const box = $('#req-reply', host())
    // a quiet check redraws only when something new arrived, and never under a reply being written
    if (quiet) {
      const typing = box && (box.message.value.trim() || document.activeElement === box.message)
      if (typing || JSON.stringify(t.messages) === host().dataset.reqSnap) return later()
    }
    host().dataset.reqSnap = JSON.stringify(t.messages)
    host().innerHTML = head(`Request ${esc(t.number || '')}`) + marker(seq) + threadHTML(t)
    markSeen(t)
    const f = $('#req-reply', host())
    f.addEventListener('submit', (e) => send(e, t, seq))
    later()
    function later() { setTimeout(() => alive(seq) && threadView(id, true, seq), 30000) }
  }

  async function send(e, t, seq) {
    e.preventDefault()
    const f = e.target, err = $('.req-error', f), btn = $('button[type=submit]', f)
    const message = f.message.value.trim()
    err.hidden = true
    if (!message) { err.textContent = 'Write your reply first.'; err.hidden = false; f.message.focus(); return }
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    btn.innerHTML = `${icon('clock')} Sending…`
    try {
      const next = await MM.helpReply(t.id, message)
      if (!alive(seq)) return
      host().dataset.reqSnap = JSON.stringify(next.messages)
      host().innerHTML = head(`Request ${esc(next.number || '')}`) + marker(seq) + threadHTML(next)
      markSeen(next)
      $('#req-reply', host()).addEventListener('submit', (ev) => send(ev, next, seq))
      toast('Reply sent. We’ll answer here and on WhatsApp.')
      $('.req-thread li:last-child', host())?.scrollIntoView({ block: 'nearest' })
    } catch (ex) {
      err.textContent = ex && ex.code === 'HELP_LIMIT' ? ex.message : ex && ex.status === 404 ? 'This request can’t take replies right now. Please message us another way.' : (ex && ex.message) || 'We couldn’t send that just now. Please try again.'
      err.hidden = false
      btn.disabled = false
      btn.removeAttribute('aria-busy')
      btn.innerHTML = `Send reply ${icon('arrow')}`
    }
  }
})()
