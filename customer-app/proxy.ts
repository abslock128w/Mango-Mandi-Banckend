import { NextResponse, type NextRequest } from "next/server";
import { shopPolicy } from "@/lib/csp";

/** Adds the Content-Security-Policy with a per-request nonce (Next.js reads it from the request header). */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  // Shared through the local proxy (start-local --phone) the API is this same origin.
  const csp = shopPolicy({ api: process.env.NEXT_PUBLIC_API_URL || null, nonce, dev: process.env.NODE_ENV !== "production" });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|images|brand|favicon|icon|apple-touch|manifest|sw.js|serwist|v1/).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
