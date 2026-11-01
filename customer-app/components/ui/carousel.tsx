"use client";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import * as React from "react";
import { cn } from "@/lib/format";

type Api = UseEmblaCarouselType[1];
type Options = Parameters<typeof useEmblaCarousel>[0];
type Plugins = Parameters<typeof useEmblaCarousel>[1];

interface Ctx {
  ref: UseEmblaCarouselType[0];
  api: Api;
  selected: number;
  count: number;
  scrollTo: (i: number) => void;
}

const CarouselContext = React.createContext<Ctx | null>(null);

export function useCarousel() {
  const c = React.useContext(CarouselContext);
  if (!c) throw new Error("useCarousel must be used inside <Carousel>");
  return c;
}

/** shadcn/ui Carousel (Embla 8). */
export function Carousel({ opts, plugins, className, children, label, ...rest }: React.HTMLAttributes<HTMLDivElement> & { opts?: Options; plugins?: Plugins; label: string }) {
  const [ref, api] = useEmblaCarousel(opts, plugins);
  const [selected, setSelected] = React.useState(0);
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!api) return;
    const update = () => {
      setSelected(api.selectedScrollSnap());
      setCount(api.scrollSnapList().length);
    };
    update();
    api.on("select", update).on("reInit", update);
    return () => {
      api.off("select", update).off("reInit", update);
    };
  }, [api]);
  const scrollTo = React.useCallback((i: number) => api?.scrollTo(i), [api]);
  return (
    <CarouselContext.Provider value={{ ref, api, selected, count, scrollTo }}>
      <div role="region" aria-roledescription="carousel" aria-label={label} className={cn("relative", className)} {...rest}>
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

export function CarouselContent({ className, children }: { className?: string; children: React.ReactNode }) {
  const { ref } = useCarousel();
  return (
    <div ref={ref} className="overflow-hidden">
      <div className={cn("flex touch-pan-y", className)}>{children}</div>
    </div>
  );
}

export function CarouselItem({ className, children, index, total }: { className?: string; children: React.ReactNode; index: number; total: number }) {
  return (
    <div role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${total}`} className={cn("min-w-0 shrink-0 grow-0", className)}>
      {children}
    </div>
  );
}
