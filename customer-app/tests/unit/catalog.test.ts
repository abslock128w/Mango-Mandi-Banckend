import { describe, expect, it } from "vitest";
import { toRupees } from "@/lib/api/client";
import { buildProducts, defaultStage, isSoldOut, kgOf, skuFor } from "@/lib/catalog";
import { rupees } from "@/lib/format";
import { shopPolicy } from "@/lib/csp";
import type { CatalogueItem } from "@/lib/types";

const row = (sku: string, variety: string, boxSize: string, price: number, stage: CatalogueItem["stage"], qty: number): CatalogueItem => ({
  sku, name: `${variety} ${boxSize}`, variety, boxSize, price, description: null, photoUrl: null, stage,
  fruitsPerBox: 10, fruitWeightG: 280, qty, eatBy: "2026-11-02", nextAvailableDate: null,
});

describe("money", () => {
  it("turns API paise into rupees, nested too", () => {
    const quote = toRupees({ subtotal: 189900, discount: 10000, total: 179900, lines: [{ unitPrice: 189900, linePrice: 379800, qty: 2 }] });
    expect(quote).toEqual({ subtotal: 1899, discount: 100, total: 1799, lines: [{ unitPrice: 1899, linePrice: 3798, qty: 2 }] });
  });
  it("shows paise only when there are some", () => {
    expect(rupees(1899)).toBe("₹1,899");
    expect(rupees(18.5)).toBe("₹18.50");
  });
});

describe("catalogue rows to products", () => {
  const rows = [
    row("ALP-3", "Alphonso", "3kg", 1899, "RIPE", 4),
    row("ALP-3", "Alphonso", "3kg", 1899, "RAW", 0),
    row("ALP-5", "Alphonso", "5kg", 2999, "SEMI_RIPE", 2),
    row("BAD-3", "Badami", "3kg", 1299, "RIPE", 0),
  ];
  const products = buildProducts(rows);

  it("groups SKUs by variety, smallest box first", () => {
    expect(products.map((p) => p.id)).toEqual(["alphonso", "badami"]);
    expect(products[0].boxes.map((b) => [b.apiSku, b.size])).toEqual([["ALP-3", 3], ["ALP-5", 5]]);
    expect(kgOf("5kg")).toBe(5);
  });

  it("has one line per box and stage with the day's stock", () => {
    const alp = products[0];
    expect(skuFor(alp, "RIPE", 3)).toMatchObject({ id: "ALP-3|RIPE", stock: 4, price: 1899, eatBy: "2026-11-02" });
    expect(skuFor(alp, "RAW", 3)?.stock).toBe(0);
    // A stage with no row for the day is sold out, not "unknown".
    expect(skuFor(alp, "SEMI_RIPE", 3)?.stock).toBe(0);
    expect(isSoldOut(alp, "RAW")).toBe(true);
    expect(defaultStage(alp)).toBe("RIPE");
  });

  it("marks a variety with nothing to sell as out of season", () => {
    expect(products[1].variety.inSeason).toBe(false);
  });
});

describe("content security policy", () => {
  it("trusts scripts by nonce and never inline", () => {
    const p = shopPolicy({ api: "https://api.mandimangoes.in", nonce: "n1" });
    const script = p.match(/script-src [^;]*/)![0];
    expect(script).toContain("'nonce-n1' 'strict-dynamic'");
    expect(script).not.toContain("unsafe");
    expect(p).toContain("connect-src 'self' https://api.mandimangoes.in");
    expect(p).toContain("frame-ancestors 'none'");
  });
});
