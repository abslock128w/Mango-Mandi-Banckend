import type { StopState } from "@/lib/run-context";

const CHIP: Record<StopState, [string, string]> = {
  unpacked: ["Not packed", "bg-chip text-muted"],
  pickup: ["To pick up", "bg-brand-soft text-deep"],
  out: ["On the way", "bg-tint text-action"],
  delivered: ["Delivered", "bg-action text-white"],
  missed: ["Missed", "bg-danger-soft text-danger"],
};

export function StopChip({ state }: { state: StopState }) {
  const [label, cls] = CHIP[state];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-semibold ${cls}`}>{label}</span>;
}
