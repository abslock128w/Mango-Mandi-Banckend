"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Logo } from "./logo";

export function FlowHeader({ title, back = true, href }: { title: string; back?: boolean; href?: string }) {
  const router = useRouter();
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-content items-center gap-2 px-2 lg:h-[72px] lg:px-6">
        {back && (
          <button type="button" onClick={() => (href ? router.push(href) : window.history.length > 1 ? router.back() : router.push("/"))} aria-label="Back" className="press grid size-11 place-items-center rounded-full text-ink hover:bg-chip">
            <ArrowLeft size={20} strokeWidth={1.75} />
          </button>
        )}
        <span className="hidden lg:block">
          <Logo compact />
        </span>
        <h1 className="font-display text-17 font-extrabold text-ink lg:ml-2">{title}</h1>
      </div>
    </header>
  );
}
