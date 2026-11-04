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

