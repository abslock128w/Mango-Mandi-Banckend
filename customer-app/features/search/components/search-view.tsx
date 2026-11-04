"use client";
import Image from "next/image";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ArrowLeft, ChevronDown, Clock, Search, SearchX, ShoppingCart, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProductCard, ProductCardSkeleton } from "@/features/catalog/components/product-card";
import { useProducts } from "@/features/catalog/hooks/queries";
import { useOpenProduct } from "@/features/product/open";
import { Logo } from "@/features/shell/logo";
import { useUi } from "@/features/shell/ui-store";
import { cartCount, useCart } from "@/features/cart/store";
import { cn, rupees } from "@/lib/format";
import type { SearchSuggestion } from "@/lib/types";
import { searchProducts, suggestionsFor } from "../match";
import { RotatingPlaceholder } from "./rotating-placeholder";

/** Fixed ideas that always find something, after the varieties on sale. */
const IDEAS = ["Ripe, ready to eat", "Raw mango for pickle", "Semi-ripe", "5 kg box", "Mango for aamras"];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Typed text grey, completion bold (Instamart autosuggest). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <b className="font-semibold text-ink">{text}</b>;
  return (
    <span>
      {i > 0 && <b className="font-semibold text-ink">{text.slice(0, i)}</b>}
      <span className="text-muted">{text.slice(i, i + q.length)}</span>
      <b className="font-semibold text-ink">{text.slice(i + q.length)}</b>
    </span>
  );
}

function Thumb({ src }: { src?: string }) {
  return (
    <span className="relative size-8 shrink-0 overflow-hidden rounded-8 border-[0.5px] border-line bg-chip">
      {src ? <Image src={src} alt="" fill sizes="32px" className="object-cover" /> : <Search aria-hidden size={16} className="m-2 text-muted" />}
    </span>
  );
}

function SuggestionTree({ items, query, onSearch }: { items: SearchSuggestion[]; query: string; onSearch: (q: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(() => items.find((s) => s.children)?.id ?? null);
  const [prevItems, setPrevItems] = useState(items);
  // New suggestions: expand the first variety into its ripeness stages.
  if (items !== prevItems) {
    setPrevItems(items);
    setExpanded(items.find((s) => s.children)?.id ?? null);
  }
  const open = useOpenProduct();
  return (
    <ul role="listbox" aria-label="Suggestions" className="py-1">
      {items.map((s) => (
        <li key={s.id}>
          <div className="flex items-center">
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={(e) => (s.children ? onSearch(s.label) : open(e, s.productId!, "search-suggest", s.ripeness))}
              className="flex h-9 min-w-0 flex-1 items-center gap-2.5 px-4 text-left text-13 hover:bg-chip"
            >
              <Thumb src={s.image} />
              <span className="min-w-0 truncate">
                <Highlight text={s.label} query={query} />
                {s.reason && <span className="ml-1.5 text-11 text-muted">· {s.reason}</span>}
              </span>
            </button>
            {s.children && (
              <button
                type="button"
                aria-label={`${expanded === s.id ? "Hide" : "Show"} ripeness options for ${s.label}`}
                aria-expanded={expanded === s.id}
                onClick={() => setExpanded((x) => (x === s.id ? null : s.id))}
                className="grid size-11 place-items-center text-muted"
              >
                <ChevronDown aria-hidden size={18} className={cn("transition-transform", expanded === s.id && "rotate-180")} />
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {s.children && expanded === s.id && (
              <m.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden border-l-2 border-line ml-8">
                {s.children.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={(e) => open(e, c.productId!, "search-suggest", c.ripeness)}
                      className="flex h-9 w-full items-center gap-2.5 pr-4 pl-4 text-left text-13 hover:bg-chip"
                    >
                      <Thumb src={c.image} />
                      <Highlight text={c.label} query={query} />
                    </button>
                  </li>
                ))}
              </m.ul>
            )}
          </AnimatePresence>
        </li>
      ))}
    </ul>
  );
}

function SearchCartButton() {
  const lines = useCart((s) => s.lines);
  const hydrated = useUi((s) => s.hydrated);
  const setOpen = useUi((s) => s.setCartOpen);
  const count = hydrated ? cartCount(lines) : 0;
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return (
    <button type="button" onClick={() => setOpen(true)} aria-label={count ? `Cart, ${count} items` : "Cart"} className="press relative flex h-[46px] shrink-0 items-center gap-2 rounded-8 bg-deep px-3 text-white">
      <ShoppingCart aria-hidden size={20} strokeWidth={1.75} />
      <span className="hidden text-13 font-bold sm:inline">{count ? `${count} items · ${rupees(total)}` : "My Cart"}</span>
      {count > 0 && <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-brand text-9 font-bold text-ink sm:hidden">{count}</span>}
    </button>
  );
}

export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const submitted = params.get("q") ?? "";
  const [text, setText] = useState(submitted);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = useUi((s) => s.recentSearches);
  const addRecent = useUi((s) => s.addRecent);
  const clearRecent = useUi((s) => s.clearRecent);
  const debounced = useDebounced(text.trim(), 150);
  const typing = text.trim() !== "" && text.trim() !== submitted;

  const [prevSubmitted, setPrevSubmitted] = useState(submitted);
  if (submitted !== prevSubmitted) {
    setPrevSubmitted(submitted);
    setText(submitted);
  }
  useEffect(() => inputRef.current?.focus(), []);

  const { data: products, isPending } = useProducts();
  const suggestions = useMemo(() => (products && debounced ? suggestionsFor(products, debounced) : null), [products, debounced]);
  const results = useMemo(() => (products && submitted ? searchProducts(products, submitted) : null), [products, submitted]);
  const trending = useMemo(() => [...(products ?? []).slice(0, 3).map((p) => p.name), ...IDEAS], [products]);

  const runSearch = (q: string) => {
    const v = q.trim();
    if (!v) return;
    addRecent(v);
    setText(v);
    inputRef.current?.blur();
    router.replace(`/search?q=${encodeURIComponent(v)}`, { scroll: false });
  };

  const showResults = submitted && !typing;

  return (
    <div className="min-h-dvh bg-surface">
      <header className="site-header sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-content items-center gap-2 px-3 py-2.5 lg:gap-6 lg:px-6 lg:py-4">
          <button type="button" onClick={() => router.back()} aria-label="Back" className="press grid size-11 shrink-0 place-items-center rounded-full text-ink lg:hidden">
            <ArrowLeft size={20} strokeWidth={1.75} />
          </button>
          <span className="hidden shrink-0 lg:block">
            <Logo />
          </span>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(text);
            }}
            className="relative flex h-[46px] min-w-0 flex-1 items-center rounded-8 border border-line bg-surface focus-within:border-action"
          >
            <Search aria-hidden size={20} strokeWidth={1.75} className="ml-3 shrink-0 text-ink" />
            <label htmlFor="q" className="sr-only">
              Search for mangoes
            </label>
            <input
              id="q"
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-15 text-ink outline-none"
            />
            {!text && <RotatingPlaceholder className="absolute top-1/2 left-10 -translate-y-1/2 text-15" />}
            {text && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setText("");
                  inputRef.current?.focus();
                  if (submitted) router.replace("/search", { scroll: false });
                }}
                className="grid size-11 shrink-0 place-items-center text-muted"
              >
                <X size={18} strokeWidth={2} />
              </button>
            )}
          </form>
          <SearchCartButton />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-content pb-28">
        {typing ? (
          suggestions && suggestions.length > 0 ? (
            <SuggestionTree items={suggestions} query={text} onSearch={runSearch} />
          ) : suggestions ? (
            <button type="button" onClick={() => runSearch(text)} className="flex h-11 w-full items-center gap-2.5 px-4 text-13 text-ink">
              <Search aria-hidden size={18} className="text-muted" /> Search for &quot;{text}&quot;
            </button>
          ) : null
        ) : showResults ? (
          <section aria-live="polite" className="px-3 pt-3 lg:px-6">
            <h1 className="text-15 text-ink">
              Showing results for <b className="font-bold">&quot;{submitted}&quot;</b>
            </h1>
            {results?.matchedBy === "synonym" && <p className="mt-0.5 text-12 text-muted">Including other names and ripeness</p>}
            {!results && isPending ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {Array.from({ length: 4 }, (_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : results && results.products.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 lg:gap-3" data-testid="search-results">
                {results.products.map((p, i) => (
                  <ProductCard key={`${p.id}-${results.stage}-${results.size}`} product={p} scope="search" index={i} ripeness={results.stage} preferredSize={results.size} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-14 text-center" data-testid="no-results">
                <span className="grid size-20 place-items-center rounded-full bg-chip text-muted">
                  <SearchX aria-hidden size={36} strokeWidth={1.5} />
                </span>
                <p className="mt-4 text-17 font-bold text-ink">No results for &quot;{submitted}&quot;</p>
                <p className="mt-1 text-13 text-muted">Check the spelling or try one of these</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {trending.slice(0, 4).map((t) => (
                    <button key={t} type="button" onClick={() => runSearch(t)} className="press h-9 rounded-8 border border-line px-3 text-12 text-ink">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="space-y-6 px-4 pt-4 lg:px-6">
            {recent.length > 0 && (
              <section aria-labelledby="recent-h">
                <div className="flex items-center justify-between">
                  <h2 id="recent-h" className="text-15 font-bold text-ink">
                    Recent searches
                  </h2>
                  <button type="button" onClick={clearRecent} className="h-11 text-12 font-semibold text-action">
                    clear
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <button key={r} type="button" onClick={() => runSearch(r)} className="press flex h-9 items-center gap-1.5 rounded-8 border border-line px-3 text-12 text-ink">
                      <Clock aria-hidden size={14} className="text-muted" /> {r}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section aria-labelledby="trend-h">
              <h2 id="trend-h" className="text-15 font-bold text-ink">
                Try searching
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {trending.map((t) => (
                  <button key={t} type="button" onClick={() => runSearch(t)} className="press flex h-9 items-center gap-1.5 rounded-8 border border-line bg-surface px-3 text-12 text-ink">
                    <Search aria-hidden size={14} className="text-muted" /> {t}
                  </button>
                ))}
              </div>
            </section>
            <section aria-labelledby="pop-h">
              <h2 id="pop-h" className="text-15 font-bold text-ink">
                Popular right now
              </h2>
              <PopularGrid />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function PopularGrid() {
  const { data } = useProducts();
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 lg:gap-3">
      {(data ?? []).slice(0, 6).map((p, i) => (
        <ProductCard key={p.id} product={p} scope="search-popular" index={i} />
      ))}
      {!data && Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={i} />)}
    </div>
  );
}
