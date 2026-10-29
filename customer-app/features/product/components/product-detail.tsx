"use client";
import Image from "next/image";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { BadgeCheck, Boxes, CalendarClock, ChevronRight, Leaf, RefreshCcw, Star } from "lucide-react";
import Link from "next/link";
import { useState, ViewTransition } from "react";
import { WhenVisible } from "@/components/ui/when-visible";
import { AddButton } from "@/features/cart/components/add-button";
import { useCart, useQty } from "@/features/cart/store";
import { NotifyButton } from "@/features/catalog/components/notify-button";
import { ProductCard, vtName } from "@/features/catalog/components/product-card";
import { ripenessDot } from "@/features/catalog/components/ripeness-chip";
import { usePolicy, usePreorderWeeks, useProducts, useReviews } from "@/features/catalog/hooks/queries";
import { whatsappLink } from "@/lib/config";
import { boxContents, cn, dateTime, longDate, rupees } from "@/lib/format";
import { uiSpring } from "@/lib/motion";
import { defaultSize, defaultStage, productImage, skuFor } from "@/lib/catalog";
import { RIPENESS, STAGES } from "@/lib/ripeness";
import type { BoxSize, Product, RipenessStage, Sku } from "@/lib/types";

export interface Selection {
  stage: RipenessStage;
  size: BoxSize;
  sku: Sku;
  setStage: (r: RipenessStage) => void;
  setSize: (s: BoxSize) => void;
}

export function useSelection(product: Product | undefined, initial?: RipenessStage | null): Selection | null {
  // Selection is keyed by product id so it resets when another product opens.
  const [state, setState] = useState<{ pid: string; stage: RipenessStage | null; size: BoxSize | null }>({ pid: "", stage: null, size: null });
  if (!product) return null;
  const own = state.pid === product.id ? state : { pid: product.id, stage: null, size: null };
  const stageState = own.stage;
  const sizeState = own.size;
  const setSizeState = (size: BoxSize) => setState((s) => ({ ...(s.pid === product.id ? s : { stage: null }), pid: product.id, size }));
  const stage = stageState && product.stages.includes(stageState) ? stageState : defaultStage(product, initial);
  const size = sizeState ?? defaultSize(product, stage);
  const sku = skuFor(product, stage, size) ?? product.skus[0];
  return {
    stage,
    size,
    sku,
    setStage: (r) => {
      const keep = product.skus.some((s) => s.ripeness === r && s.size === size && s.stock > 0);
      setState({ pid: product.id, stage: r, size: keep ? size : defaultSize(product, r) });
    },
    setSize: setSizeState,
  };
}

function Gallery({ product, sel, scope, mode }: { product: Product; sel: Selection; scope: string; mode: "sheet" | "page" }) {
  const images = Array.from(new Set([productImage(product, sel.stage), ...product.variety.photos]));
  const [active, setActive] = useState(0);
  const current = images[Math.min(active, images.length - 1)];
  const main = (
    <div className="relative aspect-square overflow-hidden rounded-12 bg-surface">
      <Image src={current} alt={`${product.name} mango`} fill preload fetchPriority="high" loading="eager" sizes="(min-width: 1024px) 520px, 100vw" className="object-cover" />
    </div>
  );
  return (
    <div>
      {mode === "page" ? (
        <ViewTransition name={vtName(scope, product.id)} share="morph" default="none">
          <div>{main}</div>
        </ViewTransition>
      ) : (
        <m.div layoutId={`img-${scope}-${product.id}`} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
          {main}
        </m.div>
      )}
      <div role="listbox" aria-label="Product photos" className="no-scrollbar mt-3 flex gap-2 overflow-x-auto" data-base-ui-swipe-ignore="x">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            role="option"
            aria-selected={i === active}
            aria-label={`Photo ${i + 1} of ${images.length}`}
            onClick={() => setActive(i)}
            className={cn("press relative size-16 shrink-0 overflow-hidden rounded-8 border-2 bg-surface", i === active ? "border-action" : "border-line")}
          >
            <Image src={src} alt="" fill sizes="64px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

function RipenessExplainer({ product, sel }: { product: Product; sel: Selection }) {
  const stages = STAGES.filter((s) => product.stages.includes(s));
  const order: RipenessStage[] = ["RAW", "SEMI_RIPE", "RIPE"];
  const visual = order.filter((s) => stages.includes(s));
  const activeIdx = visual.indexOf(sel.stage);
  return (
    <section aria-labelledby="ripe-h" className="rounded-12 border-[0.5px] border-line bg-surface p-3">
      <h2 id="ripe-h" className="text-15 font-bold text-ink">
        Choose ripeness
      </h2>
      {visual.length > 1 ? (
        <>
          <div className="relative mt-4 mb-1 h-1.5 rounded-full bg-[linear-gradient(90deg,var(--color-raw),var(--color-semi),var(--color-ripe))]" aria-hidden>
            {visual.map((s, i) => (
              <span
                key={s}
                className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", ripenessDot[s])}
                style={{ left: `${(i / (visual.length - 1)) * 100}%` }}
              />
            ))}
            <m.span
              className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface/40"
              initial={false}
              animate={{ left: `${(activeIdx / (visual.length - 1)) * 100}%` }}
              transition={uiSpring}
            />
          </div>
          <div role="radiogroup" aria-label="Ripeness" className="mt-3 grid grid-cols-3 gap-2">
            {visual.map((s) => {
              const on = s === sel.stage;
              const soldOut = !product.skus.some((k) => k.ripeness === s && k.stock > 0);
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => sel.setStage(s)}
                  className={cn(
                    "press flex min-h-14 flex-col items-center justify-center rounded-12 border px-1 py-2 text-center",
                    on ? "border-action bg-tint" : "border-line bg-surface",
                  )}
                >
                  <span className="flex items-center gap-1 text-13 font-semibold text-ink">
                    <span aria-hidden className={cn("size-2 rounded-full", ripenessDot[s])} />
                    {RIPENESS[s].label}
                  </span>
                  <span className="mt-0.5 text-11 text-muted">{soldOut ? "Sold out" : RIPENESS[s].short}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      <p className="mt-3 text-12 text-ink">
        <b className="font-semibold">{RIPENESS[sel.stage].hint}</b>
        {sel.sku.eatBy && <span className="text-muted"> Best eaten by {longDate(sel.sku.eatBy)}.</span>}
      </p>
      <details className="mt-2 text-12">
        <summary className="cursor-pointer py-1 font-semibold text-action">How to store them</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
          {RIPENESS[sel.stage].care.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function BoxChips({ product, sel }: { product: Product; sel: Selection }) {
  return (
    <section aria-labelledby="box-h">
      <h2 id="box-h" className="text-15 font-bold text-ink">
        Select box
      </h2>
      <div role="radiogroup" aria-label="Box size" className="mt-2 flex gap-3">
        {product.boxes.map((b) => {
          const s = b.size;
          const sku = skuFor(product, sel.stage, s);
          if (!sku) return null;
          const on = s === sel.size;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => sel.setSize(s)}
              className={cn(
                "press relative flex h-16 w-[75px] flex-col items-center justify-center rounded-12 border text-center",
                on ? "border-action bg-tint" : "border-line bg-surface",
                sku.stock <= 0 && "border-dashed",
              )}
            >
              <span className="text-13 font-semibold text-ink">{b.label}</span>
              <span className="text-12 text-ink">{sku.stock > 0 ? rupees(sku.price) : "Sold out"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const PROMISES = [
  { icon: Leaf, title: "Picked for your day", text: "Ripeness matched to the day you want to eat them", tone: "bg-raw-soft text-action" },
  { icon: BadgeCheck, title: "No carbide", text: "Naturally ripened in hay, never gassed", tone: "bg-brand-soft text-ripe" },
  { icon: RefreshCcw, title: "Free replacement", text: "Damaged or wrong ripeness? Tell us and we send a new box", tone: "bg-ribbon-soft text-ribbon" },
];

export function Promises({ className }: { className?: string }) {
  return (
    <ul className={cn("grid grid-cols-3 gap-2", className)}>
      {PROMISES.map(({ icon: Icon, title, text, tone }) => (
        <li key={title} className="flex flex-col items-center rounded-12 bg-surface p-2.5 text-center">
          <span className={cn("grid size-12 place-items-center rounded-full", tone)}>
            <Icon aria-hidden size={24} strokeWidth={1.75} />
          </span>
          <p className="mt-1.5 text-12 font-bold text-ink">{title}</p>
          <p className="mt-0.5 text-11 text-muted">{text}</p>
        </li>
      ))}
    </ul>
  );
}

function Highlights({ product, sel }: { product: Product; sel: Selection }) {
  const v = product.variety;
  const rows: [string, React.ReactNode][] = [
    ["Origin", v.origin],
    ["Availability", v.inSeason ? "In stock for your day" : v.seasonNote],
    [
      "Sweetness",
      <span key="s" className="inline-flex items-center gap-1" aria-label={`${v.sweetness} out of 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} aria-hidden className={cn("size-2 rounded-full", i < v.sweetness ? "bg-ripe" : "bg-line")} />
        ))}
      </span>,
    ],
    ["Best eaten by", sel.sku.eatBy ? longDate(sel.sku.eatBy) : RIPENESS[sel.stage].short],
    ["Flavour", v.flavour],
    ["Box", [sel.sku.boxLabel, boxContents(sel.sku.fruitsPerBox, sel.sku.fruitWeightG)].filter(Boolean).join(". ")],
  ];
  return (
    <section aria-labelledby="hl-h" className="rounded-12 border-[0.5px] border-line bg-surface p-3">
      <h2 id="hl-h" className="text-15 font-bold text-ink">
        Highlights
      </h2>
      <dl className="mt-2 divide-y divide-line">
        {rows.map(([k, val]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] gap-2 py-2 text-12">
            <dt className="text-muted">{k}</dt>
            <dd className="text-ink">{val}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Reviews({ product }: { product: Product }) {
  const { data } = useReviews(product.boxes[0]?.apiSku);
  if (!data || data.summary.count === 0) return null;
  const { summary, items } = data;
  return (
    <section aria-labelledby="rev-h" className="rounded-12 border-[0.5px] border-line bg-surface p-3">
      <h2 id="rev-h" className="flex items-center gap-2 text-15 font-bold text-ink">
        Reviews
        {summary.average != null && (
          <span className="inline-flex items-center gap-0.5 rounded-4 bg-action px-1.5 text-12 text-white">
            {summary.average.toFixed(1)} <Star aria-hidden size={11} fill="currentColor" strokeWidth={0} />
          </span>
        )}
        <span className="text-12 font-medium text-muted">{summary.count} ratings</span>
      </h2>
      <ul className="mt-2 divide-y divide-line">
        {items.map((r) => (
          <li key={r.id} className="py-2.5 text-12">
            <p className="flex items-center gap-1.5">
              <span className="font-semibold text-ink" aria-label={`${r.rating} out of 5`}>
                {"★".repeat(r.rating)}
                <span className="text-line">{"★".repeat(5 - r.rating)}</span>
              </span>
              <span className="text-ink">{r.displayName}</span>
              {r.verifiedPurchase && <span className="text-11 text-action">Verified buyer</span>}
            </p>
            {r.ripenessOrdered && <p className="mt-0.5 text-11 text-muted">Ordered {RIPENESS[r.ripenessOrdered].label.toLowerCase()} · {dateTime(r.createdAt)}</p>}
            {r.comment && <p className="mt-1 text-ink">{r.comment}</p>}
            {r.reply && <p className="mt-1 rounded-8 bg-chip p-2 text-muted">Reply from MandiMangoes: {r.reply}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HelpCard({ product }: { product: Product }) {
  const { data: policy } = usePolicy();
  const wa = whatsappLink(`Hi, I have a question about ${product.name} mangoes.`);
  return (
    <section aria-labelledby="help-h" className="rounded-12 border-[0.5px] border-line bg-surface p-3 text-12">
      <h2 id="help-h" className="text-15 font-bold text-ink">
        Good to know
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-ink">
        <li>Order by 6 pm for delivery tomorrow, or pick a later day.</li>
        <li>Prepaid only. Delivery is free and GST is included in the price.</li>
        <li>Cancel any time before your box is packed for a full refund.</li>
        <li>Report a damaged box within {policy ? `${policy.claimWindowHours} hours` : "a day"} of delivery for a free replacement.</li>
      </ul>
      {wa ? (
        <a href={wa} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-11 items-center font-semibold text-action">
          Ask us on WhatsApp
        </a>
      ) : (
        <Link href="/help" className="mt-2 inline-flex h-11 items-center font-semibold text-action">
          Help and questions
        </Link>
      )}
    </section>
  );
}

function Rail({ title, products, scope, ripeness }: { title: string; products: Product[]; scope: string; ripeness?: RipenessStage }) {
  if (!products.length) return null;
  return (
    <section aria-label={title}>
      <h2 className="font-display text-17 font-extrabold text-ink">{title}</h2>
      <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pt-3 pb-1" data-base-ui-swipe-ignore="x">
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} scope={scope} index={i} ripeness={ripeness} fixed />
        ))}
      </div>
    </section>
  );
}

export function PriceBlock({ sel, product }: { sel: Selection; product: Product }) {
  return (
    <div>
      <p className="text-19 font-bold text-ink">{rupees(sel.sku.price)}</p>
      <p className="text-9 text-muted">(Inclusive of all taxes)</p>
      {!product.variety.inSeason && <p className="mt-1 text-12 font-semibold text-danger">{product.variety.seasonNote}</p>}
      <PreorderNote product={product} />
    </div>
  );
}

/** Shown when this variety has pre-order weeks open. */
export function PreorderNote({ product }: { product: Product }) {
  const { data } = usePreorderWeeks();
  const skus = new Set(product.boxes.map((b) => b.apiSku));
  const weeks = (data?.weeks ?? []).filter((w) => skus.has(w.sku) && w.remaining > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (!weeks.length) return null;
  return (
    <Link href="/preorder" className="mt-2 flex gap-2.5 rounded-12 border border-brand bg-brand-soft p-3" data-testid="preorder-note">
      <CalendarClock aria-hidden size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink" />
      <span className="text-12 text-ink">
        <span className="block font-bold">Pre-order for the season</span>
        <span className="mt-0.5 block text-muted">Book a week from {longDate(weeks[0].weekStart)} and lock today&apos;s price.</span>
      </span>
      <ChevronRight aria-hidden size={18} className="ml-auto shrink-0 self-center text-muted" />
    </Link>
  );
}

function BulkLink() {
  return (
    <Link href="/bulk" className="flex items-center justify-between gap-2 rounded-12 border-[0.5px] border-line bg-surface p-3">
      <span className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-8 bg-ribbon-soft text-ribbon">
          <Boxes aria-hidden size={20} strokeWidth={1.75} />
        </span>
        <span>
          <span className="block text-13 font-semibold text-ink">Buying 10 or more boxes?</span>
          <span className="block text-12 text-muted">Bulk deals with lower prices per box for events and offices</span>
        </span>
      </span>
      <ChevronRight aria-hidden size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

/** Sticky footer: box, price and a solid green Add to cart (becomes a stepper). */
export function PurchaseBar({ product, sel, scope }: { product: Product; sel: Selection; scope: string }) {
  const qty = useQty(sel.sku.id);
  const add = useCart((s) => s.add);
  const reduce = useReducedMotion();
  const outOfStock = sel.sku.stock <= 0;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-12 text-muted">
          {sel.sku.boxLabel} box · {RIPENESS[sel.stage].label}
        </p>
        <p className="text-17 font-bold text-ink">{rupees(sel.sku.price)}</p>
        <p className="text-9 text-muted">(Inclusive of all taxes)</p>
      </div>
      {outOfStock ? (
        <div className="w-40">
          <NotifyButton sku={sel.sku.apiSku} stage={sel.stage} label={`${product.name} ${RIPENESS[sel.stage].label.toLowerCase()}`} wide />
        </div>
      ) : qty > 0 ? (
        <AddButton product={product} sku={sel.sku} scope={`${scope}-bar`} size="lg" />
      ) : (
        <m.button
          type="button"
          whileTap={reduce ? undefined : { scale: 0.96 }}
          onClick={() => add(product, sel.sku)}
          data-testid="add-to-cart"
          className="h-12 min-w-40 rounded-6 bg-action px-6 text-15 font-semibold text-white"
        >
          Add to cart
        </m.button>
      )}
    </div>
  );
}

export function ProductDetail({ product, sel, scope, mode }: { product: Product; sel: Selection; scope: string; mode: "sheet" | "page" }) {
  const v = product.variety;

  const info = (
    <div className="space-y-4">
      <div>
        <p className="text-12 text-muted">{v.origin}</p>
        <h1 className="mt-0.5 font-display text-21 font-extrabold text-ink lg:text-24">{`${product.name} Mango`}</h1>
        <p className="mt-1 text-13 text-muted">{v.flavour}</p>
      </div>
      <PriceBlock sel={sel} product={product} />
      <RipenessExplainer product={product} sel={sel} />
      <BoxChips product={product} sel={sel} />
      <BulkLink />
      {mode === "page" && (
        <div className="hidden rounded-12 border-[0.5px] border-line bg-surface lg:block">
          <PurchaseBar product={product} sel={sel} scope={scope} />
        </div>
      )}
      <section aria-labelledby="why-h">
        <h2 id="why-h" className="mb-2 text-15 font-bold text-ink">
          Why buy from us?
        </h2>
        <Promises />
      </section>
      <section aria-labelledby="story-h" className="rounded-12 border-[0.5px] border-line bg-surface p-3">
        <h2 id="story-h" className="text-15 font-bold text-ink">
          The story of {product.name}
        </h2>
        <p className="mt-1 text-13 text-ink">{v.story}</p>
        {v.description && <p className="mt-2 text-13 text-muted">{v.description}</p>}
      </section>
    </div>
  );

  return (
    <div className={cn(mode === "page" ? "" : "px-4 pb-6")}>
      {mode === "page" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:gap-10">
          <div className="lg:sticky lg:top-[110px] lg:self-start">
            <Gallery product={product} sel={sel} scope={scope} mode={mode} />
            <div className="mt-4 hidden space-y-4 lg:block">
              <Highlights product={product} sel={sel} />
            </div>
          </div>
          <div className="space-y-4">
            {info}
            <div className="lg:hidden">
              <Highlights product={product} sel={sel} />
            </div>
            <Reviews product={product} />
            <HelpCard product={product} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Gallery product={product} sel={sel} scope={scope} mode={mode} />
          {info}
          <Highlights product={product} sel={sel} />
          <Reviews product={product} />
          <HelpCard product={product} />
        </div>
      )}
      <WhenVisible placeholder={<div className="mt-6 h-[340px]" />}>
        <RelatedRails product={product} stage={sel.stage} />
      </WhenVisible>
    </div>
  );
}

/** Other varieties, closest in sweetness first; rendered only when scrolled near. */
function RelatedRails({ product, stage }: { product: Product; stage: RipenessStage }) {
  const { data: all } = useProducts();
  if (!all) return <div className="mt-6 h-[340px]" />;
  const similar = all
    .filter((p) => p.id !== product.id)
    .sort((a, b) => Number(b.variety.inSeason) - Number(a.variety.inSeason) || Math.abs(a.variety.sweetness - product.variety.sweetness) - Math.abs(b.variety.sweetness - product.variety.sweetness))
    .slice(0, 8);
  return (
    <div className="mt-6 space-y-6">
      <Rail title="You may also like" products={similar} scope={`similar-${product.id}`} ripeness={stage} />
    </div>
  );
}
