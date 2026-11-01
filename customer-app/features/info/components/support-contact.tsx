"use client";
import { MessageCircle } from "lucide-react";
import { config, whatsappLink } from "@/lib/config";

/** How to reach a person: WhatsApp. */
export function SupportContact({ text = "Hello MandiMangoes, I need help" }: { text?: string }) {
  const link = whatsappLink(text);
  if (!link) return <p>Message us on WhatsApp at the shop&apos;s number. (This test build has no help number set.)</p>;
  return (
    <>
      <p>Message us on WhatsApp. Tell us your order number if you have one, and add a photo if something is wrong with a box.</p>
      <p>
        <a
          data-btn
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="press inline-flex h-11 items-center gap-2 rounded-12 bg-action px-4 text-13 font-semibold text-white"
        >
          <MessageCircle aria-hidden size={18} /> WhatsApp +{config.supportWhatsapp}
          <span className="sr-only"> (opens WhatsApp)</span>
        </a>
      </p>
    </>
  );
}
