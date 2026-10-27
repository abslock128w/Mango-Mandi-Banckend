# Support and maintenance after go-live

**Status: proposal.** The client and the delivery team agree this (or change it) and sign it before go-live
(deploy/GO-LIVE.md, item 13). Until then nobody is committed to the times below. The monthly fee is agreed
separately; this page sets out who does what and how fast.

MandiMangoes sells fruit that spoils in days, and most orders arrive on weekends and in the evening. So support is
planned around the season, not office hours.

## Who does what

| Role | Who | Does |
|------|-----|------|
| Manager on duty | Client staff, one named person per day (a rota) | Checks the panel's **Needs attention** card at 09:00, 13:00 and 18:00 every day in season; uses the recovery buttons there; talks to customers |
| Developer on call | The delivery team, one named person per week, with a backup | Answers alerts, fixes code, settings and data, follows `deploy/RUNBOOKS.md` |
| Account owner | The client (two people per account) | Owns every account: GitHub, Vercel, Neon, Sentry, Better Stack, Razorpay, Meta, Jio DLT, Google Cloud, the domain. Approves anything that costs money or touches money |

The names and phone numbers go in the on-call table in `deploy/VERCEL.md`, section 8, before go-live.

## How fast

"Season" is 1 March to 31 July, plus the first four weeks after go-live. The client confirms the dates each year.

| Level | What it means | Examples | In season | Off season |
|-------|---------------|----------|-----------|------------|
| P1 | Customers cannot order or pay, or money is stuck | `/ready` failing, checkout errors, payments taken but orders not confirmed, refunds not sent for an hour, the database down | 07:00 to 22:00 IST, every day including Sunday: answer in 30 minutes and work until fixed. Overnight: the phone alert wakes the developer; answer in 2 hours | Every day: answer in 2 hours |
| P2 | One part broken, with a way round it | WhatsApp messages failing, one panel page broken, login codes slow | Same day, weekends included | Next working day |
| P3 | Small problems and requests | A wording change, a new report | Within 5 working days | Within 5 working days |

The developer tells the manager on duty when a P1 starts and when it ends, by WhatsApp.

## A stuck payment on a Sunday

1. **The alert.** Sentry sends "Payments were confirmed by polling" or a webhook warning, and the panel shows a
   webhook problem. If the API is down, Better Stack phones the developer on call.
2. **No money is lost while it waits.** Every minute the job asks Razorpay about orders still waiting for payment,
   and a payment that bought nothing is refunded in full on its own. The worst case is a delay, not a lost payment.
3. **The manager on duty** opens Needs attention and follows the item's button: **Refund this payment** for a payment
   that matches no order, **Paid back another way** when Razorpay cannot send a refund, **Send again** for a message.
   Each asks the manager to confirm it is them. They call the customer.
4. **The developer on call** answers within 30 minutes (in season), finds the cause with `deploy/RUNBOOKS.md`
   ("Payments", "Webhooks not arriving", "Stuck or failed refunds") and fixes it.
5. **Afterwards** the developer writes three lines in the incident log (what happened, the cause, what changed),
   kept in the repository's `docs/incidents/` folder.

## Regular maintenance

| How often | What | Who |
|-----------|------|-----|
| Every day in season | Needs attention at 09:00, 13:00, 18:00 | Manager on duty |
| Every week | Dependency and security updates (Dependabot pull requests), merged after CI passes | Developer |
| Every month | Check the nightly backups ran (GitHub Actions, Backup), Sentry for repeating warnings, costs of each account | Developer, with the account owner |
| Every 3 months, and before each season | Timed restore drill (`deploy/RESTORE-DRILL.md`) and a load test on staging (`deploy/LOAD-TEST.md`) | Developer |
| Once a year, after the season | Runtime upgrades. Node 24 is supported until 30 April 2028; move to the next LTS in August 2027, outside the season | Developer |
| Once a year | Rotate secrets (`deploy/RUNBOOKS.md`, "Compromised credentials") and review who has access to each account | Developer and account owner |

## What is not covered

Changes to business rules, new features and new integrations are quoted separately. Problems caused by an outside
service (Razorpay, Meta, Jio, Vercel, Neon) are worked around where possible and raised with that service; their own
fix times are theirs.
