import Link from "next/link";

export function SignInPrompt({ next, title = "Log in to see your orders" }: { next: string; title?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <p className="text-17 font-bold text-ink">{title}</p>
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="press mt-4 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
        Log in
      </Link>
    </div>
  );
}
