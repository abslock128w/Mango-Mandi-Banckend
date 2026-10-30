"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";
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
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner />
    </div>
  );
}
