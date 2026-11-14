/* VMR Mangoes catalogue content: the words and photos for each variety the shop can sell.
   Brought over from the MangoKart shop (~/mangokart/mocks/seed/catalog.ts, lib/ripeness.ts).
   Prices, boxes and stock are NOT here: they come from mango-api (/v1/products, /v1/catalogue).
   A variety joins its API products on `name` === product.variety. A variety the API does not
   sell is never shown; an API variety with no entry here gets a plain fallback (shelf.js). */
(() => {
  const photo = (n) => `assets/mangoes/m${String(n).padStart(2, '0')}.webp`

  // [name, region, origin, flavour, story, season [from, to] (months), sweetness 1-5, popularity,
  //  photos [ripe, semi, raw, ...gallery], best for, tags, occasions]
  const ROWS = [
    ['Alphonso', 'Ratnagiri', 'Ratnagiri and Devgad, Maharashtra', 'Rich, creamy and fragrant with saffron-gold flesh',
      'Known locally as Hapus, Alphonso grows in the red laterite soil of the Konkan coast. Each fruit is hand-picked at maturity and ripened in hay, never with carbide.',
      [3, 6], 5, 100, [0, 7, 22, 32], 'Most loved for desserts', ['hapus', 'dessert', 'aamras', 'premium'], ['dessert', 'gifting']],
    ['Kesar', 'Gir', 'Gir, Junagadh, Gujarat', 'Saffron-sweet with a hint of honey',
      'Grown in the foothills of Gir, Kesar takes its name from its saffron colour. It is the classic choice for aamras and shrikhand.',
      [5, 7], 5, 92, [5, 12, 23, 33], 'The classic aamras mango', ['aamras', 'dessert', 'saffron', 'shrikhand'], ['dessert', 'gifting']],
    ['Banganapalli', 'Kurnool', 'Kurnool, Andhra Pradesh', 'Mild, sweet and fibreless with a firm bite',
      'Also called Benishan, Banganapalli has a GI tag and thin golden skin. Its fibreless flesh slices cleanly for salads and lunch boxes.',
      [3, 6], 4, 85, [16, 19, 24, 11], 'Slices clean, no fibre', ['benishan', 'slices', 'fibreless'], ['pickle']],
    ['Dasheri', 'Malihabad', 'Malihabad, Lucknow, Uttar Pradesh', 'Aromatic and honey-sweet, long and slender',
      'Dasheri traces back to the orchards of Malihabad. Its aroma fills a room, and it is best eaten whole, squeezed from the skin.',
      [5, 7], 4, 80, [4, 14, 25, 10], 'Fills the room with aroma', ['aromatic', 'lucknow'], ['dessert']],
    ['Langra', 'Varanasi', 'Varanasi, Uttar Pradesh', 'Tangy-sweet with green skin even when ripe',
      'Langra stays green outside when ripe. Its lemon-yellow flesh is juicy, with a gentle tang that balances the sweetness.',
      [6, 8], 4, 70, [29, 26, 26, 31], 'Green outside, gold inside', ['banarasi', 'green skin', 'tangy'], ['pickle']],
    ['Chausa', 'Hardoi', 'Hardoi, Uttar Pradesh', 'Very sweet, soft and juicy',
      'Chausa arrives late in the season. It is soft and very sweet, and best enjoyed chilled and sucked straight from the fruit.',
      [7, 8], 5, 68, [15, 21, 27, 9], 'Best enjoyed chilled', ['late season', 'juicy'], ['dessert', 'juice']],
    ['Totapuri', 'Chittoor', 'Chittoor, Andhra Pradesh', 'Tangy and firm with a parrot-beak tip',
      'Totapuri is named for its parrot-beak shape. Firm and tangy, it is the go-to mango for pickles, chutneys and pulp.',
      [5, 7], 2, 75, [22, 24, 28, 23], 'For the pickle jar', ['pickle', 'kairi', 'chutney', 'tangy', 'achar'], ['pickle']],
    ['Himsagar', 'Murshidabad', 'Murshidabad, West Bengal', 'Creamy, fibreless and very sweet',
      "Bengal's pride, Himsagar has a short season and a creamy texture loved for mishti doi and desserts.",
      [5, 6], 5, 78, [1, 34, 30, 20], "Bengal's creamy pride", ['bengal', 'dessert', 'fibreless'], ['dessert', 'gifting']],
    ['Neelam', 'Krishnagiri', 'Krishnagiri, Tamil Nadu', 'Floral, mildly sweet with a long shelf life',
      'Neelam fruits late and keeps well. Its floral aroma makes it a favourite for smoothies and milkshakes.',
      [6, 8], 3, 60, [17, 28, 22, 13], 'Keeps well, blends well', ['floral', 'shake', 'smoothie'], ['juice']],
    ['Mallika', 'Kolar', 'Kolar, Karnataka', 'Honeyed and citrusy with deep orange flesh',
      'A cross of Neelam and Dasheri, Mallika carries the aroma of one and the sweetness of the other.',
      [5, 6], 4, 64, [3, 25, 23, 35], 'Honeyed and citrusy', ['hybrid', 'citrus'], ['dessert']],
    ['Amrapali', 'Saharanpur', 'Saharanpur, Uttar Pradesh', 'Intensely sweet with deep orange flesh',
      'Amrapali is a dwarf hybrid of Dasheri and Neelam, rich in carotene and very sweet.',
      [5, 7], 5, 66, [6, 38, 24, 8], 'Intensely sweet', ['hybrid', 'sweet'], ['dessert', 'juice']],
    ['Badami', 'Dharwad', 'Dharwad, Karnataka', 'Alphonso-like richness at a gentler price',
      'Called the Karnataka Alphonso, Badami shares the creamy texture of Hapus with an almond-shaped profile.',
      [3, 6], 4, 72, [2, 30, 25, 36], "Karnataka's Alphonso", ['karnataka alphonso', 'dessert'], ['dessert']],
    ['Raspuri', 'Mysuru', 'Mysuru, Karnataka', 'Juicy and sweet, made for pulp and juice',
      'Raspuri means full of juice. It is the mango Mysuru grows for pulp, juice and ice cream.',
      [4, 6], 4, 58, [18, 27, 26, 37], 'Juiciest pulp', ['juice', 'pulp', 'ice cream'], ['juice']],
    ['Imam Pasand', 'Krishna', 'Krishna, Andhra Pradesh', 'Large, fibreless and richly sweet',
      'Once reserved for royalty, Imam Pasand is a large, thin-skinned mango with fibreless flesh and a lingering finish.',
      [3, 6], 5, 74, [39, 9, 27, 34], 'Once a royal favourite', ['himayat', 'royal', 'premium'], ['dessert', 'gifting']],
    ['Malgova', 'Salem', 'Salem, Tamil Nadu', 'Round, juicy and sweet with a soft texture',
      'Malgova is a round mango from Salem with soft, juicy flesh, a summer staple across Tamil Nadu.',
      [5, 7], 4, 62, [11, 15, 28, 33], 'Round, soft and juicy', ['salem', 'round'], ['juice']],
    ['Mixed Box', 'Four regions', 'Maharashtra, Gujarat, Andhra Pradesh and West Bengal', 'Four favourites in one box',
      "Can't pick one? The Mixed Box packs a fixed assortment of four in-season favourites, each wrapped and labelled so you can taste them side by side.",
      [5, 7], 5, 90, [20, 21, 30, 12], 'Four favourites, one box', ['gift', 'assorted', 'sampler', 'mixed', 'combo'], ['gifting']],
  ]

  const varieties = ROWS.map(([name, region, origin, flavour, story, season, sweetness, popularity, pics, bestFor, tags, occasions]) => ({
    name, region, origin, flavour, story,
    season: { from: season[0], to: season[1] },
    sweetness, popularity, bestFor, tags, occasions,
    photos: { RIPE: photo(pics[0]), SEMI_RIPE: photo(pics[1]), RAW: photo(pics[2]) },
    gallery: [photo(pics[0]), photo(pics[1]), photo(pics[3])],
  }))

  const mixed = varieties.find((v) => v.name === 'Mixed Box')
  mixed.contents = ['Alphonso', 'Kesar', 'Banganapalli', 'Himsagar'].map((name) => ({ name, share: 'a quarter of the box' }))

  window.MM_CATALOG = {
    varieties,

    // Per stage: when to use it and when to eat it (MangoKart), keyed by the API stage.
    ripeness: {
      RAW: { use: 'Firm and sour, for pickle and cooking', eatBy: 'Use within a week for pickle, chutney or panna' },
      SEMI_RIPE: { use: 'Keep a few days, eat through the week', eatBy: 'Ripens at room temperature in 1 to 4 days' },
      RIPE: { use: 'Ready to eat, slice or make aamras', eatBy: 'Eat within 2 to 3 days of delivery' },
    },

    occasions: [
      { id: 'all', label: 'Every mango' },
      { id: 'dessert', label: 'Dessert & aamras' },
      { id: 'pickle', label: 'Pickle & chutney' },
      { id: 'juice', label: 'Juice & shakes' },
      { id: 'gifting', label: 'Gifting' },
    ],

    // Search words that point at a variety (and the stage it should open at).
    synonyms: [
      { terms: ['pickle', 'achar', 'achaar', 'kairi', 'chutney', 'sour'], variety: 'Totapuri', stage: 'RAW', reason: 'Best for pickle' },
      { terms: ['pickle', 'achar', 'kairi'], variety: 'Banganapalli', stage: 'RAW', reason: 'Firm raw slices' },
      { terms: ['dessert', 'sweet', 'aamras', 'shrikhand', 'premium'], variety: 'Alphonso', stage: 'SEMI_RIPE', reason: 'Most loved for desserts' },
      { terms: ['aamras', 'dessert'], variety: 'Kesar', stage: 'SEMI_RIPE', reason: 'Classic aamras mango' },
      { terms: ['hapus'], variety: 'Alphonso', stage: 'SEMI_RIPE', reason: 'Hapus is Alphonso' },
      { terms: ['juice', 'pulp', 'shake', 'smoothie'], variety: 'Raspuri', stage: 'SEMI_RIPE', reason: 'Juiciest pulp' },
      { terms: ['gift', 'assorted', 'sampler', 'mix', 'combo'], variety: 'Mixed Box', stage: null, reason: 'Four varieties in one box' },
      { terms: ['panna', 'green', 'raw'], variety: 'Totapuri', stage: 'RAW', reason: 'Tangy raw mango' },
      { terms: ['benishan'], variety: 'Banganapalli', stage: 'SEMI_RIPE', reason: 'Benishan is Banganapalli' },
      // other spellings customers use (the search suggestions offer these names: suggest.js)
      { terms: ['banginapalli', 'banganpalli', 'bangalapalli'], variety: 'Banganapalli', stage: 'SEMI_RIPE', reason: 'Also spelt Banganapalli' },
      { terms: ['himayath', 'himayat', 'himam pasand'], variety: 'Imam Pasand', stage: 'SEMI_RIPE', reason: 'Himayath is Imam Pasand' },
      { terms: ['rathgiri', 'ratnagiri', 'rathnagiri'], variety: 'Alphonso', stage: 'SEMI_RIPE', reason: 'Ratnagiri Alphonso' },
      { terms: ['dasari', 'dussehri', 'dasehri'], variety: 'Dasheri', stage: 'SEMI_RIPE', reason: 'Dasari is Dasheri' },
      { terms: ['malgoa', 'malgoba'], variety: 'Malgova', stage: 'SEMI_RIPE', reason: 'Also spelt Malgova' },
    ],

    trending: ['Alphonso', 'Raw mango for pickle', 'Kesar', 'Mixed Box', 'Dasheri', 'Mango for aamras'],
  }
})()
