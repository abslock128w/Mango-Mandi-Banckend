// The rider app's Content-Security-Policy, sent by proxy.ts with a fresh nonce per request
// (Next's nonce approach: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
//
// Scripts: only this app's own files and the inline bootstrap Next.js marks with the nonce.
// No 'strict-dynamic': the photo compressor's worker loads /vendor/browser-image-compression.js
// with importScripts, which a nonce can't cover. 'wasm-unsafe-eval' is for the Lottie player's
// WebAssembly (/lottie/dotlottie-player.wasm), not JavaScript eval.
// Fetches: this app, mango-api (NEXT_PUBLIC_API_URL) and Vercel Blob's upload API (photos go
// straight to Blob with a token from the API, lib/queue.ts). Directions open Google Maps as a
// plain link, which a policy does not limit. Styles allow inline: motion and React set style
// attributes; scripts are what the policy is for.
import { API_URL } from "@/lib/config";

/** Where @vercel/blob/client uploads to (its default; NEXT_PUBLIC_VERCEL_BLOB_API_URL overrides it). */
const BLOB_API = (process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL || "https://vercel.com/api/blob").replace(/\/$/, "");

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(nonce: string, { dev = false, api = API_URL }: { dev?: boolean; api?: string } = {}): string {
  const apiOrigin = originOf(api);
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Development: React rebuilds server error stacks with eval (Next's guide).
    "script-src": ["'self'", `'nonce-${nonce}'`, "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(apiOrigin ? [apiOrigin] : []), BLOB_API, `${BLOB_API}/`],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const out = Object.entries(d).map(([k, v]) => `${k} ${[...new Set(v)].join(" ")}`);
  // Not on localhost: it would send the dev server's http:// calls to https://.
  if (!dev) out.push("upgrade-insecure-requests");
  return out.join("; ");
}
