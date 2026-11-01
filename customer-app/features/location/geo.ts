"use client";
import { GOOGLE_MAPS_KEY, hasGoogleMaps } from "@/lib/maps";

type GComponent = { long_name: string; types: string[] };
const pick = (c: GComponent[], ...types: string[]) => c.find((x) => types.some((t) => x.types.includes(t)))?.long_name;

async function googleGeocode(params: string, signal?: AbortSignal) {
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}&region=in&language=en&key=${GOOGLE_MAPS_KEY}`, { signal });
  const d = (await res.json()) as { status: string; results: { formatted_address: string; address_components: GComponent[]; geometry: { location: { lat: number; lng: number } } }[] };
  if (d.status !== "OK" || !d.results.length) throw new Error(d.status);
  return d.results;
}

export interface GeoResult {
  pincode?: string;
  area?: string;
  city?: string;
  display?: string;
}

/** Reverse geocode: Google Geocoding API when a key is set, else OpenStreetMap Nominatim (1 req/s; callers debounce). */
export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<GeoResult> {
  if (hasGoogleMaps) {
    const [r] = await googleGeocode(`latlng=${lat.toFixed(6)},${lng.toFixed(6)}`, signal);
    const c = r.address_components;
    return {
      pincode: pick(c, "postal_code")?.replace(/\s/g, ""),
      area: pick(c, "sublocality_level_1", "sublocality", "neighborhood", "route"),
      city: pick(c, "locality", "administrative_area_level_2"),
      display: r.formatted_address,
    };
  }
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`;
  const res = await fetch(url, { signal, headers: { "Accept-Language": "en-IN" } });
  if (!res.ok) throw new Error("Could not find this place");
  const d = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  const a = d.address ?? {};
  return {
    pincode: a.postcode?.replace(/\s/g, ""),
    area: a.suburb || a.neighbourhood || a.road || a.village || a.city_district,
    city: a.city || a.town || a.state_district || a.state,
    display: d.display_name,
  };
}

export async function geocodePincode(pincode: string, signal?: AbortSignal): Promise<{ lat: number; lng: number } | null> {
  if (hasGoogleMaps) {
    const [r] = await googleGeocode(`components=country:IN|postal_code:${pincode}`, signal).catch(() => [null]);
    return r ? r.geometry.location : null;
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&country=India&postalcode=${pincode}&limit=1`, { signal });
  if (!res.ok) return null;
  const list = (await res.json()) as { lat: string; lon: string }[];
  return list[0] ? { lat: Number(list[0].lat), lng: Number(list[0].lon) } : null;
}
