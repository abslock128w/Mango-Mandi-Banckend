"use client";
import Link from "next/link";
import { useMotionValueEvent, useScroll } from "motion/react";
import * as m from "motion/react-m";
import { ChevronDown, Search, ShoppingCart, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RotatingPlaceholder } from "@/features/search/components/rotating-placeholder";
import { useNextSlot } from "@/features/catalog/hooks/queries";
import { useLocation } from "@/features/location/store";
import { useAuth } from "@/features/auth/store";
import { cartCount, useCart } from "@/features/cart/store";
import { useUi } from "./ui-store";
import { Logo } from "./logo";
import { headerTween } from "@/lib/motion";
import { cn, plural, rupees } from "@/lib/format";

function useCollapsed() {
  const { scrollY } = useScroll();
  const [collapsed, setCollapsed] = useState(false);
  const state = useRef({ collapsed: false, freezeUntil: 0, anchor: 0 });
  useMotionValueEvent(scrollY, "change", (y) => {
    const s = state.current;
    const now = performance.now();
    // Ignore the scroll adjustment caused by the header resizing itself.
    if (now < s.freezeUntil) {
      s.anchor = y;
      return;
    }
    const toggle = (v: boolean) => {
      s.collapsed = v;
      s.freezeUntil = now + 260;
      s.anchor = y;
      setCollapsed(v);
    };
    if (y < 40) {
      if (s.collapsed) toggle(false);
      s.anchor = y;
      return;
    }
    if (!s.collapsed && y - s.anchor > 24) toggle(true);
    else if (s.collapsed && s.anchor - y > 24) toggle(false);
    else if ((s.collapsed && y > s.anchor) || (!s.collapsed && y < s.anchor)) s.anchor = y;
  });
  return collapsed;
}

export function AddressLine({ className }: { className?: string }) {
  const address = useLocation((s) => s.address);
  const hydrated = useUi((s) => s.hydrated);
  return (
    <Link href="/location" className={cn("inline-flex max-w-full min-w-0 items-center gap-0.5 text-13 text-ink", className)}>
      <span className="truncate">
        {hydrated && address ? (
          <>
            <b className="font-bold uppercase">{address.label}</b> - {address.line1}, {address.city}
          </>
        ) : (
          "Select delivery location"
        )}
      </span>
      <ChevronDown aria-hidden size={16} strokeWidth={2} className="shrink-0" />
      <span className="sr-only">Change delivery address</span>
    </Link>
  );
}

/** Headline: the delivery day and first slot for the pincode, or a prompt to set one. */
function useHeadline() {
  const slot = useNextSlot();
  const hasPincode = useLocation((s) => Boolean(s.address));
  if (!hasPincode) return { kicker: "Fresh mangoes", headline: "Delivered on your day" };
  if (!slot) return { kicker: "Delivery", headline: "Checking your area" };
  return { kicker: "Delivery", headline: slot.window ? `${slot.dayLabel}, ${slot.window}` : slot.dayLabel };
}

function EtaHeadline({ size = "lg" }: { size?: "lg" | "md" }) {
  const { headline } = useHeadline();
  return <p className={cn("font-display leading-tight font-extrabold text-ink", size === "lg" ? "text-21 sm:text-24" : "text-17")}>{headline}</p>;
}

function EtaKicker() {
  return <>{useHeadline().kicker}</>;
}

function DesktopCart() {
  const lines = useCart((s) => s.lines);
  const hydrated = useUi((s) => s.hydrated);
  const setOpen = useUi((s) => s.setCartOpen);
  const count = hydrated ? cartCount(lines) : 0;
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="press flex h-[52px] min-w-[112px] items-center gap-2 rounded-8 bg-deep px-3 text-left text-white"
      aria-label={count ? `Cart, ${plural(count, "item")}, ${rupees(total)}` : "Cart is empty"}
    >
      <ShoppingCart aria-hidden size={24} strokeWidth={1.75} />
      {count ? (
        <span className="flex flex-col text-13 leading-tight font-bold">
          <span>{plural(count, "item")}</span>
          <span>{rupees(total)}</span>
        </span>
      ) : (
        <span className="text-15 font-bold">My Cart</span>
      )}
    </button>
  );
}

export function SearchLink({ className }: { className?: string }) {
  return (
    <Link
      href="/search"
      className={cn(
        "flex h-12 items-center gap-2 rounded-8 border border-line bg-surface px-3 text-13 lg:h-[46px] lg:bg-chip",
        className,
      )}
    >
      <Search aria-hidden size={20} strokeWidth={1.75} className="shrink-0 text-ink" />
      <span className="sr-only">Search for mangoes</span>
      <RotatingPlaceholder />
    </Link>
  );
}

/** Sticky Blinkit header. The address line collapses on scroll down and expands on scroll up (180 ms). */
export function Header() {
  const collapsed = useCollapsed();
  const token = useAuth((s) => s.profile);
  const ref = useRef<HTMLElement>(null);
  // Expose the live header height for sticky rails and chip rows.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const hydrated = useUi((s) => s.hydrated);

  return (
    <header ref={ref} className="site-header sticky top-0 z-40 border-b border-line bg-linear-to-br from-brand to-blush lg:bg-linear-to-r lg:from-brand-soft lg:via-surface lg:to-surface">
      {/* Phones and tablets */}
      <div className="mx-auto max-w-content px-4 pt-3 pb-3 lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <m.div
              initial={false}
              animate={collapsed ? { height: 0, opacity: 0 } : { height: "auto", opacity: 1 }}
              transition={headerTween}
              className="overflow-hidden"
            >
              <p className="text-11 font-bold text-ink">
                <EtaKicker />
              </p>
              <EtaHeadline />
            </m.div>
            <AddressLine className={cn(collapsed ? "mt-0" : "mt-0.5")} />
          </div>
          <Link
            href={hydrated && token ? "/account" : "/login?next=/account"}
            aria-label="Account"
            className="press grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink"
          >
            <UserRound size={20} strokeWidth={1.75} />
          </Link>
        </div>
        <SearchLink className="mt-3" />
      </div>

      {/* Laptops */}
      <div className="mx-auto hidden h-[86px] max-w-content items-center gap-6 px-6 lg:flex">
        <Logo />
        <div className="h-full w-px bg-line" aria-hidden />
        <div className="w-[270px] min-w-0 shrink-0">
          <p className="font-display text-17 leading-tight font-extrabold text-ink">
            <EtaInline />
          </p>
          <AddressLine className="mt-0.5" />
        </div>
        <SearchLink className="flex-1" />
        <Link href={hydrated && token ? "/account" : "/login?next=/account"} className="text-17 text-ink hover:text-action">
          {hydrated && token ? "Account" : "Login"}
        </Link>
        <DesktopCart />
      </div>
    </header>
  );
}

function EtaInline() {
  const { kicker, headline } = useHeadline();
  if (kicker !== "Delivery") return <>{`${headline} · ${kicker.toLowerCase()}`}</>;
  return <>Delivery <span className="lowercase">{headline}</span></>;
}
