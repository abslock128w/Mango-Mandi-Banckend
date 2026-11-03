"use client";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import * as React from "react";
import { useIsDesktop } from "@/lib/hooks/use-media";
import { cn } from "@/lib/format";

type SnapPoint = number | string;

// Phone sheets open at once (e.g. a filter sheet over the cart): the page stays pushed back until the last closes.
let pushedBack = 0;
let settleTimer = 0;

/**
 * Pushes the page (.app-root, features/shell/app-root.tsx) back while a phone sheet is open, and
 * makes it follow the drag: Base UI writes --drawer-swipe-progress on the backdrop on every move,
 * and a MutationObserver copies it to the page in the same frame. globals.css does the rest.
 */
function usePushBack(backdrop: React.RefObject<HTMLDivElement | null>, active: boolean) {
  React.useEffect(() => {
    const page = document.querySelector<HTMLElement>(".app-root");
    if (!active || !page) return;
    window.clearTimeout(settleTimer);
    if (pushedBack++ === 0) {
      page.style.setProperty("--indent-top", `${Math.max(window.scrollY, document.body.scrollTop)}px`);
      page.removeAttribute("data-settling");
      page.setAttribute("data-active", "");
    }
    let mo: MutationObserver | null = null;
    // The backdrop mounts with the portal, a frame after `open`.
    const raf = requestAnimationFrame(() => {
      const el = backdrop.current;
      if (!el) return;
      const copy = () => page.style.setProperty("--drawer-swipe-progress", el.style.getPropertyValue("--drawer-swipe-progress") || "0");
      copy();
      mo = new MutationObserver(copy);
      mo.observe(el, { attributes: true, attributeFilter: ["style"] });
    });
    return () => {
      cancelAnimationFrame(raf);
      mo?.disconnect();
      if (--pushedBack > 0) return;
      page.removeAttribute("data-active");
      page.style.setProperty("--drawer-swipe-progress", "0");
      // Keep the rounded clip while the page comes forward again.
      page.setAttribute("data-settling", "");
      settleTimer = window.setTimeout(() => page.removeAttribute("data-settling"), 450);
    };
  }, [active, backdrop]);
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Visually hide the title (still announced). */
  hideTitle?: boolean;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  /** Phone snap points, e.g. [0.62, 1] for peek and full. */
  snapPoints?: SnapPoint[];
  /** Laptop presentation. */
  desktop?: "right" | "dialog";
  /** Width of the right panel on laptops. */
  panelWidth?: number;
  className?: string;
  bodyClassName?: string;
  onOpenChangeComplete?: (open: boolean) => void;
}

/**
 * shadcn-style Drawer on Base UI primitives (no Vaul). docs/design/shop-motion.md, "Sheet".
 * Phones: bottom sheet that tracks the finger, with optional snap points. Base UI rubber-bands past
 *   the top (square-root damping), dismisses on a flick faster than 500 px/s or a drag past the
 *   threshold, and otherwise settles on the nearest snap point. The page behind is pushed back
 *   (usePushBack, globals.css) and the backdrop dims, both by --drawer-swipe-progress, so they
 *   follow the drag rather than a timer. Release and open run on spring.smooth (its CSS mirror), shortened
 *   by Base UI's --drawer-swipe-strength after a fast flick. The keyboard lifts the sheet
 *   (VirtualKeyboardProvider, visualViewport) so a pincode or code field is never covered.
 * Laptops (>=1024px): right-hand panel (spring.smooth slide) or centred dialog (scale .96 + fade, 240 ms).
 * Content renders with the sheet: no delayed fade.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  description,
  children,
  footer,
  header,
  snapPoints,
  desktop = "right",
  panelWidth = 400,
  className,
  bodyClassName,
  onOpenChangeComplete,
}: SheetProps) {
  const isDesktop = useIsDesktop();
  const [snap, setSnap] = React.useState<SnapPoint | null>(snapPoints?.[0] ?? null);
  const [wasOpen, setWasOpen] = React.useState(open);
  // Each time the sheet opens it starts at the first snap point (peek).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSnap(snapPoints?.[0] ?? null);
  }

  const mode = isDesktop ? desktop : "bottom";
  const useSnaps = mode === "bottom" && snapPoints && snapPoints.length > 0;
  const backdropRef = React.useRef<HTMLDivElement>(null);
  usePushBack(backdropRef, open && mode === "bottom");

  const titleNode = (
    <BaseDrawer.Title className={cn("font-display text-17 font-extrabold text-ink", hideTitle && "sr-only")}>{title}</BaseDrawer.Title>
  );

  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={(o) => onOpenChange(o)}
      onOpenChangeComplete={onOpenChangeComplete}
      swipeDirection={mode === "right" ? "right" : "down"}
      // Remount when switching between snapping and free modes (controlled vs uncontrolled).
      key={useSnaps ? "snap" : mode}
      {...(useSnaps ? { snapPoints, snapPoint: snap, onSnapPointChange: setSnap } : {})}
    >
      <BaseDrawer.VirtualKeyboardProvider>
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop
          ref={backdropRef}
          className={cn(
            "fixed inset-0 z-50 min-h-dvh bg-scrim",
            // Dims with the drag: fully dark at rest, clear as the sheet leaves.
            "opacity-[calc(1-var(--drawer-swipe-progress,0))] data-ending-style:opacity-0 data-starting-style:opacity-0",
            "transition-opacity duration-(--dur-m) ease-standard data-swiping:duration-0",
          )}
        />
        <BaseDrawer.Viewport
          className={cn(
            "fixed inset-0 z-50 flex touch-none",
            // The software keyboard's height: the sheet sits on top of it.
            mode === "bottom" && "items-end justify-center pb-(--drawer-keyboard-inset)",
            mode === "right" && "justify-end",
            mode === "dialog" && "items-center justify-center p-6",
          )}
        >
          <BaseDrawer.Popup
            className={cn(
              "group/sheet relative flex min-h-0 flex-col bg-surface text-ink outline-none",
              "transition-[transform,opacity] data-swiping:duration-0 data-swiping:select-none data-swiping:will-change-transform",
              mode !== "dialog" &&
                // spring.smooth; a fast flick (low --drawer-swipe-strength) lands sooner.
                "duration-[calc(var(--dur-spring-smooth)*var(--drawer-swipe-strength,1))] ease-(--ease-spring-smooth)",
              mode === "dialog" && "duration-(--dur-m) ease-standard",
              mode === "bottom" &&
                cn(
                  "w-full rounded-t-16 shadow-sheet",
                  useSnaps
                    ? "h-[calc(100dvh-2rem-var(--drawer-keyboard-inset,0px))] [padding-bottom:max(0px,calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] [transform:translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))]"
                    : "max-h-[calc(100dvh-2rem-var(--drawer-keyboard-inset,0px))] [transform:translateY(var(--drawer-swipe-movement-y))]",
                  "data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]",
                ),
              mode === "right" &&
                "h-dvh max-w-full [transform:translateX(var(--drawer-swipe-movement-x))] data-starting-style:[transform:translateX(100%)] data-ending-style:[transform:translateX(100%)]",
              mode === "dialog" &&
                "max-h-[calc(100dvh-3rem)] w-full max-w-[560px] rounded-16 data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:opacity-0",
              className,
            )}
            style={mode === "right" ? { width: panelWidth } : undefined}
          >
            {mode === "bottom" && (
              <div className="flex shrink-0 justify-center pt-2 pb-1" aria-hidden>
                <div className="h-1 w-10 rounded-full bg-line" />
              </div>
            )}
            {header ?? (
              <div className={cn("flex shrink-0 items-center justify-between gap-3 px-4", hideTitle ? "py-1" : "border-b border-hairline py-3")}>
                {titleNode}
                <BaseDrawer.Close
                  aria-label="Close"
                  className="press ml-auto grid size-11 place-items-center rounded-full text-ink hover:bg-chip"
                >
                  <X size={20} strokeWidth={1.75} />
                </BaseDrawer.Close>
              </div>
            )}
            {header && <div className="sr-only">{titleNode}</div>}
            {description && <BaseDrawer.Description className="sr-only">{description}</BaseDrawer.Description>}
            <BaseDrawer.Content
              className={cn(
                "min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain",
                bodyClassName,
              )}
            >
              {children}
            </BaseDrawer.Content>
            {footer && <div className="shrink-0 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)]">{footer}</div>}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
      </BaseDrawer.VirtualKeyboardProvider>
    </BaseDrawer.Root>
  );
}
