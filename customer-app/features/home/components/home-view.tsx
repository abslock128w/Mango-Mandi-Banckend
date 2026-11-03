"use client";
import { CatalogueError } from "@/features/catalog/components/catalogue-error";
import { useDeliveryDate, useProducts } from "@/features/catalog/hooks/queries";
import { dayName } from "@/lib/format";
import { HeroCarousel, type Slide } from "./hero-carousel";
import { BookAheadCard, BulkBanner, HowItWorks, UnpaidBanner } from "./home-widgets";
import { ProductRail } from "./product-rail";
import { TrustStrip } from "./trust-strip";
import { VarietyGrid } from "./variety-grid";

const SLIDES: Slide[] = [
  { id: "s1", image: "/images/banners/b1.jpg", title: "Picked for the day you want to eat them", subtitle: "Choose ripe, semi-ripe or raw", href: "/c/all", tone: "brand" },
  { id: "s2", image: "/images/banners/b4.jpg", title: "Raw mangoes for pickle", subtitle: "Firm and green, ripen at home in days", href: "/c/raw", tone: "raw" },
  { id: "s3", image: "/images/banners/b2.jpg", title: "Book a box ahead", subtitle: "Lock in today's price for a later week", href: "/preorder", tone: "ripe" },
  { id: "s4", image: "/images/banners/b3.jpg", title: "Free delivery, every order", subtitle: "Prices include GST. No minimum", href: "/c/all", tone: "action" },
];

/** Home, composed in the shop (the API has no layout endpoint). */
export function HomeView() {
  const { data: products, isError, refetch } = useProducts();
  const date = useDeliveryDate();
  const day = date ? dayName(date) : null;
  return (
    <>
      <div className="mx-auto max-w-content">
        <UnpaidBanner />
        <HeroCarousel slides={SLIDES} />
        {isError && <CatalogueError onRetry={refetch} className="mx-4 mt-4 lg:mx-6" />}
        <VarietyGrid title="Shop by variety" products={products?.slice().sort((a, b) => Number(Boolean(a.variety.contents)) - Number(Boolean(b.variety.contents)))} />
        <ProductRail id="ripe" title={day ? `Ripe for ${day.toLowerCase() === "tomorrow" ? "tomorrow" : day}` : "Ripe and ready"} why="Tree-ripened, eat within a day or two" stage="RIPE" href="/c/ripe" />
        <BookAheadCard />
        <ProductRail id="semi" title="Semi-ripe, ready in 1 to 2 days" why="Firm today, sweet on your counter by the weekend" stage="SEMI_RIPE" href="/c/semi-ripe" />
        <BulkBanner />
        <ProductRail id="raw" title="Raw for pickles" why="Green and tart, for pickle, chutney and salads" stage="RAW" href="/c/raw" />
        <HowItWorks />
        <TrustStrip />
      </div>
    </>
  );
}
