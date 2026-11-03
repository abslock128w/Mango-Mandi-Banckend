"use client";
import Autoplay from "embla-carousel-autoplay";
import { BlurImage } from "@/components/ui/blur-image";
import Link from "next/link";
import { useReducedMotion, useScroll, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef, useState } from "react";
import { Carousel, CarouselContent, CarouselItem, useCarousel } from "@/components/ui/carousel";
import { cn } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
export interface Slide {
  id: string;
  image: string;
  title: string;
  subtitle: string;
  href: string;
  tone: "brand" | "action" | "ripe" | "raw";
}

// The photo leads; the words sit on a soft ink scrim at its foot. The tone colours only the button.
const TONE: Record<Slide["tone"], string> = {
  brand: "bg-brand text-ink",
  action: "bg-white text-deep",
  ripe: "bg-white text-ripe",
  raw: "bg-white text-action",
};

function Dots() {
  const { selected, count, scrollTo } = useCarousel();
  return (
    // Fixed height: the dots appear once Embla has measured, without pushing the page down.
    <div className="mt-3 flex h-6 justify-center gap-1">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" onClick={() => scrollTo(i)} aria-label={`Go to slide ${i + 1}`} aria-current={i === selected} className="relative grid h-6 min-w-6 place-items-center px-1 after:absolute after:inset-x-0 after:-inset-y-2.5">
          {/* A 20 px pill clipped to a 6 px dot: the stretch is clip-path, never width. */}
          <m.span
            className={cn("block h-1.5 w-5 rounded-full transition-colors duration-(--dur-m)", i === selected ? "bg-ink" : "bg-line")}
            initial={false}
            animate={{ clipPath: i === selected ? "inset(0px 0px round 9999px)" : "inset(0px 7px round 9999px)" }}
            transition={spring.snappy}
          />
        </button>
      ))}
    </div>
  );
}

function SlideCard({ s, i, total, ready }: { s: Slide; i: number; total: number; ready: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduce = useReducedMotion();
  const { selected } = useCarousel();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Subtle parallax on the banner image while the page scrolls: at most 4% either way, none under reduced motion.
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["-4%", "4%"]);
  const active = selected === i;
  return (
    <CarouselItem index={i} total={total} className="basis-[88%] pl-3 sm:basis-1/2 lg:basis-1/3">
      <Link ref={ref} href={s.href} className="relative block aspect-[16/10] overflow-hidden rounded-16 bg-brand-soft lg:aspect-[2.1/1]">
        <m.div className="absolute -inset-y-[5%] inset-x-0" style={{ y }}>
          {/* Off-screen banners load after first paint so they don't compete with the LCP image. */}
          {(i === 0 || ready) && <BlurImage src={s.image} alt="" fill preload={i === 0} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 88vw" className="object-cover" />}
        </m.div>
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-ink/85 via-ink/35 to-transparent p-4 text-white lg:p-5">
          {/* The words rise 8 px (160 ms) each time their slide comes to the front; the photo alone moves with the scroll. */}
          <m.div initial={false} animate={active ? { y: [8, 0], opacity: [0, 1] } : { y: 0, opacity: 1 }} transition={{ duration: 0.16, ease: ease.standard }}>
            <p className="max-w-[80%] font-display text-24 leading-tight font-extrabold text-balance lg:text-21">{s.title}</p>
            <p className="mt-1 max-w-[80%] text-13 font-medium text-white/90 lg:text-12">{s.subtitle}</p>
            <span className={cn("mt-3 block w-fit rounded-full px-3 py-2 text-12 font-bold", TONE[s.tone])}>Order now</span>
          </m.div>
        </div>
      </Link>
    </CarouselItem>
  );
}

/** Autoplay runs only while the banners are on screen (and never under reduced motion). */
function PauseOffscreen() {
  const { api } = useCarousel();
  useEffect(() => {
    const root = api?.rootNode();
    const autoplay = api?.plugins()?.autoplay;
    if (!root || !autoplay) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? autoplay.play() : autoplay.stop()), { threshold: 0.2 });
    io.observe(root);
    return () => io.disconnect();
  }, [api]);
  return null;
}

/**
 * Hero banners: Embla (duration 22 for a quicker, softer settle), autoplay every 5 s that pauses
 * while a finger or pointer is on it and while it is off screen, stretching pagination dots.
 */
export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(t);
  }, []);
  const plugins = useMemo(() => (reduce ? [] : [Autoplay({ delay: 5000, stopOnInteraction: false, stopOnMouseEnter: true, stopOnFocusIn: true })]), [reduce]);
  return (
    <Carousel label="Offers" opts={{ align: "start", loop: true, duration: 22 }} plugins={plugins} className="pt-3">
      <PauseOffscreen />
      <CarouselContent className="-ml-3 pr-4 pl-4 lg:pl-6">
        {slides.map((s, i) => (
          <SlideCard key={s.id} s={s} i={i} total={slides.length} ready={ready} />
        ))}
      </CarouselContent>
      <Dots />
    </Carousel>
  );
}
