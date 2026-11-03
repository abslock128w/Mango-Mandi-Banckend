# MandiMangoes shop: motion plan ("the Apple way")

Scope: `customer-app/` (Next 16, React 19, Tailwind v4, `motion` 14 via LazyMotion/domMax, Base UI Drawer,
Embla, React `<ViewTransition>`). The shop is built and works; this plan makes it *feel* like a native app:
every movement physical, interruptible, brief, and in the service of continuity. Nothing here changes what
the shop does, only how it moves. All test ids, accessible names and e2e specs stay as they are.

## 1. What is already there (keep, do not rebuild)

- Springs in `lib/motion.ts` (`morphSpring` 500/30, `uiSpring` 380/32, `softSpring` 220/28), `headerTween`.
- `LazyMotion strict` + `domMax` lazy import, `MotionConfig reducedMotion="user"`, `reduced:` variant, the
  CSS kill switch in `globals.css:115-129`.
- React `<ViewTransition>`: page enter/exit (`features/shell/page-transition.tsx`), product image morph
  card ↔ detail (`product-card.tsx:68`, `product-detail.tsx:65`, `share="morph"`).
- Sheet (`components/ui/drawer.tsx`): Base UI Drawer, drag + snap points on phones, side panel/dialog ≥1024.
- ADD → stepper `layoutId` morph with `AnimatePresence popLayout` (`add-button.tsx`), `RollingNumber`.
- Cart bar spring entrance, thumbnails stagger, total count-up. Cart lines `layout` enter/exit.
- Hero carousel autoplay + parallax + stretching dots. Sliding indicators (`listing`, `filter-sheet`, `box-toggle`).
- Header collapse on scroll with hysteresis. Toaster springs. Login phone ↔ OTP slide. Success Lottie + confetti.
- Skeletons, `WhenVisible` (400 px), `press` utility, `animate-rise` with `riseDelay` stagger.

## 2. What feels un-Apple today (the gaps)

1. **Mixed physics.** Some things spring (stepper, cart bar), some tween (sheet 250 ms ease-out, page 200 ms,
   header 180 ms). Apple's rule: one family of curves, chosen by *duration + bounce*, so the whole app
   moves like one material.
2. **Sheets don't push the page back.** iOS modals scale the page behind to ~0.94, round its corners and
   dim it, all tied to the drag. Here the backdrop fades on a timer and the content behind stays flat.
   Content inside the sheet also fades in *after a 310 ms delay*, so the sheet feels empty when it lands.
3. **Header animates `height`** (reflow every frame, even with the freeze trick) and is time-based rather
   than scroll-linked. It should follow the finger and cost nothing.
4. **Entrances replay.** `animate-rise` runs on every mount, so cards re-animate when `WhenVisible` mounts a
   rail mid-scroll, and tabs that re-render shimmer. Apple animates a thing *once*, on first appearance.
5. **No continuity on the key moment.** Add to cart morphs the button, but nothing travels to the cart
   bar; the bar just changes a number. The customer should see the box go into the cart.
6. **Page transitions are the same in both directions.** Forward and back look identical, so the app has
   no sense of depth. Flow pages (checkout, account, orders) also fade like catalogue pages instead of
   *presenting* over the shop.
7. **Images pop in.** No blur/colour placeholder; cards go from grey to picture in one frame.
   Rails clip hard at the gutter with no edge fade and no snap.
8. **Skeleton → content is a cut**, not a crossfade (search, listings).
9. **Layout animations of `height`** (cart line exit, search accordion) jank on low-end Androids.

## 3. Principles (write these at the top of `docs/design/shop-motion.md`)

1. **One material.** Every interactive motion is a spring described by `duration` and `bounce`, Apple-style
   (`spring({ duration: 0.35, bounce: 0.15 })`). Four presets only: `smooth` (0.30, 0), `snappy` (0.28, 0.12),
   `bouncy` (0.42, 0.28), `gentle` (0.5, 0). Tweens only for opacity crossfades and scroll-linked values.
2. **Interruptible and retargetable.** No `mode="wait"` on anything the user can tap again; springs
   retarget mid-flight. A second tap on ADD never waits for the first animation.
3. **Direct manipulation.** Sheets, carousels, toasts and the header track the finger 1:1, rubber-band past
   their limits, and use release velocity to decide where they land.
4. **Continuity over cuts.** Things that are the same object morph (product image, price, ADD button, cart
   thumbnail). Things that replace each other crossfade. Nothing blinks.
5. **Brief and quiet.** 120–350 ms for UI, never over 450 ms except the order-success celebration. Overshoot
   (bounce > 0.15) only for delight moments: add to cart, order placed.
6. **Depth tells hierarchy.** Forward navigation slides in from the right and pushes the old page back;
   modals rise from the bottom and push the page back; back reverses exactly.
7. **Compositor only.** Animate `transform`, `opacity`, `filter`, `clip-path`. No animated `height`, `top`,
   `width`. `will-change` only while a gesture is live. 60 fps on a 2019 Android, 120 fps on ProMotion.
8. **Reduced motion is a first-class mode**: crossfades only, no parallax, no autoplay, no fly-to-cart, no
   confetti. Never a blank screen.

## 4. Tokens and primitives (step 1 of the build)

`lib/motion.ts` becomes the single source:

```ts
export const spring = {
  smooth: { type: 'spring', duration: 0.30, bounce: 0 },
  snappy: { type: 'spring', duration: 0.28, bounce: 0.12 },
  bouncy: { type: 'spring', duration: 0.42, bounce: 0.28 },
  gentle: { type: 'spring', duration: 0.50, bounce: 0 },
} as const
export const fade = { duration: 0.16, ease: [0.2, 0, 0, 1] }      // crossfades
export const ease = { standard: [0.2, 0, 0, 1], emphasized: [0.32, 0.72, 0, 1] } // CSS mirror below
export const press = { scale: 0.97, transition: spring.snappy }
```

`styles/theme.css` gains `--ease-standard`, `--ease-emphasized`, `--dur-xs: 100ms`, `--dur-s: 160ms`,
`--dur-m: 240ms`, `--dur-l: 360ms`; every hard-coded `duration-200`/`0.18s` in the app moves to these.
Keep `morphSpring/uiSpring/softSpring` as aliases of the new presets so nothing breaks.

New primitives in `components/ui/`:
- `Pressable` (wraps `m.button`/`m.a`, `whileTap` press, `-webkit-tap-highlight-color: transparent`,
  `touch-action: manipulation`, focus ring). Replace the `press` utility usages.
- `Crossfade` (`AnimatePresence mode="popLayout"` + absolute stacking) for skeleton → content and for
  text that changes (delivery ETA, prices).
- `RevealOnce` (IntersectionObserver, animates the first time only, remembers in a `WeakSet`/data attr;
  under reduced motion renders final state).
- `BlurImage` (next/image with `blurDataURL` or dominant-colour background, opacity 0 → 1 on load, 200 ms).

## 5. Screen by screen

### Shell
- **Header**: scroll-linked, not timed. Reserve the full height in layout (`--header-h` constant); the
  brand/ETA block collapses with `useScroll` → `useTransform` on `translateY`/`scale`/`opacity` over the
  first 64 px, clamped, with the existing hysteresis only deciding the *direction* on short scrolls.
  No reflow. Search bar stays pinned and shrinks its vertical padding via `scale`.
- **Page transitions (React ViewTransition)**: directional. A tiny history store (`features/shell/nav.ts`)
  records push vs pop (`navigation` API where available, else a history index in `sessionStorage`).
  Forward: new page slides in 24 px from the right + fades, old scales to 0.98 and dims 8%. Back: exact
  reverse. Flow pages (`/checkout`, `/account*`, `/orders*`, `/order/*`, `/login`, `/location`) *present*:
  rise 100% from the bottom (`emphasized`, 360 ms) over the shop, and dismiss downwards. Names:
  `enter/exit="forward" | "back" | "present" | "dismiss"` in `globals.css`.
- **Cart bar**: appear with `spring.bouncy`; hide/show with scroll direction (translateY only, same
  direction logic as the header, shared hook `useScrollDirection`). Pulses `scale 1.03` on each add.
- **Toasts**: iOS style, from the top on all sizes, `spring.snappy`; swipe up to dismiss (`drag="y"`,
  dismiss on velocity < -300 or offset < -40); stack with `layout`.
- **Sheet** (`drawer.tsx`): the biggest single improvement.
  - Page behind: `[data-sheet-open] #app-root { transform: scale(.94) translateY(…); border-radius: 12px }`
    driven by the drag progress (Base UI exposes it) so it tracks the finger, not a timer.
  - Backdrop opacity = drag progress. Rubber-band above the top snap (`y = overshoot * 0.3`).
  - Release: velocity > 500 px/s dismisses; else snap to nearest; `spring.smooth`.
  - Content renders immediately; remove the 310 ms delayed fade. Below-fold sections inside use
    `RevealOnce`.
  - Keyboard: on phones listen to `visualViewport` and translate the sheet up so inputs (pincode, OTP)
    are never covered.
  - Desktop side panel: slide from the right with `spring.smooth`; dialog: scale .96 → 1 + fade, 240 ms.

### Home
- **Hero carousel**: Embla `duration: 22`, `dragFree: false`, autoplay pauses on hover/touch and when
  the carousel is offscreen (IntersectionObserver); parallax capped at ±4% and transform-only; dots
  keep the spring stretch. Slide text rises 8 px / 160 ms when its slide becomes active.
- **Variety grid**: `RevealOnce` fade + 8 px rise, 30 ms stagger capped at 8; press scale .97 and image
  `scale 1.04` on hover (desktop only, `@media (hover: hover)`).
- **Product rails**: `scroll-snap-type: x mandatory`, `scroll-snap-align: start`, `scroll-padding-inline`
  = page gutter; an edge fade via `mask-image: linear-gradient(...)` on both ends; `RevealOnce` per card.
  The "see all" link gets a press state.
- **Delivery line ("Tomorrow, 7 to 11 am")**: `Crossfade` when the pincode or slot changes.

### Product card, ADD, cart
- **ADD → stepper**: keep the `layoutId` morph but on `spring.snappy`; the `glitches.spec` opacity guard
  must still pass (no exit fade below 0.9 on the stepper).
- **Fly to cart (phones)**: on add, a 40 px clone of the card image arcs to the cart bar's thumbnail slot
  (transform-only keyframes, 380 ms `emphasized`, scale 1 → .4, fades last 20%), then the bar pulses and
  the thumbnail stack re-layouts (`layout` already there). Portal-rendered, pointer-events none, one at
  a time (a second tap cancels the first). Skipped under reduced motion.
- **Stepper +/-**: `RollingNumber` on `spring.snappy`; at 0 the stepper morphs back to ADD.
- **Cart lines**: exit via `clip-path`/`scaleY` from origin top + opacity, not `height`. Swipe left on a
  line reveals Remove (`drag="x"`, 80 px threshold, rubber-band). Totals use `RollingNumber`.

### Product detail
- Phone sheet: image morph `layoutId` (exists) plus title and price morph (`layoutId` per field); the
  sheet opens at snap 0.72 with `spring.smooth`; thumbnails rail snaps. Desktop: `<ViewTransition>` morph
  for image + name; description crossfades; back reverses (names stay stable both ways).
- Box toggle indicator `spring.snappy`; price `Crossfade`.

### Catalogue listing and search
- Rail of categories: indicator `spring.snappy`; scroll-spy stays; programmatic `scrollTo` uses
  `behavior: 'smooth'` only when not reduced.
- Filter sheet: same sheet physics; applying filters crossfades the grid (`Crossfade`) and reorders with
  `layout` only for ≤ 12 items; beyond that, plain crossfade.
- Search: rotating placeholder keep; results `Crossfade` from skeleton; accordion animates
  `clip-path` + translate instead of `height: auto`; clear button pops with `spring.snappy`.

### Checkout, login, orders
- Checkout steps: directional slide ±16 px on `spring.smooth` without `mode="wait"`; totals roll; the
  pay button morphs width → spinner → tick (`layoutId` on the label, `spring.snappy`), then `present` to
  the success page.
- Success: Lottie stays; confetti 1.2 s, fewer particles, none under reduced motion; order card rises
  with `spring.gentle`.
- Login OTP: six boxes with a blinking caret; wrong code shakes (`x: [0,-6,6,-4,4,0]`, 320 ms) and clears.
- Orders list: `RevealOnce` rows; row press state; order → tracking is `forward`.
- Tracking: rider status changes `Crossfade`; the delivery photo box is fixed-aspect (fixes the CLS risk
  at `tracking-view.tsx:237`).

### Images (all screens)
- `BlurImage` everywhere `next/image` is used; `blurDataURL` generated at build for `/public` images
  (`scripts/blur-placeholders.mjs`, plaiceholder-style 8 px base64) and the dominant colour as background
  for API-served images. Raw `<img>` tags in bulk/tracking/claim get width/height or a fixed-aspect box.

## 6. Performance budget and guard rails

- Only `transform`, `opacity`, `filter`, `clip-path` are animated. ESLint rule (custom, simple regex on
  `animate={{ height`/`width`/`top`) fails the build.
- `will-change: transform` is set by the sheet/drag code only while dragging and removed after.
- `content-visibility: auto; contain-intrinsic-size` on below-fold home sections and listing groups.
- Keep LazyMotion `domMax` lazy; no new animation libraries. Bundle delta under 6 kB gzipped.
- Playwright: `glitches.spec` CLS < 0.05 stays; add `motion.spec.ts`: (a) sheet drag-down dismisses,
  (b) ADD twice within 100 ms ends at quantity 2 with no stuck clone, (c) reduced-motion run has no
  fly-to-cart element, (d) header does not change document height while scrolling (no reflow), (e) INP
  proxy: `Add` tap to stepper paint under 100 ms (performance.now around the click).
- `visual.spec.ts` baselines run with animations disabled; they must not change.
- Unit: `spacing.test.ts` (4 px grid) still applies to all new classes.

## 7. Delivery

Branch from `claude/ops-dashboard-v2-9a061c` (so the stack is linear: #1 ← #2 ← #3 ← this), PR against it.
Commit this plan as `docs/design/shop-motion.md` first, then one commit per step:

1. Tokens + primitives (`lib/motion.ts`, theme vars, `Pressable`, `Crossfade`, `RevealOnce`, `BlurImage`).
2. Sheet physics (push-back, rubber-band, velocity, immediate content, keyboard).
3. Header scroll-linked + cart bar direction + shared `useScrollDirection`.
4. Directional page transitions + `present` for flow pages.
5. Home: carousel, grid, rails (snap, edge fade), reveal-once.
6. Add to cart: fly-to-cart, stepper, cart lines (clip-path exit, swipe to remove).
7. Product detail morphs (phone + desktop).
8. Listing/search/filter crossfades; checkout, login, orders, tracking.
9. Images: blur placeholders script + `BlurImage` rollout; fixed-aspect raw images.
10. Guard rails: lint rule, `motion.spec.ts`, bundle check; run the full e2e matrix (mobile + desktop)
    against a fresh local API; record 3 short screen recordings (add to cart, open product, open cart)
    at 390 px with `PW_SHOTS` and put them in `docs/screenshots/shop/`.
11. PR with before/after recordings, the test table, and the "what shipped / what did not / owner
    questions" section appended to the plan.

## 8. Owner questions (defaults taken unless told otherwise)

1. Fly-to-cart on phones: on [taken]; desktop gets only the bar pulse.
2. Flow pages present from the bottom (iOS modal) [taken] vs slide from the right.
3. Hero autoplay: keep at 5 s but pause on interaction [taken] vs no autoplay.
4. Confetti on order success: keep, shorter [taken] vs remove.
5. Swipe-to-remove on cart lines: on [taken]; the Remove button stays too.
6. Haptics: none on web [taken] (`navigator.vibrate` is Android-only and feels cheap).
