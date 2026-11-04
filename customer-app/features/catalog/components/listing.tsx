"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageTransition } from "@/features/shell/page-transition";
import { useProducts } from "../hooks/queries";
import { cn } from "@/lib/format";
import { uiSpring } from "@/lib/motion";
import { RIPENESS } from "@/lib/ripeness";
import type { Collection, Product, RipenessStage } from "@/lib/types";
import { ProductCard, ProductCardSkeleton } from "./product-card";
import { SECTIONS } from "../sections";
import { DEFAULT_FILTERS, SORTS, type Filters, type Tab } from "../filters";
import { WhenVisible } from "@/components/ui/when-visible";


const SECTION_STAGE: Record<Collection, RipenessStage | null> = { all: null, ripe: "RIPE", "semi-ripe": "SEMI_RIPE", raw: "RAW" };

function sectionStage(id: Collection, f: Filters): RipenessStage | null {
  return SECTION_STAGE[id] ?? f.ripeness;
}

function minPrice(p: Product, stage: RipenessStage | null) {
  const prices = p.skus.filter((s) => !stage || s.ripeness === stage).map((s) => s.price);
  return prices.length ? Math.min(...prices) : Infinity;
}

function sortProducts(list: Product[], sort: Filters["sort"], stage: RipenessStage | null) {
  const out = [...list];
  if (sort === "price-asc") out.sort((a, b) => minPrice(a, stage) - minPrice(b, stage));
  else if (sort === "price-desc") out.sort((a, b) => minPrice(b, stage) - minPrice(a, stage));
  else if (sort === "popularity") out.sort((a, b) => b.variety.popularity - a.variety.popularity);
  else out.sort((a, b) => Number(b.variety.inSeason) - Number(a.variety.inSeason));
  return out;
}

function applyClientFilters(list: Product[], stage: RipenessStage | null, f: Filters) {
  return list.filter((p) => {
    if (f.sweetness && p.variety.sweetness < f.sweetness) return false;
    if (stage && !p.stages.includes(stage)) return false;
    if (f.inStockOnly) {
      if (!p.variety.inSeason) return false;
      const skus = p.skus.filter((s) => (!stage || s.ripeness === stage) && (!f.size || s.size === f.size));
      if (!skus.some((s) => s.stock > 0)) return false;
    }
    return true;
  });
}

function Chip({ children, active, onClick, count }: { children: React.ReactNode; active?: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press flex h-9 shrink-0 items-center gap-1 rounded-8 border px-3 text-12 font-medium whitespace-nowrap",
        active ? "border-action bg-tint text-action" : "border-line bg-surface text-ink",
      )}
    >
      {children}
      {count ? <span className="grid size-4 place-items-center rounded-full bg-action text-9 font-bold text-white">{count}</span> : null}
    </button>
  );
}

const FilterSheet = dynamic(() => import("./filter-sheet").then((m) => m.FilterSheet), { ssr: false });

function RipenessRail({ active, onSelect }: { active: Collection; onSelect: (id: Collection) => void }) {
  return (
    <nav aria-label="Ripeness and collections" className="no-scrollbar sticky top-(--header-h) h-[calc(100dvh-var(--header-h))] w-rail shrink-0 overflow-y-auto border-r border-line bg-surface lg:w-[104px]">
      <ul>
        {SECTIONS.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={on ? "true" : undefined}
                className="press relative flex w-full flex-col items-center gap-1 px-1 py-2.5"
              >
                <span className={cn("relative size-12 overflow-hidden rounded-12 transition-colors", on ? "bg-brand-soft" : "bg-chip")}>
                  <Image src={s.image} alt="" fill sizes="48px" className="object-cover" />
                </span>
                <span className={cn("text-center text-11 leading-tight", on ? "font-bold text-ink" : "text-muted")}>{s.label}</span>
                {on && <m.span layoutId="rail-active" transition={uiSpring} className="absolute inset-y-1.5 right-0 w-1 rounded-l-4 bg-action" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Listing({ initial }: { initial: Collection }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [active, setActive] = useState<Collection>(initial);
  const [sheet, setSheet] = useState<{ open: boolean; tab: Tab; loaded: boolean }>({ open: false, tab: "sort", loaded: false });
  const sectionRefs = useRef(new Map<Collection, HTMLElement>());
  const lock = useRef<number>(0);
  const reduce = useReducedMotion();

  const visibleSections = SECTIONS.filter((s) => !(filters.ripeness && SECTION_STAGE[s.id] && SECTION_STAGE[s.id] !== filters.ripeness));
  const { data: products } = useProducts();

  const scrollToSection = useCallback(
    (id: Collection, smooth = true) => {
      const el = sectionRefs.current.get(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0) - 52;
      lock.current = Date.now() + 700;
      window.scrollTo({ top: id === "all" ? 0 : top, behavior: smooth && !reduce ? "smooth" : "auto" });
    },
    [reduce],
  );

  // Deep link: /c/raw starts at the Raw section.
  useEffect(() => {
    if (initial !== "all") requestAnimationFrame(() => scrollToSection(initial, false));
  }, [initial, scrollToSection]);

  // Scroll-spy: the section nearest the top of the grid is active.
  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < lock.current) return;
      const offset = (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0) + 64;
      let current: Collection = visibleSections[0]?.id ?? "all";
      for (const s of visibleSections) {
        const el = sectionRefs.current.get(s.id);
        if (el && el.getBoundingClientRect().top - offset <= 0) current = s.id;
      }
      setActive((a) => (a === current ? a : current));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [visibleSections]);

  useEffect(() => {
    const url = active === "all" ? "/c/all" : `/c/${active}`;
    if (window.location.pathname !== url) window.history.replaceState(window.history.state, "", url + window.location.search);
  }, [active]);

  const filterCount = Number(filters.sort !== "relevance") + Number(Boolean(filters.ripeness)) + Number(Boolean(filters.size)) + Number(Boolean(filters.sweetness)) + Number(filters.inStockOnly);
  const openSheet = (tab: Tab) => setSheet({ open: true, tab, loaded: true });

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-content">
        <RipenessRail
          active={active}
          onSelect={(id) => {
            setActive(id);
            scrollToSection(id);
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="no-scrollbar sticky top-(--header-h) z-20 flex gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2">
            <Chip onClick={() => openSheet("sort")} count={filterCount} active={filterCount > 0}>
              <SlidersHorizontal aria-hidden size={14} strokeWidth={2} /> Filters
            </Chip>
            <Chip onClick={() => openSheet("size")} active={Boolean(filters.size)}>
              {filters.size ? `${filters.size} kg` : "Box size"} <ChevronDown aria-hidden size={14} />
            </Chip>
            <Chip onClick={() => openSheet("ripeness")} active={Boolean(filters.ripeness)}>
              {filters.ripeness ? RIPENESS[filters.ripeness].label : "Ripeness"} <ChevronDown aria-hidden size={14} />
            </Chip>
            <Chip onClick={() => openSheet("sort")} active={filters.sort !== "relevance"}>
              {filters.sort === "relevance" ? "Sort By" : SORTS.find((s) => s.id === filters.sort)?.label} <ChevronDown aria-hidden size={14} />
            </Chip>
          </div>
          <div className="space-y-6 bg-canvas p-2.5 lg:p-4">
            {visibleSections.map((s, i) => {
              const stage = sectionStage(s.id, filters);
              const list = products ? sortProducts(applyClientFilters(products, stage, filters), filters.sort, stage) : null;
              return (
                <section
                  key={s.id}
                  ref={(el) => {
                    if (el) sectionRefs.current.set(s.id, el);
                    else sectionRefs.current.delete(s.id);
                  }}
                  aria-labelledby={`sec-${s.id}`}
                  data-section={s.id}
                >
                  <h2 id={`sec-${s.id}`} className="px-0.5 pb-2.5 font-display text-15 font-extrabold text-ink lg:text-17">
                    {s.title}
                    {list && <span className="ml-1.5 text-12 font-medium text-muted">{list.length} items</span>}
                  </h2>
                  <WhenVisible
                    // First section renders immediately; the rest when scrolled near. Scroll-spy targets stay in place.
                    key={i === 0 ? "now" : "later"}
                    rootMargin={i === 0 ? "10000px" : "600px"}
                    placeholder={
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 lg:gap-3" aria-hidden>
                        {Array.from({ length: Math.min(list?.length ?? 12, 12) }, (_, j) => (
                          <ProductCardSkeleton key={j} />
                        ))}
                      </div>
                    }
                  >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 lg:gap-3">
                    {list
                      ? list.map((p, j) => <ProductCard key={`${p.id}-${filters.size ?? ""}`} product={p} ripeness={stage} scope={`list-${s.id}`} preferredSize={filters.size} index={j} priority={i === 0 && j < 2} />)
                      : Array.from({ length: 12 }, (_, j) => <ProductCardSkeleton key={j} />)}
                    {list && list.length === 0 && <p className="col-span-full rounded-12 bg-surface p-6 text-center text-13 text-muted">No mangoes match these filters.</p>}
                  </div>
                  </WhenVisible>
                </section>
              );
            })}
          </div>
        </div>
      </div>
      {sheet.loaded && <FilterSheet open={sheet.open} tab={sheet.tab} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} value={filters} onApply={setFilters} />}
    </PageTransition>
  );
}
