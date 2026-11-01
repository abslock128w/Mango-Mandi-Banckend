import { Bike, FileText, ReceiptText, TicketPercent } from "lucide-react";
import { rupees } from "@/lib/format";

/**
 * The bill as the API prices it (POST /v1/checkout/quote): items, promo,
 * free delivery, to pay. Before a quote, `estimate` marks it as provisional.
 */
export function BillDetails({ subtotal, discount = 0, promo, total, estimate }: { subtotal: number; discount?: number; promo?: { code: string; description: string } | null; total: number; estimate?: boolean }) {
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode, testid?: string) => (
    <div className="flex items-center justify-between gap-2 py-1.5 text-12 text-ink">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span data-testid={testid}>{value}</span>
    </div>
  );
  return (
    <section aria-labelledby="bill-h" className="rounded-12 bg-surface p-3">
      <h2 id="bill-h" className="mb-1 text-15 font-bold text-ink">
        Bill details
      </h2>
      {row(<FileText aria-hidden size={16} strokeWidth={1.75} />, "Items total", rupees(subtotal))}
      {promo &&
        row(
          <TicketPercent aria-hidden size={16} strokeWidth={1.75} />,
          `Promo (${promo.code})`,
          <span className="font-semibold text-action">−{rupees(discount)}</span>,
          "promo-discount",
        )}
      {row(<Bike aria-hidden size={16} strokeWidth={1.75} />, "Delivery", <span className="font-semibold text-action">FREE</span>)}
      {row(<ReceiptText aria-hidden size={16} strokeWidth={1.75} />, "GST", <span className="text-muted">Included in prices</span>)}
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
        <span className="text-15 font-bold text-ink">{estimate ? "Estimated total" : "To pay"}</span>
        <span className="text-15 font-bold text-ink" data-testid="to-pay">
          {rupees(total)}
        </span>
      </div>
      {estimate && <p className="mt-1 text-11 text-muted">Checkout confirms stock and the final price for your day.</p>}
    </section>
  );
}
