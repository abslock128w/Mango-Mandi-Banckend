"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, MapPin } from "lucide-react";
import { useAuth, useSignedIn } from "@/features/auth/store";
import { QtyStepper } from "@/features/bulk/components/qty-stepper";
import { StagePicker } from "@/features/bulk/components/stage-picker";
import { usePreorderWeeks } from "@/features/catalog/hooks/queries";
import { useLocation } from "@/features/location/store";
import { useUi } from "@/features/shell/ui-store";
import { PageTransition } from "@/features/shell/page-transition";
import { api, ApiError, qk } from "@/lib/api/client";
import { cn, rupees } from "@/lib/format";
import type { PreorderWeek, RipenessStage } from "@/lib/types";
import { realPayUrl, weekOf, weekRange } from "../status";

const MAX_BOXES = 20;
const DRAFT_KEY = "mm.preorderDraft";

interface Draft {
  sku: string;
  weekStart: string;
  stage: RipenessStage;
  qty: number;
  name: string;
  address: string;
}
function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function keepDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // private mode: the form starts empty after sign-in
  }
}

interface SkuGroup {
  sku: string;
  name: string;
  variety: string;
  boxSize: string;
  price: number;
  weeks: PreorderWeek[];
}

/** /preorder: book a box for a delivery week of the coming season at today's price (GET /v1/preorders/weeks, POST /v1/preorders). */
export function PreorderView() {
  const hydrated = useUi((s) => s.hydrated);
  const q = usePreorderWeeks();
  return (
    <PageTransition>
      <div className="mx-auto max-w-content px-4 pt-4 pb-10 lg:px-6">
        <section className="rounded-16 bg-deep p-5 text-white lg:p-8" aria-labelledby="pre-h">
          <p className="flex items-center gap-1.5 text-12 font-bold tracking-wide text-brand uppercase">
            <CalendarClock aria-hidden size={16} /> Book ahead
          </p>
          <h1 id="pre-h" className="mt-1 font-display text-24 leading-tight font-extrabold lg:text-36">
            Book your box for the new season
          </h1>
          <p className="mt-2 max-w-xl text-13 lg:text-15">
            The season starts in the first week of March. Booking opens in January. Pick a week and pay today&apos;s price now. Once the fruit is in, we choose
            your delivery day in that week and message you.
          </p>
        </section>

        <div className="mt-5">
          {!hydrated || q.isPending ? (
            <div className="space-y-3" aria-label="Loading open weeks">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="skeleton h-40 rounded-16" />
              ))}
            </div>
          ) : q.isError ? (
            <div role="alert" className="rounded-12 bg-danger-soft p-4 text-13 text-danger">
              <p>{q.error instanceof ApiError ? q.error.message : "Couldn't load the open weeks."}</p>
              <button type="button" onClick={() => q.refetch()} className="press mt-2 h-11 rounded-8 bg-surface px-4 font-semibold text-action">
                Try again
              </button>
            </div>
          ) : !q.data.weeks.length ? (
            <div className="flex flex-col items-center rounded-16 bg-surface px-6 py-10 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-ink">
                <CalendarClock aria-hidden size={24} />
              </span>
              <h2 className="mt-3 text-17 font-bold text-ink">No weeks open for booking</h2>
              <p className="mt-1 max-w-md text-13 text-muted">Booking opens in January, once we know how much fruit is coming. Order for the next few days in the shop.</p>
              <Link href="/" className="press mt-4 inline-flex h-11 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
                Shop now
              </Link>
            </div>
          ) : (
            <BookForm weeks={q.data.weeks} stages={q.data.stages} cancelPolicy={q.data.cancelPolicy} onStale={() => void q.refetch()} />
          )}
        </div>
      </div>
    </PageTransition>
  );
}

function BookForm({ weeks, stages, cancelPolicy, onStale }: { weeks: PreorderWeek[]; stages: RipenessStage[]; cancelPolicy: string; onStale: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const profile = useAuth((s) => s.profile);
  const where = useLocation((s) => s.address);
  const pincode = where?.pincode ?? null;

  const groups = useMemo<SkuGroup[]>(() => {
    const map = new Map<string, SkuGroup>();
    for (const w of weeks) {
      const g = map.get(w.sku) ?? { sku: w.sku, name: w.name, variety: w.variety, boxSize: w.boxSize, price: w.price, weeks: [] };
      g.weeks.push(w);
      map.set(w.sku, g);
    }
    for (const g of map.values()) g.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return [...map.values()];
  }, [weeks]);

  // Back from signing in: what the visitor had filled in, if that week is still open.
  const [draft] = useState(() => {
    const d = readDraft();
    return d && weeks.some((w) => w.sku === d.sku && w.weekStart === d.weekStart) ? d : null;
  });
  useEffect(() => keepDraft(null), []);

  const firstOpen = weeks.find((w) => w.remaining > 0) ?? weeks[0];
  const [sel, setSel] = useState({ sku: draft?.sku ?? firstOpen.sku, weekStart: draft?.weekStart ?? firstOpen.weekStart });
  const pick = weeks.find((w) => w.sku === sel.sku && w.weekStart === sel.weekStart) ?? firstOpen;
  const [stage, setStage] = useState<RipenessStage>(draft?.stage ?? (stages.includes("SEMI_RIPE") ? "SEMI_RIPE" : stages[0]));
  const [qty, setQty] = useState(draft?.qty ?? 1);
  const [name, setName] = useState(draft?.name ?? profile?.name ?? "");
  const [address, setAddress] = useState(draft?.address ?? (where ? [where.line1, where.line2, where.city].filter(Boolean).join(", ") : ""));
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const waitlist = pick.remaining <= 0;
  const max = waitlist ? MAX_BOXES : Math.min(MAX_BOXES, pick.remaining);
  const boxes = Math.max(1, Math.min(qty, max));
  const total = pick.price * boxes;

  const book = useMutation({
    mutationFn: () =>
      api.bookPreorder({ sku: pick.sku, stage, qty: boxes, weekStart: pick.weekStart, pincode: pincode!, address: address.trim(), name: name.trim() || undefined, ...(waitlist ? { waitlist: true } : {}) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.preorders });
      qc.invalidateQueries({ queryKey: qk.preorderWeeks });
      qc.setQueryData(qk.preorder(p.id), p);
      const url = realPayUrl(p);
      // Razorpay brings the customer back to /preorders/:id after paying.
      if (url) window.location.assign(url);
      else router.push(`/preorders/${p.id}`);
    },
    onError: (err) => {
      // The week filled or closed while the form was open: show the new numbers.
      if (err instanceof ApiError && ["PREORDER_FULL", "INVALID_WEEK"].includes(err.code)) onStale();
    },
  });

  function choose(sku: string, weekStart: string) {
    setSel({ sku, weekStart });
    book.reset();
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signedIn) {
      keepDraft({ sku: pick.sku, weekStart: pick.weekStart, stage, qty: boxes, name: name.trim(), address: address.trim() });
      return router.push(`/login?next=${encodeURIComponent("/preorder")}`);
    }
    if (!pincode) return router.push(`/location?next=${encodeURIComponent("/preorder")}`);
    const a = address.trim();
    if (a.length < 10) return setError("Enter the full address: house or flat number, street, area and a landmark.");
    if (a.length > 500) return setError("Keep the address under 500 characters.");
    book.mutate();
  }

  const unpaidId = book.error instanceof ApiError && book.error.code === "UNPAID_PREORDER_EXISTS" && typeof book.error.extra.preorderId === "string" ? book.error.extra.preorderId : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-8">
      <section aria-labelledby="weeks-h">
        <h2 id="weeks-h" className="text-15 font-bold text-ink">
          Pick a box and a week
        </h2>
        <p className="text-12 text-muted">Each week starts on a Monday. We deliver on one day that week.</p>
        <ul className="mt-3 space-y-3">
          {groups.map((g) => (
            <li key={g.sku} className="rounded-16 border-[0.5px] border-line bg-surface p-3 shadow-card lg:p-4" data-testid="preorder-sku">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-15 font-bold text-ink">{g.name}</h3>
                  <p className="text-12 text-muted">
                    {g.variety} · {g.boxSize} box
                  </p>
                </div>
                <b className="shrink-0 text-17 text-ink">{rupees(g.price)}</b>
              </div>
              <div role="radiogroup" aria-label={`Weeks for ${g.name}`} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.weeks.map((w) => {
                  const on = w.sku === pick.sku && w.weekStart === pick.weekStart;
                  const full = w.remaining <= 0;
                  return (
                    <button
                      key={w.weekStart}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${weekOf(w.weekStart)}, ${full ? "fully booked, waitlist open" : `${w.remaining} left`}`}
                      onClick={() => choose(w.sku, w.weekStart)}
                      className={cn("press flex min-h-11 flex-col items-start rounded-12 border px-3 py-2 text-left", on ? "border-action bg-tint" : "border-line bg-surface")}
                    >
                      <span className="text-13 font-semibold text-ink">{weekRange(w.weekStart)}</span>
                      <span className={cn("text-11", full ? "text-danger" : w.remaining <= 10 ? "text-ribbon" : "text-muted")}>
                        {full ? "Full. Join the waitlist" : w.remaining <= 10 ? `Only ${w.remaining} left` : `${w.remaining} of ${w.capacity} open`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="book-h" className="scroll-mt-24 space-y-4 rounded-16 border-[0.5px] border-line bg-surface p-4 shadow-card lg:sticky lg:top-[110px] lg:self-start">
        <div>
          <h2 id="book-h" className="text-15 font-bold text-ink">
            {pick.name}, {weekOf(pick.weekStart).toLowerCase()}
          </h2>
          <p className="text-12 text-muted">
            {pick.variety} · {pick.boxSize} box · {rupees(pick.price)} a box
          </p>
        </div>

        <StagePicker legend="Ripeness on arrival" stages={stages} value={stage} onChange={setStage} />

        <div className="flex items-center justify-between gap-3">
          <span className="text-13 font-semibold text-ink">Boxes</span>
          <QtyStepper label="Boxes" value={boxes} min={1} max={max} onChange={setQty} />
        </div>

        <label className="block">
          <span className="text-12 font-semibold text-ink">Your name</span>
          <input
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-11 w-full rounded-8 border border-line bg-surface px-3 text-13 text-ink outline-none focus:border-action"
          />
        </label>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-12 font-semibold text-ink">
              <MapPin aria-hidden size={14} /> {pincode ? `Delivering to ${pincode}` : "No pincode set"}
            </span>
            <Link href={`/location?next=${encodeURIComponent("/preorder")}`} className="flex h-11 items-center text-13 font-semibold text-action">
              {pincode ? "Change" : "Set pincode"}
            </Link>
          </div>
          <label className="block">
            <span className="text-12 font-semibold text-ink">Delivery address</span>
            <textarea
              id="pre-address"
              autoComplete="street-address"
              rows={3}
              maxLength={500}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby="pre-address-hint"
              className={cn("mt-1 w-full rounded-8 border bg-surface px-3 py-2 text-13 text-ink outline-none focus:border-action", error ? "border-danger" : "border-line")}
            />
            <span id="pre-address-hint" className="block text-11 text-muted">
              House or flat number, street, area and a landmark.
            </span>
          </label>
          {error && (
            <p role="alert" className="mt-1 text-12 text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-13 text-ink">
            {boxes} × {pick.name}
          </span>
          <b className="text-17 text-ink">{rupees(total)}</b>
        </div>
        <p className="text-12 text-muted">
          {waitlist ? "This week is fully booked. Join the waitlist and we'll send you a payment link if a box frees up. Nothing is charged now." : cancelPolicy}
        </p>
        <p className="text-11 text-muted">Prepaid. GST included. No delivery fee.</p>

        {book.error && (
          <div role="alert" className="rounded-8 bg-danger-soft px-3 py-2 text-13 text-danger">
            <p>{book.error instanceof ApiError ? book.error.message : "Couldn't book. Please try again."}</p>
            {unpaidId && (
              <Link href={`/preorders/${unpaidId}`} className="mt-1 inline-flex h-11 items-center font-semibold underline">
                Open your unpaid booking
              </Link>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={book.isPending}
          data-testid="preorder-book"
          className="press flex h-14 w-full items-center justify-center gap-2 rounded-12 bg-action text-17 font-bold text-white disabled:bg-disabled"
        >
          {book.isPending && <Loader2 aria-hidden size={20} className="animate-spin" />}
          {!signedIn ? (waitlist ? "Log in to join the waitlist" : "Log in to book") : !pincode ? "Set your pincode" : waitlist ? "Join the waitlist" : `Book and pay ${rupees(total)}`}
        </button>
        {!signedIn && <p className="text-center text-12 text-muted">You log in with your mobile number, then come back here to book and pay.</p>}
      </form>
    </div>
  );
}
