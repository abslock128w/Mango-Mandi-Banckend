// The Leaflet part of MapView, loaded on demand. Plain Leaflet (no react-leaflet): one map per
// mount, markers and layers redrawn when their data changes. Tiles from VITE_MAP_TILES_URL, else
// OpenStreetMap's standard tiles with their attribution (a paid tile provider should replace them
// before heavy use: docs/design/ops-dashboard-v2.md). 'none' draws no tiles (tests, offline).
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../styles/map.css'
import type { MapMarker, MapViewProps } from './MapView'

const TILES = (import.meta.env.VITE_MAP_TILES_URL ?? '').trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM = /openstreetmap\.org/.test(TILES)
const ATTRIBUTION = OSM ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' : 'Map tiles: see the panel settings'

const HOUSE =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z"/></svg>'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function icon(m: MapMarker, on: boolean): L.DivIcon {
  const cls = `map-marker map-${m.kind}${m.tone ? ` pipe-${m.tone}` : ''}${on ? ' is-on' : ''}`
  if (m.kind === 'warehouse') return L.divIcon({ className: cls, html: `<span class="map-house">${HOUSE}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] })
  if (m.kind === 'rider')
    return L.divIcon({ className: cls, html: `<span class="map-rider-dot" style="opacity:${m.opacity ?? 1}"></span><span class="map-rider-pulse"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] })
  return L.divIcon({ className: cls, html: `<span class="map-pin-body">${m.badge ? esc(m.badge) : ''}</span>`, iconSize: [26, 32], iconAnchor: [13, 30] })
}

export default function MapCanvas({ markers, trails = [], heat = [], highlight, onHover, onSelect, fitKey, label }: MapViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const handlers = useRef({ onHover, onSelect })
  handlers.current = { onHover, onSelect }
  const fitted = useRef<string | null>(null)

  useEffect(() => {
    if (!host.current) return
    const m = L.map(host.current, { zoomControl: true, attributionControl: true, keyboard: true, scrollWheelZoom: false })
    m.setView([12.97, 77.6], 11)
    if (TILES !== 'none') L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION, className: 'map-tiles' }).addTo(m)
    else m.attributionControl.addAttribution('No map tiles')
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    // Leaflet's own focusable map container gets a name.
    host.current.setAttribute('aria-label', label)
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(host.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
    // One map per mount; the label is set once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    for (const t of trails) if (t.points.length > 1) L.polyline(t.points, { className: 'map-trail', weight: 3, opacity: 0.7 }).addTo(g)
    for (const h of heat) {
      L.circleMarker([h.lat, h.lng], { radius: 8 + 22 * h.weight, className: 'map-heat', fillOpacity: 0.15 + 0.5 * h.weight, weight: 1 })
        .bindTooltip(esc(h.label))
        .addTo(g)
    }
    for (const mk of markers) {
      const marker = L.marker([mk.lat, mk.lng], { icon: icon(mk, highlight === mk.id), title: mk.label, alt: mk.label, keyboard: mk.kind !== 'warehouse', riseOnHover: true, zIndexOffset: mk.kind === 'rider' ? 600 : highlight === mk.id ? 900 : 0 })
      marker.bindTooltip(esc(mk.label), { direction: 'top', offset: [0, -24] })
      marker.on('mouseover', () => handlers.current.onHover?.(mk.id))
      marker.on('mouseout', () => handlers.current.onHover?.(null))
      marker.on('click', () => handlers.current.onSelect?.(mk.id))
      marker.on('keypress', (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === 'Enter') handlers.current.onSelect?.(mk.id)
      })
      marker.addTo(g)
    }
    const key = fitKey ?? 'all'
    const pts = [...markers.map((x) => [x.lat, x.lng] as [number, number]), ...heat.map((h) => [h.lat, h.lng] as [number, number])]
    if (fitted.current !== key && pts.length) {
      fitted.current = key
      m.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 14, animate: false })
    }
  }, [markers, trails, heat, highlight, fitKey])

  return (
    <>
      <div ref={host} className="map-canvas" />
      <button
        type="button"
        className="btn btn-small map-fit"
        onClick={() => {
          const pts = [...markers.map((x) => [x.lat, x.lng] as [number, number]), ...heat.map((h) => [h.lat, h.lng] as [number, number])]
          if (map.current && pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 14 })
        }}
      >
        Fit to stops
      </button>
    </>
  )
}
