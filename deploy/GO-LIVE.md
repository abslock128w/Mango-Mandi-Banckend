# Go-live plan with dates

The proposal puts go-live on **Friday 1 January 2027**; the second architecture review counts to 6 January. This plan
finishes everything by Friday 18 December, runs a pilot from Monday 14 December, and decides go or no-go on Wednesday
30 December, so either date works. Written on 27 October 2026.

Items 4, 5 and 6 need approvals from outside companies that can take weeks, so they **start this week**. If any of them
slips past its date, go-live moves by the same amount; nothing in the code can replace them.

| # | Item | Who | Start | Done by | Lead time and notes |
|---|------|-----|-------|---------|---------------------|
| 1 | Move production to **Vercel Pro**; switch `mango-api/vercel.json` cron to every minute (`deploy/SCHEDULER.md`); watch a week of check-ins, then turn the pinger off | Client pays; team switches | 30 Oct | 6 Nov | A day. Vercel's Hobby plan is for non-commercial use |
| 2 | Move the GitHub repository into the **client's GitHub organisation**; the team keeps member access; branch protection on `main` (CI must pass, one review) | Client, with the team | 30 Oct | 6 Nov | A day. Backups (GitHub Actions) and Dependabot move with it |
| 3 | Neon production project on a paid plan with 7-day history; a staging branch | Client, with the team | 30 Oct | 6 Nov | A day (`deploy/VERCEL.md` step 1) |
| 4 | **Razorpay**: KYC for live keys; test keys on staging; run and record the test-mode scenarios (`deploy/RAZORPAY-SANDBOX.md`) | Client, then the team | 30 Oct | Test run 13 Nov; live keys 27 Nov | KYC usually takes 3 to 10 working days |
| 5 | **Meta**: business verification, the WhatsApp number, and approval of the 20 message templates | Client | 30 Oct | Verified 20 Nov; templates 4 Dec | Verification can take 1 to 3 weeks; each template 1 to 2 days, and some come back for changes |
| 6 | **Jio DLT**: entity registration, sender ID, login-code template; confirm the request format on staging | Client, then the team | 30 Oct | 27 Nov | Entity 3 to 7 working days, then a few days for sender ID and template |
| 7 | Google sign-in (published consent screen), Cloudflare Turnstile, Sentry (three projects: API, shop, panel), Vercel Blob | Client | 30 Oct | 13 Nov | A few days |
| 8 | Domains and DNS; Vercel firewall rule and preview protection; Node.js 24.x set on the shop project | Client, with the team | 6 Nov | 13 Nov | DNS can take a day to spread |
| 9 | Alerts: Sentry alert rules and cron monitor, Better Stack uptime and on-call rota with names (`docs/alerts.md`); test one alert end to end on staging | Client names people; team sets up | 13 Nov | 20 Nov | Needs item 7 |
| 10 | Backups: secrets set, a first nightly backup, a timed restore drill against the 1-hour target (`deploy/RESTORE-DRILL.md`) | Client, then the team | 13 Nov | 27 Nov | Needs items 2 and 3 |
| 11 | Seller legal details and grievance officer in the terms and on bills; a lawyer reads the privacy notice; **the client's CA confirms** the bill retention period (8 years) and the GST treatment of the bills | Client | 30 Oct | 4 Dec | Book the lawyer and the CA now |
| 12 | Native speakers check the Hindi and Kannada text | Client | 6 Nov | 4 Dec | |
| 13 | Support and maintenance agreed and signed (`deploy/SUPPORT.md`); on-call names in `deploy/VERCEL.md` | Client and team | 30 Oct | 4 Dec | |
| 14 | Decide whether photos need a second copy outside Vercel Blob | Client | 13 Nov | 4 Dec | |
| 15 | Load test on staging (`deploy/LOAD-TEST.md`); set the speed and availability targets from it | Team | 27 Nov | 11 Dec | Needs items 1, 3 and 4 |
| 16 | Pilot with friends and family on production, real payments, small amounts | Client and team | 14 Dec | 18 Dec, then watch | Needs items 1 to 13 |
| 17 | Go or no-go meeting: every item above done, a week of clean alerts, the pilot's orders delivered | Client and team | | 30 Dec | |

Already done in code: the Node 24 move (Node 22 support ends 30 April 2027, inside the season), alerts that run on
Vercel, error reports from the shop and the panel, bill-safe data cleanup, and immediate sign-out when staff are
removed or change role.
