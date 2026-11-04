import { ripenessLabel } from "@/lib/format";
import { productImage } from "@/lib/catalog";
import { STAGES } from "@/lib/ripeness";
import type { BoxSize, Product, RipenessStage, SearchSuggestion } from "@/lib/types";

/**
 * Search runs in the browser over the products the shop already has (the
 * catalogue for the pincode and day, else the price list): the API has no
 * search endpoint, and there are only a handful of varieties.
 */

/** Other names and spellings, to a variety id (lib/varieties slug). */
const VARIETY_WORDS: Record<string, string> = {
  hapus: "alphonso",
  haapus: "alphonso",
  aapus: "alphonso",
  apus: "alphonso",
  alphanso: "alphonso",
  alfonso: "alphonso",
  alphonzo: "alphonso",
  ratnagiri: "alphonso",
  devgad: "alphonso",
  "karnataka alphonso": "badami",
  badam: "badami",
  banganapalli: "banganapalli",
  banganapali: "banganapalli",
  banganpalli: "banganapalli",
  benishan: "banganapalli",
  baneshan: "banganapalli",
  safeda: "banganapalli",
  kesar: "kesar",
  kesari: "kesar",
  gir: "kesar",
  totapuri: "totapuri",
  thotapuri: "totapuri",
  kilimooku: "totapuri",
  "kili mooku": "totapuri",
  ginimoothi: "totapuri",
  mallika: "mallika",
  "imam pasand": "imam-pasand",
  imampasand: "imam-pasand",
  himayat: "imam-pasand",
  himam: "imam-pasand",
};

/** Ripeness words. Some (pickle, breakfast) also say what a variety is good for, so they also match text. */
const STAGE_WORDS: Record<string, RipenessStage> = {
  raw: "RAW",
  kachcha: "RAW",
  kacha: "RAW",
  kachha: "RAW",
  kaccha: "RAW",
  kairi: "RAW",
  keri: "RAW",
  unripe: "RAW",
  green: "RAW",
  firm: "RAW",
  pickle: "RAW",
  achar: "RAW",
  chutney: "RAW",
  "semi ripe": "SEMI_RIPE",
  semiripe: "SEMI_RIPE",
  semi: "SEMI_RIPE",
  "half ripe": "SEMI_RIPE",
  "almost ripe": "SEMI_RIPE",
  ripe: "RIPE",
  ready: "RIPE",
  "ready to eat": "RIPE",
  pakka: "RIPE",
  pucca: "RIPE",
  sweet: "RIPE",
  breakfast: "RIPE",
};

const STOP = new Set(["mango", "mangoes", "mangos", "aam", "box", "boxes", "for", "the", "a", "an", "of", "and", "with", "to", "in", "fresh", "buy", "kg", "kilo", "kilos", "order"]);

const PHRASES = [...Object.keys(VARIETY_WORDS), ...Object.keys(STAGE_WORDS)].filter((k) => k.includes(" ")).sort((a, b) => b.length - a.length);

export interface Parsed {
  varieties: string[];
  stage: RipenessStage | null;
  size: BoxSize | null;
  /** Must all appear in a product's text. */
  words: string[];
  /** Narrow when they match some product (pickle), else ignored. */
  soft: string[];
}

export function parseQuery(raw: string): Parsed {
  let q = ` ${raw.toLowerCase().replace(/[-_]/g, " ").replace(/[^\p{L}\p{N}.\s]/gu, " ").replace(/\s+/g, " ")} `;
  const kg = q.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilo|kilos|kilogram)\b/);
  const size: number | null = kg ? Number(kg[1]) : null;
  q = q.replace(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilo|kilos|kilogram)\b/g, " ");
  const varieties = new Set<string>();
  let stage: RipenessStage | null = null;
  const soft: string[] = [];
  for (const p of PHRASES) {
    if (q.includes(` ${p} `)) {
      if (VARIETY_WORDS[p]) varieties.add(VARIETY_WORDS[p]);
      if (STAGE_WORDS[p]) stage ??= STAGE_WORDS[p];
      q = q.replace(` ${p} `, " ");
    }
  }
  const words: string[] = [];
  for (const t of q.trim().split(" ")) {
    if (!t || STOP.has(t) || /^\d+(\.\d+)?$/.test(t)) continue;
    if (VARIETY_WORDS[t]) varieties.add(VARIETY_WORDS[t]);
    else if (STAGE_WORDS[t]) {
      stage ??= STAGE_WORDS[t];
      soft.push(t);
    } else words.push(t);
  }
  return { varieties: [...varieties], stage, size, words, soft };
}

const haystack = (p: Product) =>
  [p.name, p.variety.name, p.variety.origin, p.variety.flavour, p.variety.description, p.variety.story, ...p.variety.tags, ...p.boxes.map((b) => b.name)].join(" ").toLowerCase();

export interface SearchOutcome {
  products: Product[];
  stage: RipenessStage | null;
  size: BoxSize | null;
  matchedBy: "name" | "synonym" | "none";
}

export function searchProducts(products: Product[], query: string): SearchOutcome {
  const parsed = parseQuery(query);
  const { varieties, stage, size, words, soft } = parsed;
  const text = new Map(products.map((p) => [p.id, haystack(p)]));
  const has = (p: Product, w: string) => text.get(p.id)!.includes(w);

  let list = products.filter((p) => {
    if (varieties.length && !varieties.includes(p.id) && !words.some((w) => has(p, w))) return false;
    return words.every((w) => has(p, w));
  });
  // "Alphonso" also appears in Badami's text (Karnataka Alphonso): names first when they match.
  const named = words.length ? list.filter((p) => words.every((w) => `${p.name} ${p.variety.name}`.toLowerCase().includes(w))) : [];
  if (named.length) list = named;
  const softHits = list.filter((p) => soft.some((w) => has(p, w)));
  if (softHits.length) list = softHits;
  if (stage) list = list.filter((p) => p.stages.includes(stage));
  if (size) {
    const withSize = list.filter((p) => p.boxes.some((b) => b.size === size));
    if (withSize.length) list = withSize;
  }

  const meaningful = varieties.length + words.length + soft.length + (stage ? 1 : 0) + (size ? 1 : 0) > 0;
  // Just "mango" or "aam": everything.
  if (!meaningful) list = /\b(mango|mangoes|mangos|aam)\b/i.test(query) ? products : [];
  const matchedBy = list.length === 0 ? "none" : !meaningful || (words.length && !varieties.length) ? "name" : "synonym";
  return { products: list, stage, size: size && list.some((p) => p.boxes.some((b) => b.size === size)) ? size : null, matchedBy };
}

/** Typeahead: each matching variety, opening into its ripeness stages. */
export function suggestionsFor(products: Product[], query: string): SearchSuggestion[] {
  const { products: hits, stage } = searchProducts(products, query);
  return hits.slice(0, 6).map((p) => ({
    id: p.id,
    label: p.name,
    productId: p.id,
    image: productImage(p, stage ?? "RIPE"),
    reason: p.variety.inSeason ? undefined : p.variety.seasonNote,
    children: (stage ? [stage] : STAGES).map((r) => ({ id: `${p.id}-${r}`, label: `${p.name} · ${ripenessLabel[r]}`, productId: p.id, ripeness: r, image: productImage(p, r) })),
  }));
}
