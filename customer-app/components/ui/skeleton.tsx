import { cn } from "@/lib/format";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-8", className)} />;
}
