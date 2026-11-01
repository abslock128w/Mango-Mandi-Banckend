import Link from "next/link";
import { Logo } from "@/features/shell/logo";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 text-center">
      <Logo />
      <p className="mt-8 font-display text-36 font-extrabold text-ink">404</p>
      <h1 className="mt-1 text-19 font-bold text-ink">This page fell off the tree</h1>
      <p className="mt-1 max-w-xs text-13 text-muted">The link may be old, or the mango may be out of season.</p>
      <Link href="/" className="press mt-6 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
        Back to home
      </Link>
    </main>
  );
}
