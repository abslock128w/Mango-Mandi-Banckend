/* The review pop-up. When a signed-in customer opens the shop and their latest delivered order
   has no rating yet, it asks how the packaging, the condition on arrival and the sweetness were
   (1 to 5 each) with an optional note, and saves it with PUT /v1/orders/:id/rating. It asks once
   per order: closing it or "Not now" remembers the order in localStorage (mm-review-skip), and the
   order page keeps a "Rate this order" button. Loaded after app.js, whose helpers it uses. */
(() => {
  const SKIP = 'mm-review-skip'
  // Only orders delivered in the last 30 days are asked about.
  const RECENT_MS = 30 * 86_400_000
  const ASPECTS = [
    ['packaging', 'Packaging', 'How the box was packed'],
    ['condition', 'Condition', 'How the mangoes arrived'],
    ['sweetness', 'Sweetness', 'How they tasted'],
  ]
  const dialog = $('#review-dialog')
  let current = null
  let sent = false

  const stars = ([key, label, hint], value) => `<fieldset class="stars-field"><legend>${label} <small>${hint}</small></legend><div class="stars" data-stars="${key}">${[1, 2, 3, 4, 5]
    .map((n) => `<label class="${value >= n ? 'on' : ''}"><input type="radio" name="${key}" value="${n}" ${value === n ? 'checked' : ''}><span aria-hidden="true">★</span><span class="stars-label">${n} out of 5</span></label>`)
    .join('')}</div></fieldset>`

  function open(order, rating = null) {
    const r = rating || {}
    dialog.innerHTML = `<div class="sheet-head"><div><span class="sheet-kicker">Order ${esc(orderNo(order.number))}${order.deliveredAt ? ` · delivered ${esc(fmtDate(String(order.deliveredAt).slice(0, 10)))}` : ''}</span><h2>How were your mangoes?</h2></div><button class="icon-button" data-review-skip aria-label="Not now">${icon('close')}</button></div>
      <form id="review-form" novalidate>
        ${ASPECTS.map((a) => stars(a, r[a[0]] || 0)).join('')}
        <label class="field wide">Anything you’d like to tell us? (optional)<textarea name="comment" rows="3" maxlength="500" placeholder="What was great, or what we should fix">${esc(r.comment || '')}</textarea></label>
        <p class="prototype-tag" id="review-error" role="alert" hidden></p>
        <button class="button primary full" type="submit">${rating ? 'Update review' : 'Send review'} ${icon('arrow')}</button>
        <button class="text-button review-skip" type="button" data-review-skip>Not now</button>
      </form>`
    openDialog('#review-dialog')
    // Set after openDialog: it closes any open sheet first, which must not count as skipping this order.
    current = order
    sent = false
  }

  // "Not now", the close button, Escape and a tap outside all mean: don't ask about this order again.
  dialog.addEventListener('close', () => {
    if (current && !sent) save(SKIP, [...new Set([...read(SKIP, []), current.id])].slice(-50))
    current = null
  })
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-review-skip]')) closeDialogs()
  })
  dialog.addEventListener('change', (e) => {
    const box = e.target.closest('.stars')
    if (!box) return
    const value = Number(e.target.value)
    $$('label', box).forEach((l, i) => l.classList.toggle('on', i < value))
    $('#review-error', dialog).hidden = true
  })
  dialog.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const data = new FormData(form)
    const body = {}
    for (const [key] of ASPECTS) if (data.get(key)) body[key] = Number(data.get(key))
    const error = $('#review-error', dialog)
    if (!Object.keys(body).length) {
      error.textContent = 'Tap the stars to rate at least one of the three.'
      error.hidden = false
      return
    }
    const comment = String(data.get('comment') || '').trim()
    if (comment) body.comment = comment
    const button = $('button[type=submit]', form)
    button.disabled = true
    try {
      await MM.rateOrder(current.id, body)
      sent = true
      closeDialogs()
      toast('Thank you. Your review is in.')
      window.dispatchEvent(new CustomEvent('mm:reviewed'))
    } catch (err) {
      error.textContent = err.message
      error.hidden = false
      button.disabled = false
    }
  })

  // The order page's "Rate this order" button (pages.js): the same form, with the earlier answers filled in.
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-review]')
    if (!b) return
    try {
      const o = await MM.order(b.dataset.review)
      open({ id: o.id, number: o.number, deliveredAt: o.delivery && o.delivery.at }, o.rating)
    } catch (err) {
      toast(err.message)
    }
  })

  /** On opening the shop: the newest delivered order with no rating, unless it was already asked about. */
  async function offer() {
    const busy = () => /^\/(checkout|login)\b/.test(location.pathname)
    if (!MM.profile() || busy()) return
    try {
      if (!(await MM.restore())) return
      const skipped = read(SKIP, [])
      const order = (await MM.orders()).find((o) => o.status === 'DELIVERED' && o.rated === false && !skipped.includes(o.id) && (!o.deliveredAt || Date.now() - Date.parse(o.deliveredAt) < RECENT_MS))
      // Never on top of another sheet (the delivery area, the bag) or once checkout has begun.
      if (!order || $('dialog[open]') || busy()) return
      open(order)
    } catch {
      // Offline or signed out: ask next time.
    }
  }
  window.addEventListener('load', () => setTimeout(offer, 1200))
})()
