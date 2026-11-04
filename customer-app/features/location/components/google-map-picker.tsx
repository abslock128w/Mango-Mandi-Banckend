"use client";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";
import { GOOGLE_MAPS_KEY, GOOGLE_MAP_ID } from "@/lib/maps";

function Recenter({ center }: { center: { lat: number; lng: number; key: number } }) {
  const map = useMap();
  useEffect(() => {
    if (!map || center.key === 0) return;
    map.panTo({ lat: center.lat, lng: center.lng });
    if ((map.getZoom() ?? 0) < 16) map.setZoom(16);
  }, [map, center.key, center.lat, center.lng]);
  return null;
}

/** Google Map with a fixed centre pin; reports the centre whenever the map settles. */
export default function GoogleMapPicker({
  center,
  onMove,
}: {
  center: { lat: number; lng: number; key: number };
  onMove: (lat: number, lng: number) => void;
}) {
  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY} libraries={["geocoding"]} region="IN" language="en">
      <div className="relative h-full w-full">
        <Map
          mapId={GOOGLE_MAP_ID}
          defaultCenter={{ lat: center.lat, lng: center.lng }}
          defaultZoom={16}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          onIdle={(e) => {
            const c = e.map.getCenter();
            if (c) onMove(c.lat(), c.lng());
          }}
          className="h-full w-full"
        />
        <Recenter center={center} />
        {/* Fixed centre pin */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-full" aria-hidden>
          <div className="mb-1 rounded-8 bg-ink px-2.5 py-1.5 text-11 font-semibold whitespace-nowrap text-white shadow-sheet">Your order will be delivered here</div>
          <svg viewBox="0 0 32 40" className="mx-auto size-10 drop-shadow">
            <path d="M16 39s13-12.4 13-23A13 13 0 0 0 3 16c0 10.6 13 23 13 23Z" className="fill-action" />
            <circle cx="16" cy="16" r="5" className="fill-white" />
          </svg>
        </div>
      </div>
    </APIProvider>
  );
}
