import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Logo } from "@/features/shell/logo";
import { RetryButton } from "./retry";

export const metadata: Metadata = { title: "You're offline" };
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 text-center">
      <Logo />
      <span className="mt-8 grid size-20 place-items-center rounded-full bg-brand-soft text-ripe">
        <WifiOff aria-hidden size={36} strokeWidth={1.5} />
      </span>
      <h1 className="mt-4 text-19 font-bold text-ink">You&apos;re offline</h1>
      <p className="mt-1 max-w-xs text-13 text-muted">Check your connection. Your cart is saved on this device and will be here when you&apos;re back.</p>
      <RetryButton />
    </main>
  );
}
