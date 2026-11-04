import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/format";

/**
 * The MandiMangoes wordmark (design/brand/wordmark.png): the two-line name with the mango as
 * the O. `compact` shows the mango alone, for tight spots such as the checkout header.
 */
export function Logo({ className, compact, height = 45 }: { className?: string; compact?: boolean; height?: number }) {
  return (
    <Link href="/" aria-label="MandiMangoes home" className={cn("inline-flex shrink-0 items-center", className)}>
      {compact ? (
        <Image src="/brand/mark-96.webp" alt="" width={40} height={40} priority className="size-10" />
      ) : (
        <Image src="/brand/logo-480.webp" alt="" width={Math.round(height * 2.374)} height={height} priority sizes={`${Math.round(height * 2.374)}px`} style={{ height, width: "auto" }} />
      )}
    </Link>
  );
}
