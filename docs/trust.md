# Trust pack: bills, customer profiles, CSV exports

Three features for MandiMangoes, each behind its own switch:

| Feature | What it does | Who | Switch |
| --- | --- | --- | --- |
| **C1 Bills** | A numbered bill (PDF) for every paid order. Optional business name and GSTIN at checkout. | The customer (their own orders), MANAGER, OPERATOR | `BILLS_ENABLED` |
| **S1 Customer profile** | `/customers` (search by phone) and `/customers/:id` in the panel. | MANAGER, OPERATOR | `CUSTOMER_PROFILES_ENABLED` |
| **S5 CSV exports** | Seven streamed CSV files over a date range. | MANAGER | `STAFF_EXPORTS_ENABLED` |

Each switch is **on outside production** and **off in production** until it is set to `true`. You can turn each one off on its own. While a switch is off:

- its routes answer 404;
- the panel hides its links, cards and buttons (`/auth/me` returns `features`);
- the shop hides the business fields and the bill card (`/v1/policy` and the quote return `bills`).

All settings are read in `mango-api/src/trust-config.js`. They are listed in `mango-api/.env.example`.

## C1 Bills

### Which document? (research)

Fresh mangoes are **exempt** from GST.

- HSN 0804 ("Dates, figs, pineapples, avocados, guavas, mangoes … fresh or dried") is S. No. 51 of the exempt list in Notification 2/2017-Central Tax (Rate), 28 June 2017. That entry covers fresh fruit. Dried mangoes moved to a taxed entry, and we sell no dry fruit. Source: gstcouncil.gov.in, `sites/default/files/2024-05/download_5.pdf`.

What the law then requires (CGST Act, CBIC consolidated text `CGST-Act-Updated-31082021.pdf`, and the GST Council's flyer on tax invoices):

- **Not registered.** CGST Act s.23(1)(a): someone who supplies only goods that are wholly exempt is not liable to register. An unregistered seller may not issue a tax invoice or collect GST. The bill is a plain **Receipt** with no GST lines.
- **Registered, everything exempt.** CGST Act s.31(3)(c): a registered person supplying exempt goods issues a **Bill of Supply**, not a tax invoice. CGST Rules rule 49 lists what it must show:
  - the supplier's name, address and GSTIN;
  - a serial number of at most 16 characters, unique for the financial year;
  - the date;
  - the recipient's name and address, and their GSTIN (or UIN) if registered;
  - HSN, description, value;
  - a signature or digital signature, which a proviso says is not needed for an electronic bill of supply (so the PDF says it needs none).

  Rule 49 was read on CBIC's own tax information portal: `taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule49_v1.00.html` (the consolidated rules are also at `cbic-gst.gov.in/pdf/24092021-CGST-Rules-2017-Part-A-Rules.pdf`). Its provisos apply rule 46's provisos to bills of supply "with necessary modifications".
- **Delivery charge.** Fruit delivered with a delivery charge is a *composite supply* (s.2(30)). The fruit is the principal supply, and s.8(a) taxes the whole as the principal supply. So the delivery charge is exempt with the fruit. The bill says so.
- **Tax charged.** Only when tax is charged on every line is the bill a **Tax Invoice** (rule 46). With some lines taxed and some not, it is an **Invoice-cum-Bill of Supply** (rule 46A).
  - The code supports both through each product's existing `hsn_code` and `gst_rate`. Prices are GST-inclusive, so the tax is worked out of them per line.
  - Every product sold today is exempt, so **no MandiMangoes bill says "Tax Invoice"**.
- **E-invoicing (IRN)** applies to tax invoices of businesses above the turnover threshold. It does not apply to bills of supply. Nothing was built for it.

How the code picks the document (`composeBill` in `mango-api/src/bills.js`):

| Seller GSTIN set? | Lines | Title |
| --- | --- | --- |
| no | any | **Receipt** |
| yes | all exempt | **Bill of Supply** |
| yes | all taxed | Tax Invoice |
| yes | mixed | Invoice-cum-Bill of Supply |

### Seller settings

| Env var | Required | Notes |
| --- | --- | --- |
| `BILL_SELLER_LEGAL_NAME` | in production with bills on | Printed at the top. |
| `BILL_SELLER_ADDRESS` | in production with bills on | Lines separated by `\|`. |
| `BILL_SELLER_STATE_CODE` | in production with bills on | Two digits, e.g. `29` (Karnataka). Prints the place of supply. |
| `BILL_SELLER_GSTIN` | no | Only once registered. Checked by format, state code and check character. An invalid one stops a production start and is never printed. |
| `BILL_SELLER_CONTACT` | no | One line under the seller. |
| `BILL_NUMBER_PREFIX` | no | 1–3 letters or digits, default `MM`. |

- **Preflight.** In production with `BILLS_ENABLED=true`, the start stops if the name, address or state code is missing. Without a GSTIN, preflight only warns: the bills are Receipts.
- **Outside production.** A placeholder seller ("MandiMangoes, Bengaluru", state 29) is used, and every bill says *"Sample bill: the seller details are placeholders"*. `scripts/start-local.mjs` needs no new flags: the switches are on outside production. It may set the `BILL_SELLER_*` values to show real seller details.

### Numbering

- The format is `MM/26-27/000001`: prefix, financial year (April–March, by the IST date of payment), and a 6-digit sequence. That is 15 characters, within rule 49's limit of 16.
- **One gapless sequence per financial year.**
  - The table `bill_counters(fy, last_no)` is advanced by `INSERT … ON CONFLICT DO UPDATE SET last_no = last_no + 1`.
  - That statement runs inside the transaction that marks the order paid, so the counter row stays locked until that transaction commits.
  - A rolled-back payment hands its number back. Two payments can never share a number.
  - `bills` has `UNIQUE(order_id)`, `UNIQUE(number)` and `UNIQUE(fy, seq)`.
- **When.** A number is assigned when the order becomes paid and confirmed:
  - In the payment path (`processPayment`, both the webhook and the verify call), under a SAVEPOINT. A bill problem never undoes a payment: it is logged, and the maintenance step `bills` (`issueMissingBills`) issues the bill a minute later.
  - The same step issues bills for preorders converted to orders (the conversion runs earlier in the same maintenance run).
  - **Which orders the step looks at.** Every paid order placed, or paid, since bills were first switched on, less 7 days (`BILL_CATCH_UP_DAYS`). The moment bills were first switched on is written once, by the first maintenance run with bills on, to the one-row table `bills_started`, and never moves. So an order whose bill keeps failing never ages out: the step keeps failing until it is billed. Orders paid more than 7 days *before* bills were first switched on are not billed (no back-filling of old orders into the new number series).
  - If that step keeps failing, it shows on **Needs attention** as "Issuing bills for paid orders".
- **No bill** for an unpaid order, a ₹0 order, or a free replacement. A replacement keeps the original order's bill. Replacements are the only remedy apart from the two refund cases.
- **Bulk Deals orders** are billed like any other order. A line says `(Bulk Deal: <title>)` and shows the tier price.
- **Tests.** `mango-api/test/bills.test.js` proves the numbering:
  - 12 concurrent payments plus replayed webhooks give numbers 1–12 with no gaps or duplicates;
  - direct concurrent `issueBill` calls, with a rollback;
  - the financial-year boundary on the IST date (31 March 23:59 IST vs 1 April 00:00 IST).

### Snapshot and immutability

When the number is assigned, everything printed is copied into `bills.snapshot` (JSONB):

- the seller;
- the lines, with HSN, quantity, price and discount share;
- the delivery charge, the totals and the notes;
- the buyer's business name and GSTIN.

The buyer's name and delivery address are copied into `bill.buyer_name` and `bill.buyer_address`. The PDF is drawn from the snapshot every time, so later edits to the order, product, promo or seller settings never change an issued bill. The test checks that the PDF is byte-identical after such edits.

The database trigger `bills_keep_issued` refuses any UPDATE or DELETE of an issued bill. A statement trigger, `bills_no_truncate`, refuses `TRUNCATE` of `bills` and of `bill_counters` (row triggers do not fire on TRUNCATE, and `TRUNCATE orders CASCADE` would otherwise wipe every bill). The allowed changes are:

- **Marking it cancelled, once** (`cancelled_at`, `cancel_reason`). A cancelled order (a customer's own cancel before packing, or a manager cancelling an undeliverable order) keeps its bill and number. The PDF then reads *"CANCELLED on <date>: the order was cancelled by the buyer."* or *"… cancelled by the shop."*, then *"This bill stays on record with its number."* Only those two fixed wordings are ever stored or printed (`BILL_CANCELLED_BY`). The reason a manager types stays on the order's history in the panel and never reaches a bill, because the customer downloads it.
- **Removing the consumer's name and address** (`buyer_removed_at`). This happens on account deletion (`privacy.js`) and after `PII_RETENTION_MONTHS` (`retention.js`). The number, date, lines, amounts and any business name and GSTIN stay for the books.

The snapshot holds no delivery day and the PDF prints none: the day can still move after payment (a reschedule before packing), and the bill never changes.

**Catching up (`reconcileBills`, part of the maintenance step `bills`).** A release without bills code (for example a rollback running on this schema) can cancel an order, delete an account or run retention without touching the bills. Each maintenance run therefore marks cancelled every bill whose order is `CANCELLED` (by the buyer when `customer_cancelled_at` is set, otherwise by the shop, dated by the order's last cancel event), and removes the buyer's name and address from every bill whose order has `pii_removed_at` set or whose customer is deleted. It is idempotent and logs a warning with the counts when it changes anything.

### Business details at checkout

The checkout has a box: *"Buying for a business? Add its name and GSTIN to the bill"*. When it is ticked, the shop asks for:

- the business name (2–100 characters);
- the GSTIN.

The shop checks the GSTIN for a fast message (`customer-app/src/gstin.ts`). **The API checks again on confirm** (`mango-api/src/gstin.js`):

- 15 characters;
- a valid state code;
- the PAN shape;
- the check character (base-36 Luhn, mod 36).

An invalid GSTIN is answered `400 VALIDATION_ERROR` with a message saying what is wrong. With bills off, sending business details is `400 BILLS_OFF`. The details are stored on `orders.buyer_business_name` and `orders.buyer_gstin`, and the review step shows them under "Bill to".

### Downloads

| Who | Route | Notes |
| --- | --- | --- |
| Customer | `GET /v1/orders/:id/bill` | Only the order's owner. Anyone else gets 404, like the other order routes (security-readiness isolation case). `BILL_NOT_ISSUED` (404) before payment. |
| MANAGER, OPERATOR | `GET /admin/v1/orders/:id/bill` | Each download is written to `staff_audit` as `DOWNLOAD bill` with the bill number. Packers never see bills (`redactForPacker`). |

- The file is named `MandiMangoes-bill-MM-26-27-000001.pdf`.
- The shop shows a "Your bill" card on the order page with "Download bill (PDF)".
- The panel shows a "Bill" card on order detail.
- **PDF.**
  - Written by hand with no library (`mango-api/src/bill-pdf.js`): A4, the built-in Helvetica, amounts as `Rs. 1,899.00`, because Helvetica's WinAnsi encoding has no ₹.
  - Long orders run over several pages, each marked "Page i of n".
  - Tests read the PDFs back with `pdftotext`.

## S1 Customer profile

- **Search.** `POST /admin/v1/customers/search {phone}` takes the full 10-digit number, with spaces, `+91` or `0` allowed.
  - The API tidies the number. It never searches by partial number, so staff cannot fish through numbers.
  - Audited as `SEARCH customers by phone`. The detail holds only the last 4 digits and the match count.
- **Profile.** `GET /admin/v1/customers/:id`, audited as `VIEW customer profile`. It shows:
  - lifetime spend (paid, not refunded), paid orders, and first and last order;
  - average rating and claims;
  - contact details, masked;
  - consent: privacy notice accepted, WhatsApp reminders, back-in-stock alerts, sign-in method, open preorders;
  - saved addresses;
  - claims, with links to replacements;
  - reviews and ratings;
  - orders, up to 200, each with its bill number and any business.
- **Phone and email** are masked: `******3210` and `a*****@example.com`. "Show full number and email" calls `POST /admin/v1/customers/:id/reveal`, audited as `REVEAL customer phone and email`.
- **Audit before data.** Every audit row is written *before* the answer is sent (`auditNow`). If the audit write fails, the request fails (500) and no customer data leaves.
- **Never from a cache.** The panel fetches the profile on every opening (no React Query cache for it), so coming back to a profile from an order is a new view, audited again.
- **Ways in:**
  - the "Customer profile" link on order detail;
  - the claims list;
  - the reviews list;
  - the phone search under Customers → "Find a customer".
- MANAGER and OPERATOR only. Other roles get 403, and packers never see the links.

## S5 CSV exports

`GET /admin/v1/exports/:kind?from=YYYY-MM-DD&to=YYYY-MM-DD[&by=placed|delivery]`, MANAGER only.

| Kind | Rows | By |
| --- | --- | --- |
| `orders` | one per order: totals, payment, refund, bill number, business | placed or delivery date |
| `order-lines` | one per line: SKU, ripeness, qty, price, Bulk Deal | placed or delivery date |
| `bulk-orders` | lines sold as Bulk Deals | placed or delivery date |
| `claims` | one per claim and its resolution | claim date |
| `reviews` | one per review: ratings, status | review date |
| `payments` | captured payments | payment date (the order's confirmation, however long after it was placed) |
| `refunds` | refunds requested or paid (the two allowed cases) | refund date |

- **Ranges.** Both ends are counted, IST days, **at most 92 days** (`EXPORT_MAX_DAYS`). A longer range is `400 RANGE_TOO_LONG`. The panel disables the button and says why first.
- **Streaming.** The file is written while it is read, 1,000 rows per keyset page on `(sort_at, sort_id)`. A big export never sits in memory, and rows cannot be skipped or repeated between pages.
- **Formula injection.** Every cell goes through the warehouse `csvCell`. A value starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`, and every cell is quoted.
- **No phone numbers or addresses.** Customers appear by `customer_id`; their profile has the rest, behind the audit.
- **Audit.** `EXPORT <kind>` is written before the first byte. When the stream ends it is updated with the row count and whether it finished.
- **Panel.** Each page has a "Download as CSV" card:
  - Orders: orders, order lines;
  - Claims;
  - Reviews;
  - Bulk Deals: Bulk Deals orders;
  - Analytics: payments, refunds.

## Database

The only migration is `mango-api/migrations/035_trust.sql`. It is additive, and the previous release never reads it. It adds:

- `orders.buyer_business_name` and `orders.buyer_gstin`, nullable;
- the tables `bill_counters`, `bills` and `bills_started` (one row: when bills were first switched on);
- the triggers `bills_keep_issued` (rows) and `bills_no_truncate` (on `bills` and `bill_counters`).

The profile and exports read existing tables. They need no schema.

## Limits

- No credit notes or debit notes. A cancelled order's bill stays, marked cancelled.
- The bill gives no place-of-supply rule beyond the seller's state. The shop delivers only inside it.
- The profile lists at most 200 orders, and says how many there are in all.
- Exports cover at most 92 days per file.
- No WhatsApp message carries the bill. The customer downloads it from the order page.

## Owner decisions

1. **Credit notes.** Should a cancelled or refunded paid order get a credit note (with its own number series), or is the cancelled mark on the bill enough? A registered seller of exempt goods has no tax to reverse. Your accountant may still want credit notes for the books.
2. **GST registration.** Set `BILL_SELLER_LEGAL_NAME`, `BILL_SELLER_ADDRESS` and `BILL_SELLER_STATE_CODE` before switching `BILLS_ENABLED=true` in production. Set `BILL_SELLER_GSTIN` only if registered: the bills then become Bills of Supply.
3. **WhatsApp.** No template was added. To send the bill link in the order-confirmed message, a new or changed template must be approved by Meta first. That is an owner step.
4. **Gift orders.** The bill prints the delivery address. On a gift order, that is the recipient's address. Is that wanted, or should a gift bill omit the address?
5. **Turning on in production.** Each switch is separate: `BILLS_ENABLED`, `CUSTOMER_PROFILES_ENABLED`, `STAFF_EXPORTS_ENABLED`.

## Tests

| What | Where |
| --- | --- |
| API | `mango-api/test/bills.test.js` (22), `mango-api/test/trust-staff.test.js` (10), the security-readiness isolation case for the bill route |
| Fixtures | role policy and route inventory: additions only |
| Unit | `tests/unit/export-range.unit.ts`, `customer-app/tests/unit/gstin.unit.ts` |
| Panel, mock API | `tests/trust.spec.ts`: roles, flags, masked phone and reveal, export range, phone width, axe |
| Shop and panel, real API | `customer-app/tests/trust.spec.ts` (the phone project at 375px): GSTIN at checkout (a typo, then a valid one), test payment, shop bill download read with `pdftotext`, someone else's bill gives 404, panel bill download, profile, reveal, orders CSV, audit rows, axe, no sideways scroll |
