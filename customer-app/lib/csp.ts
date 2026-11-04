/**
 * The shop's Content-Security-Policy, sent by proxy.ts with a fresh nonce per
 * request. It mirrors scripts/csp.ts ('shop'), the policy the repo's other app
 * uses; tests/csp.spec.ts checks the two stay in step. Next.js streams inline
 * scripts, so script-src uses a nonce with 'strict-dynamic' instead of a host
 * list: scripts the page loads itself (Razorpay checkout, Google sign-in,
 * Turnstile) are trusted through the nonced script that adds them.
 */
const SENTRY = ["https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io", "https://*.ingest.de.sentry.io"];
const GOOGLE = "https://accounts.google.com";
const RAZORPAY = "https://*.razorpay.com";
const RAZORPAY_CHECKOUT = "https://checkout.razorpay.com";
const TURNSTILE = "https://challenges.cloudflare.com";
const IMAGES = ["https://*.public.blob.vercel-storage.com", "https://*.googleusercontent.com"];
/** The location picker: Google Maps with a key, OpenStreetMap tiles and search without (lib/maps.ts). */
export const MAP_SOURCES = {
  img: ["https://*.tile.openstreetmap.org", "https://maps.gstatic.com", "https://*.googleapis.com", "https://*.ggpht.com"],
  connect: ["https://nominatim.openstreetmap.org", "https://maps.googleapis.com"],
  font: ["https://fonts.gstatic.com"],
  style: ["https://fonts.googleapis.com"],
};

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function shopPolicy({ api, nonce, dev = false }: { api: string | null; nonce: string; dev?: boolean }): string {
  const apiSrc = api === null ? ["https:"] : [originOf(api)].filter((x): x is string => Boolean(x));
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Hosts are ignored where 'strict-dynamic' is understood and kept for older browsers.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", `${GOOGLE}/gsi/client`, RAZORPAY_CHECKOUT, TURNSTILE, ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", `${GOOGLE}/gsi/style`, ...MAP_SOURCES.style],
    "img-src": ["'self'", "data:", "blob:", ...apiSrc, ...IMAGES, RAZORPAY, ...MAP_SOURCES.img],
    "font-src": ["'self'", "data:", ...MAP_SOURCES.font],
    "connect-src": ["'self'", ...apiSrc, `${GOOGLE}/gsi/`, ...SENTRY, RAZORPAY, ...MAP_SOURCES.connect, ...(dev ? ["ws:", "wss:"] : [])],
    "frame-src": [GOOGLE, RAZORPAY, TURNSTILE],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", RAZORPAY],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(d)
    .map(([k, v]) => `${k} ${[...new Set(v)].join(" ")}`)
    .join("; ");
}
