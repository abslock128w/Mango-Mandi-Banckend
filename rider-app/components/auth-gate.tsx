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
      <div className="flex flex-1 flex-col gap-5 px-6 pb-10">
        <p className="text-3xl font-extrabold">Your run</p>
        <p className="text-lg text-muted">Pick up each box at the warehouse with a photo, then at each door the photos and the customer&apos;s code.</p>
        <div className="grid place-items-center pt-6">
          <Spinner />
        </div>
      </div>
    </div>
  );
}
