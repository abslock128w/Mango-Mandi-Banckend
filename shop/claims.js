/* Report a problem with a delivered order (a claim), on the order's page (pages.js trackView, #order-claim).
   The API (mango-api customer.js, claims): photos are uploaded first (POST /v1/claims/photos, a JPEG, PNG or WebP of
   2 MB at most, up to 3 per claim), then the claim (POST /v1/claims: the issue, the boxes, a description of 5 to 2000
   characters and the photo ids). Only within claimWindowHours of delivery, one open claim per order, and never once an
   order has been replaced. A claim ends in a replacement order or a rejection with the reason: never a refund.
   GET /v1/claims gives each claim's progress. Phone photos are made smaller here (at most 1600 px, JPEG) so they fit.
   Loaded after pages.js and before app.js. Styles: style.css (.claim-). */
(() => {
  const MAX_PHOTOS = 3, MAX_BYTES = 2 * 1024 * 1024, MIN_TEXT = 5, MAX_TEXT = 2000
  const ISSUES = [
    ['DAMAGED', 'Damaged or spoiled', 'Bruised, crushed, rotten or leaking mangoes.'],
    ['WRONG_ITEM', 'Wrong mangoes', 'A different variety, ripeness or size from what you ordered.'],
    ['NOT_DELIVERED', 'Something is missing', 'A box, or mangoes from a box, didn’t arrive.'],
  ]
  const ISSUE_WORD = Object.fromEntries(ISSUES.map(([k, w]) => [k, w]))
  const day = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
  const fail = (code) => Object.assign(new Error(code), { code })
  let photos = [] // { blob, url } for the form on screen
  const CAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'

  /** Each error the API can give, said for a customer. */
  function claimError(e, o) {
    const h = hoursWord(Number(o.claimWindowHours) || 24)
    switch (e && e.code) {
      case 'CLAIM_WINDOW_CLOSED': return `Problems can be reported only within ${h} of delivery, and that time has passed for this order. Message us and we’ll help.`
      case 'NOT_DELIVERED': return 'You can report a problem once this order has been delivered.'
      case 'CONFLICT': return 'You’ve already reported a problem with this order. We’re looking at it and will update you here.'
      case 'ALREADY_REPLACED': return 'We already replaced this order. If something is wrong with the replacement, report it on the replacement order.'
      case 'CLAIM_LIMIT': return 'You’ve reported several problems this month, so please message us on WhatsApp and we’ll sort it out with you.'
      case 'INVALID_SKU': return 'One of the boxes you chose isn’t in this order. Reload the page and choose again.'
      case 'PHOTO_NOT_FOUND': return 'One of your photos didn’t upload properly. Remove it and add it again.'
      case 'PAYLOAD_TOO_LARGE': return 'That photo is too large to send (2 MB at most). Try another photo.'
      case 'PHOTO_INVALID': case 'PHOTO_REQUIRED': return 'That file isn’t a photo we can use. Add a JPEG, PNG or WebP picture.'
      case 'TOO_MANY_PHOTOS': return 'Some photos you added earlier haven’t been sent yet. Send this report, or reload the page and try again.'
      case 'VALIDATION_ERROR': return `Check your report: tell us what happened in ${MIN_TEXT} characters or more, and add at most ${MAX_PHOTOS} photos.`
      case 'NOT_FOUND': return 'We couldn’t find this order on your account. Reload the page and try again.'
      case 'UNAUTHORIZED': return 'Please sign in again to send your report.'
      default: return (e && e.message) || 'We couldn’t send your report just now. Please try again.'
    }
  }

  /** A photo made small enough to send: at most 1600 px on its longer side, as a JPEG under 2 MB. */
  async function shrink(file) {
    const fits = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= MAX_BYTES * 0.75
    if (fits) return file
    if (file.type && !file.type.startsWith('image/')) throw fail('PHOTO_INVALID')
    let bmp
    try { bmp = await createImageBitmap(file) } catch { throw fail('PHOTO_INVALID') }
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close?.()
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q))
      if (blob && blob.size <= MAX_BYTES) return blob
    }
    throw fail('PAYLOAD_TOO_LARGE')
  }

  function boxesOf(o) {
    const m = new Map()
    for (const l of o.items || []) {
      const b = m.get(l.sku) || { sku: l.sku, name: boxName(l.name, l.sku), qty: 0 }
      b.qty += Number(l.quantity) || 0
      m.set(l.sku, b)
    }
    return [...m.values()]
  }

  const within = (o) => !o.claimUntil || Date.now() < Date.parse(o.claimUntil)
  const reachUs = (o) => `${helpLink('Message us', `Hi VMR Mangoes, about my order ${orderNo(o.number)}`)} or send a request from <a href="/help" data-route>Help</a>.`

  function statusHTML(c) {
    const sent = `<small>Reported ${esc(day(c.createdAt))}${c.issueType ? ` · ${esc(ISSUE_WORD[c.issueType] || c.issueType)}` : ''}</small>`
    if (c.status === 'RESOLVED' && c.resolution === 'REPLACEMENT_APPROVED') {
      return `<div class="claim-status is-approved" role="status">${icon('check')}<div><strong>Replacement approved</strong><p>${c.replacementOrder ? `We’re sending you a replacement: order <a href="/orders/${encodeURIComponent(c.replacementOrder.id)}" data-route>${esc(orderNo(c.replacementOrder.number))}</a>.` : 'We’re sending you a replacement and will message you about its delivery.'}</p>${sent}</div></div>`
    }
    if (c.status === 'RESOLVED' && c.resolution === 'REJECTED') {
      return `<div class="claim-status is-rejected" role="status">${icon('info')}<div><strong>We couldn’t approve this report</strong>${c.rejectionReason ? `<p>Reason: ${esc(c.rejectionReason)}</p>` : ''}${sent}</div></div>`
    }
    if (c.status === 'UNDER_REVIEW') return `<div class="claim-status is-review" role="status">${icon('clock')}<div><strong>Under review</strong><p>We’re looking at your report now and will update you here.</p>${sent}</div></div>`
    return `<div class="claim-status is-sent" role="status">${icon('check')}<div><strong>Report sent</strong><p>We’ve got your report and will look at it soon. Its progress shows here.</p>${sent}</div></div>`
  }

  function formHTML(o) {
    const boxes = boxesOf(o), one = boxes.length === 1
    return `<form id="claim-form" class="claim-form" novalidate>
      <p class="prototype-tag claim-error" role="alert" tabindex="-1" hidden></p>
      <fieldset class="claim-set"><legend>What went wrong?</legend>
        ${ISSUES.map(([k, w, d], i) => `<label class="claim-choice"><input type="radio" name="issueType" value="${k}"${i === 0 ? ' checked' : ''}><span><strong>${w}</strong><small>${d}</small></span></label>`).join('')}
      </fieldset>
      <fieldset class="claim-set"><legend>Which ${one ? 'box' : 'boxes'}?</legend>
        ${boxes.map((b) => `<label class="claim-choice"><input type="checkbox" name="sku" value="${esc(b.sku)}"${one ? ' checked' : ''}><span><strong>${esc(b.name)}</strong><small>${b.qty} ${b.qty === 1 ? 'box' : 'boxes'}</small></span></label>`).join('')}
      </fieldset>
      <label class="field">Tell us what happened<textarea name="description" rows="4" required minlength="${MIN_TEXT}" maxlength="${MAX_TEXT}" placeholder="For example: two mangoes in the Alphonso box were crushed."></textarea></label>
      <div class="claim-photos">
        <p class="claim-photo-head" id="claim-photo-note"><strong>Photos</strong> <small>Up to ${MAX_PHOTOS}. They help us decide quickly.</small></p>
        <ul class="claim-thumbs" aria-label="Photos added"></ul>
        <label class="button secondary claim-add">${CAMERA}<span>Add a photo</span><input type="file" name="photo" accept="image/*" multiple class="sr-only" aria-describedby="claim-photo-note"></label>
        <p class="claim-full" hidden>${icon('info')}<span>You’ve added ${MAX_PHOTOS} photos, the most one report takes. Remove one to add another.</span></p>
      </div>
      <p class="page-note">If we approve your report we send a replacement. Problems are put right with a replacement, not a refund.</p>
      <div class="help-actions"><button class="button primary" type="submit">Send report ${icon('arrow')}</button><button class="button secondary" type="button" data-claim-cancel>Cancel</button></div>
    </form>`
  }

  function paintPhotos(f) {
    const list = $('.claim-thumbs', f), add = $('.claim-add', f), input = $('input[type=file]', f), full = photos.length >= MAX_PHOTOS
    list.innerHTML = photos.map((p, i) => `<li><img src="${p.url}" alt="Photo ${i + 1}"><button class="icon-button claim-drop" type="button" data-claim-drop="${i}" aria-label="Remove photo ${i + 1}">${icon('close')}</button></li>`).join('')
    input.disabled = full
    add.classList.toggle('is-disabled', full)
    add.setAttribute('aria-disabled', String(full))
    add.hidden = full
    $('.claim-full', f).hidden = !full
  }

  function showError(f, text) {
    const err = $('.claim-error', f)
    err.textContent = text
    err.hidden = false
    err.focus()
  }

  /** The claim box on a delivered order's page. */
  window.orderClaimBox = async function orderClaimBox(o, seq) {
    const card = $('#order-claim', host())
    if (!card) return
    const body = $('.claim-body', card)
    let claims = []
    try { claims = (await MM.claims()) || [] } catch { claims = [] }
    if (!alive(seq) || !card.isConnected) return
    card.removeAttribute('aria-busy')
    const mine = claims.filter((c) => c.orderId === o.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    const last = mine[0], open = last && last.status !== 'RESOLVED', replaced = mine.some((c) => c.resolution === 'REPLACEMENT_APPROVED')
    const canReport = within(o) && !open && !replaced
    const until = o.claimUntil ? day(o.claimUntil) : ''
    const h = hoursWord(Number(o.claimWindowHours) || 24)
    $('h3', card).textContent = last ? 'Your problem report' : 'Something wrong with your box?'
    let html = mine.map(statusHTML).join('')
    if (canReport) {
      html += `<p>${last ? 'Something else wrong?' : 'Damaged, wrong or missing mangoes?'} Tell us within ${h} of delivery${until ? ` (until ${esc(until)})` : ''} and we’ll put it right.</p><div class="help-actions"><button class="button secondary" type="button" data-claim-open>${icon('info')} ${last ? 'Report another problem' : 'Report a problem with this order'}</button></div><div class="claim-form-slot"></div>`
    } else if (!open && !replaced && !within(o)) {
      html += `<p class="claim-closed">${icon('clock')}<span>Problems with this order could be reported until ${esc(until)}, ${h} after delivery, so that window has closed. If something is still wrong, ${reachUs(o)}</span></p>`
    } else if (last && last.resolution === 'REJECTED') {
      html += `<p>If you think we got this wrong, ${reachUs(o)}</p>`
    }
    body.innerHTML = html
    const opener = $('[data-claim-open]', card)
    if (opener) opener.addEventListener('click', () => openForm(o, seq, card, opener))
  }

  function openForm(o, seq, card, opener) {
    const slot = $('.claim-form-slot', card)
    photos.forEach((p) => URL.revokeObjectURL(p.url))
    photos = []
    slot.innerHTML = formHTML(o)
    opener.parentElement.hidden = true
    const f = $('#claim-form', card)
    paintPhotos(f)
    $('input[name=issueType]', f).focus()
    $('[data-claim-cancel]', f).addEventListener('click', () => { slot.innerHTML = ''; opener.parentElement.hidden = false; opener.focus() })
    f.addEventListener('click', (e) => {
      const drop = e.target.closest('[data-claim-drop]')
      if (!drop) return
      const [gone] = photos.splice(Number(drop.dataset.claimDrop), 1)
      if (gone) URL.revokeObjectURL(gone.url)
      paintPhotos(f)
      ;($('.claim-add input', f).disabled ? $('textarea', f) : $('.claim-add input', f)).focus()
    })
    $('input[type=file]', f).addEventListener('change', async (e) => {
      const files = [...e.target.files]
      e.target.value = ''
      $('.claim-error', f).hidden = true
      for (const file of files) {
        if (photos.length >= MAX_PHOTOS) { showError(f, `A report takes up to ${MAX_PHOTOS} photos, so only the first ones were added.`); break }
        try { const blob = await shrink(file); photos.push({ blob, url: URL.createObjectURL(blob) }) } catch (ex) { showError(f, claimError(ex, o)) }
      }
      if (alive(seq) && f.isConnected) paintPhotos(f)
    })
    f.addEventListener('submit', (e) => submit(e, o, seq))
  }

  async function submit(e, o, seq) {
    e.preventDefault()
    const f = e.target, btn = $('button[type=submit]', f)
    if (btn.disabled) return
    $('.claim-error', f).hidden = true
    const issueType = (f.querySelector('input[name=issueType]:checked') || {}).value
    const itemSkus = [...f.querySelectorAll('input[name=sku]:checked')].map((x) => x.value)
    const description = f.description.value.trim()
    if (!issueType) return showError(f, 'Choose what went wrong.')
    if (!itemSkus.length) return showError(f, 'Choose the box or boxes with the problem.')
    if (description.length < MIN_TEXT) { showError(f, `Tell us a little more about what happened (${MIN_TEXT} characters or more).`); return }
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    btn.innerHTML = `${icon('clock')} Sending your report…`
    try {
      const photoIds = []
      for (const p of photos) photoIds.push((await MM.claimPhoto(p.blob)).id)
      await MM.fileClaim({ orderId: o.id, issueType, description, itemSkus, photoIds })
      photos.forEach((p) => URL.revokeObjectURL(p.url))
      photos = []
      if (!alive(seq)) return
      toast('Report sent. We’ll look at it soon.')
      await window.orderClaimBox(o, seq)
      $('#order-claim .claim-status', host())?.focus?.()
    } catch (ex) {
      if (!f.isConnected) return
      btn.disabled = false
      btn.removeAttribute('aria-busy')
      btn.innerHTML = `Send report ${icon('arrow')}`
      showError(f, claimError(ex, o))
    }
  }
})()
