# Screenshot baselines (QA pass, 2 Nov 2026)

Full-page screenshots of every screen, taken on this branch against the local stack
(`scripts/start-local.mjs`, demo data) after the visual fixes. WebP, quality 45, at CSS-pixel width.
They are for reading and comparing by eye; the automated comparisons are the Playwright visual
snapshots (`tests/visual.spec.ts`, `customer-app/e2e/visual.spec.ts`, `rider-app/e2e/visual.spec.ts`,
run with `PW_VISUAL=1`).

| Folder | What | Names |
|---|---|---|
| `shop/` | 27 shop pages (home to claims, signed in where needed) at 360, 390, 768, 1280 and 1440 px, Chromium | `chromium-<width>-<page>.webp` |
| `panel/` | 37 panel screens as a manager at all five widths, light and dark; WebKit at 390 and 1280; operator, packer, QC and rider at 390 and 1280 | `<browser>-<role>-<width>-<theme>_<route>.webp` (`_detail` is a batch or order page) |
| `rider/` | Sign in, today, pickup, picked up, the stop, the code step and the locked code at all five widths | `<screen>-<width>.webp` |

The shop and the rider app have no dark theme (light only, by design), so they have no dark shots.
A screen a role may not open shows the panel's "not for your role" page in that role's shots.
