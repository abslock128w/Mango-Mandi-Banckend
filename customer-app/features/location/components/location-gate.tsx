"use client";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/drawer";
import { useUi } from "@/features/shell/ui-store";
import { useLocation } from "../store";
import { PincodeForm } from "./pincode-form";

const ALLOW = [/^\/location/, /^\/offline/, /^\/login/, /^\/account/, /^\/orders/, /^\/order\//];

/** First-visit gate: no address yet, so ask for a serviceable pincode before shopping. */
export function LocationGate() {
  const hydrated = useUi((s) => s.hydrated);
  const address = useLocation((s) => s.address);
  const pathname = usePathname();
  const [dismissedPath, setDismissedPath] = useState<string | null>(null);
  const open = hydrated && !address && !ALLOW.some((r) => r.test(pathname)) && dismissedPath !== pathname;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && address && setDismissedPath(pathname)}
      title="Where should we deliver?"
      description="Pincode check for delivery"
      desktop="dialog"
    >
      <div className="p-4">
        <p className="mb-4 text-13 text-muted">Tell us where to deliver and we&apos;ll show what we can bring, at the ripeness you want, on the day you want.</p>
        <PincodeForm onDone={() => setDismissedPath(pathname)} />
      </div>
    </Sheet>
  );
}
