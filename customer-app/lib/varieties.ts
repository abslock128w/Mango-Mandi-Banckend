/**
 * Editorial content per variety (words from the old shop's i18n en.ts). The
 * API knows products and stock; managers add products, so a variety missing
 * here falls back to its API description and generic photos.
 */
const img = (n: number) => `/images/mangoes/m${String(n).padStart(2, "0")}.jpg`;

export interface VarietyInfo {
  name: string;
  from: string;
  taste: string;
  bestFor: string;
  season: string;
  sweetness: 1 | 2 | 3 | 4 | 5;
  popularity: number;
  photos: [string, string, string];
  /** Stage photos when the API has none: raw shows green fruit. */
  stagePhotos: { RIPE: string; SEMI_RIPE: string; RAW: string };
  tags: string[];
}

const V: VarietyInfo[] = [
  { name: "Alphonso", from: "The Konkan coast of Maharashtra, around Ratnagiri and Devgad, where it is called Hapus.", taste: "Saffron flesh, rich and sweet, with a strong scent and almost no fibre.", bestFor: "Eating in slices, aamras, milkshakes and desserts.", season: "Usually April to early June.", sweetness: 5, popularity: 100, photos: [img(0), img(32), img(7)], stagePhotos: { RIPE: img(0), SEMI_RIPE: img(3), RAW: img(22) }, tags: ["hapus", "dessert", "aamras"] },
  { name: "Badami", from: "North Karnataka, which is why it is often called Karnataka Alphonso.", taste: "Close to Alphonso: sweet and smooth, a little milder, with very little fibre.", bestFor: "Eating fresh, and aamras on a budget.", season: "Usually April to June.", sweetness: 4, popularity: 90, photos: [img(2), img(36), img(30)], stagePhotos: { RIPE: img(2), SEMI_RIPE: img(29), RAW: img(23) }, tags: ["karnataka alphonso", "aamras"] },
  { name: "Kesar", from: "The foothills of Gir in Gujarat.", taste: "Bright orange flesh, very sweet and fragrant.", bestFor: "Aamras, shrikhand and ice cream.", season: "Usually May to July.", sweetness: 5, popularity: 85, photos: [img(5), img(33), img(12)], stagePhotos: { RIPE: img(5), SEMI_RIPE: img(13), RAW: img(24) }, tags: ["aamras", "dessert"] },
  { name: "Banganapalli", from: "Kurnool and nearby districts of Andhra Pradesh. Also called Benishan.", taste: "Large and golden, mildly sweet, firm and fibreless.", bestFor: "Eating in slices and fruit salads.", season: "Usually April to June.", sweetness: 4, popularity: 80, photos: [img(16), img(11), img(19)], stagePhotos: { RIPE: img(16), SEMI_RIPE: img(19), RAW: img(25) }, tags: ["benishan", "slices"] },
  { name: "Mallika", from: "A cross of Neelam and Dasheri, grown widely around Karnataka.", taste: "Honey-sweet, with deep orange flesh and little fibre.", bestFor: "Eating fresh and desserts.", season: "Usually May and June.", sweetness: 4, popularity: 70, photos: [img(3), img(35), img(25)], stagePhotos: { RIPE: img(3), SEMI_RIPE: img(31), RAW: img(26) }, tags: ["hybrid"] },
  { name: "Imam Pasand", from: "Andhra Pradesh and Tamil Nadu.", taste: "Big, juicy and rich, with a thin skin.", bestFor: "Eating fresh.", season: "Usually May and June.", sweetness: 5, popularity: 72, photos: [img(39), img(34), img(9)], stagePhotos: { RIPE: img(39), SEMI_RIPE: img(9), RAW: img(27) }, tags: ["royal"] },
  { name: "Totapuri", from: "Karnataka, Andhra Pradesh and Tamil Nadu. Named for its parrot-beak tip.", taste: "Tangy and firm, less sweet than the others.", bestFor: "Pickles, salads and pulp.", season: "Usually May to July.", sweetness: 2, popularity: 65, photos: [img(22), img(23), img(24)], stagePhotos: { RIPE: img(22), SEMI_RIPE: img(23), RAW: img(24) }, tags: ["pickle", "kairi", "chutney"] },
];

const FALLBACK: Omit<VarietyInfo, "name"> = {
  from: "",
  taste: "",
  bestFor: "",
  season: "",
  sweetness: 4,
  popularity: 50,
  photos: [img(12), img(14), img(10)],
  stagePhotos: { RIPE: img(12), SEMI_RIPE: img(13), RAW: img(28) },
  tags: [],
};

const byName = new Map(V.map((v) => [v.name.toLowerCase(), v]));

export function varietyInfo(variety: string): VarietyInfo {
  return byName.get(variety.trim().toLowerCase()) ?? { name: variety, ...FALLBACK };
}

export const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
