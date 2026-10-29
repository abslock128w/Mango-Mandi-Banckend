"use client";
import Image from "next/image";
import { AnimatePresence, animate, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { useUi } from "@/features/shell/ui-store";
import { rupees } from "@/lib/format";
import { cartCount, cartSubtotal, useCart } from "../store";
import { DeliveryBadge } from "./free-delivery";

const HIDDEN = [/^\/cart/, /^\/checkout/, /^\/login/, /^\/orders\/.+/, /^\/preorders\/.+/, /^\/location/, /^\/offline/];

function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => rupees(v));
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.4, ease: "easeOut" });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <m.span className="tabular-nums">{text}</m.span>;
}

/** Floating cart bar (phones and tablets). Laptops use the header cart button. */
export function CartBar() {
  const lines = useCart((s) => s.lines);
  const hydrated = useUi((s) => s.hydrated);
  const cartOpen = useUi((s) => s.cartOpen);
  const setOpen = useUi((s) => s.setCartOpen);
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const bulk = useCart((s) => s.bulk);
  const count = cartCount(lines, bulk);
  const itemTotal = cartSubtotal(lines, bulk);
  const visible = hydrated && count > 0 && !cartOpen && !HIDDEN.some((r) => r.test(pathname));
  const thumbs = lines.slice(-3).reverse();

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden ${pathname.startsWith("/p/") || pathname.startsWith("/bulk/") ? "bottom-[76px]" : "bottom-0"}`}
      aria-live="polite"
    >
      <AnimatePresence>
        {visible && (
          <m.button
            type="button"
            key="bar"
            data-testid="cart-bar"
            onClick={() => setOpen(true)}
            initial={reduce ? { opacity: 0 } : { y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            whileTap={{ scale: 0.98 }}
            className="pointer-events-auto mx-auto flex h-14 w-full max-w-[560px] items-center gap-2.5 rounded-12 bg-deep pr-3 pl-2 text-left text-white shadow-sheet"
            aria-label={`View cart, ${count} item${count === 1 ? "" : "s"}, ${rupees(itemTotal)}`}
          >
            <DeliveryBadge />
            <span className="flex -space-x-3" aria-hidden>
              <AnimatePresence initial={false}>
                {thumbs.map((l, i) => (
                  <m.span
                    key={l.skuId}
                    layout
                    initial={reduce ? false : { scale: 0.4, opacity: 0, x: -8 }}
                    animate={{ scale: 1, opacity: 1, x: 0 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30, delay: reduce ? 0 : i * 0.05 }}
                    className="relative size-9 overflow-hidden rounded-8 border-2 border-deep bg-white"
                    style={{ zIndex: 3 - i }}
                  >
                    <Image src={l.image} alt="" fill sizes="36px" className="object-cover" />
                  </m.span>
                ))}
              </AnimatePresence>
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-13 font-bold">
                <RollingNumber value={count} /> item{count === 1 ? "" : "s"}
              </span>
              <span className="text-13 font-bold">
                <CountUp value={itemTotal} />
              </span>
            </span>
            <span className="flex items-center gap-0.5 text-15 font-bold">
              View cart <ChevronRight aria-hidden size={20} strokeWidth={2} />
            </span>
          </m.button>
        )}
      </AnimatePresence>
    </div>
  );
}
