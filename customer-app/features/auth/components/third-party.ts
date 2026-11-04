"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";

/**
 * Google Identity Services and Cloudflare Turnstile, loaded only when the API
 * says they are set up (GET /v1/auth/config). Same rules as the old shop's
 * auth-ui.tsx.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup"; context?: string }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
    turnstile?: {
      render: (el: HTMLElement, o: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

export const authConfigKey = ["auth-config"] as const;

export const useAuthConfig = () => useQuery({ queryKey: authConfigKey, queryFn: api.authConfig, staleTime: Infinity, retry: false });

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string, failMessage: string) {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        reject(new Error(failMessage));
      };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

export const loadGoogle = () => loadScript("https://accounts.google.com/gsi/client", "Could not load Google sign-in.");
const loadTurnstile = () => loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", "Could not load the security check. Check your connection and try again.");

/**
 * Cloudflare's check that a person, not a script, is asking for a code. Off
 * unless the API has a site key. Each token works once, so the widget is reset
 * after every request and solves itself again (usually invisibly).
 */
export function useTurnstile(onError: (message: string) => void) {
  const siteKey = useAuthConfig().data?.turnstileSiteKey ?? null;
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const fail = useRef(onError);
  useEffect(() => {
    fail.current = onError;
  });

  useEffect(() => {
    if (!siteKey || !box) return;
    let live = true;
    loadTurnstile()
      .then(() => {
        if (!live || !window.turnstile) return;
        widget.current = window.turnstile.render(box, {
          sitekey: siteKey,
          // The API checks this action and the hostname (mango-api src/turnstile.js).
          action: "otp",
          size: "flexible",
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        });
      })
      .catch((err: Error) => live && fail.current(err.message));
    return () => {
      live = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, box]);

  return {
    needed: Boolean(siteKey),
    token,
    /** Callback ref for the widget's box. */
    setBox,
    used() {
      setToken(null);
      if (widget.current) window.turnstile?.reset(widget.current);
    },
  };
}
