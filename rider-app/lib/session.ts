"use client";
// The rider's sign-in. The phone is bound on first sign-in (OTP, then a PIN);
// after that a cold start asks only for the PIN. The refresh token and device
// id live in IndexedDB; the 15-minute access token only in memory.
import { useSyncExternalStore } from "react";
import { delKv, getKv, setKv } from "./db";
import type { Session } from "./types";

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "locked"; riderName: string | null }
  | { status: "ready"; rider: Session["rider"] };

let state: SessionState = { status: "loading" };
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  for (const l of listeners) l();
}

export const getAccessToken = () => accessToken;
export const getSessionState = () => state;

export function useSession(): SessionState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** A random id made once per install; the API binds the rider's PIN and refresh token to it. */
export async function deviceId(): Promise<string> {
  let id = await getKv<string>("deviceId");
  if (!id) {
    try {
      id = localStorage.getItem("mandi-rider-device") ?? undefined;
    } catch {
      // storage blocked: a new id
    }
    id ??= crypto.randomUUID();
    await setKv("deviceId", id);
    try {
      localStorage.setItem("mandi-rider-device", id);
    } catch {
      // IndexedDB has it
    }
  }
  return id;
}

/** On start: a bound phone goes to the PIN screen, a new one to sign-in. */
export async function bootSession() {
  if (state.status !== "loading") return;
  const refresh = await getKv<string>("refreshToken");
  const rider = await getKv<Session["rider"]>("rider");
  set(refresh ? { status: "locked", riderName: rider?.name ?? null } : { status: "signedOut" });
}

export async function startSession(s: Session) {
  accessToken = s.accessToken;
  await setKv("refreshToken", s.refreshToken);
  await setKv("rider", s.rider);
  set({ status: "ready", rider: s.rider });
}

/** The access token stopped working and could not be renewed: ask for the PIN again. */
export async function lockSession() {
  accessToken = null;
  const rider = await getKv<Session["rider"]>("rider");
  const refresh = await getKv<string>("refreshToken");
  set(refresh ? { status: "locked", riderName: rider?.name ?? null } : { status: "signedOut" });
}

/** The device was revoked or the PIN tries ran out: sign in again with an OTP. */
export async function signOut() {
  accessToken = null;
  await delKv("refreshToken");
  await delKv("rider");
  set({ status: "signedOut" });
}
