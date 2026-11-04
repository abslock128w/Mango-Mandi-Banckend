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

// The slide's accent: only its "Order now" pill carries a colour; the photo has the rest of the card.
const TONE: Record<Slide["tone"], string> = {
  brand: "bg-brand text-ink",
  action: "bg-white text-deep",
  ripe: "bg-brand text-ink",
  raw: "bg-raw-soft text-action",
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
      {/* A full-bleed photo card (the editorial feel): the words sit on a scrim at its foot, the photo moves, the words hold still. */}
      <Link ref={ref} href={s.href} data-backdrop="dark" className="relative block aspect-[2.1/1] overflow-hidden rounded-12 bg-brand-soft">
        <m.div className="absolute -inset-y-[5%] inset-x-0" style={{ y }}>
          {/* Off-screen banners load after first paint so they don't compete with the LCP image. */}
          {(i === 0 || ready) && <BlurImage src={s.image} alt="" fill preload={i === 0} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 88vw" className="object-cover" />}
        </m.div>
        <div className="scrim absolute inset-0 flex flex-col justify-end p-4 text-white">
          {/* The words rise 8 px (160 ms) each time their slide comes to the front. */}
          <m.div initial={false} animate={active ? { y: [8, 0], opacity: [0, 1] } : { y: 0, opacity: 1 }} transition={{ duration: 0.16, ease: ease.standard }}>
            <p className="max-w-[80%] font-display text-19 leading-tight font-extrabold lg:text-24">{s.title}</p>
            <p className="mt-1 max-w-[80%] text-12 font-medium text-white/85">{s.subtitle}</p>
            <span className={cn("mt-3 block w-fit rounded-8 px-3 py-2 text-12 font-bold", TONE[s.tone])}>Order now</span>
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
