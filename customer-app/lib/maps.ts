/**
 * Map provider. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Maps JavaScript API and
 * Geocoding API enabled) to use Google Maps; without it the app falls back to
 * OpenStreetMap tiles via Leaflet so local dev and tests work keyless.
 */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
/** Advanced markers need a map ID; Google's DEMO_MAP_ID works for development. */
export const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";
export const hasGoogleMaps = GOOGLE_MAPS_KEY.length > 0;
