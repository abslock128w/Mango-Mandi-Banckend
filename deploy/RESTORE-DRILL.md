# Restore drill

A restore you have never tried is a guess. The drill proves two things: that the
database can be brought back to a point in time, and that what comes back is
usable. It does not touch `main`. Run it before launch, and once a month in season.

## Targets

| | Target | Where it comes from |
|---|---|---|
| **RPO** (data you can lose) | Under a minute, for a point inside Neon's 7-day history window. Up to 24 hours when restoring from the nightly off-site copy (older mistakes, or Neon itself lost). | Neon history retention (RELEASE.md step 7), `.github/workflows/backup.yml` |
| **RTO** (time until the shop takes orders again) | 1 hour, from deciding to restore. **Not measured yet**: the owner must run the drill and write the time down below. | This drill |

Photos in Vercel Blob are not in either copy. See VERCEL.md "Backups and restore drill".

## Drill on Neon (about 15 minutes)

1. Make a branch of `main` as it was a few minutes ago: Neon console → **Branches →
   Create branch → Point in time**, or with the Neon CLI:
   ```sh
   neonctl branches create --project-id <id> --name drill-$(date +%Y%m%d) \
     --parent main --parent-timestamp "$(date -u -d '-10 min' +%FT%TZ)"
   neonctl connection-string drill-$(date +%Y%m%d) --project-id <id>
   ```
2. Run the checks against it:
   `DRILL_URL=<that connection string> ./mango-api/ops/restore-drill.sh`
3. It prints which environment the copy belongs to, the newest migration, the newest
   order and the row counts of the main tables. Then it checks that the stock books
   balance: every batch line's on-hand, held, committed and reserve-buffer figures
   must equal the ledger and the order stock they come from. Any difference fails
   the drill.
4. Write the time it took, start to finish, in the log below.
5. **Delete the branch.** It is a full copy of customer data.

## Drill on the nightly copy

Do this once a quarter, and after every schema change: it is the copy you need if
Neon itself loses the data.

1. Download the newest `mango-backup-...` artifact (GitHub → Actions → Backup) and decrypt it on your
   own computer: `gpg --decrypt mango-....dump.gpg > mango.dump`.
2. `ADMIN_URL=postgres://user:pass@host:5432/postgres ./mango-api/ops/restore-check.sh mango.dump`
   (it also takes the `.gpg` file and decrypts it itself). It loads the dump into a
   scratch database, lists the migrations, counts rows, runs the same stock checks,
   and drops the scratch database (`KEEP_SCRATCH=1` keeps it for a look).

## A real restore

The drill stops before the steps a real restore needs. Those are in VERCEL.md
"Rolling back", and none may be skipped: `ops/bump-sequences.js` (so no order or bill
number is used twice), `ops/replay-payments.js` (payments taken since the restore
point) and `ops/reapply-deletions.js` (accounts deleted since then).

## Log

| Date | Who | Kind (Neon / nightly copy) | Minutes end to end | Notes |
|---|---|---|---|---|
| | | | | |
