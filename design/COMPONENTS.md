# MandiMangoes component inventory

The shop (`customer-app/`) and the staff panel (`src/`) share one token file, [`tokens.css`](tokens.css).
Run `node design/check-contrast.mjs` after changing a colour: every text pair must stay at 4.5:1 or more, light and dark.

## Tokens

| Group | Tokens | Use |
| --- | --- | --- |
| Spacing | `--space-1` … `--space-10` (4px steps: 4, 8, 12, 16, 20, 24, 32, 40) | Margins, gaps, padding |
| Type | `--font-sans`, `--font-mono` | Two families only; mono is for codes and IDs |
| Surfaces | `--color-bg`, `--color-surface`, `--color-ink`, `--color-muted`, `--color-line` | Page, cards, text, borders |
| Accent | `--color-accent` (fill), `--color-on-accent` (text on it), `--color-accent-strong` (accent text), `--color-accent-soft` (tint) | The one brand colour: primary buttons, active tab, selection |
| Semantic | `--color-success`, `--color-warning`, `--color-error`, `--color-info`, each with a `-soft` background | Status text and notes. Never colour alone: always with a word |
| Shape | `--radius-sm`, `--radius-md`, `--radius-pill`, `--tap-min` (44px) | Corners, tap targets |
| Motion | `--motion-fast` 150ms, `--motion-base` 200ms, `--motion-slow` 300ms | Become 0ms under `prefers-reduced-motion` |

The shop's older names (`--mango`, `--ink`, `--leaf` …) are aliases of these in `customer-app/src/styles.css`.

## Shop components

The names on the left are the spec names. "Today" is where it lives now.

| Spec name | Today | States it handles | Notes |
| --- | --- | --- | --- |
| TopBar | `App.tsx` header + `WhereButton`, `SearchBar` | pincode set / not set, signed in / out | Pincode chip left, profile right, search below. Cart lives in the bottom tabs (user's choice, 20 Oct) |
| Bottom tabs | `App.tsx` `nav.tabbar` | active tab, cart count | Hidden on checkout, claim and review forms so they never cover the submit button |
| PincodeSheet | `Shop.tsx` `PincodeForm` | empty, checking, not served, no open days | Opens from the chip with `?where=1` |
| ProductCard | `Shop.tsx` `ProductCard` | in stock (ripeness listed), sold out with next day, in cart count | Whole card opens the product page (user's Amazon-style choice, 20 Oct) |
| Product detail / buy box | `Product.tsx` `BuyBox` | no pincode, not on sale here, each ripeness in stock / sold out / low stock, cart already at max | Ripe chosen first when in stock |
| QuantityStepper | `.stepper` in `BuyBox` and `Cart.tsx` | min 1, max from stock (cap 20 until API gap G5) | 40px buttons inside a 44px row |
| Notify me | `Shop.tsx` `NotifyMe` | signed out, waiting, sent | WhatsApp back-in-stock alert |
| StickyCartBar | `Shop.tsx` `.sticky-cart` | hidden at 0, count + total | Sits above the bottom tabs, safe-area aware |
| Cart | `Cart.tsx` | empty, items, item removed, price changed | Full page, not a sheet |
| Checkout | `Checkout.tsx` | delivery day, slot, address, gift, promo, quote problems | Bill lines come from the server quote |
| AddressForm | `Checkout.tsx`, `Account.tsx` `SavedAddresses` | none saved, saved (max 5), invalid pincode | Autofill attributes set |
| OtpInput | `auth-ui.tsx` `PhoneCodeForm` | sent, wrong, expired, rate-limited, WhatsApp fallback | One field with `one-time-code`; 6-box version is spec work |
| PayButton | `payment.ts` + `Checkout.tsx` | idle, opening, paid, failed, pending confirmation | Razorpay script loads only on Pay |
| Order tracking | `Order.tsx` `OrderView`, `StatusPill` | each status, delivery photo, move day, cancel | |
| ReplacementRequest | `Claim.tsx` | pick items, reason, up to 3 photos, sent, decided | Never says refund |
| Reviews | `Product.tsx`, `Review.tsx`, `stars.tsx` | none, list, filtered, photos, brand reply | |
| Dialog | `ui.tsx` `Dialog` | open / closed | Focus trapped, Escape closes, focus returns |
| Loading / error | `ui.tsx` `Spinner`, `ErrorNote` | loading, error with retry | Skeletons replace spinners in milestone 2 |
| MangoArt | `mango.tsx` | raw, semi-ripe, ripe | Drawn icon until real photos (API gap G1) |

## Staff panel

The panel imports the same `tokens.css` and uses `--font-sans` and `--font-mono`. Its own colour names (`--green-700`, `--amber-500` …) stay as they are, since the panel's own tests check its contrast. New panel styles should use the shared tokens.
