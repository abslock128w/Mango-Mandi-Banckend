"use client";
import { CloudUpload } from "lucide-react";

/** How many steps are saved on the phone and not sent yet. */
export function PendingBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span role="status" data-testid="pending-badge" className="inline-flex items-center gap-2 rounded-full bg-warn-soft px-3 py-1 text-sm font-semibold text-warn">
      <CloudUpload aria-hidden size={16} />
      {count} pending upload{count === 1 ? "" : "s"}
    </span>
  );
}
