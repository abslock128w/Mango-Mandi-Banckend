# Partner Network

Partner With Us lets entrepreneurs, distributors, product makers, corporate buyers, creators and logistics firms anywhere in India send MandiMangoes a business enquiry. Staff review and manage those enquiries in the panel's Partner Network section.

This release covers enquiries only. There are no partner accounts, logins, dashboards, commissions or payouts. An approved product proposal never creates a shop product by itself.

- Switch: `PARTNER_NETWORK`. It is on unless the environment sets it to `false`, and managers can turn it off on the Settings page. While it is off, every route below answers 404 and the shop hides its links.
- Database: migrations `058_partner_network.sql` and `059_validate_partner_checks.sql`; `069_partner_erasure.sql` (deleting ended applications); `093_partner_short_form.sql` (the short form leaves state, country, contact preference and organisation type empty); `095_partner_close_three_categories.sql` (switches off three categories, below).
- Code:
  - `mango-api/src/partner/`: the questionnaire, enquiries, staff actions and alerts.
  - `shop/partner.js`: the shop pages.
  - `src/pages/partner/`: the panel pages.

## Who can do what

| Action | MANAGER | OPERATOR | Other roles |
|---|---|---|---|
| See the overview, enquiries, proposals and documents | yes | yes | no |
| Add notes, schedule and edit follow-ups, log contact attempts, request more information | yes | yes | no |
| Change priority, assign (to a manager or operator), move between NEW, UNDER_REVIEW, CONTACTED and NEGOTIATION | yes | yes | no |
| Approve, reject, close, reopen, convert | yes | no | no |
| Move a proposal to APPROVED, REJECTED or CLOSED | yes | no | no |
| Export CSV, edit categories | yes | no | no |

Every staff change is recorded twice:

- as an activity row on the enquiry, which staff see on its Activity tab;
- in `staff_audit`, in the same transaction.

Looking at an enquiry or downloading a document is also written to `staff_audit`, because both show applicants' personal details.

## Statuses

Enquiry statuses: NEW → UNDER_REVIEW → CONTACTED → NEGOTIATION → CONVERTED. An enquiry can also end as REJECTED or CLOSED.

| From | Allowed next |
|---|---|
| NEW | UNDER_REVIEW, CONTACTED, REJECTED\*, CLOSED\* |
| UNDER_REVIEW | CONTACTED, NEGOTIATION, REJECTED\*, CLOSED\* |
| CONTACTED | UNDER_REVIEW, NEGOTIATION, REJECTED\*, CLOSED\* |
| NEGOTIATION | CONTACTED, CONVERTED\*, REJECTED\*, CLOSED\* |
| CONVERTED | CLOSED\* |
| REJECTED, CLOSED | UNDER_REVIEW\* (reopen) |

\* Managers only, and only through the action routes (approve, reject, close, reopen, convert). These ask for a reason or title, which the PATCH route does not take.

The decision routes work like this:

- **Approve** accepts the enquiry for a business discussion. It moves to NEGOTIATION and its decision becomes APPROVED.
- **Convert** records a business opportunity (a title and notes). The enquiry becomes CONVERTED.

Proposal statuses: SUBMITTED, UNDER_EVALUATION, SAMPLE_REQUESTED, QUALITY_REVIEW, COMMERCIAL_REVIEW, APPROVED, REJECTED, CLOSED.

- Any non-final status can move to any other non-final status.
- APPROVED, REJECTED and CLOSED are for managers only, and need a reason.
- A final proposal can be moved back to UNDER_EVALUATION by a manager.

Priorities: LOW, NORMAL (the default), HIGH and URGENT.

### Where an application is (what the applicant sees)

The applicant sees four steps: **Submitted → Under review → Call / meeting → Decision**. One function maps the
record to them (`mango-api/src/partner/progress.js`, `progressOf`), and both the public status check on /partner and
the Grow with us tab of the signed-in account use it, so the same reference always shows the same step.

| Status | Step | What the shop says |
|---|---|---|
| NEW | Submitted (Under review next) | Submitted |
| UNDER_REVIEW | Under review | Under review |
| CONTACTED | Call / meeting | We have spoken to you |
| NEGOTIATION (decision APPROVED) | Call / meeting | Approved for a business discussion |
| CONVERTED | Decision | You are a partner now |
| REJECTED | Decision | Not taken forward this time |
| CLOSED | Decision | Closed |

- Each step carries the date it was last reached (from the status moves in the activity history; Submitted is the
  submission time). A reopened application is at Under review again, and the later steps lose their dates.
- A decision made without a call shows the Call / meeting step as skipped.
- A pending follow-up (a call booked by staff, not more than an hour overdue) shows on the Call / meeting step as its
  time (`callAt`), while the application has not ended.
- Nothing personal is in it: no name, number, email, place, answers, documents, notes, reasons, follow-up notes or who
  handled it.

## How long applications are kept

The Grow with us form promises this, in full before the first question and on `/partner/privacy`, in short by the
consent tick and on the "application sent" screen:

> **How we use what you tell us.** Everything you share here is used for one thing only: to decide whether we are a
> good fit to work together. We don’t share it with anyone or use it for anything else. Once your application has
> ended, we delete it within N days. If we go ahead together, we keep your contact details so we can work with you.

N is `PARTNER_RETENTION_DAYS` (default 30, at least 1), sent to the shop as `retention.days` on `GET /v1/partner-network`.
`src/partner/erase.js` keeps the promise; every deletion path goes through its `eraseEnquiry`:

- **When.** An application has ended when it is REJECTED, CLOSED or CONVERTED. The maintenance run checks every hour
  (step `partner-retention`, bounded batch, `FOR UPDATE SKIP LOCKED`, one transaction each) and deletes the details of
  ended applications whose `status_changed_at` is `PARTNER_RETENTION_DAYS` old, less one hour, so none is late. A
  reopened application starts over; it runs with `PARTNER_NETWORK` off too.
- **What goes.** The answers, the documents (rows and their Blob files), staff notes, follow-ups, the business
  opportunity, what the product proposal said (name, category, description, source, prices, capacity,
  certifications), the applicant's messages in the outbox, document file names and written reasons, titles, notes and
  messages in the activity history and in `staff_audit` (`detail.reason`, `detail.title`), and on the enquiry row: name,
  mobile, email, city, PIN code, business name, address, website, GSTIN, years operating, comments, best time to call,
  the duplicate-check hash and the upload secret.
- **What stays.** The reference, categories, state, status, decision, priority, assignment, the form version and
  consent wording, the dates, and `erased_at` (migration 069), so the counts stay honest; the activity history keeps
  what happened and when.
- **CONVERTED** means the applicant became a partner: their contact details (name, mobile, email, business name,
  address, website, city, PIN code, GSTIN) and the business opportunity stay; everything else above goes. If a
  converted partner is closed later, the contact details go `PARTNER_RETENTION_DAYS` after that.
- **Sooner.** A manager can press "Delete this application’s details now" on an ended application
  (`POST /admin/v1/partner-network/enquiries/:id/erase`, managers only, recorded in `staff_audit` as
  `ERASE partner enquiry` with the status, whether contact details were kept and the document count). The applicant
  deleting their shop account (`DELETE /v1/me`) erases every application sent from the account's number, contact
  details included, closing an open one first; `ops/erase-customer.js --phone|--email` does the same for a request by
  email or WhatsApp, even with no shop account.
- **After.** An erased application can't be changed (409 `ENQUIRY_ERASED`), except that a converted one may still be
  closed. The panel shows "Details deleted on <date>" in the list and on the page; the CSV export marks the row.
- **Backups.** Database backups (`ops/backup.sh`, `RETAIN_DAYS`, default 14) still hold deleted details until they
  age out. After a restore, the hourly step deletes ended applications again within the hour; deletions made early
  (a manager's button, the applicant's request) must be made again.

## The questionnaire

`mango-api/src/partner/questionnaire.js` is the only definition of the form. The shop draws the form from `GET /v1/partner-network`, and the API checks submissions against the same definition.

- Every answer is stored with the label and type it had when it was submitted, so an enquiry of any version reads correctly in the panel.
- Changing the form means adding a new version, never editing a live one, and pointing `CURRENT_VERSION` at it.
- `ACCEPTED_VERSIONS` lists the versions a submission may name: the current one, and older ones kept so a form opened before a switch can still be sent. A submission naming any other version is refused with 409 `QUESTIONNAIRE_CHANGED`. The shop then reloads the form and keeps the answers it can.

### Versions

**`2026-11-v2` (current): the short form.** Three steps:

| Step | Title | Questions |
|---|---|---|
| `contact` | About you | `fullName`, `mobile`, `email`, `city` (all required) |
| `proposal` | What you have in mind | `categories` (MULTI_SELECT, required), `representsBusiness` (Yes / No / Planning to start one, required), `businessName` (shown and required only for Yes or Planning), `proposal` ("Tell us your idea", TEXTAREA, 20 to 3000 characters, required) |
| `final` | Last bit | `startWhen` (RADIO, required), `documents` (optional upload, after the enquiry is saved), `consent` (required) |

- There is no main-interest question: the first ticked category is stored as the enquiry's `primary_category` (and `is_primary` on its category row).
- There are no per-category sections, so `GET /questionnaires/:category` returns the same three steps for every category, and a v2 enquiry never creates a product proposal, even with Product Development ticked. The idea is in the `proposal` answer.
- What v2 does not ask is stored as NULL on the enquiry row: `state`, `pincode`, `country`, `preferred_contact_method`, `business_type`, `callback_time`, `additional_comments`, `website`, `years_operating`, `gstin` and `business_address` (migration 093 dropped NOT NULL on the four that had it; their CHECKs still hold for any value present). No contact preference is assumed: the panel shows "—" for "Prefers" and staff choose the channel. The overview's "Enquiries by state" and the list's state filter count only enquiries that named a state.

**`2026-11-v1`: the long form.** Five steps (about you with state, PIN code, country and contact preference; your business; your proposal with a main interest and five long answers; a section per ticked category; final details). It is still accepted (`ACCEPTED_VERSIONS`) and still checked and stored exactly as before, including the product proposal its Product Development section creates. Its enquiries keep reading as they were. Take it out of `ACCEPTED_VERSIONS` to retire it; stored v1 enquiries are unaffected.

Question types are TEXT, TEXTAREA, EMAIL, PHONE, NUMBER, SELECT, MULTI_SELECT, RADIO, CHECKBOX, BOOLEAN, DATE, FILE_UPLOAD and CURRENCY.

Each question carries these fields:

- `key`, `label` and `type`;
- `required`: `true`, `false` or `"whenShown"`;
- optionally `options [{value,label}]`, `description`, `placeholder`, `min` and `max`;
- optionally `pattern` and `patternMessage`. `patternOnlyWhen {key, equals}` means the pattern only applies while that answer equals the value; the PIN code pattern applies only when the country is India;
- optionally `default`;
- optionally `showIf {key, in: [values]}`, which hides the question unless that answer is one of the values. For BOOLEAN questions the values are `true` and `false`.

Sections and categories:

- A section with `categories` applies only when one of those categories is ticked.
- A question key that appears in more than one applying section is asked once, in the first one.
- The `categories` (MULTI_SELECT) and, in v1, `primaryCategory` (RADIO) questions take their options from the active categories. `primaryCategory` must be one of the ticked categories.

## Customer API (`/v1/partner-network`, no sign-in)

### `GET /v1/partner-network`

Returns everything the form needs:

```json
{
  "version": "2026-11-v2",
  "categories": [{ "code": "SALES_DISTRIBUTION", "name": "Sales & Distribution Partners", "description": "..." }],
  "steps": [{ "key": "contact", "title": "About you", "description": "...",
              "sections": [{ "key": "personal", "title": "...", "categories": null,
                             "questions": [{ "key": "fullName", "label": "Full name", "type": "TEXT", "required": true, "min": 2, "max": 120 }] }] }],
  "documentCategories": [{ "code": "BUSINESS_PROFILE", "label": "Business profile" }],
  "uploads": { "maxFiles": 10, "maxFileBytes": 5242880, "types": ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  "consent": { "text": "I agree that ...", "privacyPath": "/partner/privacy" },
  "retention": { "days": 30, "partnersKeepContact": true },
  "captcha": { "siteKeyRequired": false, "action": "partner" }
}
```

The two endpoints the brief named also exist:

- `GET /v1/partner-network/categories` returns `{ categories }`.
- `GET /v1/partner-network/questionnaires/:category` returns the same `steps`, keeping only the sections that apply to that one category (404 for an unknown or inactive category).

### `POST /v1/partner-network/enquiries`

Sending a submission:

- **Header:** `Idempotency-Key` is required: 8 to 100 characters of letters, digits, `_` and `-`, made once per form fill.
- **Body:** `{ "questionnaireVersion": "2026-11-v2", "answers": { "<key>": value, ... }, "captchaToken"?: "..." }`.
- **Answers:** `categories` is an array of codes; in v2 the first is the primary one. `primaryCategory` (v1 only) is a code. BOOLEAN answers are `true` or `false`. NUMBER and CURRENCY answers are numbers. `consent` must be `true`.

Responses:

- **201** `{ "reference": "MMP-7K2QXD9T", "submittedAt": "...", "uploadToken": "...", "uploadExpiresAt": "..." }`.
- **200** with the same body when the same `Idempotency-Key` is sent again. The upload token is a fresh one.
- **400** `VALIDATION_ERROR` with `fields: { "<key>": "message", ... }`, which lists every problem at once.
- **409** `DUPLICATE_ENQUIRY` when the same answers arrived in the last 24 hours under another key. The body has `reference` (the earlier one).
- **409** `QUESTIONNAIRE_CHANGED` when `questionnaireVersion` is not in `ACCEPTED_VERSIONS`.
- **429** `RATE_LIMITED`, when one address sends more than 5 submissions an hour.

If Cloudflare Turnstile is configured (`TURNSTILE_SECRET_KEY`), `captchaToken` is required and is checked with action `partner`.

A notification failure never loses an enquiry:

- Messages go into the outbox in the same transaction as the enquiry.
- They are sent afterwards, and a failed send is retried and recorded in `notifications`.

### `POST /v1/partner-network/enquiries/:reference/documents?category=<CODE>&name=<filename>`

Uploads one supporting document. Call it once per file, after submitting.

- **Header:** `X-Upload-Token`, the token from the submission. It is valid for 2 hours.
- **Body:** the raw file bytes. `Content-Type` must be the file's real type.
- **Limits:** PDF, JPEG, PNG or WebP only, checked by the file's first bytes. At most 5 MB per file and 10 files per enquiry.
- **201** `{ "id", "name", "category", "size" }`.
- **400** `FILE_INVALID`.
- **413** `PAYLOAD_TOO_LARGE`.
- **409** `TOO_MANY_FILES`.
- **401** `UPLOAD_TOKEN_INVALID`, for a missing, wrong or expired token. A wrong reference answers the same, so a reference can't be probed.

### `GET /v1/partner-network/enquiries/:reference`

Returns where the application is ("Where an application is" above), or 404:

```json
{ "reference": "MMP-7K2QXD9T", "submittedAt": "…", "status": "CONTACTED", "step": "CALL", "approved": false,
  "outcome": null, "callAt": "…" | null, "updatedAt": "…", "received": true,
  "steps": [{ "key": "SUBMITTED" | "UNDER_REVIEW" | "CALL" | "DECISION", "state": "done" | "current" | "next" | "skipped", "at": "…" | null }] }
```

`outcome` is `PARTNER`, `NOT_TAKEN_FORWARD` or `CLOSED` once decided. `received` stays for older shop pages. Nothing
about who sent it or what they wrote is shown, because the reference is not a secret: it is printed on screen and
may be shared.

### `GET /v1/me/partner-enquiries` (signed-in customer)

`{ "items": [ … ] }`: the applications sent with the customer's own mobile number (`partner_enquiries.mobile_number`,
`+91` and 10 digits, compared with the account's number), newest first, at most 20, each exactly as the status check
above answers it (without `received`). An application whose details were deleted has no number left, so it is no
longer listed (its reference still answers the status check). 404 while the feature is off. The shop's account
(Grow with us tab) also lets the customer add a reference sent with another number; it is kept in that browser
(localStorage `mm-partner-refs`) and read through the status check.

## Staff API (`/admin/v1/partner-network`)

These are the shapes the panel uses.

`EnquiryRow`:

```json
{ "id", "reference", "name", "businessName", "primaryCategory": { "code", "name" }, "categories": [{ "code", "name" }],
  "city", "state", "mobile", "email", "submittedAt", "status", "priority", "assignedTo": { "id", "email" } | null }
```

`ProposalRow`:

```json
{ "id", "reference", "productName", "productCategory", "submittedBy": { "name", "enquiryId", "enquiryReference" },
  "applicantLocation", "sourceLocation", "procurementPrice", "suggestedSellingPrice", "monthlySupplyCapacity",
  "sampleAvailable", "submittedAt", "status" }
```

`procurementPrice` and `suggestedSellingPrice` are rupees as numbers, or null.

### Overview: `GET /overview`

```json
{
  "counts": { "total", "NEW", "UNDER_REVIEW", "CONTACTED", "NEGOTIATION", "CONVERTED", "REJECTED", "CLOSED", "pendingReview", "proposalsAwaiting" },
  "latest": [EnquiryRow],
  "byCategory": [{ "code", "name", "count" }],
  "byState": [{ "state", "count" }],
  "followups": { "overdue": [Followup], "upcoming": [Followup] },
  "recentlyConverted": [EnquiryRow],
  "proposalsNeedingAttention": [ProposalRow]
}
```

What the fields mean:

- `pendingReview` counts NEW and UNDER_REVIEW enquiries. `proposalsAwaiting` counts proposals that are not yet final.
- `byCategory` counts every ticked category, not just primaries.
- `followups.upcoming` holds pending follow-ups due in the next 7 days.

The `Followup` shape:

```json
{ "id", "enquiry": { "id", "reference", "name" }, "scheduledAt", "assignedTo": { "id", "email" } | null, "notes", "status": "PENDING"|"DONE"|"CANCELLED", "completedAt", "overdue": bool }
```

### Enquiries

`GET /enquiries` returns `{ items: [EnquiryRow], total, page, pageSize, staff: [{ id, email, role }], states: [..] }`.

Query parameters, all optional:

- `q`: a name, business name, phone (any format), email or reference;
- `status`: one status, or several comma-separated (`NEW,UNDER_REVIEW` is "pending review");
- `category` (any ticked category), `state`, `priority`;
- `assignedTo`: a staff id, `me` or `none`;
- `from` and `to`: submission dates, `YYYY-MM-DD` in IST;
- `sort`: `submitted` (the default), `name`, `status`, `priority`, `state` or `reference`;
- `dir`: `asc` or `desc`;
- `page`: from 1;
- `pageSize`: 10 to 100, 25 by default.

The other enquiry routes:

- `GET /enquiries/export.csv` takes the same filters, includes at most 5,000 rows, and is for managers only. The export is recorded in `staff_audit`.
- `GET /enquiries/:id` returns the detail below.
- `PATCH /enquiries/:id` takes `{ status?, priority?, assignedTo?: id | null, reason? }`. It is strict: any other key is a 400. The status must be in `allowedStatuses`; final statuses go through the action routes. It returns the detail.
- `POST /enquiries/:id/notes` takes `{ note }` (1 to 3000 characters).

Notes, follow-ups, contact attempts, information requests and the action routes all answer with the full detail.

- `POST /enquiries/:id/followups` takes `{ scheduledAt: ISO datetime, assignedTo?: id, notes? }`. It answers 409 `FOLLOWUP_EXISTS` when a pending follow-up already exists at that moment, 409 `ENQUIRY_ENDED` on a rejected or closed enquiry, and 400 when the time is in the past. Assignees must be managers or operators (400 otherwise); the default is the person scheduling it.
- `PATCH /enquiries/:id/followups/:followupId` takes `{ scheduledAt?, assignedTo?, notes?, status?: 'DONE'|'CANCELLED'|'PENDING' }`.
- `POST /enquiries/:id/contact-attempts` takes `{ channel: 'PHONE'|'WHATSAPP'|'EMAIL', note? }`. It records that staff opened a call, WhatsApp chat or email from the panel. It does not mean anything was sent or that the applicant answered.
- `POST /enquiries/:id/request-info` takes `{ channel: 'WHATSAPP'|'EMAIL'|'PHONE', message }`. It records the request; a NEW or UNDER_REVIEW enquiry moves to CONTACTED. The panel opens the WhatsApp or email link with the message, and the person sends it themselves.
- The action routes, all for managers only:
  - `POST /enquiries/:id/approve` takes `{ note? }`.
  - `POST /enquiries/:id/reject` takes `{ reason }` (5 or more characters).
  - `POST /enquiries/:id/close` takes `{ reason }` (5 or more characters).
  - `POST /enquiries/:id/reopen` takes `{ reason }` (5 or more characters).
  - `POST /enquiries/:id/convert` takes `{ title, notes? }`.

  Each returns the detail. A status that does not allow the action gives 409 `INVALID_TRANSITION`.
- `GET /enquiries/:id/documents/:documentId` streams the file:
  - It is sent with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`.
  - Images may be shown inline with `?inline=1`. PDFs are always sent as attachments.

The enquiry detail:

```json
{
  ...EnquiryRow, "pincode", "country", "preferredContact", "callbackTime", "startTimeline",
  "decision", "assignedAt", "assignedBy": { "email" } | null, "questionnaireVersion", "consent": { "text", "at" },
  "sections": [{ "key", "title", "answers": [{ "key", "label", "type", "value": "words" | null }] }],
  "documents": [{ "id", "name", "category", "categoryLabel", "mime", "size", "uploadedAt" }],
  "notes": [{ "id", "note", "author": "email", "createdAt", "about": "ENQUIRY"|"PROPOSAL" }],
  "followups": [Followup],
  "activity": [{ "id", "type", "summary", "oldValue", "newValue", "actor": "email" | null, "at" }],
  "proposal": { "id", "reference", "status" } | null,
  "opportunity": { "title", "notes", "createdAt", "createdBy" } | null,
  "allowedStatuses": ["..."], "actions": { "approve", "reject", "close", "reopen", "convert", "assign", "export" },
  "staff": [{ "id", "email", "role" }],
  "contact": { "tel": "tel:+91...", "whatsapp": "https://wa.me/91...", "mailto": "mailto:...?subject=..." }
}
```

How the detail reads:

- `sections` holds every question that was shown to the applicant, in order. An unanswered optional question has `value: null`, which the panel shows as "Not answered".
- `actions` holds booleans for the current staff member and status.
- `allowedStatuses` holds only the plain moves the PATCH route takes; final statuses go through the actions.
- `staff` lists the managers and operators an enquiry or follow-up can be assigned to.
- `notes` include the product proposal's notes, marked `about: "PROPOSAL"`.
- Activity `summary` is written in words ("Status changed: New → Under review").

### Product proposals

- `GET /product-proposals` takes `?status=&q=&page=&pageSize=`; `status` is one status, several comma-separated, or `open` (every status that is not final), and returns `{ items: [ProposalRow], total, page, pageSize }`.
- `GET /product-proposals/:id` returns the ProposalRow plus:
  - `description`, `productStage`, `supplierType`, `qualityCertifications`, `commercialAppeal`, `canManage` and `relationships`;
  - `documents` (the enquiry's files), `notes` (this proposal's), `activity`, `allowedStatuses` and `actions: { approve, reject, close }`;
  - `addsToShop: false`, as a reminder that approving adds no product;
  - `contact`, and `enquiry: { id, reference, status }`.
- `PATCH /product-proposals/:id` takes `{ status, reason? }`. The reason is required for APPROVED, REJECTED and CLOSED.
- `POST /product-proposals/:id/notes` takes `{ note }`.
- `POST /product-proposals/:id/request-sample` takes `{ note? }`. It sets SAMPLE_REQUESTED and records the request. It does not contact the applicant; staff do that.

### Categories

- `GET /categories` returns `{ categories: [{ code, name, description, active, displayOrder, enquiries }], states }`, where `states` is the list of Indian states.
- `PATCH /categories/:code` takes `{ name?, description?, active?, displayOrder? }` and returns `{ categories }`. A description is required (2 to 600 characters), and the last open category can't be switched off. It is for managers only. Codes are fixed, because the questionnaire refers to them.
- Inactive since 2026-11-24 (migration 095): Farmers & Suppliers (`FARMERS_SUPPLIERS`), Retail & Reseller Partners (`RETAIL_RESELLER`) and Other Opportunities (`OTHER`). The form no longer offers them and a new enquiry (v1 or v2) can not choose them. Their rows stay, so enquiries that chose one keep their primary and ticked categories, and the panel still names, counts and filters them. Their codes stay in `CATEGORY_CODES`, where the v1 sections name them. To offer one again, switch it on here or run `UPDATE partnership_categories SET is_active = TRUE, updated_at = now() WHERE code = '<CODE>'`.

## Messages

All messages go through the WhatsApp outbox (`notifications`). They are sent only while `WHATSAPP_PARTNER_UPDATES=true`, which needs Meta to approve two templates first:

- `PARTNER_ENQUIRY_RECEIVED` goes to the applicant (name, reference and category) when they submit with consent.
- `PARTNER_TEAM_ALERT` goes to every number in `PARTNER_ALERT_PHONES`, for:
  - a new enquiry and a new product proposal;
  - an enquiry assigned, converted or rejected;
  - a follow-up due within the hour, and a follow-up overdue.

  The message carries what happened, the reference, a short detail and a link to the panel.

Delivery details:

- The maintenance job queues the follow-up alerts. Each one goes once.
- Without the switch or the numbers, nothing is queued. The panel's Overview shows the same information.
- There is no email provider in this project, so nothing is emailed. Staff use the panel's email button, which opens their own mail app.

## Security

- Applicants need no sign-in and get no verification code. The mobile number, email and PIN code are checked for format only.
- Public submissions:
  - are rate-limited per address (5 an hour) and protected by Turnstile when it is configured;
  - accept answers only from the questionnaire;
  - never accept a status, priority, assignment or id.
- Text is stored as typed and shown by React (escaped). The CSV export prefixes cells that start with `=`, `+`, `-` or `@`.
- Documents are private:
  - The first bytes are checked against PDF, JPEG, PNG or WebP. The name is cleaned.
  - Files are stored in private Vercel Blob (or the row, locally) and served only through the staff route above.
- Notes and activity are only ever in staff responses. The applicant's status check and account list show only the step summary above.
- Logs carry the reference and enquiry id, never the name, phone or email.
