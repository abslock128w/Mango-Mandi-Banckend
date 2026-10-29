"use client";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api/client";
import type { Profile } from "@/lib/types";
import { errorText } from "./errors";
import { loadGoogle, useAuthConfig } from "./third-party";

/** Google's own button. Renders nothing until the API says Google sign-in is set up. */
export function GoogleButton({ onSignedIn, onError }: { onSignedIn: (p: Profile) => void; onError: (message: string) => void }) {
  const clientId = useAuthConfig().data?.googleClientId ?? null;
  const box = useRef<HTMLDivElement>(null);
  const done = useRef({ onSignedIn, onError });
  useEffect(() => {
    done.current = { onSignedIn, onError };
  });

  useEffect(() => {
    if (!clientId || !box.current) return;
    let live = true;
    loadGoogle()
      .then(() => {
        if (!live || !box.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          context: "signin",
          callback: ({ credential }) =>
            void api.signInWithGoogle(credential).then(
              (p) => done.current.onSignedIn(p),
              (err) => done.current.onError(errorText(err)),
            ),
        });
        window.google.accounts.id.renderButton(box.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: Math.min(box.current.clientWidth || 320, 400),
        });
      })
      .catch((err: Error) => live && done.current.onError(err.message));
    return () => {
      live = false;
    };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="space-y-4">
      <div ref={box} className="flex min-h-11 justify-center" />
      <p aria-hidden className="flex items-center gap-3 text-12 text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
        or
      </p>
    </div>
  );
}
