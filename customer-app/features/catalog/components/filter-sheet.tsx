"use client";
import * as m from "motion/react-m";
import { useState } from "react";
import { Sheet } from "@/components/ui/drawer";
import { cn } from "@/lib/format";
import { uiSpring } from "@/lib/motion";
import { RIPENESS } from "@/lib/ripeness";
import type { BoxSize, RipenessStage } from "@/lib/types";
import { DEFAULT_FILTERS, SORTS, type Filters, type Tab } from "../filters";

export function FilterSheet({ open, onOpenChange, value, onApply, tab }: { open: boolean; onOpenChange: (o: boolean) => void; value: Filters; onApply: (f: Filters) => void; tab: Tab }) {
  const [draft, setDraft] = useState(value);
  const [active, setActive] = useState<Tab>(tab);
  const [wasOpen, setWasOpen] = useState(open);
  // Reset the draft to the applied filters each time the sheet opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(value);
      setActive(tab);
    }
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: "sort", label: "Sort by" },
    { id: "ripeness", label: "Ripeness" },
    { id: "size", label: "Box size" },
    { id: "more", label: "Sweetness" },
  ];
  const opt = (on: boolean, label: string, onClick: () => void, key: string) => (
    <button key={key} type="button" role="radio" aria-checked={on} onClick={onClick} className="flex h-12 w-full items-center justify-between gap-3 border-b border-line text-left text-13 text-ink">
      {label}
      <span aria-hidden className={cn("grid size-5 place-items-center rounded-full border-2", on ? "border-action" : "border-line")}>
        {on && <span className="size-2.5 rounded-full bg-action" />}
      </span>
    </button>
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      desktop="dialog"
      footer={
        <div className="flex gap-3 p-3">
          <button type="button" onClick={() => setDraft(DEFAULT_FILTERS)} className="press h-12 flex-1 rounded-12 border border-line text-15 font-semibold text-ink">
            Clear all
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
            className="press h-12 flex-1 rounded-12 bg-action text-15 font-semibold text-white"
          >
            Apply
          </button>
        </div>
      }
    >
      <div className="flex min-h-[320px]">
        <div role="tablist" aria-orientation="vertical" className="w-[120px] shrink-0 bg-canvas">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={active === t.id} type="button" onClick={() => setActive(t.id)} className={cn("relative flex h-12 w-full items-center px-3 text-left text-13", active === t.id ? "bg-surface font-semibold text-ink" : "text-muted")}>
              {active === t.id && <m.span layoutId="filter-tab" transition={uiSpring} className="absolute inset-y-0 left-0 w-1 rounded-r-4 bg-action" />}
              {t.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label={tabs.find((t) => t.id === active)?.label} className="flex-1 px-4">
          {active === "sort" && SORTS.map((s) => opt(draft.sort === s.id, s.label, () => setDraft({ ...draft, sort: s.id }), s.id))}
          {active === "ripeness" &&
            [null, "ripe", "semi-raw", "raw"].map((r) =>
              opt(draft.ripeness === r, r ? RIPENESS[r as RipenessStage].label : "Any ripeness", () => setDraft({ ...draft, ripeness: r as RipenessStage | null }), String(r)),
            )}
          {active === "size" && [null, 3, 5].map((s) => opt(draft.size === s, s ? `${s} kg box` : "Any box size", () => setDraft({ ...draft, size: s as BoxSize | null }), String(s)))}
          {active === "more" && (
            <>
              {[0, 3, 4, 5].map((n) => opt(draft.sweetness === n, n ? `Sweetness ${n === 5 ? "5 (very sweet)" : `${n} and above`}` : "Any sweetness", () => setDraft({ ...draft, sweetness: n }), `sw${n}`))}
              <label className="flex h-12 items-center justify-between text-13 text-ink">
                Hide out of stock
                <input type="checkbox" checked={draft.inStockOnly} onChange={(e) => setDraft({ ...draft, inStockOnly: e.target.checked })} className="size-5 accent-(--color-action)" />
              </label>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

