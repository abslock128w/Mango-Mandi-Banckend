"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const base = "press inline-flex items-center justify-center gap-2 rounded-2xl px-5 font-semibold text-center";
const sizes = {
  md: "min-h-12 text-base",
  lg: "min-h-14 text-lg",
  xl: "min-h-16 text-xl",
} as const;
const variants = {
  // Disabled: the neutral disabled tokens, never faded opacity (design/COMPONENTS.md).
  primary: "bg-green text-white shadow-card active:bg-green-press disabled:bg-disabled disabled:text-disabled-ink disabled:shadow-none",
  // Mango yellow with dark ink: kept for the key confirmations (Mark picked up, Confirm code).
  confirm: "bg-mango text-ink shadow-card active:bg-mango-deep disabled:bg-disabled disabled:text-disabled-ink disabled:shadow-none",
  secondary: "border-2 border-green bg-paper text-green disabled:border-disabled disabled:text-disabled-ink",
  quiet: "bg-chip text-ink disabled:text-disabled-ink",
  danger: "bg-danger text-white disabled:bg-disabled disabled:text-disabled-ink",
} as const;

type Look = { variant?: keyof typeof variants; size?: keyof typeof sizes };
const cls = (variant: keyof typeof variants, size: keyof typeof sizes, extra: string) => `${base} ${sizes[size]} ${variants[variant]} ${extra}`;

export function Button({ variant = "primary", size = "md", className = "", ...p }: ComponentProps<"button"> & Look) {
  return <button type="button" {...p} className={cls(variant, size, className)} />;
}

export function LinkButton({ variant = "primary", size = "md", className = "", ...p }: ComponentProps<typeof Link> & Look) {
  return <Link {...p} className={cls(variant, size, className)} />;
}

export function A({ variant = "primary", size = "md", className = "", ...p }: ComponentProps<"a"> & Look) {
  return <a {...p} className={cls(variant, size, className)} />;
}

const accents = { none: "border border-line", green: "border-2 border-green", mango: "border-2 border-mango-deep" } as const;

export function Card({ className = "", accent = "none", children, ...p }: ComponentProps<"section"> & { accent?: keyof typeof accents }) {
  return (
    <section {...p} className={`rounded-[var(--radius-card)] bg-paper p-4 shadow-card ${accents[accent]} ${className}`}>
      {children}
    </section>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-base font-medium text-danger">
      {children}
    </p>
  );
}

/** Saved on the phone, waiting for signal, and the like. */
export function Notice({ children, tone = "warn", className = "" }: { children: ReactNode; tone?: "warn" | "plain"; className?: string }) {
  return (
    <p role="status" className={`rounded-xl px-3 py-2 text-base font-medium ${tone === "warn" ? "bg-warn-soft text-warn" : "bg-chip text-ink"} ${className}`}>
      {children}
    </p>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span aria-hidden className="size-6 animate-spin rounded-full border-[3px] border-line border-t-green" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
