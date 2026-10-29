# WhatsApp tests and what they prove

## Levels of verification

| Level | Meaning | WhatsApp status |
|-------|---------|-----------------|
| Implemented | Code written and reviewed | All of [README.md](README.md) |
| Tested with mocks | Automated tests against a real Postgres, with Meta's Graph API and Razorpay replaced by fakes | Yes, see below |
| Verified in Meta's test environment | Run with Meta's test number and a developer app | **Not done**: needs the owner's Meta app and token |
| Verified on a real account | Run on the business number with approved templates | **Not done**: needs business verification, number, templates ([META-CHECKLIST.md](META-CHECKLIST.md)) |
| Awaiting external approval | Business verification, display name, every template, app Live mode | Yes, all of them |

The steps in [ACTIVATION.md](ACTIVATION.md) are the live verification. Until they are run and
recorded, nothing here proves that Meta accepts a given request or template.

## How to run

```sh
cd mango-api
TEST_DATABASE_URL=postgres://localhost/mango_test node --test --test-concurrency=1 \
  test/whatsapp.test.js test/whatsapp-docs.test.js test/preflight.test.js
npm test                                     # everything
cd .. && npx playwright test tests/whatsapp.spec.ts   # panel page
node mango-api/scripts/whatsapp-templates-doc.mjs --check   # TEMPLATES.md matches the code
```

Run test files one at a time against one database (`--test-concurrency=1`): two runs on the
same database interfere.

## The 15 scenarios

All in `mango-api/test/whatsapp.test.js`, "WhatsApp end to end".

| # | Scenario | Test |
|---|----------|------|
| E1 | Customer orders in the chat | E1, E3, E12 |
| E2 | Same payment event twice | E2 |
| E3 | Payment link paid, order confirmed | E1, E3, E12 |
| E4 | Forged webhook (bad or missing signature) | E4 |
| E5 | Inbound message delivered twice | E5 |
| E6 | Order status question | E6, E7 |
| E7 | Someone else's order number | E6, E7 |
| E8 | STOP, STOP OFFERS, START, shop opt-in | E8 (two tests) |
| E9 | 24-hour window closed | E9 |
| E10 | Meta rate limit / temporary error, retried | E10 |
| E11 | Timeout with no answer, not resent | E11 |
| E12 | Confirmation template sent once | E1, E3, E12 |
| E13 | Handoff to staff and back | E13 (two tests) |
| E14 | Hold expired before payment | E14 |
| E15 | Meta down | E15 |

Other tests in the same file: rules (keywords, consent classes, registry completeness, every
kind's variables match its template, signature, window, outcomes, parsing), late and
out-of-order statuses, paused templates and account events, the automation switch, template
sync with paging, the set-up page and roles, the media proxy, replay of lost webhook events,
retention and account deletion, non-Indian numbers and reactions, the waiting health check.

## Results (29 Oct 2026)

| Suite | Result |
|-------|--------|
| `test/whatsapp.test.js` | 35 / 35 pass |
| `test/whatsapp-docs.test.js` | 1 / 1 pass |
| `test/preflight.test.js` | 18 / 18 pass (includes the WhatsApp settings checks) |
| Full API suite | See the pull request for the run on the final commit |
| Panel `tests/whatsapp.spec.ts` | 8 / 8 pass (phone and desktop); full panel suite 526 pass, 14 skipped |
| `ROLLBACK.sql` | Run on a throwaway database: migrate, roll back, migrate again, all clean |

## Limits

- Meta's real responses are not tested. The fakes follow Meta's documented formats; a real
  account may differ in error codes or fields. ACTIVATION.md step 4 onward catches that.
- Template wording is only a suggestion; Meta's review decides. A variable count mismatch is
  caught by "Read templates from Meta", not by these tests.
- Hindi and Kannada chat replies are not covered (the chat bot answers in English).
- Load: no load test of the webhook at Meta's peak delivery rate.
- WhatsApp Payments (in-chat UPI) is not built; payment is by Razorpay link.
