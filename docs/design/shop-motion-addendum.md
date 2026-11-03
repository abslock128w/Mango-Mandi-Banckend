# Shop motion, addendum: First Club feel, liquid glass, mango splash

Builds on the ten steps already committed on `shop-motion` (see `docs/design/shop-motion.md`). Same
rules as before: no behaviour changes, test ids and accessible names stay, compositor-only motion,
reduced-motion honoured, the shop must still pass its e2e suite. Three additions, in this order.

## A. Borrow the First Club feel (editorial, image-led, calm)

First Club (the premium grocery app from Bengaluru) feels like a magazine, not a grid of SKUs. What
to take from it, nothing more:

1. **Photography leads.** Product tiles and the detail page give the image the whole card; name, stage
   chip and price sit on a soft gradient scrim at the bottom of the image (or just below it for small
   tiles), never in a boxed label row. Images get a slow 1.03 → 1.0 settle on first reveal (`RevealOnce`),
   and a 1.02 lift on press (`Pressable`).
2. **Generous rhythm.** One accent per screen. Section headers are a single confident line with an
   optional one-line "why" in muted ink (e.g. "Alphonso · Ratnagiri, plucked 5 days ago"). Raise the
   vertical rhythm between rails on the home page (24 → 32 px on phones; keep the 4 px grid test green).
3. **Story moments.** The hero carousel slides become full-bleed photo cards with the headline on a
   scrim and a short serif-less but larger display size (reuse the existing display font; no new font
   files, bundle budget stands). Parallax on the photo, text stays still.
4. **Quiet chrome.** The header and cart bar stop being opaque bars; they become glass (section B) so the
   photography shows through. Dividers drop to hairlines (`--color-line` at 60 % alpha).
5. **Micro-detail.** Prices use tabular numerals; the stage chip (RIPE / SEMI / RAW) gets a 6 px dot that
   breathes once (scale 1 → 1.15 → 1, 600 ms, once on reveal) instead of a solid pill.

Do not copy their layout wholesale, their palette or their copy. Keep MandiMangoes' warm canvas
(`--color-canvas #fff8ee`) and brand mango/green.

## B. Liquid glass (Apple iOS 26 style), used sparingly

Glass is for **floating chrome only**: the header, the cart bar, the tab/filter chip row when it sticks,
sheet handles and sheet headers, the toast, and primary floating buttons (ADD on the detail page, the
checkout CTA). Never for cards, lists or page backgrounds.

### Tokens (add to `styles/theme.css`)

```css
--glass-bg: color-mix(in oklab, var(--color-surface) 62%, transparent);
--glass-bg-strong: color-mix(in oklab, var(--color-surface) 78%, transparent);
--glass-tint: color-mix(in oklab, var(--color-brand) 10%, transparent);   /* warm cast */
--glass-blur: 18px;
--glass-saturate: 1.6;
--glass-edge: 1px solid color-mix(in oklab, white 55%, transparent);
--glass-shadow: 0 1px 0 rgba(255,255,255,.45) inset, 0 8px 24px -12px rgba(43,29,18,.25);
```

### `.glass` recipe (one utility, in `globals.css`)

- `background: linear-gradient(var(--glass-tint), transparent 60%), var(--glass-bg)`
- `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))` + `-webkit-` prefix
- `border: var(--glass-edge)`; `box-shadow: var(--glass-shadow)`; radius 20–28 px for pills, 16 px for bars
- **Specular highlight**: a `::before` pseudo with a 140° linear gradient (white 35 % → transparent 40 %),
  `mix-blend-mode: soft-light`, whose `--spec-x` is scroll-linked (use the existing scroll-linked header
  value, `0 → 1` over 80 px) so the highlight glides as the user scrolls. Transform only.
- **Lensing on touch**: on press, the glass pill scales 0.97 and its blur drops 18 → 12 px for the press
  duration (filter is compositor-friendly on modern engines; gate it behind `(hover: none)` phones only,
  and skip entirely when the device reports `prefers-reduced-transparency`).
- **Adaptive ink**: text on glass uses `--color-ink` at 92 % and gets `text-shadow: 0 0.5px 0 rgba(255,255,255,.4)`
  for legibility over photos. Minimum contrast stays AA; the a11y spec must still pass.
- **Fallbacks**: `@supports not (backdrop-filter: blur(1px))` → `--glass-bg-strong`, no blur.
  `@media (prefers-reduced-transparency: reduce)` → opaque `--color-surface`, no blur, no specular.
- **Perf guard**: at most four `backdrop-filter` surfaces live at once (header, cart bar, one sheet, one
  toast). Add a unit test like `compositor-only.test.ts` that greps for `backdrop-filter` outside
  `.glass` and fails. During sheet drag, the page behind already scales to 0.94; glass on the sheet header
  must not animate blur while dragging (keep `will-change: transform` only).

### Where

| Surface | Glass variant | Note |
|---|---|---|
| Header (collapsed state) | `.glass` bar | expanded state stays canvas-coloured; crossfade between the two via opacity, tied to the same scroll value |
| Cart bar | `.glass` pill, strong | thumbnails sit on the glass; total uses tabular nums |
| Sticky filter chips (listing/search) | `.glass` row | only once it sticks (`IntersectionObserver` sentinel already exists for the header, reuse) |
| Sheet header + handle | `.glass` | content under it scrolls beneath |
| Toasts | `.glass` pill | |
| Detail page ADD + checkout CTA | `.glass` button with brand tint at 100 % behind the label when enabled | stays obviously primary |

## C. Mango splash on order confirmation (replaces confetti)

Reference: the Slice mango-drink TV ads, where a mango drops into thick juice and sends up a slow,
glossy splash with droplets and a crown. We want that moment, stylised, on the success view
(`features/orders/components/success-view.tsx`, replacing `confetti.tsx`).

### Choreography (about 1.6 s total, then rests)

1. **0–250 ms, drop.** A mango (use an inline SVG, two-tone brand + blush gradient, small leaf) falls from
   just above the success card, `bouncy` spring on `y`, slight rotation −12° → 4°.
2. **250–300 ms, impact.** The mango squashes to 1.08 × 0.9 for one frame and a radial "juice ring" scales
   from 0.3 → 1.4 while fading, in `--color-brand` at 60 %.
3. **300–900 ms, crown splash.** Eight to twelve juice blobs burst outward in an arc (randomised within
   ±15° and ±10 % distance, seeded once per mount so it never flickers), each a rounded SVG path in
   mango-orange → yellow gradient, with a `filter: url(#goo)` SVG gooey filter (feGaussianBlur +
   feColorMatrix) on the group so the blobs merge like liquid. Blobs rise with a `bouncy` spring, then
   fall with gravity (`gentle`), scale 0 → 1 → 0.6, opacity to 0 at the end.
4. **400–1100 ms, droplets.** Twenty tiny circles (2–5 px) scatter further and faster, no goo, fade out.
5. **600–1000 ms, ripple.** Two concentric rings expand (scale 0.6 → 1.6, opacity .35 → 0) behind the mango.
6. **900 ms onward, settle.** The mango sits in a shallow "puddle" ellipse that fades in; the headline
   ("Your mangoes are on the way" or whatever copy exists today) rises with `RevealOnce`, and the order
   number counts in with `RollingNumber`. A few droplets can slide down the card like condensation
   (optional, only if cheap).

### Rules

- All SVG + `motion` transforms/opacity. No canvas, no Lottie, no new dependency. The goo filter is
  applied to one small group only (≤ 12 shapes) because `feGaussianBlur` is expensive; cap the
  filter region with `x/y/width/height` on the `<filter>`.
- Lazy-load the splash component (`next/dynamic`) so it is only in the success route's chunk. Budget:
  ≤ 8 kB gzipped for the splash on top of the existing 6 kB motion budget; report the number in the PR.
- Runs once per success view mount. `prefers-reduced-motion`: show the mango resting in its puddle with
  the ring at its final state, no animation; keep whatever "order placed" live region exists.
- Keep the existing success Lottie only if it is still needed for something; otherwise remove it and the
  confetti and drop their bytes.
- Add one e2e case to `motion.spec.ts` (reduced-motion off): after placing a demo order, the splash
  container is visible and the headline is in the DOM within 2 s; with reduced motion on, no `animate`
  attributes/inline transforms change between two screenshots 500 ms apart.

## Delivery

- Steps: A (one commit), B tokens + `.glass` + header/cart bar (one commit), B remaining surfaces (one
  commit), C splash (one commit), then lint, unit, e2e (a11y, visual, motion, tap-targets, spacing),
  bundle check, update `docs/design/shop-motion.md` with sections for glass and the splash.
- Then open the PR against `claude/ops-dashboard-v2-9a061c` with before/after notes and the two bundle
  numbers. Branch stays `shop-motion`.
