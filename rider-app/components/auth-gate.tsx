"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";
import { Brand } from "./brand";
import { Login } from "./login";
import { Unlock } from "./unlock";
import { Spinner } from "./ui";

/** The start screen: sign in on a new phone, the PIN on a bound one, else today's run. */
export function AuthGate() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (s.status === "ready") router.replace("/today");
  }, [s.status, router]);
  if (s.status === "signedOut") return <Login />;
  if (s.status === "locked") return <Unlock name={s.riderName} />;
  // While the session is read from the phone: the same frame as sign-in, so the first paint
  // already shows the screen's words (and nothing jumps when sign-in or the PIN replaces it).
  return (
    <div className="flex min-h-dvh flex-col">
      <Brand />
      <div className="flex flex-1 flex-col gap-6 px-6 pb-10">
        <div className="flex flex-col gap-2">
          <p className="font-display text-4xl text-green">Your run</p>
          {/* The largest text on the first paint, a little longer than sign-in's or the PIN's own words, so the
              screen that replaces it is not a later, larger paint (Lighthouse's largest contentful paint). */}
          <p className="text-lg text-muted">
            Collect each box at the warehouse with a photo of its seal. At every door: a photo of the box, a photo of the open box for the mango
            check, then the customer&apos;s 4-digit code.
          </p>
        </div>
        <div className="grid place-items-center pt-6">
          <Spinner />
        </div>
      </div>
    </div>
  );
}
