import { expect, test } from "vitest";
import { DEFAULT_FILTERS, filtersFromQuery, filtersToQuery } from "@/features/catalog/filters";

test("filters go to the query string and come back the same", () => {
  const f = { sort: "price-asc", ripeness: "RAW", size: 5, sweetness: 4, inStockOnly: true } as const;
  expect(filtersToQuery(f)).toBe("?sort=price-asc&ripeness=RAW&size=5&sweet=4&stock=1");
  expect(filtersFromQuery(filtersToQuery(f))).toEqual(f);
});

test("no filters is no query string", () => {
  expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
  expect(filtersFromQuery("")).toEqual(DEFAULT_FILTERS);
});

test("anything unknown in a hand-edited link falls back to the default", () => {
  expect(filtersFromQuery("?sort=cheapest&ripeness=MUSHY&size=-3&sweet=9&stock=yes")).toEqual(DEFAULT_FILTERS);
});
