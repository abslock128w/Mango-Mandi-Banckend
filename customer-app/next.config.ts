import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

/**
 * The API's address. "/" (or empty) means this same origin: the shop answers /v1 itself and
 * SHOP_API_PROXY passes it on (never /v1/dev). Used by start-local --phone, and by a demo whose
 * shop and API are on different vercel.app names: Safari and iPhones block the API's sign-in
 * cookie there as third-party, so customers would be signed out every time they came back.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const api = URL.canParse(apiUrl) ? new URL(apiUrl) : null;
const proxy = process.env.SHOP_API_PROXY;

// UX-1: every page shows a help contact, so a production build needs the WhatsApp number.
if (process.argv.includes("build") && !process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP && !process.env.ALLOW_NO_SUPPORT_WHATSAPP) {
  throw new Error("Set NEXT_PUBLIC_SUPPORT_WHATSAPP (country code and number, digits only, e.g. 919800000000) to build the shop.");
}

const nextConfig: NextConfig = {
  // The storefront is client-data driven (TanStack Query over mango-api's /v1).
  reactStrictMode: true,
  // inlineCss is off: in Next 16.4 it embeds the stylesheet twice more in the RSC payload.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 414, 640, 768, 1024, 1280],
    imageSizes: [32, 64, 96, 128, 180, 256, 384],
    // Product photos come from the API (/v1/products/:sku/photo) or Vercel Blob.
    remotePatterns: [
      ...(api ? [{ protocol: api.protocol.replace(":", "") as "http" | "https", hostname: api.hostname, port: api.port, pathname: "/v1/**" }] : []),
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
    dangerouslyAllowLocalIP: api?.hostname === "localhost" || api?.hostname === "127.0.0.1",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  async rewrites() {
    return proxy ? [{ source: "/v1/:path((?!dev(?:/|$)).*)", destination: `${proxy}/v1/:path` }] : [];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withSerwist(nextConfig);
