"use client";
import { Crosshair, Loader2, Map } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/format";
import { reverseGeocode } from "../geo";
import { isPincode, makeAddress, useServiceability } from "../use-check";
import { OutOfZone } from "./out-of-zone";

/** Pincode entry + current location. Calls onDone once a serviceable address is set. */
export function PincodeForm({ onDone, showMapLink = true }: { onDone?: () => void; showMapLink?: boolean }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [outOf, setOutOf] = useState<string | null>(null);
  const check = useServiceability();

  const submit = async (pincode: string, extra?: { area?: string; lat?: number; lng?: number }) => {
    setError(null);
    if (!isPincode(pincode)) {
      setError("Enter a valid 6-digit pincode");
      return;
    }
    const res = await check.mutateAsync(pincode).catch(() => null);
    if (!res) {
      setError("Couldn't check that pincode. Try again.");
      return;
    }
    if (!res.serviceable) {
      setOutOf(pincode);
      return;
    }
    check.setAddress(makeAddress({ pincode, city: "", ...extra }));
    onDone?.();
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setError("Location isn't available on this device");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const g = await reverseGeocode(coords.latitude, coords.longitude);
          if (!g.pincode) throw new Error();
          setPin(g.pincode);
          await submit(g.pincode, { area: g.area, lat: coords.latitude, lng: coords.longitude });
        } catch {
          setError("Couldn't read your location. Enter your pincode instead.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setError("Location permission denied. Enter your pincode instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  if (outOf) return <OutOfZone pincode={outOf} onRetry={() => { setOutOf(null); setPin(""); }} />;

  return (
    <div className="space-y-3">
      <button type="button" onClick={locate} disabled={locating} className="press flex h-12 w-full items-center justify-center gap-2 rounded-12 bg-action text-15 font-semibold text-white">
        {locating ? <Loader2 aria-hidden size={20} className="animate-spin" /> : <Crosshair aria-hidden size={20} strokeWidth={1.75} />}
        {locating ? "Finding you" : "Use my current location"}
      </button>
      <div className="flex items-center gap-3 text-11 font-semibold text-muted uppercase" aria-hidden>
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(pin);
        }}
        className="flex gap-2"
        noValidate
      >
        <label className="sr-only" htmlFor="pincode">
          Pincode
        </label>
        <input
          id="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="Enter pincode"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "pin-err" : undefined}
          className={cn("h-12 min-w-0 flex-1 rounded-8 border bg-surface px-3 text-15 text-ink outline-none placeholder:text-muted focus:border-action", error ? "border-danger" : "border-line")}
        />
        <button type="submit" disabled={check.isPending} className="press h-12 rounded-8 border border-action bg-tint px-4 text-15 font-semibold text-action">
          {check.isPending ? <Loader2 aria-hidden size={18} className="animate-spin" /> : "Check"}
        </button>
      </form>
      {error && (
        <p id="pin-err" role="alert" className="text-12 text-danger">
          {error}
        </p>
      )}
      {showMapLink && (
        <Link href="/location" onClick={() => onDone?.()} className="flex h-11 items-center justify-center gap-1.5 text-13 font-semibold text-action">
          <Map aria-hidden size={18} strokeWidth={1.75} /> Pick on map instead
        </Link>
      )}
      {process.env.NODE_ENV !== "production" && <p className="text-center text-11 text-muted">Local demo pincodes: 560034, 560038, 560066 (Bengaluru)</p>}
    </div>
  );
}
