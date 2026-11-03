# Shop: liquid glass and the mango splash, v2 plan

Supersedes `docs/design/shop-motion-addendum.md` sections B and C (section A, the editorial feel, stands).
Built on top of PR #4 (`claude/shop-motion-3bdd77`). Same rules: no behaviour change, test ids and
accessible names stay, compositor-only motion, reduced motion honoured, e2e stays green.

---

## Part 1. How Apple's Liquid Glass actually works (research digest)

Sources: WWDC25 "Meet Liquid Glass" (219), "Get to know the new design system" (356), "Build a SwiftUI app
with the new design" (323), plus the CSS/SVG recreations (ekino, vitalbadjo, nikdelvin). Apple's own words
where it matters, because the plan below maps each behaviour to a web technique.

1. **Lensing is the defining trait, not blur.** "Whereas previous materials scattered light, this new set
   of materials dynamically bends, shapes and concentrates light in real time." The *edge* of the glass
   refracts what is behind it (the background appears magnified/bent at the rim); the centre is nearly
   clear. Bigger elements get "more pronounced lensing and refraction, and a softer scattering of light".
   Elements don't fade in: they "materialize in and out by gradually modulating the light bending".
2. **Specular highlights respond to geometry and motion.** Light sources "shine on the material producing
   highlights that respond to geometry"; on interaction "light travels around the material, defining its
   silhouette"; on some devices the highlight follows device motion.
3. **It adapts to what is behind it.** Each element "continuously adapts based on what's behind it"; small
   elements (bars, pills) flip between a light and a dark style depending on background luminance; large
   ones (sheets, sidebars) shift tone but never flip. Symbols/text on the glass flip with it.
4. **Shadows are contextual.** Shadow opacity rises over text and busy content, drops over flat light
   backgrounds; larger glass casts deeper shadows; nearby colour "bleeds into the shadow".
5. **Two variants, never mixed.** *Regular* (adaptive, any size, anything can sit on it) is the default.
   *Clear* is permanently more transparent, non-adaptive, needs a dimming layer, and is only for media-rich
   content with bold bright foreground.
6. **Tint is for the primary action only.** A tint "generates a range of tones mapped to content brightness
   underneath"; a solid-fill button "breaks the visual character". Don't tint everything; put brand colour
   in the content layer.
7. **Touch: flex, illuminate, lift.** On press the material "flexes and energizes with light": a glow
   spreads from under the finger across the element and onto neighbouring glass; the element scales and
   bounces ("gel-like"); elements can "lift up into glass temporarily" on interaction while staying quiet
   at rest.
8. **Morphing.** Controls on the floating plane "shape shift" between states (a button becomes a menu,
   a toolbar becomes a sheet). Glass cannot sample other glass, so grouped controls share one sampling
   region (`GlassEffectContainer`) and morph via `glassEffectID`.
9. **Layering.** Glass is for the navigation/control layer "floating above the content"; never in lists or
   cards; "always avoid glass on glass"; things on top of glass are thin vibrant overlays, not more glass.
10. **Scroll edge effect** replaces hard dividers: content under a bar "gently dissolves into the
    background", soft by default; dark content switches it to a subtle dimming.
11. **Shape rules.** Capsules for bars and pills (radius = height / 2); nested shapes are *concentric*
    (inner radius = outer radius − padding); avoid pinched or flared corners.
12. **Sheets** are inset glass at partial height (corners nest in the display corners), become opaque as
    they reach full height, and spring from their source button.
13. **Accessibility.** Reduce Transparency → frostier, more opaque. Increase Contrast → near black/white
    with a contrasting border. Reduce Motion → no elastic/flex effects, lower intensity.

### What the web can and cannot do

| Apple behaviour | Web technique | Support |
|---|---|---|
| Blur + saturation body | `backdrop-filter: blur() saturate()` | all modern browsers |
| Edge lensing / refraction | `backdrop-filter: url(#svgFilter)` with `feDisplacementMap` driven by a radial edge map | **Chromium only**; Safari/Firefox ignore `url()` in `backdrop-filter` (and Safari drops the whole declaration if mixed, so it must be a separate `@supports` rule) |
| Specular rim | 1 px translucent border + inset box-shadows (top brightest) + a `::before` gradient sheen, `mix-blend-mode: soft-light/screen` | all |
| Highlight following motion | move the sheen's gradient position with a scroll-linked value (transform only) | all |
| Light/dark flip by background | measure the backdrop (IntersectionObserver sentinel over dark sections, or `color-mix` against a known section background) and toggle a `data-tone` attribute | all |
| Contextual shadow | two stacked shadows whose opacity is toggled with `data-tone`/scroll state | all |
| Flex + illuminate on press | scale 0.97 + a radial glow from the touch point (CSS var `--px/--py` set on pointerdown), transform/opacity only | all |
| Morphing | `layoutId` morphs in `motion` (already used for ADD → stepper) | all |
| Reduce Transparency | `@media (prefers-reduced-transparency: reduce)` | Chromium 118+; others fall through to the no-`backdrop-filter` path |

So: body + rim + sheen + adaptivity + touch everywhere; **true refraction as a Chromium progressive
enhancement**, with an edge-gradient fake (a brighter, slightly magnified-looking rim) everywhere else.

---

## Part 2. Liquid glass for the shop: execution plan

### 2.1 Tokens (`styles/theme.css`)

```css
/* body */
--glass-blur: 16px;            /* > 16 smears; Apple's look is clearer than classic glassmorphism */
--glass-saturate: 1.7;
--glass-bg-light: color-mix(in oklab, #fff 55%, transparent);
--glass-bg-dark:  color-mix(in oklab, #1b1310 48%, transparent);
--glass-bg-frost: color-mix(in oklab, var(--color-surface) 88%, transparent);  /* reduced transparency / no backdrop-filter */
/* rim + sheen */
--glass-rim-top:    rgba(255,255,255,.75);
--glass-rim-bottom: rgba(120,70,20,.18);
--glass-sheen: linear-gradient(135deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.12) 38%, rgba(255,255,255,0) 60%);
/* shadow, two states */
--glass-shadow-quiet: 0 6px 20px -12px rgba(43,29,18,.18);
--glass-shadow-busy:  0 10px 30px -10px rgba(43,29,18,.32);
/* tint for the one primary action */
--glass-tint-action: color-mix(in oklab, var(--color-action) 82%, transparent);
```

### 2.2 The `.glass` utility (`app/globals.css`)

One class, four modifiers: `.glass` (regular), `.glass--bar`, `.glass--pill`, `.glass--tint`, plus a
`data-tone="light|dark"` attribute the JS flips. Rules:

- `background: var(--glass-bg-light)`; `[data-tone=dark]` swaps to dark and flips ink to white.
- `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))` (+ `-webkit-`).
- `border: 1px solid transparent; border-top-color: var(--glass-rim-top)` plus
  `box-shadow: inset 0 1px 0 var(--glass-rim-top), inset 0 -1px 0 var(--glass-rim-bottom), var(--glass-shadow-quiet)`.
- `::before` = sheen: `background: var(--glass-sheen)`, `background-size: 220% 100%`,
  `background-position-x: calc(var(--glass-sheen-x, 0) * 100%)`, `mix-blend-mode: soft-light`,
  `pointer-events: none`, `border-radius: inherit`. `--glass-sheen-x` is a 0 → 1 scroll-linked value set
  on the header (reuse the existing scroll-linked `MotionValue`), so the highlight glides as you scroll.
- `::after` = the Chromium lens: `@supports (backdrop-filter: url(#x))` adds
  `backdrop-filter: url(#glass-lens)` on the pseudo only (so Safari keeps the blur on the host element).
  The SVG filter lives once in `app/layout.tsx` (inline `<svg width=0 height=0>`): `feImage` of a radial
  edge map (transparent centre, grey→strong at the rim; generate it as a small data-URI PNG at build or draw
  it with a `<radialGradient>` inside the filter via `feImage href="#edgeMap"`) → `feDisplacementMap`
  `scale="24"` `xChannelSelector="R"` `yChannelSelector="G"`. Filter region `x=-10% y=-10% w=120% h=120%`.
- Fallback rim everywhere else: a second inset shadow `inset 0 0 0 2px rgba(255,255,255,.18)` plus the
  sheen gives the "thicker edge" read without displacement.
- `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)`:
  `background: var(--glass-bg-frost)`, no `backdrop-filter`, no `::after`.
- `@media (prefers-contrast: more)`: background near-opaque surface, `border: 1.5px solid var(--color-ink)`.
- `@media (prefers-reduced-motion: reduce)`: no sheen movement, no press flex.

### 2.3 Adaptive tone (the light/dark flip)

Small glass (header bar, cart bar, chips, toast) flips; large glass (sheet header) only shifts tone.
Implementation: a `useBackdropTone(ref)` hook with an `IntersectionObserver` on elements marked
`data-backdrop="dark"` (hero photo cards, the dark promo banner); when such an element crosses the glass's
band, set `data-tone="dark"` on the glass. No per-frame pixel sampling. The ink (`text`, icons) on the glass
uses `color: var(--glass-ink)` which the tone attribute switches. Transition the swap with a 200 ms
opacity crossfade of two stacked backgrounds, not a colour animation.

### 2.4 Touch: flex and illuminate

`Pressable` gains `glass` mode: on `pointerdown` set `--px`/`--py` (percent) from the event, add
`[data-pressed]`; CSS: `transform: scale(.97)`; a `::before` radial glow
`radial-gradient(120px circle at var(--px) var(--py), rgba(255,255,255,.45), transparent 60%)` fading in
over 120 ms and out over 300 ms (opacity only). Spring back with `spring.snappy`. Neighbouring glass in the
same group (`[data-glass-group]`) gets a weaker glow via `:has([data-pressed])`.

### 2.5 Where glass goes (regular everywhere; tint only on the two primary CTAs)

| Surface | Class | Notes |
|---|---|---|
| Header, collapsed state | `.glass--bar` | expanded state stays canvas; crossfade bars by opacity tied to the existing scroll value; sheen x follows scroll |
| Cart bar | `.glass--pill` + `data-glass-group` | capsule (radius = height/2); thumbnails are vibrant overlays, not glass |
| Sticky filter chip row (listing/search) | `.glass--bar` | only when stuck (existing sentinel) |
| Sheet header + grabber | `.glass` large | tone shifts, never flips; becomes opaque at the top snap point (opacity crossfade tied to drag progress) |
| Toasts | `.glass--pill` | |
| Detail ADD, checkout CTA | `.glass--tint` | tinted glass, label white, still the only tinted things on screen |
| Scroll edge | `.scroll-edge` 24 px gradient mask under the header (`mask-image: linear-gradient(...)` on a pseudo) | soft style only |

Never: product cards, lists, page backgrounds, the order summary card. Never glass on glass (a glass toast
over the glass cart bar: the toast is offset above it, both still in the same plane).

### 2.6 Shapes

Pills are capsules. Nested things are concentric: inner radius = outer radius − padding (cart bar 28 →
thumbnails 20 with 8 px padding; sheet 24 → sheet header controls 16 with 8 px). Add a `tests/unit/radii.test.ts`
that greps the glass components for `rounded-*` pairs and asserts concentricity.

### 2.7 Perf guard rails

- Max four `backdrop-filter` surfaces mounted at once; `tests/unit/compositor-only.test.ts` gains a rule:
  `backdrop-filter` only inside `.glass*` in CSS, and a Playwright check that counts
  `getComputedStyle(el).backdropFilter !== 'none'` across the DOM on home, listing and detail (≤ 4).
- During sheet drag and page transitions, glass gets `will-change: transform` only; blur never animates.
- `motion.spec.ts`: scroll the home page 2 s on a throttled CPU (`page.emulateCPUThrottling`? not in PW;
  use `--cpu-throttling-rate=4` via CDP) and assert no long task > 50 ms from the glass.
- Bundle: the glass hook + Pressable changes ≤ 1.5 kB gz on top of the 6 kB motion budget; the SVG filter is
  inline markup (≈ 0.4 kB).

---

## Part 3. The mango splash (replaces confetti + the success Lottie)

### 3.1 Reference, in words

The owner's reference clip (a thick yellow liquid splash on a dark ground, top-down, 5 s): a compact
glossy pool that keeps expanding for the whole clip; **long tapered tendrils** radiating out with **beads
at the tips** (ligaments breaking into drops); **scattered splatter dots** well outside the mass; a
**bulging, glossy centre** with a soft crater; the liquid is thick (slow, rounded, no spray), lit from one
side with a bright specular and a darker rim. The ask: that, with a **realistic mango sitting in the
middle**, on the success view, replacing the current tick Lottie and confetti, which look generic.

### 3.2 Prototype to port

`docs/design/splash-prototype.html` (same commit as this plan) is a working, dependency-free version:
open it in a browser, press Replay. Port it, don't redesign it. The technique:

- One `<svg viewBox="-200 -200 400 400">`.
- **The liquid silhouette is a `<mask>`**: a `<g filter="url(#goo)">` (feGaussianBlur σ=6 → feColorMatrix
  alpha `22 -10`) containing the pool ellipse and 16 tendril groups (tapered path + tip circle). Because
  the goo'd shapes are only a mask, **one gradient paints the whole merged liquid**: a `radialGradient`
  body (light yellow centre → mango orange → deep orange rim), a vertical rim gradient (white top edge,
  brown bottom edge) and a specular hotspot, all as full-size rects under the mask. That is what makes it
  read as one thick glossy fluid instead of flat blobs.
- **Tendrils** are individually animated with CSS custom props (`--a` angle, `--l` length, `--d` delay,
  `--w` wobble) on `transform: rotate() scale()` from the centre with an overshoot curve
  `cubic-bezier(.18,1.35,.32,1)`: they shoot past, settle back 6 %. Lengths and angles are jittered once
  (seeded) so it never looks like a gear.
- **Beads/droplets** outside the goo stay crisp: 16 small circles flung along `--a` to radius `--r`.
- **Pool** scales 0.18 → 1 with the same overshoot, then a 4 s `breathe` to 1.035 (echoes the reference's
  continuous expansion).
- **Mango**: an SVG illustration, kidney-shaped (`M-78 -10 … Z`), Alphonso yellow skin radial gradient
  (`#fff0a6 → #ffd84d → #f0b21b → #b8780c`), a faint orange blush, a gloss hotspot, green speckles, stem and
  leaf at the left shoulder, rotated −8°. It **drops in** (translateY −260 → 0, ease-in, 340 ms, −14° → 4°),
  **squashes** on impact (1.1×0.86 → 0.96×1.05 → 1, overshoot), a contact shadow grows under it, and a
  **front lip** of juice (a second goo'd mask drawn *after* the mango) covers its lower edge so it sits in
  the pool rather than on it.
- **Ripple**: one stroked ellipse scaling 0.35 → 1.5 and fading.
- **Timeline**: 0–340 ms drop · 320 ms impact (squash, shadow, ring) · 330–1300 ms tendrils and beads
  (staggered 0–100 ms) · 1.1 s headline rises · 1.25 s subline · 1.3 s onward breathe.

### 3.3 Make it more realistic than the prototype (do these)

1. **Mango realism.** Replace my hand-drawn body with a traced outline of a real Alphonso (use
   `public/images/mangoes/m00.jpg` as the reference: wide kidney, slight beak at the right end, flatter
   bottom). Three gradient layers (skin, shadow side, blush) + a soft inner shadow via
   `feGaussianBlur` on a darker copy, clipped to the body, + 10–14 speckles. Keep it vector: it must scale
   crisply and stay under budget. No raster.
2. **Thickness.** Add a darker underside band to each tendril tip bead (the rim gradient already does most
   of it) and make 3–4 of the long tendrils *curve* (control-point offsets) so it reads as poured, not
   sprayed.
3. **Secondary motion.** Two tendrils keep stretching slowly for 2 s after the burst (ease-out) and one bead
   detaches at 900 ms (a tip circle that translates 12 px further and shrinks to 0.8). Subtle.
4. **Crater.** A soft dark ellipse (`opacity .18`, blurred) just around the mango's base inside the pool,
   painted via a third masked rect, to sell the dent the mango makes.
5. **Colour on the shop canvas.** Background is `--color-canvas #fff8ee`, not black, so keep the rim
   gradient's bottom stop (brown, 35 %) and the contact shadow; without them the juice floats.

### 3.4 Integration

- New `features/orders/components/mango-splash.tsx` (client component, `next/dynamic` with `ssr: false`,
  only imported by `success-view.tsx` when `paid && !failed`). Replace `<Confetti />` and the
  `DotLottieReact` success branch with it; delete `confetti.tsx`, `/public/lottie/success.json`, the
  `setWasmUrl` line and the `@lottiefiles/dotlottie-react` dependency **if nothing else uses it**
  (grep first; the wasm in `public/lottie/` goes too if unused).
- Keep the tick fallback (`<Check>` in the green circle) for `prefers-reduced-motion`: show the **final
  frame** of the splash instead (static SVG, no animation classes) with the tick badge over the mango's
  corner, so reduced-motion users still get the mango. `failed` keeps the red tick.
- Headline and order summary keep their current `RevealOnce`/spring entrances, delayed to 1.1 s / 1.3 s
  to land after the burst.
- `aria-hidden` on the SVG; the existing `role="status"` text stays the announcement.
- Size: the whole component ≤ 9 kB gzipped (SVG paths are the bulk). Add it to the bundle budget script
  as its own line.
- Tests: `motion.spec.ts` gets "order success shows the mango splash" (after a demo payment, the `svg[data-splash]`
  is visible, `h1` text "Order confirmed" within 2 s) and "reduced motion shows the resting splash" (no
  running animations: `document.getAnimations().length === 0` inside the splash). `visual.spec.ts` snapshot
  of the resting state at 1.6 s with animations paused via `page.evaluate(() => document.getAnimations().forEach(a => a.finish()))`.

---

## Delivery order and commits

1. `glass: tokens, .glass utility, lens filter, fallbacks` (CSS only, no surfaces yet; unit tests for
   backdrop-filter containment and radii).
2. `glass: header, scroll edge, cart bar` (+ tone hook, sheen x on scroll, Pressable glass mode).
3. `glass: chips, sheet header, toasts, tinted CTAs`.
4. `splash: mango splash component` (port prototype, realism items 1–5, integration, Lottie/confetti removal).
5. `splash: tests and budget line`; update `docs/design/shop-motion.md` with "Liquid glass" and "Mango
   splash" sections (fold this plan in, delete `shop-motion-addendum.md` and this file; keep
   `splash-prototype.html` as the reference).
6. Lint, typecheck, unit, full e2e; PR against `claude/shop-motion-3bdd77` titled "Shop: liquid glass,
   editorial feel and the mango splash" with before/after notes, the bundle numbers (motion vs 6 kB,
   glass vs 1.5 kB, splash vs 9 kB), test counts, and a short "what Safari/Firefox get instead of
   refraction" note.
