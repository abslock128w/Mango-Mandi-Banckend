"use client";
import Link from "next/link";
import { ChevronDown, Search, ShoppingCart, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Crossfade } from "@/components/ui/crossfade";
import { RotatingPlaceholder } from "@/features/search/components/rotating-placeholder";
import { useNextSlot } from "@/features/catalog/hooks/queries";
import { useLocation } from "@/features/location/store";
import { useAuth } from "@/features/auth/store";
import { cartCount, useCart } from "@/features/cart/store";
import { useUi } from "./ui-store";
import { Logo } from "./logo";
import { useBackdropTone } from "@/lib/hooks/use-backdrop-tone";
import { userScrolledRecently, useScrollDirection } from "@/lib/hooks/use-scroll-direction";
import { cn, plural, rupees } from "@/lib/format";

/**
 * The phone header is an iOS large title. It keeps its full height in the layout and is sticky at
 * top: -(collapse) px, so the browser itself scrolls the logo and delivery line away and the
 * address and search stay pinned: no height animation, no reflow, the document never changes
 * height. While it goes, the logo block fades and shrinks a little, the address line slides up
 * into the space and the account button holds still: CSS scroll-driven animations (globals.css),
 * in step with the compositor's scroll, no script per frame. A browser without scroll timelines
 * keeps the header fully open (collapse 0) rather than half-working. Stopping half-way after a
 * swipe settles the title open or closed in the direction of travel, as iOS does.
 */
function useLargeTitle(header: React.RefObject<HTMLElement | null>, parts: { search: React.RefObject<HTMLElement | null>; account: React.RefObject<HTMLElement | null>; address: React.RefObject<HTMLElement | null> }) {
  const collapse = useRef(0);

  // Measured on resize only (never on scroll): how far the header slides and the address moves.
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = () => {
      const { search, account, address } = { search: parts.search.current, account: parts.account.current, address: parts.address.current };
      const root = document.documentElement.style;
      // Laptops (the phone block is display: none), and browsers without scroll timelines, do not collapse.
      if (!search || !account || !address || !search.offsetParent || !CSS.supports("animation-timeline: scroll()")) {
        collapse.current = 0;
        root.setProperty("--header-collapse", "0px");
        root.setProperty("--header-h", `${el.offsetHeight}px`);
        return;
      }
      const top = (n: HTMLElement) => n.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const accountTop = top(account);
      // Collapsed, the search keeps the gap it has below the account button today.
      const c = Math.max(0, Math.round(top(search) - (accountTop + account.offsetHeight + 12)));
      collapse.current = c;
      root.setProperty("--header-collapse", `${c}px`);
      root.setProperty("--header-shift", `${Math.max(0, Math.round(top(address) - accountTop - c))}px`);
      // What stays on screen: sticky rails and scroll offsets sit under this.
      root.setProperty("--header-h", `${el.offsetHeight - c}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [header, parts.search, parts.account, parts.address]);

  // Settle a half-collapsed title after the customer's own scroll stops.
  const { ref: dir } = useScrollDirection();
  useEffect(() => {
    const settle = () => {
      const c = collapse.current;
      const y = window.scrollY;
      if (!c || y <= 0 || y >= c || !userScrolledRecently(1000)) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: dir.current.dir === "down" ? c : 0, behavior: reduce ? "auto" : "smooth" });
    };
    window.addEventListener("scrollend", settle);
    return () => window.removeEventListener("scrollend", settle);
  }, [dir]);
}


export function AddressLine({ className }: { className?: string }) {
  const address = useLocation((s) => s.address);
  const hydrated = useUi((s) => s.hydrated);
  return (
    <Link href="/location" className={cn("tap inline-flex max-w-full min-w-0 items-center gap-1 text-13 text-ink", className)}>
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
  // A new pincode or slot crossfades the line instead of cutting to it.
  return (
    <p className={cn("font-display leading-tight font-extrabold text-ink", size === "lg" ? "text-21 sm:text-24" : "text-17")}>
      <Crossfade inline id={headline}>
        {headline}
      </Crossfade>
    </p>
  );
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

export function SearchLink({ className, ref }: { className?: string; ref?: React.Ref<HTMLAnchorElement> }) {
  return (
    <Link
      ref={ref}
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

/**
 * Sticky Blinkit header. On phones the logo and delivery line scroll away as a large title
 * (useLargeTitle). The bar itself is liquid glass (globals.css, .glass--bar): on phones the brand
 * gradient lies over it while the title is open and fades with the scroll (.header-brand-bg), so the
 * collapsed bar is glass the page shows through; on laptops it is glass from the start. Its tone
 * flips to dark while a photo card or dark banner passes under it (useBackdropTone), and the content
 * below its edge dissolves into it (.glass-edge) instead of meeting a line.
 */
export function Header() {
  const token = useAuth((s) => s.profile);
  const ref = useRef<HTMLElement>(null);
  const search = useRef<HTMLAnchorElement>(null);
  const account = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLDivElement>(null);
  useLargeTitle(ref, { search, account, address });
  useBackdropTone(ref);
  const hydrated = useUi((s) => s.hydrated);

  return (
    <header ref={ref} className="site-header glass glass--bar sticky top-[calc(-1*var(--header-collapse,0px))] z-40 lg:top-0">
      <span aria-hidden className="header-brand-bg absolute inset-0 bg-linear-to-br from-brand to-blush lg:hidden" />
      <span aria-hidden className="glass-edge" />
      {/* Phones and tablets */}
      <div className="relative mx-auto max-w-content px-4 pt-3 pb-3 lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="header-brand origin-top-left">
              <Logo height={34} className="mb-2" />
              <p className="text-11 font-bold text-ink">
                <EtaKicker />
              </p>
              <EtaHeadline />
            </div>
            <div ref={address} className="header-address relative">
              <AddressLine className="mt-0.5" />
            </div>
          </div>
          {/* The account button holds still while the header scrolls; its face presses. */}
          <div ref={account} className="header-account relative z-10 size-11 shrink-0">
            <Link
              href={hydrated && token ? "/account" : "/login?next=/account"}
              aria-label="Account"
              className="press grid size-full place-items-center rounded-full bg-surface text-ink"
            >
              <UserRound size={20} strokeWidth={1.75} />
            </Link>
          </div>
        </div>
        <SearchLink ref={search} className="mt-3" />
      </div>

      {/* Laptops */}
      <div className="relative mx-auto hidden h-[86px] max-w-content items-center gap-6 px-6 lg:flex">
        <Logo height={58} />
        <div className="h-full w-px bg-hairline" aria-hidden />
        <div className="w-[270px] min-w-0 shrink-0">
          <p className="font-display text-17 leading-tight font-extrabold text-(--glass-ink,var(--color-ink))">
            <EtaInline />
          </p>
          <AddressLine className="mt-0.5" />
        </div>
        <SearchLink className="flex-1" />
        <Link href={hydrated && token ? "/account" : "/login?next=/account"} className="tap text-17 text-(--glass-ink,var(--color-ink)) hover:text-action">
          {hydrated && token ? "Account" : "Sign in"}
        </Link>
        <DesktopCart />
      </div>
    </header>
  );
}

function EtaInline() {
  const { kicker, headline } = useHeadline();
  return (
    <Crossfade inline id={`${kicker}-${headline}`}>
      {kicker !== "Delivery" ? (
        `${headline} · ${kicker.toLowerCase()}`
      ) : (
        <>
          Delivery <span className="lowercase">{headline}</span>
        </>
      )}
    </Crossfade>
  );
}
