"use client";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CalendarDays, ChevronRight, Minus, Package, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/drawer";
import { RollingNumber } from "@/components/ui/rolling-number";
import { useSignedIn } from "@/features/auth/store";
import { ProductCard } from "@/features/catalog/components/product-card";
import { RipenessChip } from "@/features/catalog/components/ripeness-chip";
import { useDelivery, useDeliveryDate, useNextSlot, usePolicy, useProducts } from "@/features/catalog/hooks/queries";
import { useLocation } from "@/features/location/store";
import { toast, useUi } from "@/features/shell/ui-store";
import { cn, dayName, rupees } from "@/lib/format";
import type { BulkCartLine, CartLine } from "@/lib/types";
import { MAX_QTY, cartCount, cartSubtotal, useCart } from "../store";
import { BillDetails } from "./bill-details";
import { FreeDeliveryNote } from "./free-delivery";

export function LineStepper({ line }: { line: CartLine }) {
  const setQty = useCart((s) => s.setQty);
  const label = `${line.name} ${line.ripeness.toLowerCase().replace("_", "-")} ${line.size} kg`;
  return (
    <div role="group" aria-label={`Quantity of ${label}`} className="flex h-8 w-[66px] shrink-0 items-stretch rounded-6 bg-action font-semibold text-white">
      <button type="button" aria-label={`Remove one ${label}`} onClick={() => setQty(line.skuId, line.qty - 1)} className="press relative grid w-6 place-items-center after:absolute after:-inset-y-1.5 after:inset-x-0">
        <Minus size={14} strokeWidth={2.5} />
      </button>
      <span className="grid flex-1 place-items-center text-13" aria-live="polite">
        <RollingNumber value={line.qty} />
      </span>
      <button
        type="button"
        aria-label={`Add one more ${label}`}
        onClick={() => (line.qty >= MAX_QTY ? toast({ title: `Up to ${MAX_QTY} boxes per line`, action: { label: "Bulk deals", href: "/bulk" } }) : setQty(line.skuId, line.qty + 1))}
        className="press relative grid w-6 place-items-center after:absolute after:-inset-y-1.5 after:inset-x-0"
      >
        <Plus size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function CartLineRow({ line }: { line: CartLine }) {
  return (
    <m.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3 overflow-hidden"
      data-testid="cart-line"
    >
      <span className="relative size-[70px] shrink-0 overflow-hidden rounded-8 border-[0.5px] border-line bg-surface">
        <Image src={line.image} alt="" fill sizes="70px" className="object-cover" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-12 font-medium text-ink">{/box/i.test(line.name) ? line.name : `${line.name} Mango`}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <RipenessChip stage={line.ripeness} />
          <span className="text-12 text-muted">{line.size} kg box</span>
        </div>
        <p className="mt-1 text-12 font-semibold text-ink">{rupees(line.price * line.qty)}</p>
      </div>
      <LineStepper line={line} />
    </m.li>
  );
}

function BulkLineRow({ line }: { line: BulkCartLine }) {
  const remove = useCart((s) => s.removeBulk);
  return (
    <li className="flex items-center gap-3" data-testid="cart-bulk-line">
      <span className="relative grid size-[70px] shrink-0 place-items-center overflow-hidden rounded-8 border-[0.5px] border-line bg-brand-soft text-ink">
        {line.image ? <Image src={line.image} alt="" fill sizes="70px" className="object-cover" /> : <Package aria-hidden size={28} strokeWidth={1.5} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-11 font-bold tracking-wide text-ribbon uppercase">Bulk deal</p>
        <p className="line-clamp-2 text-12 font-medium text-ink">{line.title}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <RipenessChip stage={line.stage} />
          <span className="text-12 text-muted">{line.qty} boxes</span>
        </div>
        <p className="mt-1 text-12 font-semibold text-ink">{rupees(line.unitPrice * line.qty)}</p>
      </div>
      <button type="button" aria-label={`Remove ${line.title}`} onClick={() => remove(line.listingId, line.stage)} className="grid size-11 shrink-0 place-items-center text-muted">
        <Trash2 size={18} strokeWidth={1.75} />
      </button>
    </li>
  );
}

function EmptyCart({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-24 place-items-center rounded-full bg-brand-soft text-ripe">
        <ShoppingBasket size={44} strokeWidth={1.5} aria-hidden />
      </span>
      <p className="mt-4 text-17 font-bold text-ink">Your cart is empty</p>
      <p className="mt-1 text-13 text-muted">Pick a ripeness for the day you want to eat them</p>
      <Link href="/c/all" onClick={onBrowse} className="press mt-5 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
        Browse mangoes
      </Link>
    </div>
  );
}

function DayPicker() {
  const { data } = useDelivery();
  const date = useDeliveryDate();
  const setDate = useLocation((s) => s.setDeliveryDate);
  if (!data?.serviceable) return null;
  return (
    <div role="radiogroup" aria-label="Delivery day" className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
      {data.deliveryDates.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === date}
          onClick={() => setDate(d)}
          className={cn("press h-11 shrink-0 rounded-8 border px-3 text-13 font-semibold whitespace-nowrap", d === date ? "border-action bg-tint text-action" : "border-line text-ink")}
        >
          {dayName(d)}
        </button>
      ))}
    </div>
  );
}

export function CartContents({ onNavigate }: { onNavigate?: () => void }) {
  const lines = useCart((s) => s.lines);
  const bulk = useCart((s) => s.bulk);
  const { data: products } = useProducts();
  const slot = useNextSlot();
  const { data: policy } = usePolicy();
  const [changeDay, setChangeDay] = useState(false);
  const inCart = new Set(lines.map((l) => l.productId));
  const suggestions = (products ?? []).filter((p) => !inCart.has(p.id) && p.variety.inSeason).slice(0, 8);
  const subtotal = cartSubtotal(lines, bulk);
  const boxes = cartCount(lines, bulk);

  if (!lines.length && !bulk.length) return <EmptyCart onBrowse={() => onNavigate?.()} />;

  return (
    <div className="space-y-3 bg-canvas p-3">
      <FreeDeliveryNote />

      <section className="rounded-12 bg-surface p-3" aria-labelledby="day-h">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-8 bg-chip text-ink">
            <CalendarDays aria-hidden size={20} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="day-h" className="text-15 font-bold text-ink">
              {slot ? `Delivery ${slot.dayLabel.toLowerCase() === "tomorrow" ? "tomorrow" : slot.dayLabel}` : "Choose your delivery day"}
            </h2>
            <p className="text-12 text-muted">
              {boxes} box{boxes === 1 ? "" : "es"}
              {slot ? ` · pick a time slot at checkout` : ""}
            </p>
          </div>
          <button type="button" onClick={() => setChangeDay((s) => !s)} aria-expanded={changeDay} className="h-11 rounded-8 px-2 text-13 font-semibold text-action">
            {changeDay ? "Done" : "Change"}
          </button>
        </div>
        {changeDay && <DayPicker />}
        <ul className="mt-3 space-y-3 border-t border-line pt-3">
          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <CartLineRow key={l.skuId} line={l} />
            ))}
          </AnimatePresence>
          {bulk.map((b) => (
            <BulkLineRow key={`${b.listingId}-${b.stage}`} line={b} />
          ))}
        </ul>
        <Link href="/c/all" onClick={() => onNavigate?.()} className="mt-3 flex h-11 items-center gap-1 border-t border-line pt-2 text-13 font-semibold text-action">
          <Plus aria-hidden size={16} strokeWidth={2.5} /> Add more items
        </Link>
      </section>

      {suggestions.length > 0 && (
        <section aria-labelledby="ymal-h">
          <h2 id="ymal-h" className="px-1 pb-2 text-15 font-bold text-ink">
            You may also like
          </h2>
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pt-3 pb-1">
            {suggestions.map((p, i) => (
              <ProductCard key={p.id} product={p} scope="cart-ymal" index={i} fixed />
            ))}
          </div>
        </section>
      )}

      <BillDetails subtotal={subtotal} total={subtotal} estimate />

      <section className="rounded-12 bg-surface p-3" aria-labelledby="cancel-h">
        <h2 id="cancel-h" className="text-13 font-bold text-ink">
          Cancellation and replacements
        </h2>
        <p className="mt-1 text-12 text-ink">
          Cancel any time before your order is packed for a full refund. If a box arrives damaged, spoilt or at the wrong ripeness, report it within{" "}
          {policy ? `${policy.claimWindowHours} hours` : "a day"} of delivery and we send a free replacement.
        </p>
      </section>
    </div>
  );
}

export function PayBar({ onNavigate }: { onNavigate?: () => void }) {
  const lines = useCart((s) => s.lines);
  const bulk = useCart((s) => s.bulk);
  const signedIn = useSignedIn();
  const router = useRouter();
  if (!lines.length && !bulk.length) return null;
  const go = () => {
    onNavigate?.();
    router.push(signedIn ? "/checkout" : "/login?next=/checkout");
  };
  return (
    <div className="p-3">
      <button type="button" onClick={go} data-testid="proceed" className="press flex h-14 w-full items-center justify-between rounded-12 bg-action px-4 text-white">
        <span className="flex flex-col items-start leading-tight">
          <span className="text-15 font-bold">{rupees(cartSubtotal(lines, bulk))}</span>
          <span className="text-11 font-medium uppercase">Total</span>
        </span>
        <span className="flex items-center gap-0.5 text-17 font-bold">
          {signedIn ? "Proceed to checkout" : "Login to proceed"} <ChevronRight aria-hidden size={20} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}

/** Bottom sheet on phones, a 400 px right-hand drawer on laptops. */
export function CartPanel() {
  const open = useUi((s) => s.cartOpen);
  const setOpen = useUi((s) => s.setCartOpen);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen} title="My Cart" description="Items in your cart and your delivery day" footer={<PayBar onNavigate={close} />} bodyClassName="bg-canvas">
      <CartContents onNavigate={close} />
    </Sheet>
  );
}
