import type { BoxSize, RipenessStage, SortKey } from "@/lib/types";

export type Tab = "sort" | "ripeness" | "size" | "more";

export interface Filters {
  sort: SortKey;
  ripeness: RipenessStage | null;
  size: BoxSize | null;
  sweetness: number;
  inStockOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = { sort: "relevance", ripeness: null, size: null, sweetness: 0, inStockOnly: false };

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "popularity", label: "Popularity" },
  { id: "price-asc", label: "Price (low to high)" },
  { id: "price-desc", label: "Price (high to low)" },
];


const STAGES: RipenessStage[] = ["RAW", "SEMI_RIPE", "RIPE"];

/** The filters as a query string ("" for none), so a refresh, a shared link and Back keep them. */
export function filtersToQuery(f: Filters): string {
  const q = new URLSearchParams();
  if (f.sort !== DEFAULT_FILTERS.sort) q.set("sort", f.sort);
  if (f.ripeness) q.set("ripeness", f.ripeness);
  if (f.size) q.set("size", String(f.size));
  if (f.sweetness) q.set("sweet", String(f.sweetness));
  if (f.inStockOnly) q.set("stock", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Filters read back from a query string; anything unknown is left at its default. */
export function filtersFromQuery(search: string): Filters {
  const q = new URLSearchParams(search);
  const sort = SORTS.find((s) => s.id === q.get("sort"))?.id ?? DEFAULT_FILTERS.sort;
  const ripeness = STAGES.find((s) => s === q.get("ripeness")) ?? null;
  const size = Number(q.get("size"));
  const sweet = Number(q.get("sweet"));
  return {
    sort,
    ripeness,
    size: Number.isInteger(size) && size > 0 && size <= 50 ? size : null,
    sweetness: [3, 4, 5].includes(sweet) ? sweet : 0,
    inStockOnly: q.get("stock") === "1",
  };
}
