import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/format";

/**
 * The MandiMangoes wordmark (design/brand/wordmark.png): the two-line name with the mango as
 * the O. `compact` shows the mango alone, for tight spots such as the checkout header.
 */
export function Logo({ className, compact, height = 45 }: { className?: string; compact?: boolean; height?: number }) {
  return (
    <Link href="/" aria-label="MandiMangoes home" className={cn("tap inline-flex shrink-0 items-center", className)}>
      {compact ? (
        <Image src="/brand/mark-96.webp" alt="" width={40} height={40} priority className="size-10" />
      ) : (
        // Drawn at its width and height attributes (the file is 480 x 202): setting one in CSS and
        // the other to auto left the width a fraction of a pixel off, which Next warns about.
        <Image src="/brand/logo-480.webp" alt="" width={Math.round((height * 480) / 202)} height={height} priority sizes={`${Math.round((height * 480) / 202)}px`} />
      )}
    </Link>
  );
}
