/* The delivery map at checkout (and the read-only map on the order page).
   The pin is fixed in the middle: the customer moves the map until it sits on their door, then the spot is turned into
   an address and pincode. Search finds a building, society or street.

   Two map services, one picker:
   - Google Maps, when the build has a key (GOOGLE_MAPS_KEY → MM_CONFIG.googleMapsKey, written by build-config.mjs).
     The map, the address of a spot (Geocoding) and the search suggestions (Places, as you type) all come from Google.
     The key needs three APIs switched on in Google Cloud: Maps JavaScript API, Geocoding API and Places API (New), and
     should be restricted to the shop's own addresses (HTTP referrers). vercel.json's Content-Security-Policy allows
     Google's hosts for this.
   - Leaflet (assets/leaflet) with OpenStreetMap tiles and Nominatim, when there is no key, or if Google does not load
     or refuses the key: the shop keeps working. Nominatim's usage policy does not allow search-as-you-type, so there
     the search runs on Enter or the Search button only.

   The picker is one element kept for the whole visit and moved into each re-render's
   #co-map-slot, so the map, the zoom and the search survive app.js redrawing the checkout.
   window.MapPick = { mount, moveTo, readOnly, hasGoogle, reverse, findPincode } */
const MapPick = (() => {
  const BENGALURU = [12.9716, 77.5946]
  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  let box = null, map = null, onPick = null, skipNext = false, timer = 0, ring = null, lastAt = 0

  // ---- Google Maps (only with a key)
  const GKEY = String((window.MM_CONFIG || {}).googleMapsKey || '').trim()
  let gFailed = false, gLoad = null, gLibs = null, gToken = null, typing = 0
  /** Whether Google is the map service right now (a key is set and it has not failed to load). */
  const hasGoogle = () => Boolean(GKEY) && !gFailed
  /** Loads Google Maps once; rejects (and switches the shop back to OpenStreetMap) if it cannot. */
  function loadGoogle() {
    if (!hasGoogle()) return Promise.reject(new Error('no-google'))
    gLoad ??= new Promise((ok, no) => {
      const fail = (why) => { gFailed = true; no(new Error(why)) }
      // Google calls this when the key is refused (wrong key, API not enabled, this address not allowed).
      window.gm_authFailure = () => { gFailed = true; if (box) hint('The map could not load. Type your address below.') }
      window.__mmGoogleMaps = () => ok()
      const sc = document.createElement('script')
      sc.async = true
      sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GKEY)}&v=weekly&loading=async&libraries=places,geocoding&language=en&region=IN&callback=__mmGoogleMaps`
      sc.onerror = () => fail('google-load')
      document.head.append(sc)
      setTimeout(() => { if (!(window.google && google.maps)) fail('google-timeout') }, 12000)
    }).then(async () => {
      const [maps, geocoding, places] = await Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('geocoding'), google.maps.importLibrary('places').catch(() => null)])
      gLibs = { Map: maps.Map, geocoder: new geocoding.Geocoder(), places }
      return gLibs
    }).catch((e) => { gFailed = true; throw e })
    return gLoad
  }
  const gPart = (r, ...types) => (r.address_components || []).find((c) => types.some((t) => c.types.includes(t)))?.long_name || ''
  /** A spot → { pincode, area, address } from Google's Geocoding (the same shape app.js gets from Nominatim). */
  async function reverse(lat, lng) {
    const { geocoder } = await loadGoogle()
    const { results } = await geocoder.geocode({ location: { lat, lng } })
    if (!results || !results.length) return { pincode: '', area: null, address: '' }
    // the most exact result that is a real address, not just a plus code
    const best = results.find((r) => !r.types.includes('plus_code')) || results[0]
    const pincode = (gPart(best, 'postal_code') || results.map((r) => gPart(r, 'postal_code')).find(Boolean) || '').replace(/\s/g, '')
    const parts = [gPart(best, 'premise', 'subpremise', 'establishment', 'point_of_interest'), [gPart(best, 'street_number'), gPart(best, 'route')].filter(Boolean).join(' '), gPart(best, 'neighborhood', 'sublocality_level_3'), gPart(best, 'sublocality_level_2'), gPart(best, 'sublocality_level_1', 'sublocality'), gPart(best, 'locality', 'administrative_area_level_3')].filter(Boolean)
    const area = gPart(best, 'sublocality_level_1', 'sublocality') || gPart(best, 'neighborhood', 'sublocality_level_2') || gPart(best, 'locality') || null
    const address = [...new Set(parts)].join(', ') || String(best.formatted_address || '').replace(/,?\s*India$/, '').replace(/\s*\b\d{6}\b/, '').replace(/,\s*$/, '')
    return { pincode, area, address }
  }
  /** Where a pincode is, as { lat, lng }, or null: Google when it is on, OpenStreetMap otherwise. */
  async function findPincode(pin) {
    if (hasGoogle()) {
      try {
        const { geocoder } = await loadGoogle()
        const { results } = await geocoder.geocode({ componentRestrictions: { postalCode: String(pin), country: 'IN' } })
        const at = results && results[0] && results[0].geometry && results[0].geometry.location
        if (at) return { lat: at.lat(), lng: at.lng() }
      } catch { /* fall through to OpenStreetMap */ }
    }
    const f = await nominatim(`search?format=jsonv2&countrycodes=in&postalcode=${encodeURIComponent(pin)}&limit=1`)
    return f[0] ? { lat: Number(f[0].lat), lng: Number(f[0].lon) } : null
  }
  /** Search suggestions from Google Places (New): [{ title, detail, place }] near the map's centre, in India. */
  async function googleSuggest(q, near) {
    const { places, geocoder } = await loadGoogle()
    if (places && places.AutocompleteSuggestion) {
      gToken ??= new places.AutocompleteSessionToken()
      const base = { input: q, sessionToken: gToken, language: 'en-IN', region: 'in' }
      const ask = (req) => places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req)
      let res
      try { res = await ask({ ...base, includedRegionCodes: ['in'], locationBias: { center: near, radius: 30000 } }) }
      catch { try { res = await ask(base) } catch { res = null } }
      if (res) return (res.suggestions || []).filter((x) => x.placePrediction).slice(0, 6).map((x) => { const pp = x.placePrediction, text = pp.text ? pp.text.toString() : '', main = pp.mainText ? pp.mainText.toString() : text.split(',')[0]; return { title: main, detail: text, place: pp } })
    }
    // Places is not available for this key: the Geocoding API can still find an address
    const { results } = await geocoder.geocode({ address: q, componentRestrictions: { country: 'IN' } })
    return (results || []).slice(0, 6).map((r) => ({ title: String(r.formatted_address || '').split(',')[0], detail: r.formatted_address, lat: r.geometry.location.lat(), lng: r.geometry.location.lng() }))
  }
  /** The chosen suggestion → { lat, lng } (this also ends the search session Google bills by). */
  async function googlePlace(s) {
    if (s.lat != null) return { lat: s.lat, lng: s.lng }
    const place = s.place.toPlace()
    await place.fetchFields({ fields: ['location'] })
    gToken = null
    return place.location ? { lat: place.location.lat(), lng: place.location.lng() } : null
  }

  function loadLeaflet() {
    if (!document.querySelector('link[href="assets/leaflet/leaflet.css"]')) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = 'assets/leaflet/leaflet.css'
      document.head.append(l)
    }
    return loadScript('assets/leaflet/leaflet.js')
  }

  // Nominatim asks for at most one request a second.
  async function nominatim(path) {
    const wait = 1100 - (Date.now() - lastAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastAt = Date.now()
    const r = await fetch(`https://nominatim.openstreetmap.org/${path}`, { headers: { 'Accept-Language': 'en-IN' } })
    if (!r.ok) throw new Error('lookup')
    return r.json()
  }

  function build() {
    box = document.createElement('div')
    box.className = 'map-picker'
    box.innerHTML = `<form class="map-search liquid" role="search">${icon('search')}<input name="map-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Building, society or street" aria-label="Search for your building or street"><button type="submit" class="map-search-go">Search</button></form>
      <div class="map-results" hidden></div>
      <div class="map-frame"><div class="map-canvas"></div><span class="map-pin" aria-hidden="true">${icon('pin')}</span><span class="map-pin-shadow" aria-hidden="true"></span></div>
      <p class="map-hint" aria-live="polite">Move the map so the pin sits on your door.</p>`
    box.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault()
      search(box.querySelector('input').value)
    })
    box.querySelector('.map-results').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lat],[data-g]')
      if (!b) return
      box.querySelector('.map-results').hidden = true
      if (b.dataset.g != null) {
        const s = found[Number(b.dataset.g)]
        try { const at = s && await googlePlace(s); if (at) moveTo(at.lat, at.lng, 18); else hint('We couldn’t find that place. Move the map yourself.') }
        catch { hint('We couldn’t find that place. Move the map yourself.') }
        return
      }
      moveTo(Number(b.dataset.lat), Number(b.dataset.lng), 18)
    })
    // With Google, suggestions come as you type (it allows that; OpenStreetMap's search does not).
    box.querySelector('input').addEventListener('input', (e) => {
      if (!hasGoogle()) return
      clearTimeout(typing)
      const q = e.target.value.trim()
      if (q.length < 3) { box.querySelector('.map-results').hidden = true; return }
      typing = setTimeout(() => search(q, true), 280)
    })
  }
  let found = [] // Google's suggestions for the list on screen

  /** Puts the picker into `slot` (creating the map once). `pick` gets {lat, lng, address, pincode}. */
  async function mount(slot, { center, pick } = {}) {
    onPick = pick
    if (!box) build()
    slot.append(box)
    if (!map && hasGoogle()) {
      try {
        const { Map } = await loadGoogle()
        if (!box.isConnected) return
        if (!map) {
          const g = new Map(box.querySelector('.map-canvas'), { center: center ? { lat: center.lat, lng: center.lng } : { lat: BENGALURU[0], lng: BENGALURU[1] }, zoom: center ? 18 : 12, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false })
          const start = () => box.classList.add('is-moving')
          g.addListener('dragstart', start)
          g.addListener('zoom_changed', start)
          g.addListener('idle', () => {
            box.classList.remove('is-moving')
            if (skipNext) { skipNext = false; return }
            clearTimeout(timer)
            timer = setTimeout(lookup, 650)
          })
          skipNext = true
          // one face for both services, so the rest of this file does not care which map it is
          map = {
            google: g,
            getCenter: () => { const c = g.getCenter(); return { lat: c.lat(), lng: c.lng() } },
            setView: ([la, ln], z) => { g.setCenter({ lat: la, lng: ln }); g.setZoom(z) },
            invalidateSize: () => google.maps.event.trigger(g, 'resize'),
            circle: (la, ln, r) => { const c = new google.maps.Circle({ map: g, center: { lat: la, lng: ln }, radius: r, strokeColor: '#d9a21b', strokeWeight: 1, fillColor: '#d9a21b', fillOpacity: 0.08, clickable: false }); return { remove: () => c.setMap(null) } },
          }
          box.classList.add('is-google')
        }
        return
      } catch { /* Google did not load: the OpenStreetMap map below takes over */ }
    }
    if (map) { map.invalidateSize(); return }
    await loadLeaflet()
    if (!box.isConnected) return
    if (!map) {
      map = L.map(box.querySelector('.map-canvas'), { zoomControl: false, attributionControl: true })
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map)
      L.control.zoom({ position: 'bottomright' }).addTo(map)
      map.attributionControl.setPrefix(false)
      map.on('movestart', () => box.classList.add('is-moving'))
      map.on('moveend', () => {
        box.classList.remove('is-moving')
        if (skipNext) {
          skipNext = false
          return
        }
        clearTimeout(timer)
        timer = setTimeout(lookup, 650)
      })
      skipNext = true
      map.setView(center ? [center.lat, center.lng] : BENGALURU, center ? 18 : 12)
    } else map.invalidateSize()
  }

  /** Moves the pin to a place. `pick: false` moves without looking the address up (it is known). */
  function moveTo(lat, lng, zoom = 18, { pick = true, accuracy = null } = {}) {
    if (!map) return
    if (ring) ring.remove()
    ring = !accuracy ? null : map.circle ? map.circle(lat, lng, accuracy) : L.circle([lat, lng], { radius: accuracy, color: '#d9a21b', weight: 1, fillOpacity: 0.08 }).addTo(map)
    skipNext = !pick
    map.setView([lat, lng], zoom)
  }

  async function lookup() {
    const c = map.getCenter()
    hint('Finding this spot…')
    try {
      const g = await reverseGeocode(c.lat, c.lng)
      hint(g.address ? `Pin at: ${esc(g.address)}${g.pincode ? ` · ${esc(g.pincode)}` : ''}` : 'Move the map so the pin sits on your door.')
      if (onPick) onPick({ lat: c.lat, lng: c.lng, ...g })
    } catch {
      hint('We couldn’t name this spot. Type your address below.')
    }
  }

  async function search(q, quiet = false) {
    q = String(q || '').trim()
    const list = box.querySelector('.map-results')
    if (q.length < 3) return
    list.hidden = false
    if (!quiet || !list.children.length) list.innerHTML = '<p class="map-note">Searching…</p>'
    if (hasGoogle()) {
      try {
        const c = map ? map.getCenter() : { lat: BENGALURU[0], lng: BENGALURU[1] }
        const got = await googleSuggest(q, c)
        if (box.querySelector('input').value.trim() !== q) return // typed on since: a newer search is on its way
        found = got
        list.innerHTML = got.length
          ? got.map((f, i) => `<button type="button" data-g="${i}"><strong>${esc(f.title)}</strong><small>${esc(f.detail)}</small></button>`).join('')
          : '<p class="map-note">Nothing found. Try the society or street name, or move the map yourself.</p>'
        return
      } catch { if (hasGoogle()) { list.innerHTML = '<p class="map-note">Search isn’t answering right now. Move the map yourself.</p>'; return } }
    }
    try {
      const c = map ? map.getCenter() : { lat: BENGALURU[0], lng: BENGALURU[1] }
      // Prefer places near the current view (about 30 km around it), but allow the rest of India.
      const box30 = [c.lng - 0.3, c.lat + 0.3, c.lng + 0.3, c.lat - 0.3].map((n) => n.toFixed(4)).join(',')
      const found = await nominatim(`search?format=jsonv2&addressdetails=1&countrycodes=in&limit=6&viewbox=${box30}&q=${encodeURIComponent(q)}`)
      list.innerHTML = found.length
        ? found.map((f) => `<button type="button" data-lat="${f.lat}" data-lng="${f.lon}"><strong>${esc(f.name || f.display_name.split(',')[0])}</strong><small>${esc(f.display_name)}</small></button>`).join('')
        : '<p class="map-note">Nothing found. Try the society or street name, or move the map yourself.</p>'
    } catch {
      list.innerHTML = '<p class="map-note">Search isn’t answering right now. Move the map yourself.</p>'
    }
  }

  function hint(html) {
    const p = box && box.querySelector('.map-hint')
    if (p) p.innerHTML = html
  }

  /** A small fixed map with a marker (the order page). */
  async function readOnly(el, { lat, lng }) {
    if (hasGoogle()) {
      try {
        const { Map } = await loadGoogle()
        if (!el.isConnected) return
        // the map under a pin of our own, fixed at its centre (no marker library needed)
        el.innerHTML = `<div class="map-static"></div><span class="map-marker is-fixed" aria-hidden="true">${icon('pin')}</span>`
        new Map(el.firstChild, { center: { lat, lng }, zoom: 16, disableDefaultUI: true, gestureHandling: 'none', clickableIcons: false, keyboardShortcuts: false })
        return
      } catch { /* OpenStreetMap below */ }
    }
    await loadLeaflet()
    if (!el.isConnected) return
    const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false })
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m)
    m.attributionControl.setPrefix(false)
    m.setView([lat, lng], 16)
    L.marker([lat, lng], { icon: L.divIcon({ className: 'map-marker', html: icon('pin'), iconSize: [34, 34], iconAnchor: [17, 32] }), keyboard: false }).addTo(m)
  }

  return { mount, moveTo, readOnly, nominatim, hasGoogle, reverse, findPincode }
})()
window.MapPick = MapPick
