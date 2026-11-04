"use client";
import Link from "next/link";
import { Building2, MapPin, MessageCircle, Package } from "lucide-react";
import { useBulkDeals } from "@/features/catalog/hooks/queries";
import { usePincode } from "@/features/location/store";
import { useUi } from "@/features/shell/ui-store";
import { PageTransition } from "@/features/shell/page-transition";
import { ApiError, mediaUrl } from "@/lib/api/client";
import { whatsappLink } from "@/lib/config";
import { rupees } from "@/lib/format";
import type { BulkDeal } from "@/lib/types";
import { bestSaving, endsLabel } from "../tiers";

/** /bulk: the bulk deals for the shopper's pincode (GET /v1/bulk-deals), priced by how many boxes you order. */
export function BulkView() {
  const hydrated = useUi((s) => s.hydrated);
  const pincode = usePincode();
  const q = useBulkDeals();

  return (
    <PageTransition>
      <div className="mx-auto max-w-content px-4 pt-4 pb-10 lg:px-6">
        <section className="rounded-16 bg-deep p-5 text-white lg:p-8" aria-labelledby="bulk-h">
          <p className="text-12 font-bold tracking-wide text-brand uppercase">Bulk deals</p>
          <h1 id="bulk-h" className="mt-1 font-display text-24 leading-tight font-extrabold lg:text-36">
            Order more boxes, pay less per box
          </h1>
          <p className="mt-2 max-w-xl text-13 lg:text-15">
            For offices, events and big families. The price for your quantity is shown before you add it. Free delivery, GST included.
          </p>
        </section>

        <div className="mt-5">
          {!hydrated || q.isPending ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading bulk deals">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="skeleton h-80 rounded-16" />
              ))}
            </ul>
          ) : q.isError ? (
            <div role="alert" className="rounded-12 bg-danger-soft p-4 text-13 text-danger">
              <p>{q.error instanceof ApiError ? q.error.message : "Couldn't load bulk deals."}</p>
              <button type="button" onClick={() => q.refetch()} className="press mt-2 h-11 rounded-8 bg-surface px-4 font-semibold text-action">
                Try again
              </button>
            </div>
          ) : !pincode ? (
            <Notice icon={<MapPin aria-hidden size={22} />} title="Set your delivery pincode" body="Bulk deals depend on where we deliver. Add your pincode to see the deals for your area.">
              <Link href="/location?next=/bulk" className="press mt-3 inline-flex h-11 items-center rounded-12 bg-action px-4 text-15 font-semibold text-white">
                Set pincode
              </Link>
            </Notice>
          ) : q.data.serviceable === false ? (
            <Notice icon={<MapPin aria-hidden size={22} />} title={`We don't deliver to ${pincode} yet`} body="Try another pincode. We are adding areas through the season.">
              <Link href="/location?next=/bulk" className="press mt-3 inline-flex h-11 items-center rounded-12 border border-action px-4 text-15 font-semibold text-action">
                Change pincode
              </Link>
            </Notice>
          ) : !q.data.items.length ? (
            <Notice icon={<Package aria-hidden size={22} />} title="No bulk deals right now" body="New deals appear here when the season's big batches come in. You can still order regular boxes.">
              <Link href="/" className="press mt-3 inline-flex h-11 items-center rounded-12 bg-action px-4 text-15 font-semibold text-white">
                Shop regular boxes
              </Link>
            </Notice>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="bulk-deals">
              {q.data.items.map((d, i) => (
                <DealCard key={d.id} deal={d} eager={i < 2} />
              ))}
            </ul>
          )}
        </div>

        <OfficeBlock />
      </div>
    </PageTransition>
  );
}

function Notice({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-16 bg-surface px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-ink">{icon}</span>
      <h2 className="mt-3 text-17 font-bold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-13 text-muted">{body}</p>
      {children}
    </div>
  );
}

function DealCard({ deal: d, eager }: { deal: BulkDeal; eager: boolean }) {
  const photo = mediaUrl(d.photos[0]?.url, 640);
  const saving = bestSaving(d);
  const noStock = d.availability ? !d.availability.some((x) => x.enough) : false;
  return (
    <li className="overflow-hidden rounded-16 border-[0.5px] border-line bg-surface shadow-card" data-testid="bulk-deal">
      <Link href={`/bulk/${d.id}`} className="flex h-full flex-col">
        <div className="relative aspect-4/3 bg-chip">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- API photo, resized by the API (?w=)
            <img src={photo} alt="" loading={eager ? "eager" : "lazy"} className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-muted">
              <Package aria-hidden size={40} strokeWidth={1.5} />
            </span>
          )}
          {saving > 0 && <span className="absolute top-2 left-2 rounded-8 bg-brand px-2 py-1 text-12 font-bold text-ink">Save up to {rupees(saving)} a box</span>}
        </div>
        <div className="flex flex-1 flex-col p-3">
          <h2 className="text-15 font-bold text-ink">{d.title}</h2>
          <p className="text-12 text-muted">
            {d.product.variety} · {d.product.boxSize} box
          </p>
          <p className="mt-2 text-13 text-ink">
            From <b className="text-17">{rupees(d.fromPrice)}</b> a box
            {d.retailPrice > d.fromPrice && <span className="ml-1.5 text-12 text-muted line-through">{rupees(d.retailPrice)}</span>}
          </p>
          <p className="mt-auto pt-2 text-12 text-muted">
            Minimum {d.minQty} boxes{d.endsAt ? ` · Ends ${endsLabel(d.endsAt)}` : ""}
          </p>
          {noStock && <p className="mt-1 text-12 font-medium text-danger">Not enough stock on open days</p>}
        </div>
      </Link>
    </li>
  );
}

function OfficeBlock() {
  const wa = whatsappLink("Hi MandiMangoes, I'd like to order mangoes for an office or event.");
  return (
    <section className="mt-6 flex flex-col gap-3 rounded-16 bg-surface p-4 sm:flex-row sm:items-center lg:p-5" aria-labelledby="office-h">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-tint text-action">
        <Building2 aria-hidden size={22} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="office-h" className="text-15 font-bold text-ink">
          Ordering for an office or event?
        </h2>
        <p className="text-13 text-muted">Tell us the date, the number of boxes and the ripeness you need. We will help you plan it.</p>
      </div>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="press inline-flex h-11 items-center justify-center gap-2 rounded-12 bg-action px-4 text-15 font-semibold text-white">
          <MessageCircle aria-hidden size={18} /> WhatsApp us
        </a>
      )}
    </section>
  );
}
