"use client";
import Autoplay from "embla-carousel-autoplay";
import Image from "next/image";
import Link from "next/link";
import { useReducedMotion, useScroll, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef, useState } from "react";
import { Carousel, CarouselContent, CarouselItem, useCarousel } from "@/components/ui/carousel";
import { cn } from "@/lib/format";
import { uiSpring } from "@/lib/motion";
export interface Slide {
  id: string;
  image: string;
  title: string;
  subtitle: string;
  href: string;
  tone: "brand" | "action" | "ripe" | "raw";
}

const TONE: Record<Slide["tone"], string> = {
  brand: "from-brand/95 via-brand/70",
  action: "from-deep/95 via-deep/70 text-white",
  ripe: "from-ripe/95 via-ripe/70 text-white",
  raw: "from-action/95 via-action/70 text-white",
};

function Dots() {
  const { selected, count, scrollTo } = useCarousel();
  return (
    // Fixed height: the dots appear once Embla has measured, without pushing the page down.
    <div className="mt-2.5 flex h-6 justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" onClick={() => scrollTo(i)} aria-label={`Go to slide ${i + 1}`} aria-current={i === selected} className="relative grid h-6 place-items-center px-0.5">
          <m.span
            className={cn("block h-1.5 rounded-full", i === selected ? "bg-ink" : "bg-line")}
            initial={false}
            animate={{ width: i === selected ? 20 : 6 }}
            transition={uiSpring}
          />
        </button>
      ))}
    </div>
  );
}

function SlideCard({ s, i, total, ready }: { s: Slide; i: number; total: number; ready: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Subtle parallax on the banner image while the page scrolls.
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["-6%", "6%"]);
  return (
    <CarouselItem index={i} total={total} className="basis-[88%] pl-3 sm:basis-1/2 lg:basis-1/3">
      <Link ref={ref} href={s.href} className="relative block aspect-[2.1/1] overflow-hidden rounded-12 bg-brand-soft">
        <m.div className="absolute -inset-y-[8%] inset-x-0" style={{ y }}>
          {/* Off-screen banners load after first paint so they don't compete with the LCP image. */}
          {(i === 0 || ready) && <Image src={s.image} alt="" fill preload={i === 0} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 88vw" className="object-cover" />}
        </m.div>
        <div className={cn("absolute inset-0 flex flex-col justify-center bg-gradient-to-r to-transparent p-4 text-ink", TONE[s.tone])}>
          <p className="max-w-[62%] font-display text-19 leading-tight font-extrabold">{s.title}</p>
          <p className="mt-1 max-w-[62%] text-12 font-medium">{s.subtitle}</p>
          <span className="mt-3 w-fit rounded-8 bg-ink px-3 py-1.5 text-12 font-bold text-white">Order now</span>
        </div>
      </Link>
    </CarouselItem>
  );
}

/** Hero banners: Embla, autoplay every 5 s, stretching pagination dots. */
export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(t);
  }, []);
  const plugins = useMemo(() => (reduce ? [] : [Autoplay({ delay: 5000, stopOnInteraction: false, stopOnMouseEnter: true })]), [reduce]);
  return (
    <Carousel label="Offers" opts={{ align: "start", loop: true }} plugins={plugins} className="pt-3">
      <CarouselContent className="-ml-3 pr-4 pl-4 lg:pl-6">
        {slides.map((s, i) => (
          <SlideCard key={s.id} s={s} i={i} total={slides.length} ready={ready} />
        ))}
      </CarouselContent>
      <Dots />
    </Carousel>
  );
}
