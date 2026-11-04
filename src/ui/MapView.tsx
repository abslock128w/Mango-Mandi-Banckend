// MapView (docs/design/ops-dashboard-v2.md §3): warehouses, stops and riders on a Leaflet map.
// Leaflet and its CSS load only when a map is first drawn (MapCanvas), so pages without one, and
// the first paint, do not carry it. Everything on the map is also in the list beside it, so the
// map can be skipped with one link.
import { Suspense, lazy, useId, type ReactNode } from 'react'

export type MarkerKind = 'warehouse' | 'stop' | 'rider'

export interface MapMarker {
  id: string
  kind: MarkerKind
  lat: number
  lng: number
  /** Read on hover and in the marker's title. */
  label: string
  /** A pipeline tone (confirmed, packed, out, shipped, failed) for stops. */
  tone?: string
  /** A number on the pin: the stop's place in its run, or how many stops share the pin. */
  badge?: string
  /** Riders fade with the age of their position (0.35 to 1). */
  opacity?: number
}

export interface MapTrail {
  id: string
  points: [number, number][]
}

export interface MapHeat {
  id: string
  lat: number
  lng: number
  /** 0 to 1: the circle's size and strength. */
  weight: number
  label: string
}

export interface MapViewProps {
  label: string
  markers: MapMarker[]
  trails?: MapTrail[]
  heat?: MapHeat[]
  highlight?: string | null
  onHover?: (id: string | null) => void
  onSelect?: (id: string) => void
  /** Changes when the view should fit the markers again (the day, the filter). */
  fitKey?: string
  className?: string
  /** Shown over the map when there is nothing to draw. */
  empty?: ReactNode
}

const MapCanvas = lazy(() => import('./MapCanvas'))

export function MapView(props: MapViewProps) {
  const after = useId()
  const nothing = props.markers.length === 0 && !(props.heat?.length)
  return (
    <div className={`map-view${props.className ? ` ${props.className}` : ''}`}>
      <a className="skip-map" href={`#${after}`}>
        Skip the map
      </a>
      <div className="map-frame" role="region" aria-label={props.label}>
        <Suspense fallback={<div className="map-loading" aria-hidden="true" />}>
          <MapCanvas {...props} />
        </Suspense>
        {nothing && props.empty && <div className="map-empty">{props.empty}</div>}
      </div>
      <span id={after} tabIndex={-1} className="sr-only">
        End of the map
      </span>
    </div>
  )
}

/** Opacity of a rider's dot by the age of the last position (minutes). */
export function freshnessOpacity(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0.35
  if (minutes < 5) return 1
  if (minutes < 30) return 0.75
  return 0.45
}
