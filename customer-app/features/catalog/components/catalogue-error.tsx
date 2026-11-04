"use client";
import { CloudOff } from "lucide-react";

/** The catalogue could not be loaded: says so, with a way to try again, instead of skeletons that never end. */
export function CatalogueError({ onRetry, className = "" }: { onRetry: () => void; className?: string }) {
  return (
    <div role="alert" data-testid="catalogue-error" className={`flex flex-col items-center rounded-12 bg-surface px-4 py-8 text-center ${className}`}>
      <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
        <CloudOff aria-hidden size={26} strokeWidth={1.75} />
      </span>
      <h2 className="mt-3 text-15 font-bold text-ink">We couldn&apos;t load the mangoes</h2>
      <p className="mt-1 max-w-[300px] text-13 text-muted">Check your connection, then try again. Nothing in your cart is lost.</p>
      <button type="button" onClick={onRetry} className="press mt-4 h-11 rounded-8 bg-action px-5 text-13 font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
