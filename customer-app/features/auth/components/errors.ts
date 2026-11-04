import { ApiError } from "@/lib/api/client";

/** The API's own message (already plain words), else a generic one. */
export const errorText = (err: unknown, fallback = "Something went wrong. Please try again.") =>
  err instanceof ApiError ? err.message : err instanceof Error && err.message ? err.message : fallback;

/** Where to go after signing in (?next=): only a path on this site. "//evil.example" and "/\evil.example" are other sites. */
export const safeNext = (next: string | null | undefined): string => (next && /^\/(?![/\\])/.test(next) ? next : "/");
