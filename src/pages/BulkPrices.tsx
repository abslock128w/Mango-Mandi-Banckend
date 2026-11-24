// Bulk prices (mango-api bulk-price.js), on the Products page: what a box costs in a bulk order placed in the shop.
// One default discount for everything (25% unless changed: a ₹100 box is ₹75 in bulk), and per variety the 5 kg
// box's own bulk price, or "use the default discount". The 10 kg bulk box is two 5 kg boxes of fruit, so it always
// costs twice the 5 kg bulk price: it is shown beside it, not edited on its own. Saving asks the manager to confirm
// it is them (a price change). Money is in paise in the API and in whole rupees in the inputs.
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api } from "../api";
import { ApiError } from "../apiAnswer";
import { rupees } from "../format";
import { useSession } from "../session";
import { MONEY_CHANGE_WHY, useStepUp } from "../StepUp";
import type { BulkPriceList } from "../types";
import { FormError, QueryError, Spinner, scrollRegion, useToast } from "../ui";

/** Whole rupees from the shop price less `pct` percent, as the API rounds it. */
const discounted = (paise: number, pct: number) =>
  Math.round((paise * (100 - pct)) / 100 / 100) * 100;

export function BulkPrices() {
  const q = useQuery({
    queryKey: ["bulk-prices"],
    queryFn: api.bulkPrices,
    retry: false,
  });
  if (q.isPending)
    return (
      <section className="card">
        <Spinner label="Loading bulk prices" />
      </section>
    );
  if (q.isError) {
    // Off (BULK_ENQUIRIES) or an API without bulk prices yet: nothing to edit.
    if (q.error instanceof ApiError && q.error.status === 404) return null;
    return (
      <section className="card">
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      </section>
    );
  }
  return (
    <Editor
      key={
        q.data.version +
        JSON.stringify(q.data.varieties.map((v) => v.box?.bulkPrice))
      }
      list={q.data}
    />
  );
}

function Editor({ list }: { list: BulkPriceList }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { me } = useSession();
  const manager = me?.role === "MANAGER";
  const stepUp = useStepUp(MONEY_CHANGE_WHY);
  const [pct, setPct] = useState(String(list.discountPct));
  // sku → '' (use the default discount) or whole rupees as typed.
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      list.varieties
        .filter((v) => v.box)
        .map((v) => [
          v.box!.sku,
          v.box!.bulkPrice != null ? String(v.box!.bulkPrice / 100) : "",
        ]),
    ),
  );
  const pctNum = Number(pct);
  const pctOk = /^\d{1,2}$/.test(pct.trim()) && pctNum >= 0 && pctNum <= 90;
  const rows = useMemo(() => list.varieties.filter((v) => v.box), [list]);
  const others = list.varieties.flatMap((v) => v.other.map((o) => o.name));

  const problem = (() => {
    if (!pctOk) return "The default discount is a whole percent from 0 to 90.";
    for (const v of rows) {
      const t = own[v.box!.sku]?.trim() ?? "";
      if (!t) continue;
      if (!/^\d+$/.test(t) || Number(t) < 1)
        return `${v.variety}: the bulk price is whole rupees (or leave it empty for the default discount).`;
      if (Number(t) * 100 > v.box!.price)
        return `${v.variety}: the bulk price can't be above the shop price (${rupees(v.box!.price)}).`;
    }
    return null;
  })();

  const save = useMutation({
    mutationFn: () => {
      const prices = rows.map((v) => {
        const t = own[v.box!.sku]?.trim() ?? "";
        return { sku: v.box!.sku, bulkPrice: t ? Number(t) * 100 : null };
      });
      return stepUp.run((code) =>
        api.saveBulkPrices({ discountPct: pctNum, prices }, code),
      );
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["bulk-prices"], next);
      toast.success(
        "Bulk prices saved. The shop shows them from now; orders already placed keep theirs.",
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!problem && manager) save.mutate();
  }

  return (
    <>
      <form
        className="card"
        onSubmit={onSubmit}
        aria-labelledby="bulk-prices-h"
        data-testid="bulk-prices"
      >
        <h2 id="bulk-prices-h">Bulk prices</h2>
        <p className="small muted">
          What a box costs in a bulk order (100 kg or more, paid in the shop).
          By default the shop price less the discount below, in whole rupees.
          Set a variety’s own price to override it. The 10 kg bulk box is two 5
          kg boxes of fruit, so it costs twice the 5 kg bulk price.
        </p>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="bulk-pct">Default bulk discount (%)</label>
          <input
            id="bulk-pct"
            inputMode="numeric"
            value={pct}
            disabled={!manager}
            onChange={(e) => setPct(e.target.value)}
          />
        </div>
        <div {...scrollRegion("Bulk prices", { cards: true })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Variety</th>
                <th scope="col" className="num">
                  5 kg shop price
                </th>
                <th scope="col">5 kg bulk price (₹)</th>
                <th scope="col" className="num">
                  5 kg in bulk
                </th>
                <th scope="col" className="num">
                  10 kg in bulk
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const b = v.box!;
                const t = own[b.sku]?.trim() ?? "";
                const five =
                  t && /^\d+$/.test(t)
                    ? Number(t) * 100
                    : discounted(b.price, pctOk ? pctNum : list.discountPct);
                const off = b.price
                  ? Math.round(((b.price - five) / b.price) * 100)
                  : 0;
                return (
                  <tr key={b.sku}>
                    <td data-label="Variety">
                      <strong>{v.variety}</strong>
                      <div className="small muted">{b.name}</div>
                    </td>
                    <td data-label="5 kg shop price" className="num">
                      {rupees(b.price)}
                    </td>
                    <td data-label="5 kg bulk price (₹)">
                      <input
                        aria-label={`${v.variety} 5 kg bulk price in rupees; empty uses the default discount`}
                        inputMode="numeric"
                        placeholder={`Default: ${rupees(discounted(b.price, pctOk ? pctNum : list.discountPct))}`}
                        value={own[b.sku] ?? ""}
                        disabled={!manager}
                        onChange={(e) =>
                          setOwn((o) => ({ ...o, [b.sku]: e.target.value }))
                        }
                        style={{ maxWidth: 170 }}
                      />
                      <div className="small muted">
                        {t ? "Own price" : "Uses the default discount"}
                      </div>
                    </td>
                    <td data-label="5 kg in bulk" className="num">
                      {rupees(five)}{" "}
                      <span className="small muted">({off}% off)</span>
                    </td>
                    <td data-label="10 kg in bulk" className="num">
                      {rupees(five * 2)}{" "}
                      <span className="small muted">
                        (shop {rupees(b.price * 2)})
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {others.length > 0 && (
          <p className="small muted">
            Not sold in bulk (bulk boxes are 5 kg and 10 kg only):{" "}
            {others.join(", ")}.
          </p>
        )}
        {problem && <p className="hint">{problem}</p>}
        <FormError error={save.error} />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!manager || Boolean(problem) || save.isPending}
          aria-describedby={!manager ? "bulk-prices-why" : undefined}
        >
          {!manager && <Lock size={14} aria-hidden="true" />}{" "}
          {save.isPending ? "Saving…" : "Save bulk prices"}
        </button>
        {!manager && (
          <p className="small muted" id="bulk-prices-why">
            <Lock size={12} aria-hidden="true" /> Only a manager can change bulk
            prices.
          </p>
        )}
      </form>
      {/* Outside the form: the confirmation has a form of its own. */}
      {stepUp.dialog}
    </>
  );
}
