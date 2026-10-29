import { mediaUrl } from "./api/client";
import { dayName } from "./format";
import { STAGES } from "./ripeness";
import type { Catalogue, CatalogueItem, Product, ProductDto, RipenessStage, Sku } from "./types";
import { slugify, varietyInfo } from "./varieties";

/** "3kg" / "5 kg" / "2.5kg" to 3 / 5 / 2.5 */
export const kgOf = (boxSize: string) => Number.parseFloat(boxSize.replace(",", ".")) || 0;

/**
 * Groups the API's rows (one per SKU x stage on a delivery day, or one per SKU
 * from /products) into variety products: a card per variety, with its box
 * sizes and the three ripeness stages.
 */
export function buildProducts(rows: (CatalogueItem | ProductDto)[]): Product[] {
  const groups = new Map<string, (CatalogueItem | ProductDto)[]>();
  for (const r of rows) {
    const key = slugify(r.variety || r.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const products: Product[] = [];
  for (const [id, list] of groups) {
    const first = list[0];
    const info = varietyInfo(first.variety || first.name);
    const boxMap = new Map<string, Product["boxes"][number]>();
    for (const r of list) if (!boxMap.has(r.sku)) boxMap.set(r.sku, { apiSku: r.sku, size: kgOf(r.boxSize), label: r.boxSize.replace(/(\d)kg/i, "$1 kg"), price: r.price, photoUrl: mediaUrl(r.photoUrl), name: r.name });
    const boxes = [...boxMap.values()].sort((a, b) => a.size - b.size);
    const apiPhoto = boxes.find((b) => b.photoUrl)?.photoUrl ?? null;

    const skus: Sku[] = [];
    for (const box of boxes) {
      for (const stage of STAGES) {
        const row = list.find((r) => r.sku === box.apiSku && "stage" in r && r.stage === stage) as CatalogueItem | undefined;
        const dto = list.find((r) => r.sku === box.apiSku)!;
        skus.push({
          id: `${box.apiSku}|${stage}`,
          apiSku: box.apiSku,
          productId: id,
          ripeness: stage,
          size: box.size,
          boxLabel: box.label,
          price: box.price,
          mrp: box.price,
          // Without a catalogue (no pincode yet) stock is unknown: shown as available, checked at checkout.
          stock: row ? row.qty : "stage" in first ? 0 : 20,
          eatBy: row?.eatBy ?? null,
          nextAvailableDate: row?.nextAvailableDate ?? null,
          fruitsPerBox: dto.fruitsPerBox,
          fruitWeightG: dto.fruitWeightG,
          name: dto.name,
        });
      }
    }
    const inSeason = skus.some((s) => s.stock > 0);
    const next = skus.map((s) => s.nextAvailableDate).filter(Boolean).sort()[0] as string | undefined;
    products.push({
      id,
      kind: "variety",
      name: info.name,
      variety: {
        id,
        name: info.name,
        origin: info.from,
        flavour: info.taste || first.description || "",
        story: [info.from, info.bestFor ? `Best for: ${info.bestFor}` : "", info.season].filter(Boolean).join(" "),
        description: first.description ?? "",
        inSeason,
        seasonNote: inSeason ? (info.season || "In stock") : next ? `Back on ${dayName(next)}` : "Out of stock for now",
        sweetness: info.sweetness,
        popularity: info.popularity,
        photos: apiPhoto ? [apiPhoto, info.photos[1], info.photos[2]] : info.photos,
        tags: info.tags,
      },
      skus,
      stages: STAGES,
      stageImages: apiPhoto ? { RIPE: apiPhoto, SEMI_RIPE: apiPhoto, RAW: apiPhoto } : info.stagePhotos,
      boxes,
    });
  }
  return products.sort((a, b) => Number(b.variety.inSeason) - Number(a.variety.inSeason) || b.variety.popularity - a.variety.popularity);
}

export const productsFromCatalogue = (c: Catalogue | undefined) => (c && c.serviceable ? buildProducts(c.items) : []);

export const productImage = (p: Product, r: RipenessStage) => p.stageImages[r] ?? p.variety.photos[0];

export const skuFor = (p: Product, r: RipenessStage, size: number): Sku | undefined => p.skus.find((s) => s.ripeness === r && s.size === size);

/** First box size in stock for the stage, else the smallest. */
export function defaultSize(p: Product, r: RipenessStage): number {
  return p.skus.find((s) => s.ripeness === r && s.stock > 0)?.size ?? p.boxes[0]?.size ?? 3;
}

/** Ripe first, but never swap a sold-out stage the shopper picked (old shop rule UX-6). */
export function defaultStage(p: Product, preferred?: RipenessStage | null): RipenessStage {
  if (preferred && p.stages.includes(preferred)) return preferred;
  return p.stages.find((r) => p.skus.some((s) => s.ripeness === r && s.stock > 0)) ?? "RIPE";
}

export const isSoldOut = (p: Product, r: RipenessStage) => !p.skus.some((s) => s.ripeness === r && s.stock > 0);
