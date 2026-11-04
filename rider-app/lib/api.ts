"use client";
import { ADMIN_API } from "./config";
import { getKv } from "./db";
import { deviceId, getAccessToken, lockSession, signOut, startSession } from "./session";
import type { CheckResult, Manifest, PickupResult, Session, Step } from "./types";

/** An answer from the API that was not a success, or no answer at all (network: true). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public network = false,
  ) {
    super(message);
  }
  /** Worth trying again later: no answer, the server's own trouble, or a rate limit. */
  get transient() {
    return this.network || this.status >= 500 || this.status === 408 || (this.status === 429 && this.code !== "CODE_LOCKED");
  }
}

type Opts = { body?: unknown; raw?: Blob; headers?: Record<string, string>; auth?: boolean; retried?: boolean };

async function send(method: string, path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { ...o.headers };
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.raw) headers["Content-Type"] = "image/jpeg";
  const token = getAccessToken();
  if (o.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${ADMIN_API}${path}`, {
      method,
      headers,
      body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "No connection. It will be sent when you are back online.", undefined, true);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Renews the access token with the device's refresh token (the server allows this for 12 h after a PIN unlock). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await getKv<string>("refreshToken");
      if (!refreshToken) return false;
      const res = await send("POST", "/rider/session/refresh", { body: { deviceId: await deviceId(), refreshToken }, auth: false });
      if (!res.ok) return false;
      await startSession((await res.json()) as Session);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function request<T>(method: string, path: string, o: Opts = {}): Promise<T> {
  let res = await send(method, path, o);
  if (res.status === 401 && o.auth !== false && !o.retried) {
    if (await refreshSession()) res = await send(method, path, { ...o, retried: true });
    else {
      await lockSession();
      throw new ApiError(401, "LOCKED", "Enter your PIN to carry on.");
    }
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? "Something went wrong. Try again.", e?.details);
  }
  return json as T;
}

const id = (s: string) => encodeURIComponent(s);

export const api = {
  otpRequest: (phone: string) => request<{ sent: boolean; channel?: string; devCode?: string }>("POST", "/rider/otp/request", { body: { phone }, auth: false }),
  otpVerify: async (phone: string, code: string) =>
    request<{ setupToken: string; rider: { id: string; name: string } }>("POST", "/rider/otp/verify", { body: { phone, code, deviceId: await deviceId() }, auth: false }),
  pinSet: async (setupToken: string, pin: string) => request<Session>("POST", "/rider/pin/set", { body: { setupToken, pin, deviceId: await deviceId() }, auth: false }),
  pinUnlock: async (pin: string) => {
    const refreshToken = await getKv<string>("refreshToken");
    try {
      return await request<Session>("POST", "/rider/pin/unlock", { body: { deviceId: await deviceId(), refreshToken, pin }, auth: false });
    } catch (err) {
      // The device was revoked by a manager or too many wrong PINs: start again with an OTP.
      if (err instanceof ApiError && (err.code === "DEVICE_REVOKED" || err.code === "PIN_LOCKED" || err.code === "INVALID_TOKEN")) await signOut();
      throw err;
    }
  },
  manifest: (date: string) => request<Manifest>("GET", `/manifest?date=${id(date)}`),
  photoToken: (orderId: string, body: Record<string, unknown>) =>
    request<{ mode: "blob"; pathname: string; clientToken: string } | { mode: "direct" }>("POST", `/orders/${id(orderId)}/photos/token`, { body }),
  photoFinalize: (orderId: string, body: Record<string, unknown>) => request<{ id: string; step: Step; duplicate?: boolean }>("POST", `/orders/${id(orderId)}/photos`, { body }),
  photoDirect: (orderId: string, blob: Blob, headers: Record<string, string>) =>
    request<{ id: string; step: Step; duplicate?: boolean }>("POST", `/orders/${id(orderId)}/photos`, { raw: blob, headers }),
  pickup: (orderId: string, clientId: string) => request<PickupResult>("POST", `/orders/${id(orderId)}/pickup`, { body: { clientId } }),
  check: (orderId: string, photoId: string, continueForReview = false) =>
    request<CheckResult>("POST", `/orders/${id(orderId)}/photos/${id(photoId)}/check`, { body: continueForReview ? { continueForReview: true } : {} }),
  delivery: (orderId: string, body: Record<string, unknown>) => request<{ outcome: "DELIVERED" | "FAILED"; method?: string }>("POST", `/orders/${id(orderId)}/delivery`, { body }),
  location: (body: { lat: number; lng: number; accuracy: number | null; at: string }) => request<{ stored: boolean }>("POST", "/rider/location", { body }),
};
