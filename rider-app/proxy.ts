import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";

/**
 * A fresh nonce and the Content-Security-Policy for every page (lib/csp.ts). Next.js reads the
 * nonce from the request's policy while it renders and puts it on its own scripts, so the
 * pages render per request (app/layout.tsx waits for the connection).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages and the service worker; not built files, icons or link prefetches.
      source: "/((?!_next/static|_next/image|favicon|icons/|apple-touch-icon|lottie/|vendor/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
