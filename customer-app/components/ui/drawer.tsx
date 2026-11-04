"use client";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import * as React from "react";
import { useIsDesktop } from "@/lib/hooks/use-media";
import { cn } from "@/lib/format";

type SnapPoint = number | string;

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
 * shadcn-style Drawer on Base UI primitives (no Vaul).
 * Phones: bottom sheet with drag-to-dismiss and optional snap points.
 * Laptops (>=1024px): right-hand panel or centred dialog.
 * Motion: 250ms ease-out slide, backdrop fade, content fades in 60ms after settle.
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
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-scrim opacity-100 transition-opacity duration-[250ms] ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0" />
        <BaseDrawer.Viewport
          className={cn(
            "fixed inset-0 z-50 flex touch-none",
            mode === "bottom" && "items-end justify-center",
            mode === "right" && "justify-end",
            mode === "dialog" && "items-center justify-center p-6",
          )}
        >
          <BaseDrawer.Popup
            className={cn(
              "group/sheet relative flex min-h-0 flex-col bg-surface text-ink outline-none",
              "transition-[transform,opacity] duration-[250ms] ease-out data-swiping:duration-0 data-swiping:select-none",
              mode === "bottom" &&
                cn(
                  "w-full rounded-t-16 shadow-sheet",
                  useSnaps
                    ? "h-[calc(100dvh-2rem)] [padding-bottom:max(0px,calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] [transform:translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))]"
                    : "max-h-[calc(100dvh-2rem)] [transform:translateY(var(--drawer-swipe-movement-y))]",
                  "data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]",
                ),
              mode === "right" &&
                "h-dvh max-w-full [transform:translateX(var(--drawer-swipe-movement-x))] data-starting-style:[transform:translateX(100%)] data-ending-style:[transform:translateX(100%)]",
              mode === "dialog" &&
                "max-h-[calc(100dvh-3rem)] w-full max-w-[560px] rounded-16 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0",
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
              <div className={cn("flex shrink-0 items-center justify-between gap-3 px-4", hideTitle ? "py-1" : "border-b border-line py-3")}>
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
                "animate-[sheet-content_150ms_ease-out_310ms_both] reduced:animate-none",
                bodyClassName,
              )}
            >
              {children}
            </BaseDrawer.Content>
            {footer && <div className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">{footer}</div>}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}

export const SheetClose = BaseDrawer.Close;
