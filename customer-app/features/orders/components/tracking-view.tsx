"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, CalendarDays, Check, CircleAlert, Download, Image as ImageIcon, KeyRound, Loader2, MapPin, MessageCircle, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/drawer";
import { useAuth } from "@/features/auth/store";
import { BillDetails } from "@/features/cart/components/bill-details";
import { RipenessChip } from "@/features/catalog/components/ripeness-chip";
import { DayChips } from "@/features/checkout/components/day-chips";
import { DevPayButtons } from "@/features/checkout/components/dev-pay";
import { HoldCountdown, useSecondsLeft } from "@/features/checkout/components/hold-countdown";
import { SlotPicker } from "@/features/checkout/components/slot-picker";
import { checkoutProblem } from "@/features/checkout/errors";
import { MIN_PAY_SECONDS, openRazorpay } from "@/features/checkout/payment";
import { toast } from "@/features/shell/ui-store";
import { api, ApiError, qk } from "@/lib/api/client";
import { whatsappLink } from "@/lib/config";
import { cn, dateTime, dayName, longDate, plural, rupees, windowLabel, ORDER_STATUS } from "@/lib/format";
import type { Claim, Order, OrderStatus } from "@/lib/types";
import { CANCELLABLE, MOVABLE, TERMINAL, useClaims, useOrder, useSignedInReady } from "../hooks";
import { useReorder } from "../reorder";
import { SignInPrompt } from "./sign-in-prompt";
import { StatusPill } from "./status-pill";

const ISSUE: Record<Claim["issueType"], string> = { DAMAGED: "Damaged or spoilt", WRONG_ITEM: "Wrong item or ripeness", NOT_DELIVERED: "Not delivered" };
export const issueLabel = (t: Claim["issueType"]) => ISSUE[t];

export function claimStatusText(c: Claim) {
  if (c.status !== "RESOLVED") return "We're looking into it. We'll message you soon.";
  if (c.resolution === "REPLACEMENT_APPROVED") return "Approved. A replacement is on its way.";
  if (c.resolution === "REJECTED") return c.rejectionReason ? `Not approved: ${c.rejectionReason}` : "Not approved.";
  return "Closed.";
}

/** The usual path of an order, for the steps still to come. */
const PATH: OrderStatus[] = ["CONFIRMED", "PROCESSING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"];

function Section({ title, children, className, icon }: { title?: string; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <section className={cn("rounded-12 bg-surface p-4", className)} aria-label={title}>
      {title && (
        <h2 className="mb-2 flex items-center gap-2 text-15 font-bold text-ink">
          {icon}
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Timeline({ order }: { order: Order }) {
  const seen = new Set(order.timeline.map((t) => t.status));
  const last = order.timeline[order.timeline.length - 1]?.status ?? order.status;
  const lastIdx = PATH.indexOf(last);
  const upcoming = TERMINAL.includes(order.status) || order.status === "PAYMENT_PENDING" || order.status === "DELIVERY_FAILED" ? [] : PATH.filter((s, i) => i > lastIdx && !seen.has(s));
  const rows = [...order.timeline.map((t) => ({ status: t.status, at: t.at as string | null })), ...upcoming.map((s) => ({ status: s, at: null as string | null }))];
  return (
    <ol aria-label="Order progress" className="relative">
      {rows.map((r, i) => {
        const done = Boolean(r.at);
        const current = done && i === order.timeline.length - 1;
        const bad = r.status === "CANCELLED" || r.status === "DELIVERY_FAILED" || r.status === "RTO";
        return (
          <li key={`${r.status}${i}`} className="relative flex gap-3 pb-4 last:pb-0" aria-current={current ? "step" : undefined}>
            {i < rows.length - 1 && <span aria-hidden className={cn("absolute top-8 left-[13px] h-[calc(100%-28px)] w-0.5", done && rows[i + 1].at ? "bg-action" : "bg-line")} />}
            <span
              className={cn(
                "relative grid size-7 shrink-0 place-items-center rounded-full",
                bad ? "bg-danger-soft text-danger" : done ? "bg-action text-white" : "bg-chip text-disabled-ink",
                current && !bad && "ring-2 ring-action ring-offset-2 ring-offset-surface",
              )}
            >
              {bad ? <XCircle aria-hidden size={16} /> : done ? <Check aria-hidden size={16} strokeWidth={2.5} /> : <span className="size-2 rounded-full bg-current" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-13 font-semibold", done ? "text-ink" : "text-muted")}>{ORDER_STATUS[r.status]?.label ?? r.status}</p>
              {r.at && <p className="text-12 text-muted">{dateTime(r.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PayBox({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const router = useRouter();
  const phone = useAuth((s) => s.profile?.phone ?? null);
  const left = useSecondsLeft(order.holdExpiresAt);
  const canPay = left == null || left > MIN_PAY_SECONDS;
  const pay = useMutation({
    mutationFn: () =>
      openRazorpay(
        { orderId: order.id, number: order.number, total: order.total, razorpayOrderId: order.razorpayOrderId!, razorpayKeyId: order.razorpayKeyId!, holdExpiresAt: order.holdExpiresAt },
        phone,
      ),
    onSuccess: (r) => {
      onPaid();
      if (r === "paid") router.push(`/order/${order.id}/success`);
    },
  });
  return (
    <Section className="border border-brand bg-brand-soft">
      <p className="text-15 font-bold text-ink">Waiting for payment</p>
      <p className="mt-0.5 text-12 text-ink">This page updates by itself once the payment goes through.</p>
      <p className="mt-1">
        <HoldCountdown until={order.holdExpiresAt} />
      </p>
      {order.razorpayKeyId && order.razorpayOrderId ? (
        canPay ? (
          <button
            type="button"
            disabled={pay.isPending}
            onClick={() => pay.mutate()}
            className="press mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-12 bg-action text-15 font-bold text-white disabled:bg-disabled"
          >
            {pay.isPending && <Loader2 aria-hidden size={18} className="animate-spin" />} Pay {rupees(order.total)}
          </button>
        ) : left ? (
          <p className="mt-2 text-12 text-ink">The hold is about to end, so paying now could fail. Wait a minute and place the order again.</p>
        ) : null
      ) : (
        left !== 0 && (
          <div className="mt-3">
            <DevPayButtons
              orderId={order.id}
              onSettled={(status) => {
                onPaid();
                if (status === "SUCCEEDED") router.push(`/order/${order.id}/success`);
                else toast({ title: "The payment failed. No money was taken.", tone: "danger" });
              }}
            />
          </div>
        )
      )}
      {pay.error && (
        <p role="alert" className="mt-2 text-12 text-danger">
          {checkoutProblem(pay.error)}
        </p>
      )}
    </Section>
  );
}

function MoveSheet({ order, open, onOpenChange, onMoved }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void; onMoved: () => void }) {
  const [date, setDate] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(order.slot?.id ?? null);
  const days = useQuery({ queryKey: qk.delivery(order.pincode), queryFn: () => api.deliveryCheck(order.pincode), enabled: open, staleTime: 60_000 });
  const choices = (days.data?.deliveryDates ?? []).filter((d) => d !== order.deliveryDate);
  const day = date && choices.includes(date) ? date : (choices[0] ?? null);
  const slots = useQuery({ queryKey: qk.slots(order.pincode, day), queryFn: () => api.slots(order.pincode, day!), enabled: open && Boolean(day) });
  const daySlots = slots.data?.slots ?? [];
  const chosen = daySlots.find((s) => s.id === slotId && s.available !== false) ?? null;
  const move = useMutation({
    mutationFn: () => api.reschedule(order.id, day!, chosen?.id ?? null),
    onSuccess: () => {
      onMoved();
      onOpenChange(false);
      toast({ title: `Moved to ${dayName(day!)}`, tone: "success" });
    },
  });
  const needSlot = daySlots.length > 0 && !chosen;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Move delivery day" desktop="dialog">
      <div className="space-y-3 p-4">
        <p className="text-12 text-muted">
          Now: {longDate(order.deliveryDate)}
          {order.slot ? `, ${windowLabel(order.slot.startsAt, order.slot.endsAt)}` : ""}. You can move it until we start packing.
        </p>
        {days.isPending ? <div className="skeleton h-11 rounded-8" /> : choices.length ? <DayChips days={choices} value={day} onChange={setDate} label="New delivery day" /> : <p className="text-13 text-ink">No other days are open right now.</p>}
        {day && slots.isPending && <div className="skeleton h-14 rounded-12" />}
        {daySlots.length > 0 && <SlotPicker slots={daySlots} value={chosen?.id ?? null} onChange={setSlotId} />}
        {move.error && (
          <p role="alert" className="text-12 text-danger">
            {checkoutProblem(move.error)}
          </p>
        )}
        <button
          type="button"
          disabled={!day || needSlot || move.isPending}
          onClick={() => move.mutate()}
          className="press flex h-12 w-full items-center justify-center gap-1.5 rounded-12 bg-action text-15 font-semibold text-white disabled:bg-disabled"
        >
          {move.isPending && <Loader2 aria-hidden size={18} className="animate-spin" />}
          {day ? `Move to ${dayName(day)}` : "Move"}
        </button>
      </div>
    </Sheet>
  );
}

function CancelSheet({ order, open, onOpenChange, onDone }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(order.id),
    onSuccess: () => {
      onDone();
      onOpenChange(false);
      toast({ title: `Order ${order.number} cancelled` });
    },
  });
  const paid = order.paymentStatus === "SUCCEEDED";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Cancel order ${order.number}?`} desktop="dialog">
      <div className="space-y-3 p-4">
        <p className="text-13 text-ink">{paid ? `Your ${rupees(order.total)} goes back to how you paid, usually in 5 to 7 working days.` : "Nothing has been paid, so nothing is charged."}</p>
        {cancel.error && (
          <p role="alert" className="text-12 text-danger">
            {cancel.error instanceof ApiError ? cancel.error.message : "Couldn't cancel. Try again."}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="press h-12 rounded-12 border border-line text-15 font-semibold text-ink">
            Keep order
          </button>
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
            className="press flex h-12 items-center justify-center gap-1.5 rounded-12 bg-danger text-15 font-semibold text-white disabled:opacity-60"
          >
            {cancel.isPending && <Loader2 aria-hidden size={18} className="animate-spin" />} Cancel order
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function DeliveryPhoto({ orderId }: { orderId: string }) {
  const photo = useMutation({ mutationFn: () => api.deliveryPhoto(orderId) });
  if (photo.data)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a signed-in object URL, not a static asset
      <img src={photo.data} alt="Your box at the door" className="mt-2 max-h-80 w-full rounded-8 object-contain" />
    );
  return (
    <>
      <button type="button" disabled={photo.isPending} onClick={() => photo.mutate()} className="press mt-2 flex h-11 items-center gap-1.5 rounded-8 border border-line px-3 text-13 font-semibold text-ink">
        {photo.isPending ? <Loader2 aria-hidden size={16} className="animate-spin" /> : <ImageIcon aria-hidden size={16} />} See delivery photo
      </button>
      {photo.error && <p className="mt-1 text-12 text-danger">The photo isn&apos;t available right now.</p>}
    </>
  );
}

function BillDownload({ order }: { order: Order }) {
  const download = useMutation({
    mutationFn: async () => {
      const url = await api.bill(order.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MandiMangoes-bill-${order.bill!.number.replace(/\//g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-12 bg-surface p-3">
      <span className="text-12 text-muted">Bill {order.bill!.number}</span>
      <button type="button" disabled={download.isPending} onClick={() => download.mutate()} className="press flex h-11 items-center gap-1.5 rounded-8 border border-line px-3 text-13 font-semibold text-ink">
        {download.isPending ? <Loader2 aria-hidden size={16} className="animate-spin" /> : <Download aria-hidden size={16} />} Download bill
      </button>
      {download.error && <p className="w-full text-12 text-danger">Couldn&apos;t download the bill. Try again.</p>}
    </div>
  );
}

export function TrackingView({ id }: { id: string }) {
  const { hydrated, signedIn } = useSignedInReady();
  const { data: order, isError, error, refetch } = useOrder(id);
  if (hydrated && !signedIn) return <SignInPrompt next={`/order/${id}`} title="Log in to see this order" />;
  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-8 text-center" role="alert">
        <p className="text-17 font-bold text-ink">{missing ? "We couldn't find that order" : "Couldn't load this order"}</p>
        <div className="mt-3 flex justify-center gap-4">
          {!missing && (
            <button type="button" onClick={() => refetch()} className="h-11 text-13 font-semibold text-action">
              Try again
            </button>
          )}
          <Link href="/orders" className="inline-flex h-11 items-center text-13 font-semibold text-action">
            See your orders
          </Link>
        </div>
      </div>
    );
  }
  if (!order)
    return (
      <div className="mx-auto max-w-[720px] space-y-3 p-3">
        <div className="skeleton h-24 rounded-12" />
        <div className="skeleton h-64 rounded-12" />
      </div>
    );
  return <OrderDetail order={order} />;
}

function OrderDetail({ order }: { order: Order }) {
  const qc = useQueryClient();
  const reorder = useReorder();
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const delivered = order.status === "DELIVERED";
  const claims = useClaims(delivered);
  const myClaims = (claims.data ?? []).filter((c) => c.orderId === order.id);
  const openClaim = myClaims.some((c) => c.status !== "RESOLVED");
  const claimLeft = useSecondsLeft(delivered ? order.claimUntil : null);
  const canClaim = delivered && (claimLeft ?? 0) > 0 && !openClaim && !myClaims.some((c) => c.resolution === "REPLACEMENT_APPROVED");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.order(order.id) });
    void qc.invalidateQueries({ queryKey: qk.orders });
  };
  const boxes = order.items.reduce((n, i) => n + i.quantity, 0);
  const help = whatsappLink(`Help with order ${order.number}`);
  const refunded = order.refundStatus === "REFUNDED" || order.paymentStatus === "REFUNDED";
  const movable = MOVABLE.includes(order.status);
  const cancellable = CANCELLABLE.includes(order.status);

  return (
    <div className="mx-auto grid max-w-content grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:p-6">
      <div className="space-y-3">
        <Section>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-display text-19 font-extrabold text-ink" data-testid="order-number">
                Order {order.number}
              </p>
              <p className="text-12 text-muted">Placed {dateTime(order.placedAt)}</p>
            </div>
            <StatusPill status={order.status} />
          </div>
          <p className="mt-3 flex items-center gap-2 text-13 text-ink">
            <CalendarDays aria-hidden size={16} className="text-muted" />
            {delivered && order.delivery
              ? `Delivered ${dateTime(order.delivery.at)}`
              : `${longDate(order.deliveryDate)}${order.slot ? `, ${windowLabel(order.slot.startsAt, order.slot.endsAt)}` : ""}`}
          </p>
        </Section>

        {order.status === "PAYMENT_PENDING" && <PayBox order={order} onPaid={refresh} />}

        {order.deliveryCode && (
          <Section className="border border-action text-center">
            <p className="flex items-center justify-center gap-1.5 text-13 font-semibold text-ink">
              <KeyRound aria-hidden size={16} /> Delivery code
            </p>
            <p className="mt-1 font-display text-36 font-extrabold tracking-[0.3em] text-ink" aria-label={`Delivery code ${order.deliveryCode.split("").join(" ")}`} data-testid="delivery-code">
              {order.deliveryCode}
            </p>
            <p className="text-12 text-muted">Share it with the delivery partner when the box reaches you.</p>
          </Section>
        )}

        {order.tracking && (
          <Section>
            <p className="flex items-center gap-2 text-15 font-bold text-ink" aria-live="polite">
              <Bike aria-hidden size={18} className="text-action" />
              {order.tracking.stopsAway === 0 ? "You're the next stop" : `${plural(order.tracking.stopsAway, "stop")} away`}
            </p>
            <p className="mt-0.5 text-12 text-muted">Expect it in about {Math.max(5, Math.round(order.tracking.etaMinutes / 5) * 5)} minutes.</p>
          </Section>
        )}

        {order.status === "CANCELLED" && (
          <Section className="bg-chip">
            <p className="text-13 font-bold text-ink">This order was cancelled.</p>
            <p className="mt-0.5 text-12 text-ink">
              {order.refundStatus === "REFUNDED"
                ? `${rupees(order.total)} was refunded to how you paid.`
                : order.refundStatus === "PENDING"
                  ? `A refund of ${rupees(order.total)} is on its way. It usually takes 5 to 7 working days.`
                  : order.cancelReason === "HOLD_EXPIRED"
                    ? "The payment didn't arrive in time, so the boxes went back on sale. Nothing was charged."
                    : "Nothing was charged."}
            </p>
          </Section>
        )}

        {order.status === "DELIVERY_FAILED" && (
          <Section className="bg-danger-soft">
            <p className="flex items-center gap-2 text-13 font-bold text-danger">
              <CircleAlert aria-hidden size={16} /> We missed you
            </p>
            <p className="mt-0.5 text-12 text-ink">{order.retryScheduled ? "We'll try again on the next delivery day." : "We'll call you to arrange another time."}</p>
          </Section>
        )}

        {delivered && (
          <Section title="Delivered">
            {order.delivery && (
              <p className="text-12 text-ink">
                {dateTime(order.delivery.at)}
                {order.delivery.receivedBy ? `, received by ${order.delivery.receivedBy}` : ""}.
              </p>
            )}
            {order.delivery?.hasPhoto && <DeliveryPhoto orderId={order.id} />}
            {myClaims.map((c) => (
              <div key={c.id} className="mt-3 rounded-8 bg-canvas p-3 text-12">
                <p className="font-semibold text-ink">Problem reported: {ISSUE[c.issueType]}</p>
                <p className="mt-0.5 text-ink">{claimStatusText(c)}</p>
                {c.replacementOrder && (
                  <Link href={`/order/${c.replacementOrder.id}`} className="mt-1 inline-flex h-11 items-center font-semibold text-action">
                    See replacement {c.replacementOrder.number}
                  </Link>
                )}
              </div>
            ))}
            {canClaim && (
              <>
                <Link href={`/order/${order.id}/claim`} className="press mt-3 flex h-11 items-center justify-center gap-1.5 rounded-8 border border-line text-13 font-semibold text-ink">
                  <CircleAlert aria-hidden size={16} /> Report a problem
                </Link>
                <p className="mt-1 text-center text-11 text-muted">Damaged or wrong boxes are replaced free until {dateTime(order.claimUntil!)}.</p>
              </>
            )}
          </Section>
        )}

        <Section title="Progress">
          <Timeline order={order} />
        </Section>
      </div>

      <div className="space-y-3 lg:sticky lg:top-[96px] lg:self-start">
        <Section title={plural(boxes, "box", "boxes")}>
          <ul className="space-y-2.5">
            {order.items.map((i, n) => (
              <li key={`${i.sku}${i.stage}${n}`} className="flex items-start justify-between gap-2 text-12">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">
                    {i.quantity} × {i.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted">
                    <RipenessChip stage={i.stage} />
                    {i.eatBy && <span>Best by {dayName(i.eatBy)}</span>}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-ink">{rupees(i.linePrice)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={order.gift ? `Gift for ${order.gift.recipientName}` : "Delivering to"} icon={<MapPin aria-hidden size={16} />}>
          <p className="text-12 text-ink">{order.deliveryAddress}</p>
          <p className="text-12 text-muted">{order.pincode}</p>
          {order.gift?.message && <p className="mt-2 rounded-8 bg-canvas p-2 text-12 text-ink">&ldquo;{order.gift.message}&rdquo;</p>}
        </Section>

        <BillDetails subtotal={order.subtotal} discount={order.discount} promo={order.promoCode ? { code: order.promoCode, description: "" } : null} total={order.total} />
        {(refunded || order.refundStatus === "PENDING") && (
          <p className="rounded-12 bg-tint px-3 py-2 text-12 font-semibold text-action">{refunded ? `Refunded ${rupees(order.total)}` : "Refund in progress"}</p>
        )}
        {order.bill && <BillDownload order={order} />}

        <div className="grid gap-2">
          {movable && (
            <button type="button" onClick={() => setMoving(true)} className="press flex h-12 items-center justify-center gap-1.5 rounded-12 border border-line bg-surface text-13 font-semibold text-ink">
              <CalendarDays aria-hidden size={16} /> Move delivery day
            </button>
          )}
          {(delivered || order.status === "CANCELLED") && (
            <button
              type="button"
              onClick={() => reorder(order)}
              data-testid="reorder"
              className="press flex h-12 items-center justify-center gap-1.5 rounded-12 border border-action bg-tint text-13 font-semibold text-action"
            >
              <RotateCcw aria-hidden size={16} /> Buy again
            </button>
          )}
          {help && (
            <a href={help} target="_blank" rel="noreferrer" className="press flex h-12 items-center justify-center gap-1.5 rounded-12 border border-line bg-surface text-13 font-semibold text-ink">
              <MessageCircle aria-hidden size={16} /> Help on WhatsApp
            </a>
          )}
          {cancellable && (
            <>
              <button type="button" onClick={() => setCancelling(true)} className="press flex h-12 items-center justify-center rounded-12 text-13 font-semibold text-danger">
                Cancel order
              </button>
              <p className="text-center text-11 text-muted">You can cancel until we start packing.</p>
            </>
          )}
        </div>
      </div>

      {movable && <MoveSheet order={order} open={moving} onOpenChange={setMoving} onMoved={refresh} />}
      {cancellable && <CancelSheet order={order} open={cancelling} onOpenChange={setCancelling} onDone={refresh} />}
    </div>
  );
}
