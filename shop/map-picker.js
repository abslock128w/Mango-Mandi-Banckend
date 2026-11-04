/* The delivery map at checkout (and the read-only map on the order page).
   Leaflet (assets/leaflet, loaded on first use) with OpenStreetMap tiles. The pin is fixed in the
   middle: the customer moves the map until it sits on their door, then the spot is turned into an
   address and pincode by OpenStreetMap's Nominatim. Search finds a building, society or street,
   on Enter or the Search button only (Nominatim's usage policy does not allow search-as-you-type).

   The picker is one element kept for the whole visit and moved into each re-render's
   #co-map-slot, so the map, the zoom and the search survive app.js redrawing the checkout.
   window.MapPick = { mount, moveTo, readOnly } */
const MapPick = (() => {
  const BENGALURU = [12.9716, 77.5946]
  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  let box = null, map = null, onPick = null, skipNext = false, timer = 0, ring = null, lastAt = 0

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
    box.innerHTML = `<form class="map-search liquid" role="search">${icon('search')}<input name="map-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search your building, society or street" aria-label="Search for your building or street"><button type="submit" class="map-search-go">Search</button></form>
      <div class="map-results" hidden></div>
      <div class="map-frame"><div class="map-canvas"></div><span class="map-pin" aria-hidden="true">${icon('pin')}</span><span class="map-pin-shadow" aria-hidden="true"></span></div>
      <p class="map-hint" aria-live="polite">Move the map so the pin sits on your door.</p>`
    box.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault()
      search(box.querySelector('input').value)
    })
    box.querySelector('.map-results').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lat]')
      if (!b) return
      box.querySelector('.map-results').hidden = true
      moveTo(Number(b.dataset.lat), Number(b.dataset.lng), 18)
    })
  }

  /** Puts the picker into `slot` (creating the map once). `pick` gets {lat, lng, address, pincode}. */
  async function mount(slot, { center, pick } = {}) {
    onPick = pick
    if (!box) build()
    slot.append(box)
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
    ring = accuracy ? L.circle([lat, lng], { radius: accuracy, color: '#d9a21b', weight: 1, fillOpacity: 0.08 }).addTo(map) : null
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

  async function search(q) {
    q = String(q || '').trim()
    const list = box.querySelector('.map-results')
    if (q.length < 3) return
    list.hidden = false
    list.innerHTML = '<p class="map-note">Searching…</p>'
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
    await loadLeaflet()
    if (!el.isConnected) return
    const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false })
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m)
    m.attributionControl.setPrefix(false)
    m.setView([lat, lng], 16)
    L.marker([lat, lng], { icon: L.divIcon({ className: 'map-marker', html: icon('pin'), iconSize: [34, 34], iconAnchor: [17, 32] }), keyboard: false }).addTo(m)
  }

  return { mount, moveTo, readOnly, nominatim }
})()
window.MapPick = MapPick
