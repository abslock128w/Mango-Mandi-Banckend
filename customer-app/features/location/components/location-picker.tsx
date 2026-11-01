"use client";
import dynamic from "next/dynamic";
import { ArrowLeft, Crosshair, Loader2, MapPin } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "@/lib/config";
import { hasGoogleMaps } from "@/lib/maps";
import { cn } from "@/lib/format";
import type { Address, DeliveryCheck } from "@/lib/types";
import { dayName } from "@/lib/format";
import { api } from "@/lib/api/client";
import { geocodePincode, reverseGeocode } from "../geo";
import { useLocation } from "../store";
import { isPincode, makeAddress } from "../use-check";
import { OutOfZone } from "./out-of-zone";

// Google Maps when a key is configured, otherwise OpenStreetMap via Leaflet.
const MapPicker = dynamic(() => (hasGoogleMaps ? import("./google-map-picker") : import("./map-picker")), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-none" />,
});

type Geo = { lat: number; lng: number; pincode?: string; area?: string; city?: string; display?: string };

export function LocationPicker() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const current = useLocation((s) => s.address);
  const setAddress = useLocation((s) => s.setAddress);
  const start = current && current.lat ? { lat: current.lat, lng: current.lng } : config.defaultCenter;
  const [center, setCenter] = useState({ ...start, key: 0 });
  const [geo, setGeo] = useState<Geo | null>(null);
  const [status, setStatus] = useState<DeliveryCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [house, setHouse] = useState("");
  const [label, setLabel] = useState<Address["label"]>("Home");
  const [outOf, setOutOf] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookup = useCallback((lat: number, lng: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setBusy(true);
      try {
        const g = await reverseGeocode(lat, lng, ac.signal);
        setGeo({ lat, lng, ...g });
        setStatus(g.pincode ? await api.deliveryCheck(g.pincode) : null);
      } catch {
        if (!ac.signal.aborted) {
          setGeo({ lat, lng });
          setStatus(null);
        }
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 600);
  }, []);

  useEffect(() => {
    lookup(start.lat, start.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jumpToPincode = async () => {
    if (!isPincode(pin)) return;
    setBusy(true);
    const [s, pos] = await Promise.all([api.deliveryCheck(pin), geocodePincode(pin).catch(() => null)]);
    setBusy(false);
    if (!s.serviceable) {
      setOutOf(pin);
      return;
    }
    if (pos) setCenter({ ...pos, key: Date.now() });
    else {
      setStatus(s);
      setGeo((g) => ({ lat: g?.lat ?? start.lat, lng: g?.lng ?? start.lng, pincode: pin, city: g?.city }));
    }
  };

  const locateMe = () =>
    navigator.geolocation?.getCurrentPosition(({ coords }) => setCenter({ lat: coords.latitude, lng: coords.longitude, key: Date.now() }));

  const confirm = () => {
    if (!geo?.pincode || !status?.serviceable) return;
    setAddress(makeAddress({ pincode: geo.pincode, city: geo.city ?? "", area: geo.area, lat: geo.lat, lng: geo.lng, label, line2: house || undefined }));
    router.replace(next);
  };

  if (outOf)
    return (
      <div className="mx-auto max-w-md p-4">
        <OutOfZone pincode={outOf} onRetry={() => setOutOf(null)} />
      </div>
    );

  const serviceable = status?.serviceable;

  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:mx-auto lg:min-h-0 lg:max-w-content lg:flex-row lg:gap-6 lg:p-6">
      <div className="relative h-[52dvh] shrink-0 lg:h-[calc(100dvh-48px)] lg:flex-1 lg:overflow-hidden lg:rounded-16">
        <MapPicker center={center} onMove={(lat, lng) => lookup(lat, lng)} />
        <button type="button" onClick={() => router.back()} aria-label="Back" className="press absolute top-3 left-3 z-[600] grid size-11 place-items-center rounded-full bg-surface text-ink shadow-sheet">
          <ArrowLeft size={20} strokeWidth={1.75} />
        </button>
        <button type="button" onClick={locateMe} className="press absolute bottom-4 left-1/2 z-[600] flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-8 border border-action bg-surface px-3 text-13 font-semibold text-action shadow-sheet">
          <Crosshair aria-hidden size={18} strokeWidth={1.75} /> Go to current location
        </button>
      </div>

      <div className="-mt-4 flex flex-1 flex-col rounded-t-16 bg-surface p-4 lg:mt-0 lg:w-[400px] lg:flex-none lg:rounded-16 lg:border lg:border-line">
        <h1 className="font-display text-17 font-extrabold text-ink">Confirm delivery location</h1>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            jumpToPincode();
          }}
        >
          <label htmlFor="map-pin" className="sr-only">
            Search by pincode
          </label>
          <input
            id="map-pin"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Search by pincode"
            className="h-11 min-w-0 flex-1 rounded-8 border border-line px-3 text-13 outline-none focus:border-action"
          />
          <button type="submit" className="press h-11 rounded-8 border border-action bg-tint px-3 text-13 font-semibold text-action">
            Go
          </button>
        </form>

        <div className="mt-4 flex gap-3 rounded-12 bg-canvas p-3" aria-live="polite">
          <MapPin aria-hidden size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-action" />
          <div className="min-w-0 flex-1">
            {busy && !geo ? (
              <div className="space-y-1.5">
                <div className="skeleton h-4 w-1/2 rounded-4" />
                <div className="skeleton h-3 w-full rounded-4" />
              </div>
            ) : (
              <>
                <p className="text-15 font-bold text-ink">{geo?.area ?? (geo?.pincode ? `Pincode ${geo.pincode}` : "Move the map to your building")}</p>
                <p className="line-clamp-2 text-12 text-muted">{geo?.display ?? "Drag the map so the pin sits on your door"}</p>
                {geo?.pincode && (
                  <p className={cn("mt-1 text-12 font-semibold", serviceable ? "text-action" : "text-danger")}>
                    {busy ? "Checking…" : serviceable ? `We deliver here · first delivery ${status?.earliestDeliveryDate ? dayName(status.earliestDeliveryDate).toLowerCase() : "soon"}` : `We don't deliver to ${geo.pincode} yet`}
                  </p>
                )}
              </>
            )}
          </div>
          {busy && <Loader2 aria-label="Loading" size={18} className="shrink-0 animate-spin text-muted" />}
        </div>

        <label htmlFor="house" className="mt-4 text-12 font-semibold text-ink">
          Flat, house no., building (optional)
        </label>
        <input id="house" value={house} onChange={(e) => setHouse(e.target.value)} autoComplete="address-line2" className="mt-1 h-11 rounded-8 border border-line px-3 text-13 outline-none focus:border-action" />

        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Save address as">
          {(["Home", "Work", "Other"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={label === l} onClick={() => setLabel(l)} className={cn("press h-9 rounded-8 border px-3 text-12 font-semibold", label === l ? "border-action bg-tint text-action" : "border-line text-ink")}>
              {l}
            </button>
          ))}
        </div>

        <div className="mt-auto pt-4">
          {geo?.pincode && !serviceable && !busy ? (
            <button type="button" onClick={() => setOutOf(geo.pincode!)} className="press h-12 w-full rounded-12 border border-action text-15 font-semibold text-action">
              Tell us you want us here
            </button>
          ) : (
            <button type="button" disabled={!serviceable || busy} onClick={confirm} className="press h-12 w-full rounded-12 bg-action text-15 font-semibold text-white disabled:bg-disabled">
              Confirm location
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
