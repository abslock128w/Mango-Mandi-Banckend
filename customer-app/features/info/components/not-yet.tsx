"use client";
import Link from "next/link";
import { Sprout } from "lucide-react";
import { whatsappLink } from "@/lib/config";

/** Old shop links to features this shop does not have yet (invites, help requests, subscriptions). */
export function NotYet({ title, body, whatsappText }: { title: string; body: string; whatsappText: string }) {
  const wa = whatsappLink(whatsappText);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-ink">
        <Sprout aria-hidden size={30} strokeWidth={1.75} />
      </span>
      <h1 className="mt-4 text-19 font-bold text-ink">{title}</h1>
      <p className="mt-1 max-w-[340px] text-13 text-muted">{body}</p>
      <div className="mt-6 flex w-full max-w-[280px] flex-col gap-2">
        <Link href="/" className="press flex h-12 items-center justify-center rounded-12 bg-action text-15 font-semibold text-white">
          Shop mangoes
        </Link>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="press flex h-12 items-center justify-center rounded-12 border border-line bg-surface text-15 font-semibold text-action">
            Message us on WhatsApp<span className="sr-only"> (opens WhatsApp)</span>
          </a>
        )}
      </div>
    </main>
  );
}
