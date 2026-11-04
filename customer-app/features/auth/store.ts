"use client";
import { create } from "zustand";
import { PROFILE_EVENT, SIGNOUT_EVENT, signedInProfile } from "@/lib/api/client";
import type { Profile } from "@/lib/types";

/**
 * Who is signed in, mirrored from lib/api/client (which owns the session:
 * access token in memory, refresh token in an httpOnly cookie).
 */
interface AuthState {
  profile: Profile | null;
  sync: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  profile: null,
  sync: () => set({ profile: signedInProfile() }),
}));

if (typeof window !== "undefined") {
  window.addEventListener(PROFILE_EVENT, () => useAuth.getState().sync());
  window.addEventListener(SIGNOUT_EVENT, () => useAuth.getState().sync());
}

export const useSignedIn = () => useAuth((s) => Boolean(s.profile));
