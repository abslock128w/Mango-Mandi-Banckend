import { Scooter } from "./scooter";

/** Delivery is always free at MandiMangoes (no fee, no minimum): the badge in the cart bar. */
export function DeliveryBadge({ size = 40 }: { size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-full bg-white text-deep ring-2 ring-brand" style={{ width: size, height: size }}>
      <Scooter className="size-[60%]" />
    </span>
  );
}

export function FreeDeliveryNote() {
  return (
    <div className="flex items-center gap-2.5 rounded-12 bg-surface p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint text-action">
        <Scooter className="size-6" />
      </span>
      <div>
        <p className="text-13 font-semibold text-ink">Delivery is free on every order</p>
        <p className="text-11 text-muted">No delivery fee and no minimum. Prices include GST.</p>
      </div>
    </div>
  );
}
