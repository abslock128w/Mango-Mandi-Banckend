"use client";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { useIsDesktop } from "@/lib/hooks/use-media";
import type { RipenessStage } from "@/lib/types";

export const productHref = (id: string, scope?: string, r?: RipenessStage) => {
  const p = new URLSearchParams();
  if (r) p.set("r", r);
  if (scope) p.set("src", scope);
  const s = p.toString();
  return `/p/${id}${s ? `?${s}` : ""}`;
};

/**
 * Phones: open the product as a bottom sheet over the current page (the URL
 * gains ?product= so Back closes it). Laptops: navigate to the full page with
 * a shared-element View Transition.
 */
export function useOpenProduct() {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  return (e: React.MouseEvent | null, id: string, scope: string, r?: RipenessStage) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
    e?.preventDefault();
    if (isDesktop) {
      startTransition(() => router.push(productHref(id, scope, r), { scroll: true }));
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("product", id);
    url.searchParams.set("src", scope);
    if (r) url.searchParams.set("r", r);
    else url.searchParams.delete("r");
    window.history.pushState({ productSheet: true }, "", url);
  };
}
