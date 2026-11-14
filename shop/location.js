/* Where to deliver, chosen up front: the "Deliver to" chip in the shop bar and its sheet.
   The customer picks an area (current location, the map, a saved address or a pincode); the shop then
   shows that area's stock and delivery days. Only the area is asked here: the full address (flat,
   building) is asked at checkout, which starts from what was chosen (pincode, pin, saved address).
   First-time visitors get the sheet once, offering their current location.
   Kept in `where` (app.js, localStorage mm-where) beside the pincode check: area, lat/lng, savedId, street.
   Loaded before app.js, so top-level code only declares and listens. */

let wherePick = null // the last spot the sheet's map was moved to
let whereBusy = false
/** A saved address's short name: its own name, or its first two parts ("Flat 4B, Sunrise Apartments"). */
const shortAddress = (a) => a.name || addressText(a.address).split(',').slice(0, 2).join(',').trim()

const beforeSeason = () => typeof preSeason === 'function' && Boolean(preSeason())

function whereLabel() {
  if (!where.pincode) return 'Choose your location'
  // Before the season there is no delivery day to show: a pre-order is delivered in its harvest week.
  const day = where.deliveryDate && !beforeSeason() ? ` · ${fmtDate(where.deliveryDate)}` : ''
  return (where.area ? `${where.area} · ${where.pincode}` : `Pincode ${where.pincode}`) + day
}

function renderWhereChip() {
  const el = $('#where-label')
  if (el) el.textContent = whereLabel()
  $$('.where-chip').forEach((b) => b.classList.toggle('is-set', Boolean(where.pincode)))
  if (typeof renderCartPage === 'function') renderCartPage() // the bag page's delivery card
}

/** Checks the pincode, keeps what was chosen, reloads stock and closes the sheet. */
async function setWhere(pin, { area = null, lat = null, lng = null, savedId = null, street = null } = {}) {
  const c = await MM.deliveryCheck(pin)
  if (!c.serviceable) throw new Error(`We don’t deliver to ${pin} yet. Try another area or pincode.`)
  applyCheck(pin, c)
  Object.assign(where, { area, lat, lng, savedId, street })
  save('mm-where', where)
  loadStock()
  renderWhereChip()
  closeDialogs()
  toast(`Delivering to ${area ? `${area}, ` : ''}${pin}`)
}

async function whereSheet({ first = false } = {}) {
  const saved = MM.profile() ? await MM.addresses().catch(() => []) : []
  const d = $('#where-dialog')
  d.innerHTML = `${formHeader('Where should we deliver?')}
    <p class="where-intro">${beforeSeason() ? 'We’ll check that we deliver to your area. You’ll add the flat and building when you pre-order.' : 'We’ll show what’s in stock and the delivery days for your area. You’ll add the flat and building at checkout.'}</p>
    ${where.pincode && (where.deliveryDates || []).length && !beforeSeason() ? `<div class="field">Delivery day for ${esc(where.pincode)}</div><div class="date-cards where-days" role="group" aria-label="Delivery day">${where.deliveryDates.map((x) => { const dt = new Date(x + 'T00:00:00'); return `<button type="button" class="date-card" data-pick-date="${esc(x)}" aria-pressed="${x === where.deliveryDate}" aria-label="${esc(fmtDate(x))}"><small>${esc(dt.toLocaleDateString('en-IN', { weekday: 'short' }))}</small><strong>${dt.getDate()}</strong><small>${esc(dt.toLocaleDateString('en-IN', { month: 'short' }))}</small></button>` }).join('')}</div><p class="where-days-note">Stock changes by the day as the mangoes ripen. Pick a later day to see what’s coming.</p>` : ''}
    <button class="button primary full" data-where-locate>${icon('pin')} Use my current location</button>
    <p class="where-error prototype-tag" role="alert" hidden></p>
    ${saved.length ? `<div class="field">Your saved addresses</div><div class="address-cards">${saved.map((a) => `<button type="button" class="address-card" data-where-saved="${esc(a.id)}" aria-pressed="${a.id === where.savedId}"><strong>${esc(shortAddress(a))}</strong><small>${esc(addressText(a.address))} <span class="no-wrap">· ${esc(a.pincode)}</span></small></button>`).join('')}</div>` : ''}
    <div class="field">Or find it on the map</div>
    <div id="where-map-slot" class="map-slot"></div>
    <button class="button secondary full" data-where-map disabled>${icon('pin')}<span>Move the map to choose a spot</span></button>
    <form id="where-pin" class="where-pin" novalidate><label class="field">Or enter your pincode<input name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" placeholder="6-digit pincode" value="${esc(where.pincode || '')}"></label><button class="button secondary" type="submit">Check</button></form>
    ${first ? '<button class="text-button where-skip" data-close>Just browsing for now</button>' : ''}`
  if (!d.open) openDialog('#where-dialog')
  const center = where.lat ? { lat: where.lat, lng: where.lng } : null
  wherePick = null
  MapPick.mount($('#where-map-slot', d), {
    center,
    pick: (g) => {
      wherePick = g
      const b = $('[data-where-map]', d)
      if (b) {
        b.disabled = !/^[1-9]\d{5}$/.test(g.pincode || '')
        b.innerHTML = b.disabled ? `${icon('info')}<span>We couldn’t find a pincode here</span>` : `${icon('pin')}<span>Deliver to ${esc(g.area || 'the pin')} · ${esc(g.pincode)}</span>`
      }
    },
  }).catch(() => {})
}

function whereError(msg) {
  const p = $('#where-dialog .where-error')
  if (!p) return toast(msg)
  p.textContent = msg
  p.hidden = !msg
}

async function whereDo(fn) {
  if (whereBusy) return
  whereBusy = true
  whereError('')
  try {
    await fn()
  } catch (e) {
    whereError(e.code === 1 ? 'Location is turned off for this site. Allow it in your browser, or use the map or a pincode.' : e.message || 'Something went wrong. Try again.')
  } finally {
    whereBusy = false
  }
}

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (!b) return
  if (b.hasAttribute('data-where-open')) whereSheet()
  else if (b.hasAttribute('data-where-locate')) {
    whereDo(async () => {
      if (!navigator.geolocation) throw new Error('This browser can’t share your location. Use the map or a pincode.')
      b.disabled = true
      b.innerHTML = `${icon('pin')} Finding you…`
      try {
        const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }))
        const { latitude: lat, longitude: lng } = pos.coords
        window.MapPick?.moveTo(lat, lng, 17, { pick: false, accuracy: pos.coords.accuracy < 2000 ? pos.coords.accuracy : null })
        const g = await reverseGeocode(lat, lng)
        if (!/^[1-9]\d{5}$/.test(g.pincode)) throw new Error('We found you, but not your pincode. Move the map or type it below.')
        await setWhere(g.pincode, { area: g.area, lat, lng, street: g.address })
      } finally {
        b.disabled = false
        b.innerHTML = `${icon('pin')} Use my current location`
      }
    })
  } else if (b.hasAttribute('data-where-map')) {
    const g = wherePick
    if (g) whereDo(() => setWhere(g.pincode, { area: g.area, lat: g.lat, lng: g.lng, street: g.address }))
  } else if (b.dataset.whereSaved) {
    whereDo(async () => {
      const a = (await MM.addresses()).find((x) => x.id === b.dataset.whereSaved)
      if (!a) throw new Error('That address is no longer saved.')
      const pin = addressPin(a.address)
      await setWhere(a.pincode, { area: shortAddress(a), lat: pin?.lat ?? null, lng: pin?.lng ?? null, savedId: a.id })
    })
  }
})

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'where-pin') return
  e.preventDefault()
  const pin = String(new FormData(e.target).get('pin') || '').trim()
  if (!checkFields(e.target, [['pin', (v) => /^[1-9]\d{5}$/.test(v) ? '' : 'Enter a 6-digit pincode.']])) return
  whereDo(() => setWhere(pin))
})

// First visit: once, a moment after the page settles, offer the sheet (only on the home page).
function offerWhereOnce() {
  renderWhereChip()
  let asked = false
  try {
    asked = localStorage.getItem('mm-where-asked') === '1'
    localStorage.setItem('mm-where-asked', '1')
  } catch {}
  if (asked || where.pincode) return
  // On a phone the home-screen sheet (install.js) comes first; the delivery question follows once it closes.
  setTimeout(() => {
    const ask = () => { if (!pageOpen() && !$('dialog[open]') && !where.pincode) whereSheet({ first: true }) }
    const install = $('#install-dialog[open]')
    if (install) install.addEventListener('close', () => setTimeout(ask, 500), { once: true })
    else ask()
  }, 1600)
}
