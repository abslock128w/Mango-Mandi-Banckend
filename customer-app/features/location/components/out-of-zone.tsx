"use client";
import { MapPinOff, MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/config";

/** Not delivered here yet. The API has no wait list for pincodes, so the shopper can ask us on WhatsApp. */
export function OutOfZone({ pincode, onRetry }: { pincode: string; onRetry: () => void }) {
  const wa = whatsappLink(`Hi, please deliver MandiMangoes to pincode ${pincode}.`);
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center" data-testid="out-of-zone">
      <span className="grid size-20 place-items-center rounded-full bg-brand-soft text-ripe">
        <MapPinOff aria-hidden size={36} strokeWidth={1.5} />
      </span>
      <h2 className="mt-4 font-display text-19 font-extrabold text-ink">We don&apos;t deliver to {pincode} yet</h2>
      <p className="mt-1 max-w-[300px] text-13 text-muted">We&apos;re adding areas through the season. Tell us you&apos;d like us there, or try a nearby pincode.</p>
      <div className="mt-5 w-full max-w-[280px] space-y-2">
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="press flex h-11 w-full items-center justify-center gap-1.5 rounded-8 border border-action text-13 font-semibold text-action">
            <MessageCircle aria-hidden size={16} /> Ask us on WhatsApp
          </a>
        )}
        <button type="button" onClick={onRetry} className="h-11 w-full rounded-8 text-13 font-semibold text-action">
          Try another pincode
        </button>
      </div>
    </div>
  );
}
