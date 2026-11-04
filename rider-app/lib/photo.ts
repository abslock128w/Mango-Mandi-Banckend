"use client";
// A camera shot becomes a JPEG of at most 1280 px and about 0.4 MB, made in a
// web worker so the screen stays responsive. The worker loads its copy of the
// library from /vendor (precached), never from a CDN, so it works offline.

export type Where = { lat: number | null; lng: number | null; accuracy: number | null; takenAt: number };

export async function compressPhoto(file: File): Promise<Blob> {
  const { default: imageCompression } = await import("browser-image-compression");
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.4,
      maxWidthOrHeight: 1280,
      fileType: "image/jpeg",
      useWebWorker: true,
      libURL: `${location.origin}/vendor/browser-image-compression.js`,
      initialQuality: 0.8,
    });
  } catch {
    throw new Error("That file is not a photo. Take the photo again.");
  }
}

/** Where the rider stands at the shutter. Never blocks the step: no fix in 8 s, no location. */
export function positionNow(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round6(p.coords.latitude), lng: round6(p.coords.longitude), accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15_000 },
    );
  });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The time is taken first (the shutter), then the location and the compression run together. */
export async function capture(file: File): Promise<{ blob: Blob; where: Where }> {
  const takenAt = Date.now();
  const [blob, pos] = await Promise.all([compressPhoto(file), positionNow()]);
  return { blob, where: { takenAt, lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null } };
}

/** Metres between two points (haversine). */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
