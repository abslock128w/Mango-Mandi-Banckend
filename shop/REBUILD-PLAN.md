# Shop rebuild: the full MangoKart catalogue in the glass front end

Date: 4 Nov 2026. Branch: `claude/shop-catalogue-rebuild`.

## Goal

The shop (`shop/`) already wears the owner's new glass design (`mango-house/dist`) and is wired
to mango-api, but its shelf is three stage cards ("The raw ones", "The almost-there ones",
"The golden ones") with every variety squeezed into one box dropdown. The old front end
(`~/mangokart`) had the real catalogue: 15 varieties and a Mixed Box, each with an origin,
a flavour line, a story, a season, a sweetness score, search words and three photos.

This rebuild puts that catalogue into the new front end, in the new front end's exact style.

## Sources

| What | Where | Used for |
|---|---|---|
| Design (style source, not modified) | `~/Documents/ChatGPT/AMU/mango-house` (`DESIGN.md`, `dist/`) | Tokens, type, card, sheet, chip, dock, motion rules |
| Catalogue content | `~/mangokart/mocks/seed/catalog.ts`, `lib/ripeness.ts` | Variety copy, seasons, sweetness, tags, synonyms, trending, photo choice |
| Photos | `~/mangokart/public/images/mangoes/m00–m41.jpg` (Unsplash License, credited in `mangokart/CREDITS.md`) | Card, sheet and bag photos |
| Prices, boxes, stock | mango-api `GET /v1/products`, `GET /v1/catalogue` | Everything that is sold. The API stays the truth: MangoKart's demo prices are not used |

The API's demo seed (`mango-api/src/seed.js`, `DEMO_VARIETIES`) already carries the same 15
varieties + Mixed Box as 3 kg / 5 kg SKUs, so content and SKUs join on the variety name.

## Decisions

| Topic | Decision |
|---|---|
| Stack | Stays a static site with no build step. The deploy (`vercel.json`, CSP, `build-config.mjs`), `scripts/serve-shop.mjs`, the service worker and the checkout already depend on that, and a framework would buy nothing the owner asked for. |
| Style | No new visual language. Every new element reuses existing classes and tokens (`.product-card`, `.segmented`, `.product-tag`, `.dot`, `.field`, `.weight-select`, `.sheet`, `.button`, cream/green/ink/muted/line). New CSS is additive and only covers what the three-card design never had (photo `<img>` instead of the sprite, a stage switch on cards, an occasion row, a sort select, a gallery and facts list in the product sheet). |
| Card = variety | One card per variety the API sells, in the same 3-column grid. Card: stage photo, "best for" tag, name, heart, flavour line, price for the chosen box, 3 kg / 5 kg select, origin · stage line, quick add. |
| Stage on a card | The ripeness rail filters the whole shelf to one stage. On "All mangoes" each card has a small three-dot stage switch (Raw / Semi-raw / Ripe, text labels for screen readers), defaulting to the ripest stage in stock. |
| Mobile shelf | The three-card design used a sideways snap track. With 16 cards that track is unusable, so at ≤700px the shelf becomes a two-column grid with the card's price and box select stacked. This is the one layout change, forced by the catalogue size. |
| Occasions and sort | A row of pills under the ripeness rail: All · Dessert & aamras · Pickle & chutney · Juice & shakes · Gifting (from MangoKart's tags). A sort select beside the price note: Most loved · Sweetest · Price low to high · Price high to low. |
| Product sheet | The existing 760px sheet: photo with three thumbnails; name, origin, story; facts (season, sweetness out of 5, best for); ripeness switch with MangoKart's "use" and "eat by" guidance; box select; price; Add to bag; Mixed Box contents. |
| Search | Name, origin, flavour, tags, plus MangoKart's synonyms ("pickle" → Totapuri, raw; "hapus" → Alphonso; "juice" → Raspuri; "gift" → Mixed Box). A synonym hit sets the card's stage and shows the reason as its tag. No results shows MangoKart's trending searches as pills. The dock search already mirrors into `#search`. |
| Varieties the API does not sell | Not shown. Content without a SKU is a lookup table only. Production's seed has Alphonso and Badami only; the other 14 appear once the managers add them on the panel's Products page (owner follow-up). |
| API photos | If a product has an uploaded photo (`photoUrl`), the card uses it for that variety in place of the MangoKart photo. |
| Bag, checkout, orders, pre-order, bulk | Behaviour unchanged. The bag line stays `{sku, stage, qty}`; bag, checkout and order rows get the variety's stage photo instead of the stage sprite. |
| Code layout | `catalog.js` (content, readable data), `shelf.js` (catalogue state, cards, filters, search, product sheet), `app.js` keeps checkout, orders, pre-order, bulk and the event wiring. All three are classic deferred scripts sharing globals, in that order after `api.js`. |
| Offline | Service worker cache bumped to `v4`, the two new scripts precached; photos are cached on first view by the existing fetch handler. |

## Files

```
shop/catalog.js            new: 16 varieties, ripeness guidance, occasions, synonyms, trending
shop/shelf.js              new: catalogue state and rendering (replaces app.js lines 3–35)
shop/app.js                catalogue code removed; bag/checkout/order thumbs use the variety photo
shop/index.html            new scripts; occasion row and sort select in the toolbar
shop/style.css             additive rules at the end, same tokens
shop/assets/mangoes/*.webp photos used by catalog.js, converted from MangoKart's 800×800 JPEGs
shop/CREDITS.md            photo credits (Unsplash)
shop/sw.js                 cache v4, new files
shop/README.md             catalogue section
```

## Verification

1. `node scripts/start-local.mjs --no-open` (embedded Postgres + API with demo varieties + shop).
2. http://localhost:5174 at desktop and 375px: 16 cards, ripeness rail, occasion pills, sort,
   stage dots, search "pickle" / "hapus" / "gift", no-results pills, product sheet, add 3 kg and
   5 kg boxes at different stages, bag thumbnails, checkout to the demo payment.
3. Chausa shows sold out (the demo seeds no Chausa stock). No console errors.

### Result (4 Nov 2026, local stack)

Done in the browser pane at 800px and 375px: 16 cards from the API with the MangoKart copy and
photos; ripeness rail, occasion pills, sort and card stage dots; search "pickle" (Totapuri
then Banganapalli, both raw), "hapus", "raw mango for pickle", "ripe", and a no-results search
with the trending pills; product sheet (Mixed Box contents, stage switch, gallery); bag,
checkout and order rows with variety photos; checkout to a test payment (order ORD-1023
confirmed). Checkout refused a raw Mixed Box that had no stock for the chosen date, as it
should. No horizontal scroll at 375px. Console: only the expected 429 (OTP limit) and 409
(stock) responses.

Not checked: the service worker. The browser pane refuses to register any service worker
("unknown error when fetching the script") although `/sw.js` is served with 200 and a
JavaScript type and passes `node --check`; offline caching needs a check in Chrome or Safari.

## Follow-ups (not in this pass)

- Add the other 14 varieties to production on the panel's Products page, with real photos.
- Season windows from the API instead of the static months in `catalog.js`.
