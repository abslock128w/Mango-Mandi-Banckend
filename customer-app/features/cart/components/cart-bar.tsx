"use client";
import { BlurImage } from "@/components/ui/blur-image";
import { AnimatePresence, animate, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GlassGlow, useGlassPress } from "@/components/ui/pressable";
import { RollingNumber } from "@/components/ui/rolling-number";
import { useUi } from "@/features/shell/ui-store";
import { useBackdropTone } from "@/lib/hooks/use-backdrop-tone";
import { useScrollDirection } from "@/lib/hooks/use-scroll-direction";
import { rupees } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { cartCount, cartSubtotal, useCart } from "../store";
import { DeliveryBadge } from "./free-delivery";
import { landing } from "../fly";

const HIDDEN = [/^\/cart/, /^\/checkout/, /^\/login/, /^\/orders\/.+/, /^\/preorders\/.+/, /^\/location/, /^\/offline/];

function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => rupees(Math.round(v)));
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.36, ease: ease.standard });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <m.span className="tabular-nums">{text}</m.span>;
}

/** Scale 1 → 1.03 → 1 each time a box is added (not on removal or first appearance). */
function usePulse(count: number, reduce: boolean | null) {
  const scale = useMotionValue(1);
  const last = useRef(count);
  useEffect(() => {
    const added = count > last.current && last.current > 0;
    last.current = count;
    if (!added || reduce) return;
    // After the photo flying in from the card has landed (fly.ts).
    const c = animate(scale, [1, 1.03, 1], { duration: 0.32, ease: ease.standard, delay: landing() / 1000 });
    return () => c.stop();
  }, [count, scale, reduce]);
  return scale;
}

/**
 * Floating cart bar (phones and tablets). Laptops use the header cart button.
 * Arrives on spring.bouncy, pulses on each add, and slides away while the customer scrolls down
 * (useScrollDirection, their own scrolling only), back on the way up or as soon as the cart changes.
 * A liquid glass capsule (globals.css, .glass--pill): the page shows through it, its tone flips to
 * dark over photos (useBackdropTone), it lights up from under the finger (useGlassPress), and the
 * badge and thumbnails inside are concentric with it (28 px − 8 px padding = 20 px).
 */
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
  const pulse = usePulse(count, reduce);
  const { direction } = useScrollDirection();
  // Hidden on the way down, until the direction turns or the cart changes.
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  const [lastDir, setLastDir] = useState(direction);
  if (direction !== lastDir) {
    setLastDir(direction);
    setHiddenAt(direction === "down" ? count : null);
  }
  const tucked = hiddenAt !== null && hiddenAt === count;
  const bar = useRef<HTMLButtonElement>(null);
  useBackdropTone(bar, visible);
  const glassPress = useGlassPress();

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden ${pathname.startsWith("/p/") || pathname.startsWith("/bulk/") ? "bottom-[76px]" : "bottom-0"}`}
      aria-live="polite"
    >
      <m.div
        initial={false}
        animate={tucked ? (reduce ? { opacity: 0 } : { y: "140%" }) : reduce ? { opacity: 1 } : { y: 0 }}
        transition={spring.smooth}
        className={tucked ? "[&>*]:pointer-events-none" : undefined}
      >
        <AnimatePresence>
          {visible && (
            <m.button
              ref={bar}
              type="button"
              key="bar"
              data-testid="cart-bar"
              data-glass-group
              {...glassPress}
              onClick={() => setOpen(true)}
              initial={reduce ? { opacity: 0 } : { y: 96, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: 96, opacity: 0 }}
              transition={spring.bouncy}
              style={{ scale: pulse }}
              whileTap={{ scale: 0.97 }}
              className="glass glass--pill pointer-events-auto mx-auto flex h-14 w-full max-w-[560px] items-center gap-3 rounded-full pr-3 pl-2 text-left"
              aria-label={`View cart, ${count} item${count === 1 ? "" : "s"}, ${rupees(itemTotal)}`}
            >
              <DeliveryBadge size={40} />
              <span data-cart-thumbs className="flex -space-x-3" aria-hidden>
                <AnimatePresence initial={false}>
                  {thumbs.map((l, i) => (
                    <m.span
                      key={l.skuId}
                      layout
                      initial={reduce ? false : { scale: 0.4, opacity: 0, x: -8 }}
                      animate={{ scale: 1, opacity: 1, x: 0 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ ...spring.snappy, delay: reduce ? 0 : i * 0.05 }}
                      data-thumb
                      className="relative size-9 overflow-hidden rounded-[20px] border-2 border-white/80 bg-white"
                      style={{ zIndex: 3 - i }}
                    >
                      <BlurImage src={l.image} alt="" fill sizes="36px" className="object-cover" />
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
              <GlassGlow />
            </m.button>
          )}
        </AnimatePresence>
      </m.div>
    </div>
  );
}
