# Shop languages: English, Hindi and Kannada

One feature for MandiMangoes, behind its own switch:

| Feature | What it does | Who | Switch |
| --- | --- | --- | --- |
| **C5 Shop languages** | The customer shop in English, Hindi (हिन्दी) or Kannada (ಕನ್ನಡ). Each customer picks one; a signed-in customer's choice is saved to their account. | Customers | `SHOP_LANGUAGES` |

Kannada is the regional language because the shop delivers in Bengaluru.

The switch is **off unless set**. While it is off:

- `GET` and `PUT /v1/me/language` answer 404;
- `/v1/policy` says `features.languages: false`;
- the shop is English only and shows no language control, even to a customer who chose Hindi or Kannada earlier (their choice is kept and comes back when the switch is turned on again).

> **Before launch: have a native speaker review the Hindi and the Kannada.** The translations in `customer-app/src/i18n/hi.ts` and `kn.ts` were written to be simple and natural, but nobody who speaks either language as their first language has checked them yet. Each file says so at the top.

## The switch

| Env var | Default | Notes |
| --- | --- | --- |
| `SHOP_LANGUAGES` | empty (off) | `true` turns it on. Empty lets a manager turn it on from the panel (**Settings → Features → Shop languages**, with `PANEL_FEATURE_SWITCHES` on). `false` is a kill switch the panel cannot override. |

It is listed in `mango-api/.env.example`. `scripts/start-local.mjs` turns it on for local runs, and CI's end-to-end job runs with it on so `customer-app/tests/languages.spec.ts` runs.

## What the customer sees

- **Where to choose.** The Account page has a **Language** card, and the sign-in page has a small control under the heading. Each language is shown in its own script: English, हिन्दी, ಕನ್ನಡ. The buttons say which one is on (`aria-pressed`) and are marked with their language (`lang="hi"`, `lang="kn"`), so screen readers read each name correctly.
- **Guests.** The choice is kept on the device (`localStorage`, key `mm.lang`). If storage is blocked, it lasts as long as the tab.
- **Signed in.** Changing it on the Account page saves it to the account straight away and says **Saved.** A failed save shows the reason beside the control; the page stays in the chosen language.
- **At sign-in.** If the account already has a language, that one is used (so the choice follows the customer to another phone). If it has none, the language chosen on this device is saved to it.
- **`<html lang>`** follows the language shown, so screen readers and browser translation know it.
- **Dates and money** use the language's Indian locale (`hi-IN`, `kn-IN`) with **Latin digits** (0–9) in every language, so prices, order numbers, pincodes and codes look the same everywhere. `kn-IN` groups thousands (`₹1,23,456` in English and Hindi is `₹123,456` in Kannada), which is that locale's own rule.

### What stays as it is

- **Names from the database**: product, variety and box names, bulk deal titles, addresses, notes, the staff's replies to help requests and reviews. They are shown as the shop team entered them.
- **The brand**: MandiMangoes.
- **The legal text** of the Terms of sale and the Privacy notice. The headings follow the chosen language; the body stays English, is marked `lang="en"`, and a note above it says (in the chosen language) that the English text is the version that applies. A translated legal text would need a lawyer's review in each language.
- **Error messages from the API.** The common ones (network down, wrong code, too many tries, pincode not served, empty cart, slot full, quote expired, and a few more: `TRANSLATED_ERRORS` in `customer-app/src/api.ts`) are shown in the chosen language. Rarer ones show the API's English message.
- **Text sent to staff**: the WhatsApp message a customer starts from "Help with order …" goes to the shop team, so it stays English.
- **WhatsApp and SMS messages** from the shop stay English (below).

### Why WhatsApp and SMS stay English

Every WhatsApp message the shop starts (order confirmed, out for delivery, delivered, sign-in code, …) is a **Meta message template**. A template is approved by Meta **for one language at a time**: sending the same message in Hindi and Kannada needs a Hindi and a Kannada version of every template, each submitted and approved separately in WhatsApp Manager, and kept in step whenever the English one changes. SMS sign-in codes go through DLT-registered templates with the same problem. That is a launch decision for the owner, not something code can switch on, so for now every message stays English. The Account page says so under the language control.

## The API

- **Migration `043_languages.sql`** adds `customers.language` (`TEXT`, null until the customer chooses) with a `CHECK` that it is `en`, `hi` or `kn`. It is added `NOT VALID`, so it takes only a brief lock and does not scan existing rows (all of which are null).
- **`GET /v1/me/language`** (signed-in customer) → `{ "language": "hi" | "kn" | "en" | null, "languages": ["en", "hi", "kn"] }`.
- **`PUT /v1/me/language`** with `{ "language": "kn" }` → the same answer. The server checks the value (`en`, `hi` or `kn` only; anything else, or any other field, is a 400 `VALIDATION_ERROR`). A customer reads and changes only their own; a staff token is refused.
- **Data export** (`/v1/me/export`) includes it. **Deleting the account** clears it.
- The code is in `mango-api/src/language-routes.js`.

## How the shop does it

There is no translation library. Everything is in `customer-app/src`:

| File | What it holds |
| --- | --- |
| `i18n/en.ts` | Every word a customer sees, in English. The source the other languages follow. |
| `i18n/hi.ts`, `i18n/kn.ts` | The same keys in Hindi and Kannada. |
| `i18n-core.ts` | Looking up a key, filling `{placeholders}`, picking plural forms, the locales. No React, so it is unit tested on its own. |
| `i18n.tsx` | `LanguageProvider` (the chosen language, saving it, `<html lang>`), `useT()`, and the `LanguagePicker`. |
| `format.ts` | Money, dates and times in the current locale; status and ripeness names. |

- An entry is a string with `{name}` placeholders, or `{ one, other }` when it depends on a count. The form is picked by `Intl.PluralRules` for the language and `vars.count`, so "1 box" / "2 boxes" works in every language.
- A component calls `const t = useT()` and then `t('cart.continue')` or `t('shop.notServed', { pincode })`. `t.rich('help.fullRules', { terms: <Link…/>, privacy: <Link…/> })` puts links and other elements into a sentence, so the word order can change between languages.
- Code outside React (status names, error messages) calls `t()` from `i18n-core.ts`; the provider sets the current language before anything renders.

### Adding or changing a string

1. Add the key to `customer-app/src/i18n/en.ts`, named `area.what` (for example `checkout.slotFull`).
2. Add the same key to `hi.ts` and `kn.ts`, with the same `{placeholders}` and, for a count, the same `{ one, other }` shape. Keep it short and plain: the words a shopkeeper would say.
3. Show it with `t('area.what')` (or `t.rich` when it contains a link).
4. Run `npm run test:unit`. It fails if a key is missing from Hindi or Kannada, if the placeholders or the plural shape differ, if an entry was left in English, or if English was written straight into JSX.
5. Ask the native-speaker reviewer to look at the new Hindi and Kannada.

Changing the English wording of a key means checking its Hindi and Kannada too.

## Tests

| Test | What it checks |
| --- | --- |
| `mango-api/test/languages.test.js` | Reading and saving, validation (and the database `CHECK`), sign-in needed and own account only, 404 and nothing saved while off, the panel switch and the `false` kill switch, export and deletion. |
| `customer-app/tests/unit/i18n.unit.ts` | Hindi and Kannada have exactly the English keys, the same placeholders and plural shapes, are written in their own script; plural rules; Latin digits for money and dates. |
| `customer-app/tests/unit/i18n-literals.unit.ts` | Reads every `.tsx` file in the shop and fails on English written straight into the markup (JSX text, text attributes such as `aria-label` or `label`, literals shown from `{…}`). A short allowlist holds what is the same in every language (`+91`, MandiMangoes, arrows and separators); text marked `lang="en"` (the legal text) is skipped. A probe file proves the check catches each kind. |
| `customer-app/tests/languages.spec.ts` | A guest switches to Hindi, then Kannada, and sees the home page, a product and the cart in it (axe on each page); a signed-in customer's choice is saved to the account and follows them to a fresh browser; with the switch off the shop is English only with no control. |

All the other shop specs run in English with the switch on, unchanged.

## Owner actions

1. **Have a native Hindi speaker and a native Kannada speaker review** `customer-app/src/i18n/hi.ts` and `kn.ts` (about 1,050 entries each) before turning `SHOP_LANGUAGES` on.
2. Decide whether WhatsApp messages should follow the language later. If so, every template needs a Hindi and a Kannada version approved by Meta first; until then nothing changes.
