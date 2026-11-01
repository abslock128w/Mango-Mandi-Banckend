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
  /** A box of several varieties: what is inside. */
  contents?: { name: string; share: string }[];
}

const V: VarietyInfo[] = [
  { name: "Alphonso", from: "The Konkan coast of Maharashtra, around Ratnagiri and Devgad, where it is called Hapus.", taste: "Saffron flesh, rich and sweet, with a strong scent and almost no fibre.", bestFor: "Eating in slices, aamras, milkshakes and desserts.", season: "Usually April to early June.", sweetness: 5, popularity: 100, photos: [img(0), img(32), img(7)], stagePhotos: { RIPE: img(0), SEMI_RIPE: img(3), RAW: img(22) }, tags: ["hapus", "dessert", "aamras"] },
  { name: "Badami", from: "North Karnataka, which is why it is often called Karnataka Alphonso.", taste: "Close to Alphonso: sweet and smooth, a little milder, with very little fibre.", bestFor: "Eating fresh, and aamras on a budget.", season: "Usually April to June.", sweetness: 4, popularity: 90, photos: [img(2), img(36), img(30)], stagePhotos: { RIPE: img(2), SEMI_RIPE: img(29), RAW: img(23) }, tags: ["karnataka alphonso", "aamras"] },
  { name: "Kesar", from: "The foothills of Gir in Gujarat.", taste: "Bright orange flesh, very sweet and fragrant.", bestFor: "Aamras, shrikhand and ice cream.", season: "Usually May to July.", sweetness: 5, popularity: 85, photos: [img(5), img(33), img(12)], stagePhotos: { RIPE: img(5), SEMI_RIPE: img(13), RAW: img(24) }, tags: ["aamras", "dessert"] },
  { name: "Banganapalli", from: "Kurnool and nearby districts of Andhra Pradesh. Also called Benishan.", taste: "Large and golden, mildly sweet, firm and fibreless.", bestFor: "Eating in slices and fruit salads.", season: "Usually April to June.", sweetness: 4, popularity: 80, photos: [img(16), img(11), img(19)], stagePhotos: { RIPE: img(16), SEMI_RIPE: img(19), RAW: img(25) }, tags: ["benishan", "slices"] },
  { name: "Mallika", from: "A cross of Neelam and Dasheri, grown widely around Karnataka.", taste: "Honey-sweet, with deep orange flesh and little fibre.", bestFor: "Eating fresh and desserts.", season: "Usually May and June.", sweetness: 4, popularity: 70, photos: [img(3), img(35), img(25)], stagePhotos: { RIPE: img(3), SEMI_RIPE: img(31), RAW: img(26) }, tags: ["hybrid"] },
  { name: "Imam Pasand", from: "Andhra Pradesh and Tamil Nadu.", taste: "Big, juicy and rich, with a thin skin.", bestFor: "Eating fresh.", season: "Usually May and June.", sweetness: 5, popularity: 72, photos: [img(39), img(34), img(9)], stagePhotos: { RIPE: img(39), SEMI_RIPE: img(9), RAW: img(27) }, tags: ["royal"] },
  { name: "Totapuri", from: "Karnataka, Andhra Pradesh and Tamil Nadu. Named for its parrot-beak tip.", taste: "Tangy and firm, less sweet than the others.", bestFor: "Pickles, salads and pulp.", season: "Usually May to July.", sweetness: 2, popularity: 65, photos: [img(22), img(23), img(24)], stagePhotos: { RIPE: img(22), SEMI_RIPE: img(23), RAW: img(24) }, tags: ["pickle", "kairi", "chutney"] },
  { name: "Dasheri", from: "The orchards of Malihabad near Lucknow, Uttar Pradesh.", taste: "Long and slender, aromatic and honey-sweet.", bestFor: "Eating whole, squeezed straight from the skin.", season: "Usually June and July.", sweetness: 4, popularity: 80, photos: [img(4), img(10), img(14)], stagePhotos: { RIPE: img(4), SEMI_RIPE: img(14), RAW: img(28) }, tags: ["aromatic", "lucknow", "malihabadi"] },
  { name: "Langra", from: "Varanasi, Uttar Pradesh.", taste: "Stays green outside when ripe. Juicy lemon-yellow flesh with a gentle tang.", bestFor: "Eating fresh and chilled slices.", season: "Usually late June to August.", sweetness: 4, popularity: 70, photos: [img(29), img(31), img(26)], stagePhotos: { RIPE: img(29), SEMI_RIPE: img(31), RAW: img(26) }, tags: ["banarasi", "green skin"] },
  { name: "Chausa", from: "Hardoi and around, Uttar Pradesh.", taste: "Soft, very sweet and juicy. One of the last mangoes of the season.", bestFor: "Eating chilled, straight from the fruit.", season: "Usually July and August.", sweetness: 5, popularity: 68, photos: [img(15), img(9), img(21)], stagePhotos: { RIPE: img(15), SEMI_RIPE: img(9), RAW: img(27) }, tags: ["late season", "juicy"] },
  { name: "Himsagar", from: "Murshidabad and Malda, West Bengal.", taste: "Creamy, fibreless and very sweet, with a short season.", bestFor: "Eating fresh, mishti doi and desserts.", season: "Usually late May and June.", sweetness: 5, popularity: 78, photos: [img(1), img(20), img(34)], stagePhotos: { RIPE: img(1), SEMI_RIPE: img(20), RAW: img(25) }, tags: ["bengal", "dessert", "khirsapati"] },
  { name: "Neelam", from: "Krishnagiri, Tamil Nadu, and across the south.", taste: "Floral and mildly sweet. Keeps well.", bestFor: "Smoothies, milkshakes and eating fresh.", season: "Usually June to August.", sweetness: 3, popularity: 60, photos: [img(13), img(17), img(28)], stagePhotos: { RIPE: img(13), SEMI_RIPE: img(17), RAW: img(28) }, tags: ["floral", "shake"] },
  { name: "Amrapali", from: "A dwarf hybrid of Dasheri and Neelam, grown around Saharanpur, Uttar Pradesh.", taste: "Intensely sweet, with deep orange flesh rich in carotene.", bestFor: "Eating fresh and desserts.", season: "Usually June and July.", sweetness: 5, popularity: 66, photos: [img(6), img(8), img(38)], stagePhotos: { RIPE: img(6), SEMI_RIPE: img(8), RAW: img(30) }, tags: ["hybrid", "sweet"] },
  { name: "Raspuri", from: "Mysuru and the Old Mysore region of Karnataka.", taste: "Juicy and sweet. The name means full of juice.", bestFor: "Pulp, juice and ice cream.", season: "Usually April to June.", sweetness: 4, popularity: 58, photos: [img(37), img(18), img(27)], stagePhotos: { RIPE: img(37), SEMI_RIPE: img(18), RAW: img(27) }, tags: ["juice", "pulp"] },
  { name: "Malgova", from: "Salem, Tamil Nadu.", taste: "Round, soft and juicy, with sweet flesh.", bestFor: "Eating fresh and juice.", season: "Usually May to July.", sweetness: 4, popularity: 62, photos: [img(11), img(33), img(15)], stagePhotos: { RIPE: img(11), SEMI_RIPE: img(33), RAW: img(26) }, tags: ["salem", "round"] },
  { name: "Mixed Box", from: "Four farms, four regions: Maharashtra, Gujarat, Andhra Pradesh and West Bengal.", taste: "Four favourites in one box, each wrapped and labelled so you can taste them side by side.", bestFor: "Gifting, and finding your favourite.", season: "Through the main season.", sweetness: 5, popularity: 76, photos: [img(20), img(21), img(12)], stagePhotos: { RIPE: img(20), SEMI_RIPE: img(21), RAW: img(12) }, tags: ["assorted", "gift", "variety pack"], contents: [{ name: "Alphonso", share: "A quarter of the box" }, { name: "Kesar", share: "A quarter of the box" }, { name: "Banganapalli", share: "A quarter of the box" }, { name: "Himsagar", share: "A quarter of the box" }] },
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
