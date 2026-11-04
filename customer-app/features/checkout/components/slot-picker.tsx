"use client";
import { cn, windowLabel } from "@/lib/format";
import type { ApiSlot } from "@/lib/types";

/** Delivery time chips for one day (from GET /delivery/slots). */
export function SlotPicker({ slots, value, onChange, invalid, id }: { slots: ApiSlot[]; value: string | null; onChange: (id: string) => void; invalid?: boolean; id?: string }) {
  return (
    <div id={id} role="radiogroup" aria-label="Delivery time" aria-invalid={invalid || undefined} className="grid grid-cols-2 gap-2">
      {slots.map((s) => {
        const on = s.id === value;
        const open = s.available !== false;
        const left = s.remainingBoxes;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!open}
            onClick={() => onChange(s.id)}
            className={cn(
              "press flex min-h-14 flex-col items-center justify-center rounded-12 border px-2 py-1.5 text-center",
              on ? "border-action bg-tint text-action" : invalid ? "border-danger bg-surface text-ink" : "border-line bg-surface text-ink",
              !open && "border-dashed bg-chip text-disabled-ink",
            )}
          >
            <span className="text-13 font-semibold">{s.label}</span>
            <span className="text-12">{windowLabel(s.startsAt, s.endsAt)}</span>
            <span className="text-11 text-muted">{!open ? "Full" : on ? "Selected" : left != null && left <= 10 ? `${left} boxes left` : "Available"}</span>
          </button>
        );
      })}
    </div>
  );
}
