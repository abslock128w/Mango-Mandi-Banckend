import { cn, ORDER_STATUS } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export function StatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: "bg-chip text-muted" };
  return <span className={cn("inline-flex h-6 items-center rounded-4 px-1.5 text-11 font-semibold whitespace-nowrap", s.tone, className)}>{s.label}</span>;
}
