"use client";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";

function Events({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onMove(c.lat, c.lng);
    },
  });
  return null;
}

function Recenter({ center }: { center: { lat: number; lng: number; key: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], Math.max(map.getZoom(), 15), { animate: true });
  }, [center.key, center.lat, center.lng, map]);
  return null;
}

/** Leaflet map with a fixed centre pin; reports the centre on every move end. */
export default function MapPicker({
  center,
  onMove,
}: {
  center: { lat: number; lng: number; key: number };
  onMove: (lat: number, lng: number) => void;
}) {
  return (
    <div className="relative h-full w-full">
      <MapContainer center={[center.lat, center.lng]} zoom={15} zoomControl={false} className="h-full w-full" attributionControl>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <Events onMove={onMove} />
        <Recenter center={center} />
      </MapContainer>
      {/* Fixed centre pin */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-[500] -translate-x-1/2 -translate-y-full" aria-hidden>
        <div className="mb-1 rounded-8 bg-ink px-2.5 py-1.5 text-11 font-semibold whitespace-nowrap text-white shadow-sheet">Your order will be delivered here</div>
        <svg viewBox="0 0 32 40" className="mx-auto size-10 drop-shadow">
          <path d="M16 39s13-12.4 13-23A13 13 0 0 0 3 16c0 10.6 13 23 13 23Z" className="fill-action" />
          <circle cx="16" cy="16" r="5" className="fill-white" />
        </svg>
      </div>
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-[400] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-action/30" aria-hidden />
    </div>
  );
}
