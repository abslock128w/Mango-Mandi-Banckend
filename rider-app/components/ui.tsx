"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const base = "press inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold";
const variants = {
  // Disabled: the neutral disabled tokens, never faded opacity (design/COMPONENTS.md).
  primary: "bg-action text-white shadow-card disabled:bg-disabled disabled:shadow-none",
  secondary: "border-2 border-action bg-surface text-action disabled:border-disabled disabled:text-disabled-ink",
  quiet: "bg-chip text-ink disabled:text-disabled-ink",
  danger: "bg-danger text-white disabled:bg-disabled",
} as const;

export function Button({ variant = "primary", className = "", ...p }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button type="button" {...p} className={`${base} ${variants[variant]} ${className}`} />;
}

export function LinkButton({ variant = "primary", className = "", ...p }: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link {...p} className={`${base} ${variants[variant]} ${className}`} />;
}

export function A({ variant = "primary", className = "", ...p }: ComponentProps<"a"> & { variant?: keyof typeof variants }) {
  return <a {...p} className={`${base} ${variants[variant]} ${className}`} />;
}

export function Card({ className = "", children, ...p }: ComponentProps<"section">) {
  return (
    <section {...p} className={`rounded-[var(--radius-card)] bg-surface p-4 shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
      {children}
    </p>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-line border-t-action" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
