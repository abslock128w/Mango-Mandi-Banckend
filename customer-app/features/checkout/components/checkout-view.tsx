"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Gift, Loader2, MapPin, Receipt, ShieldCheck, TicketPercent, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useAuth } from "@/features/auth/store";
import { BillDetails } from "@/features/cart/components/bill-details";
import { cartCount, cartSubtotal, useCart } from "@/features/cart/store";
import { RipenessChip } from "@/features/catalog/components/ripeness-chip";
import { useDelivery, useDeliveryDate, usePolicy } from "@/features/catalog/hooks/queries";
import { useLocation, usePincode } from "@/features/location/store";
import { toast, useUi } from "@/features/shell/ui-store";
import { api, ApiError, qk } from "@/lib/api/client";
import { cn, dayName, plural, rupees, windowLabel } from "@/lib/format";
import type { Confirmation, Quote } from "@/lib/types";
import { checkoutProblem, isPromoError, promoProblem } from "../errors";
import { gstinProblem, tidyGstin } from "../gstin";
import { openRazorpay } from "../payment";
import { cartKey, syncCart } from "../sync";
import { DayChips } from "./day-chips";
import { DevPayButtons } from "./dev-pay";
import { HoldCountdown } from "./hold-countdown";
import { SlotPicker } from "./slot-picker";

const input = "h-11 w-full rounded-8 border border-line bg-surface px-3 text-13 text-ink outline-none focus:border-action aria-[invalid=true]:border-danger";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MOBILE = /^[6-9]\d{9}$/;
const tidyPhone = (s: string) => s.replace(/[\s-]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, "");

function Card({ title, icon, action, children, id }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  const h = useId();
  return (
    <section id={id} className="rounded-12 bg-surface p-3 lg:p-4" aria-labelledby={h}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={h} className="flex items-center gap-2 text-15 font-bold text-ink">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <label htmlFor={id} className="text-12 font-semibold text-ink">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-11 text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-12 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, children, icon }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-12 bg-surface px-3 py-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-8 bg-chip text-ink">{icon}</span>
      <span className="flex-1 text-13 font-semibold text-ink">{children}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-action" />
    </label>
  );
}

/** Signed in, a mobile number and a pincode: then the form. */
export function CheckoutView() {
  const router = useRouter();
  const hydrated = useUi((s) => s.hydrated);
  const profile = useAuth((s) => s.profile);
  const pincode = usePincode();

  useEffect(() => {
    if (!hydrated) return;
    if (!profile) router.replace("/login?next=/checkout");
    // Accounts made with Google add a checked mobile number before the first order.
    else if (!profile.phone) router.replace("/login?step=phone&next=/checkout");
    else if (!pincode) router.replace("/location?next=/checkout");
  }, [hydrated, profile, pincode, router]);

  if (!hydrated || !profile?.phone || !pincode) return <div className="skeleton m-4 h-40 rounded-12" />;
  return <CheckoutForm pincode={pincode} />;
}

type At = "slot" | "gift-name" | "gift-phone" | "address" | "business-name" | "gstin";
const ORDER: At[] = ["slot", "gift-name", "gift-phone", "address", "business-name", "gstin"];

function CheckoutForm({ pincode }: { pincode: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useAuth((s) => s.profile);
  const where = useLocation((s) => s.address);
  const setDeliveryDate = useLocation((s) => s.setDeliveryDate);
  const { lines, bulk, slotId, promoCode, setSlot, setPromo, setQty, removeBulk, clear } = useCart();
  const setCartOpen = useUi((s) => s.setCartOpen);
  const policy = usePolicy();
  const delivery = useDelivery();
  const date = useDeliveryDate();
  const empty = !lines.length && !bulk.length;

  // Once the order exists the cart is emptied: this page then shows the payment step.
  const [placed, setPlaced] = useState<Confirmation | null>(null);
  const [paying, setPaying] = useState(false);

  // 1. The account's cart is made to match this device's (the quote reads it).
  const key = cartKey(lines, bulk);
  const sync = useQuery({
    queryKey: ["checkout-sync", key],
    queryFn: async () => {
      await syncCart(lines, bulk);
      return true;
    },
    enabled: !empty && !placed,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 2. Times for the day.
  const slots = useQuery({ queryKey: qk.slots(pincode, date), queryFn: () => api.slots(pincode, date!), enabled: Boolean(date), staleTime: 30_000 });
  const daySlots = slots.data?.slots ?? [];
  const slotsRequired = daySlots.length > 0;
  const chosenSlot = daySlots.find((s) => s.id === slotId && s.available !== false) ?? null;

  // 3. The server's price for exactly this cart, day, time and code.
  const canQuote = sync.isSuccess && Boolean(date) && slots.isSuccess && (!slotsRequired || Boolean(chosenSlot)) && !placed;
  const quote = useQuery({
    queryKey: ["quote", pincode, date, chosenSlot?.id ?? null, promoCode, key],
    queryFn: async (): Promise<{ quote: Quote; promoError: string | null }> => {
      const body = { pincode, deliveryDate: date, slotId: chosenSlot?.id ?? null };
      try {
        return { quote: await api.quote({ ...body, promoCode }), promoError: null };
      } catch (e) {
        // A code that doesn't apply: price without it, and say why.
        if (promoCode && isPromoError(e)) return { quote: await api.quote(body), promoError: promoProblem(e) };
        throw e;
      }
    },
    enabled: canQuote,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const q = quote.data?.quote ?? null;

  // Form
  const [name, setName] = useState(profile?.name ?? "");
  const typed = [where?.line2, where?.line1, where?.city].filter(Boolean).join(", ");
  const [addressText, setAddressText] = useState(typed);
  const [choice, setChoice] = useState<string | null>(null);
  const book = useQuery({ queryKey: qk.addresses, queryFn: api.addresses, staleTime: 60_000 });
  const savedHere = (book.data ?? []).filter((a) => a.pincode === pincode);
  const [isGift, setIsGift] = useState(false);
  const [gift, setGift] = useState({ recipientName: "", recipientPhone: "", message: "" });
  const billsOn = policy.data?.bills === true;
  const [isBusiness, setIsBusiness] = useState(false);
  const [business, setBusiness] = useState({ name: "", gstin: "" });
  const withBusiness = billsOn && isBusiness;
  const [promoInput, setPromoInput] = useState(promoCode ?? "");
  const [problems, setProblems] = useState<Partial<Record<At, string>>>({});
  // Until the customer picks: the address typed on the map, else the last one used here.
  const auto = typed.trim().length >= 10 || !savedHere.length ? "new" : savedHere[0].id;
  const picked = isGift ? "new" : choice && (choice === "new" || savedHere.some((a) => a.id === choice)) ? choice : auto;
  const savedPick = savedHere.find((a) => a.id === picked);
  const address = savedPick ? savedPick.address : addressText;

  const clearProblem = (at: At) => {
    if (problems[at]) setProblems((p) => ({ ...p, [at]: undefined }));
  };

  const validate = () => {
    const found: Partial<Record<At, string>> = {};
    if (slotsRequired && !chosenSlot) found.slot = "Choose a delivery time.";
    if (isGift && !gift.recipientName.trim()) found["gift-name"] = "Enter their name.";
    if (isGift && !MOBILE.test(tidyPhone(gift.recipientPhone))) found["gift-phone"] = "Enter their 10-digit mobile number.";
    const a = address.trim();
    if (a.length < 10) found.address = "Enter the full address: house, street and area.";
    else if (a.length > 500) found.address = "Keep the address under 500 characters.";
    if (withBusiness && business.name.trim().length < 2) found["business-name"] = "Enter the business name.";
    if (withBusiness) {
      const bad = gstinProblem(business.gstin);
      if (bad) found.gstin = bad;
    }
    setProblems(found);
    const first = ORDER.find((at) => found[at]);
    if (first)
      requestAnimationFrame(() => {
        const el =
          first === "slot" ? document.querySelector<HTMLElement>("#checkout-slots [role=radio]:not(:disabled)") : document.getElementById(first === "address" && savedPick ? "saved-address" : first);
        el?.focus();
      });
    return !first;
  };

  const goPay = async (c: Confirmation) => {
    if (!c.razorpayKeyId) return; // test mode: the page shows the test buttons
    setPaying(true);
    try {
      const r = await openRazorpay(
        { orderId: c.orderId, number: c.number, total: c.total, razorpayOrderId: c.razorpayOrderId, razorpayKeyId: c.razorpayKeyId, holdExpiresAt: c.holdExpiresAt },
        profile?.phone ?? null,
      );
      router.replace(r === "paid" ? `/order/${c.orderId}/success` : `/order/${c.orderId}`);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "The payment window didn't open", tone: "danger" });
      router.replace(`/order/${c.orderId}`);
    }
  };

  const pay = useMutation({
    mutationFn: async () => {
      let current = q!;
      // A quote is held for a few minutes: one about to run out is renewed first.
      if (new Date(current.expiresAt).getTime() - Date.now() < 20_000) {
        const r = await quote.refetch();
        if (!r.data) throw r.error ?? new Error("Couldn't check prices. Try again.");
        current = r.data.quote;
      }
      const body = {
        address: address.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        gift: isGift ? { recipientName: gift.recipientName.trim(), recipientPhone: tidyPhone(gift.recipientPhone), ...(gift.message.trim() ? { message: gift.message.trim() } : {}) } : null,
        business: withBusiness ? { name: business.name.trim(), gstin: tidyGstin(business.gstin) } : null,
      };
      let renewed = false;
      for (let attempt = 1; ; attempt++) {
        try {
          return await api.confirm({ quoteId: current.quoteId, ...body });
        } catch (err) {
          if (err instanceof ApiError && err.code === "PAYMENT_STARTING" && attempt < 5) {
            await pause(2000);
            continue;
          }
          if (err instanceof ApiError && err.code === "QUOTE_EXPIRED" && !renewed) {
            renewed = true;
            const r = await quote.refetch();
            if (!r.data) throw r.error ?? err;
            // Never take a different amount than the one on screen without showing it first.
            if (r.data.quote.total !== current.total) throw new Error(`Prices were checked again. The total is now ${rupees(r.data.quote.total)}. Tap Pay to continue.`);
            current = r.data.quote;
            continue;
          }
          throw err;
        }
      }
    },
    onSuccess: (c) => {
      setPlaced(c);
      clear();
      void qc.invalidateQueries({ queryKey: qk.orders });
      void qc.invalidateQueries({ queryKey: qk.addresses });
      void goPay(c);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "PHONE_REQUIRED") router.push("/login?step=phone&next=/checkout");
      if (err instanceof ApiError && (err.code === "SLOT_FULL" || err.code === "SLOT_REQUIRED")) {
        void slots.refetch();
        setProblems({ slot: checkoutProblem(err) });
      }
    },
  });

  const unpaid =
    pay.error instanceof ApiError && pay.error.code === "UNPAID_ORDER_EXISTS" && typeof pay.error.extra.orderId === "string" ? (pay.error.extra as { orderId: string; number?: string }) : null;
  const cancelUnpaid = useMutation({
    mutationFn: async (orderId: string) => {
      await api.cancelOrder(orderId);
      void qc.invalidateQueries({ queryKey: qk.orders });
      void qc.invalidateQueries({ queryKey: qk.order(orderId) });
      // Its boxes are back on sale: price this cart again, then place it.
      await quote.refetch();
    },
    onSuccess: () => pay.mutate(),
  });

  const submit = () => {
    if (!validate() || !q) return;
    pay.mutate();
  };

  // After the order exists
  if (placed)
    return (
      <div className="mx-auto max-w-md p-4">
        <section className="rounded-16 bg-surface p-4 text-center" aria-live="polite">
          <p className="text-13 text-muted">Order {placed.number}</p>
          <p className="mt-1 font-display text-21 font-extrabold text-ink">{rupees(placed.total)}</p>
          <p className="mt-1">
            <HoldCountdown until={placed.holdExpiresAt} />
          </p>
          {placed.razorpayKeyId ? (
            <p className="mt-4 flex items-center justify-center gap-2 text-13 text-ink">
              {paying && <Loader2 aria-hidden size={16} className="animate-spin" />} Finish paying in the payment window.
            </p>
          ) : (
            <div className="mt-4 text-left">
              <DevPayButtons orderId={placed.orderId} onSettled={(status) => router.replace(status === "SUCCEEDED" ? `/order/${placed.orderId}/success` : `/order/${placed.orderId}`)} />
            </div>
          )}
          <Link href={`/order/${placed.orderId}`} className="mt-3 inline-flex h-11 items-center text-13 font-semibold text-action">
            Go to the order
          </Link>
        </section>
      </div>
    );

  if (empty)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-17 font-bold text-ink">Your cart is empty</p>
        <Link href="/" className="press mt-4 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
          Shop mangoes
        </Link>
      </div>
    );

  if (delivery.data && !delivery.data.serviceable)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-17 font-bold text-ink">We don&apos;t deliver to {pincode} yet</p>
        <Link href="/location?next=/checkout" className="press mt-4 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
          Change location
        </Link>
      </div>
    );

  // What stops a quote, if anything
  const blocking = sync.error ?? (quote.error && !(quote.error instanceof ApiError && quote.error.code === "SLOT_REQUIRED") ? quote.error : null);
  const unsold = blocking instanceof ApiError && (blocking.code === "PRODUCT_UNAVAILABLE" || blocking.code === "BULK_UNAVAILABLE") ? blocking : null;
  const dropUnsold = () => {
    if (!unsold) return;
    const { sku, listingId, stage } = unsold.extra as { sku?: string; listingId?: string; stage?: string };
    if (sku) for (const l of lines) if (l.apiSku === sku && (!stage || l.ripeness === stage)) setQty(l.skuId, 0);
    if (listingId) for (const b of bulk) if (b.listingId === listingId && (!stage || b.stage === stage)) removeBulk(b.listingId, b.stage);
  };
  const promoError = quote.data?.promoError ?? null;
  const payError =
    pay.error && !unpaid && !(pay.error instanceof ApiError && ["SLOT_FULL", "SLOT_REQUIRED", "PHONE_REQUIRED"].includes(pay.error.code)) ? checkoutProblem(pay.error, lines, bulk) : null;
  const working = sync.isFetching || quote.isFetching;
  const subtotal = cartSubtotal(lines, bulk);
  const removePromo = () => {
    setPromo(null);
    setPromoInput("");
  };

  return (
    <div className="mx-auto grid max-w-content grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 lg:p-6">
      <div className="min-w-0 space-y-3">
        <Card title="When" id="checkout-when">
          {delivery.data ? (
            <>
              <DayChips
                days={delivery.data.deliveryDates}
                value={date}
                onChange={(d) => {
                  setDeliveryDate(d);
                  clearProblem("slot");
                }}
              />
              <p className="mt-1.5 text-11 text-muted">Order by {delivery.data.cutoffTime.replace(" IST", "")} for the next open day.</p>
            </>
          ) : (
            <div className="skeleton h-11 rounded-8" />
          )}
          <div className="mt-3">
            {slots.isPending ? (
              <div className="skeleton h-14 rounded-12" />
            ) : slots.isError ? (
              <p role="alert" className="text-12 text-danger">
                Couldn&apos;t load delivery times.{" "}
                <button type="button" onClick={() => slots.refetch()} className="font-semibold text-action underline">
                  Try again
                </button>
              </p>
            ) : slotsRequired ? (
              <>
                <p className="mb-1.5 text-12 font-semibold text-ink">Delivery time</p>
                <SlotPicker
                  id="checkout-slots"
                  slots={daySlots}
                  value={chosenSlot?.id ?? null}
                  invalid={Boolean(problems.slot)}
                  onChange={(id) => {
                    setSlot(id);
                    clearProblem("slot");
                  }}
                />
                {problems.slot && (
                  <p role="alert" className="mt-1.5 text-12 text-danger">
                    {problems.slot}
                  </p>
                )}
              </>
            ) : (
              <p className="text-12 text-muted">Delivered during the day.</p>
            )}
          </div>
        </Card>

        <Card title={isGift ? "Their address" : "Delivery address"} icon={<MapPin aria-hidden size={18} strokeWidth={1.75} />}>
          {!isGift && savedHere.length > 0 && (
            <div role="radiogroup" aria-label="Saved addresses" className="space-y-2">
              {savedHere.map((a, i) => (
                <label key={a.id} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-12 border p-3", picked === a.id ? "border-action bg-tint" : "border-line")}>
                  <input
                    id={i === 0 ? "saved-address" : undefined}
                    type="radio"
                    name="saved-address"
                    checked={picked === a.id}
                    onChange={() => {
                      setChoice(a.id);
                      if (a.name && !name.trim()) setName(a.name);
                      clearProblem("address");
                    }}
                    className="mt-0.5 size-4 accent-action"
                  />
                  <span className="min-w-0 text-12 text-ink">
                    {a.name && <span className="block font-semibold">{a.name}</span>}
                    {a.address}
                  </span>
                </label>
              ))}
              <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-12 border p-3", picked === "new" ? "border-action bg-tint" : "border-line")}>
                <input type="radio" name="saved-address" checked={picked === "new"} onChange={() => setChoice("new")} className="size-4 accent-action" />
                <span className="text-12 font-semibold text-ink">A different address</span>
              </label>
            </div>
          )}
          {picked === "new" && (
            <Field id="address" label="Address" hint={`House, street and area in ${pincode}.`} error={problems.address}>
              <textarea
                id="address"
                rows={3}
                maxLength={500}
                autoComplete="street-address"
                value={addressText}
                aria-invalid={Boolean(problems.address)}
                aria-describedby={problems.address ? "address-error" : "address-hint"}
                onChange={(e) => {
                  setAddressText(e.target.value);
                  clearProblem("address");
                }}
                className={cn(input, "h-auto py-2")}
              />
            </Field>
          )}
          {picked !== "new" && problems.address && (
            <p role="alert" className="mt-2 text-12 text-danger">
              {problems.address}
            </p>
          )}
          <Field id="name" label="Your name" hint="For the delivery partner.">
            <input id="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </Field>
        </Card>

        <Toggle checked={isGift} onChange={setIsGift} icon={<Gift aria-hidden size={18} strokeWidth={1.75} />}>
          Send as a gift
        </Toggle>
        {isGift && (
          <Card title="Who is it for?">
            <Field id="gift-name" label="Their name" error={problems["gift-name"]}>
              <input
                id="gift-name"
                maxLength={80}
                value={gift.recipientName}
                aria-invalid={Boolean(problems["gift-name"])}
                onChange={(e) => {
                  setGift({ ...gift, recipientName: e.target.value });
                  clearProblem("gift-name");
                }}
                className={input}
              />
            </Field>
            <Field id="gift-phone" label="Their mobile" hint="So the delivery partner can reach them." error={problems["gift-phone"]}>
              <div className="flex items-center gap-2">
                <span className="text-13 text-muted" aria-hidden>
                  +91
                </span>
                <input
                  id="gift-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={14}
                  value={gift.recipientPhone}
                  aria-invalid={Boolean(problems["gift-phone"])}
                  onChange={(e) => {
                    setGift({ ...gift, recipientPhone: e.target.value });
                    clearProblem("gift-phone");
                  }}
                  className={input}
                />
              </div>
            </Field>
            <Field id="gift-note" label="Note (optional)" hint="We print it on a card in the box.">
              <textarea id="gift-note" rows={2} maxLength={200} value={gift.message} onChange={(e) => setGift({ ...gift, message: e.target.value })} className={cn(input, "h-auto py-2")} />
            </Field>
          </Card>
        )}

        {billsOn && (
          <>
            <Toggle checked={isBusiness} onChange={setIsBusiness} icon={<Receipt aria-hidden size={18} strokeWidth={1.75} />}>
              Business bill with GSTIN
            </Toggle>
            {isBusiness && (
              <Card title="Bill to">
                <Field id="business-name" label="Business name" hint="As registered for GST." error={problems["business-name"]}>
                  <input
                    id="business-name"
                    autoComplete="organization"
                    maxLength={100}
                    value={business.name}
                    aria-invalid={Boolean(problems["business-name"])}
                    onChange={(e) => {
                      setBusiness({ ...business, name: e.target.value });
                      clearProblem("business-name");
                    }}
                    className={input}
                  />
                </Field>
                <Field id="gstin" label="GSTIN" hint="15 characters, for example 29ABCDE1234F1Z5." error={problems.gstin}>
                  <input
                    id="gstin"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={20}
                    value={business.gstin}
                    aria-invalid={Boolean(problems.gstin)}
                    onChange={(e) => {
                      setBusiness({ ...business, gstin: e.target.value.toUpperCase() });
                      clearProblem("gstin");
                    }}
                    className={cn(input, "uppercase")}
                  />
                </Field>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="min-w-0 space-y-3 lg:sticky lg:top-[96px] lg:self-start">
        <Card
          title={plural(cartCount(lines, bulk), "box", "boxes")}
          action={
            <button type="button" onClick={() => setCartOpen(true)} className="flex h-11 items-center text-13 font-semibold text-action">
              Edit cart
            </button>
          }
        >
          <ul className="space-y-2">
            {q
              ? q.lines.map((l) => (
                  <li key={`${l.listingId ?? ""}${l.sku}${l.stage}`} className="flex items-start justify-between gap-2 text-12">
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">
                        {l.qty} × {l.title ?? l.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted">
                        <RipenessChip stage={l.stage} />
                        {l.eatBy && <span>Best by {dayName(l.eatBy)}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-ink">{rupees(l.linePrice)}</span>
                  </li>
                ))
              : [
                  ...lines.map((l) => (
                    <li key={l.skuId} className="flex items-center justify-between gap-2 text-12">
                      <span className="min-w-0 text-ink">
                        {l.qty} × {l.name} {l.size} kg <RipenessChip stage={l.ripeness} className="ml-1" />
                      </span>
                      <span className="shrink-0 font-semibold text-ink">{rupees(l.price * l.qty)}</span>
                    </li>
                  )),
                  ...bulk.map((b) => (
                    <li key={`${b.listingId}${b.stage}`} className="flex items-center justify-between gap-2 text-12">
                      <span className="min-w-0 text-ink">
                        {b.qty} × {b.title} <RipenessChip stage={b.stage} className="ml-1" />
                      </span>
                      <span className="shrink-0 font-semibold text-ink">{rupees(b.unitPrice * b.qty)}</span>
                    </li>
                  )),
                ]}
          </ul>
          {q && (
            <p className="mt-2 border-t border-line pt-2 text-12 text-muted">
              Arrives {dayName(q.deliveryDate)}
              {q.slot ? `, ${windowLabel(q.slot.startsAt, q.slot.endsAt)}` : ""}
            </p>
          )}
        </Card>

        <Card title="Promo code" icon={<TicketPercent aria-hidden size={18} strokeWidth={1.75} />}>
          {promoCode && !promoError && q?.promo ? (
            <div className="flex items-center justify-between gap-2 rounded-8 bg-tint px-3 py-1">
              <span className="min-w-0 text-12 text-ink">
                <span className="font-bold text-action">{q.promo.code}</span> applied
                {q.promo.description ? <span className="block text-muted">{q.promo.description}</span> : null}
              </span>
              <button type="button" aria-label={`Remove code ${q.promo.code}`} onClick={removePromo} className="press grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-chip">
                <X aria-hidden size={18} />
              </button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setPromo(promoInput.trim().toUpperCase() || null);
              }}
            >
              <label htmlFor="promo" className="sr-only">
                Promo code
              </label>
              <input
                id="promo"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={20}
                value={promoInput}
                aria-invalid={Boolean(promoError)}
                aria-describedby={promoError ? "promo-error" : undefined}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                placeholder="Enter code"
                className={cn(input, "uppercase")}
              />
              <button type="submit" disabled={!promoInput.trim()} className="press h-11 shrink-0 rounded-8 border border-action px-4 text-13 font-semibold text-action disabled:opacity-50">
                Apply
              </button>
            </form>
          )}
          {promoCode && !q && !promoError && !blocking && <p className="mt-1.5 text-11 text-muted">We&apos;ll check {promoCode} when the price is ready.</p>}
          {promoError && (
            <div id="promo-error" role="alert" className="mt-1.5 flex items-center justify-between gap-2 text-12 text-danger">
              <span>{promoError}</span>
              <button type="button" onClick={removePromo} className="h-11 shrink-0 font-semibold text-action">
                Remove
              </button>
            </div>
          )}
          {bulk.length > 0 && <p className="mt-1.5 text-11 text-muted">Codes don&apos;t apply to bulk deals.</p>}
        </Card>

        {q ? <BillDetails subtotal={q.subtotal} discount={q.discount} promo={q.promo} total={q.total} /> : <BillDetails subtotal={subtotal} total={subtotal} estimate />}

        {blocking && (
          <div role="alert" className="rounded-12 bg-danger-soft p-3 text-12 text-danger">
            <p>{checkoutProblem(blocking, lines, bulk)}</p>
            <div className="mt-1 flex flex-wrap gap-x-4">
              {unsold && (
                <button type="button" onClick={dropUnsold} className="h-11 font-semibold text-action">
                  Remove it
                </button>
              )}
              {blocking instanceof ApiError && blocking.code === "STOCK_INSUFFICIENT" && (
                <button type="button" onClick={() => setCartOpen(true)} className="h-11 font-semibold text-action">
                  Edit cart
                </button>
              )}
              {blocking instanceof ApiError && blocking.code === "NOT_SERVICEABLE" && (
                <Link href="/location?next=/checkout" className="flex h-11 items-center font-semibold text-action">
                  Change location
                </Link>
              )}
              {!unsold && (
                <button type="button" onClick={() => (sync.error ? sync.refetch() : quote.refetch())} className="h-11 font-semibold text-action">
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {unpaid && (
          <div role="alert" className="rounded-12 bg-brand-soft p-3 text-12 text-ink">
            <p>
              <span className="font-bold">You have an order waiting for payment.</span> Pay for it, or cancel it to place this one.
            </p>
            <div className="mt-2 grid gap-2">
              <Link href={`/order/${unpaid.orderId}`} className="press flex h-11 items-center justify-center rounded-8 bg-action text-13 font-semibold text-white">
                Finish paying order {unpaid.number ?? ""}
              </Link>
              <button
                type="button"
                disabled={cancelUnpaid.isPending}
                onClick={() => cancelUnpaid.mutate(unpaid.orderId)}
                className="press flex h-11 items-center justify-center gap-1.5 rounded-8 border border-line bg-surface text-13 font-semibold text-ink disabled:opacity-60"
              >
                {cancelUnpaid.isPending && <Loader2 aria-hidden size={16} className="animate-spin" />}
                Cancel it and place this order
              </button>
              {cancelUnpaid.error && <p className="text-danger">{checkoutProblem(cancelUnpaid.error)}</p>}
            </div>
          </div>
        )}

        {payError && (
          <p role="alert" className="rounded-12 bg-danger-soft p-3 text-12 text-danger">
            {payError}
          </p>
        )}

        <div className="sticky bottom-0 -mx-3 bg-canvas p-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:static lg:m-0 lg:p-0">
          {!q && slotsRequired && !chosenSlot && !blocking && <p className="mb-2 text-center text-12 text-muted">Choose a delivery time to see the final price.</p>}
          <button
            type="button"
            disabled={pay.isPending || cancelUnpaid.isPending || (!q && !(slotsRequired && !chosenSlot))}
            onClick={() => (q ? submit() : validate())}
            data-testid="place-order"
            className="press flex h-14 w-full items-center justify-between rounded-12 bg-action px-4 text-white disabled:bg-disabled"
          >
            <span className="flex flex-col items-start leading-tight">
              <span className="text-15 font-bold">{rupees(q?.total ?? subtotal)}</span>
              <span className="text-11 font-medium uppercase">{q ? "Total" : "Estimate"}</span>
            </span>
            <span className="flex items-center gap-1 text-17 font-bold">
              {(pay.isPending || working) && <Loader2 aria-hidden size={20} className="animate-spin" />}
              Pay now <ChevronRight aria-hidden size={20} />
            </span>
          </button>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-center text-11 text-muted">
            <ShieldCheck aria-hidden size={14} /> Prepaid only. Free delivery. GST included.
            {q?.holdMinutes ? ` Boxes are held for ${q.holdMinutes} minutes while you pay.` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
