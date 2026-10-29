import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/format";

/** The MandiMangoes mark (design/brand) and wordmark. The mark alone below 96 px (design/COMPONENTS.md). */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/" aria-label="MandiMangoes home" className={cn("inline-flex items-center font-display font-extrabold tracking-tight", className)}>
      <Image src="/brand/mark-96.webp" alt="" width={40} height={40} priority className="size-10 shrink-0" />
      {!compact && (
        <span className="ml-2 text-19 leading-none">
          <span className="text-deep">Mandi</span>
          <span className="text-ripe">Mangoes</span>
        </span>
      )}
    </Link>
  );
}
