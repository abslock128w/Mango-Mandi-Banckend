# Partner Network

Partner With Us lets entrepreneurs, farmers, suppliers, distributors, retailers, corporate buyers, creators and logistics firms anywhere in India send MandiMangoes a business enquiry. Staff review and manage those enquiries in the panel's Partner Network section.

This release covers enquiries only. There are no partner accounts, logins, dashboards, commissions or payouts. An approved product proposal never creates a shop product by itself.

- Switch: `PARTNER_NETWORK`. It is on unless the environment sets it to `false`, and managers can turn it off on the Settings page. While it is off, every route below answers 404 and the shop hides its links.
- Database: migration `052_partner_network.sql`.
- Code:
  - `mango-api/src/partner/`: the questionnaire, enquiries, staff actions and alerts.
  - `customer-app/src/pages/Partner*.tsx`: the shop pages.
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

## The questionnaire

`mango-api/src/partner/questionnaire.js` is the only definition of the form. The shop draws the form from `GET /v1/partner-network`, and the API checks submissions against the same definition.

- Every answer is stored with the label and type it had when it was submitted.
- Changing the form means adding a new version, never editing a live one.
- A submission made against an older version is refused with 409 `QUESTIONNAIRE_CHANGED`. The shop then reloads the form and keeps the answers it can.

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
- The `categories` (MULTI_SELECT) and `primaryCategory` (RADIO) questions take their options from the active categories. `primaryCategory` must be one of the ticked categories.

## Customer API (`/v1/partner-network`, no sign-in)

### `GET /v1/partner-network`

Returns everything the form needs:

```json
{
  "version": "2026-11-v1",
  "categories": [{ "code": "SALES_DISTRIBUTION", "name": "Sales & Distribution Partners", "description": "..." }],
  "steps": [{ "key": "contact", "title": "About you", "description": "...",
              "sections": [{ "key": "personal", "title": "...", "categories": null,
                             "questions": [{ "key": "fullName", "label": "Full name", "type": "TEXT", "required": true, "min": 2, "max": 120 }] }] }],
  "documentCategories": [{ "code": "BUSINESS_PROFILE", "label": "Business profile" }],
  "uploads": { "maxFiles": 10, "maxFileBytes": 5242880, "types": ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  "consent": { "text": "I agree that ...", "privacyPath": "/privacy" },
  "captcha": { "siteKeyRequired": false, "action": "partner" }
}
```

The two endpoints the brief named also exist:

- `GET /v1/partner-network/categories` returns `{ categories }`.
- `GET /v1/partner-network/questionnaires/:category` returns the same `steps`, keeping only the sections that apply to that one category (404 for an unknown or inactive category).

### `POST /v1/partner-network/enquiries`

Sending a submission:

- **Header:** `Idempotency-Key` is required: 8 to 100 characters of letters, digits, `_` and `-`, made once per form fill.
- **Body:** `{ "questionnaireVersion": "2026-11-v1", "answers": { "<key>": value, ... }, "captchaToken"?: "..." }`.
- **Answers:** `categories` is an array of codes. `primaryCategory` is a code. BOOLEAN answers are `true` or `false`. NUMBER and CURRENCY answers are numbers. `consent` must be `true`.

Responses:

- **201** `{ "reference": "MMP-7K2QXD9T", "submittedAt": "...", "uploadToken": "...", "uploadExpiresAt": "..." }`.
- **200** with the same body when the same `Idempotency-Key` is sent again. The upload token is a fresh one.
- **400** `VALIDATION_ERROR` with `fields: { "<key>": "message", ... }`, which lists every problem at once.
- **409** `DUPLICATE_ENQUIRY` when the same answers arrived in the last 24 hours under another key. The body has `reference` (the earlier one).
- **409** `QUESTIONNAIRE_CHANGED`.
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

Returns `{ "reference", "received": true }`, or 404. Nothing about the enquiry is shown, because the reference is not a secret.

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

- `q`: a name, phone (any format), email or reference;
- `status`, `category` (any ticked category), `state`, `priority`;
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
- `POST /enquiries/:id/followups` takes `{ scheduledAt: ISO datetime, assignedTo?: id, notes? }`. It answers 409 `FOLLOWUP_EXISTS` when a pending follow-up already exists at that moment, and 400 when the time is in the past.
- `PATCH /enquiries/:id/followups/:followupId` takes `{ scheduledAt?, assignedTo?, notes?, status?: 'DONE'|'CANCELLED'|'PENDING' }`.
- `POST /enquiries/:id/contact-attempts` takes `{ channel: 'PHONE'|'WHATSAPP'|'EMAIL', note? }`. It records that staff opened a call, WhatsApp chat or email from the panel. It does not mean anything was sent or that the applicant answered.
- `POST /enquiries/:id/request-info` takes `{ channel: 'WHATSAPP'|'EMAIL'|'PHONE', message }`. It records the request; a NEW or UNDER_REVIEW enquiry moves to CONTACTED. The panel opens the WhatsApp or email link with the message, and the person sends it themselves.
- The action routes, all for managers only:
  - `POST /enquiries/:id/approve` takes `{ note? }`.
  - `POST /enquiries/:id/reject` takes `{ reason }` (5 or more characters).
  - `POST /enquiries/:id/close` takes `{ reason }`.
  - `POST /enquiries/:id/reopen` takes `{ reason }`.
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
  "contact": { "tel": "tel:+91...", "whatsapp": "https://wa.me/91...", "mailto": "mailto:..." }
}
```

How the detail reads:

- `sections` holds every question that was shown to the applicant, in order. An unanswered optional question has `value: null`, which the panel shows as "Not answered".
- `actions` holds booleans for the current staff member and status.

### Product proposals

- `GET /product-proposals` takes `?status=&q=&page=&pageSize=` and returns `{ items: [ProposalRow], total, page, pageSize }`.
- `GET /product-proposals/:id` returns the ProposalRow plus:
  - `description`, `productStage`, `supplierType`, `qualityCertifications`, `commercialAppeal`, `canManage` and `relationships`;
  - `documents` (the enquiry's files), `notes` (this proposal's), `activity` and `allowedStatuses`;
  - `contact`, and `enquiry: { id, reference, status }`.
- `PATCH /product-proposals/:id` takes `{ status, reason? }`. The reason is required for APPROVED, REJECTED and CLOSED.
- `POST /product-proposals/:id/notes` takes `{ note }`.
- `POST /product-proposals/:id/request-sample` takes `{ note? }`. It sets SAMPLE_REQUESTED and records the request. It does not contact the applicant; staff do that.

### Categories

- `GET /categories` returns `[{ code, name, description, active, displayOrder, enquiries }]`.
- `PATCH /categories/:code` takes `{ name?, description?, active?, displayOrder? }`. It is for managers only. Codes are fixed, because the questionnaire refers to them.

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
- Notes and activity are only ever in staff responses.
- Logs carry the reference and enquiry id, never the name, phone or email.
