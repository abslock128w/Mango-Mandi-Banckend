#!/usr/bin/env bash
# Proves a backup can be restored: loads it into a scratch database, checks the
# schema is current, the key tables have rows, and the stock counters agree
# with the ledger, the orders and the labelled boxes, then drops the scratch
# database. Run it weekly and after every schema change.
#   ADMIN_URL=postgres://user:pass@host:5432/postgres ./ops/restore-check.sh backups/mango-....dump
# An encrypted dump (.gpg) is decrypted first; the private key must be in the
# local GPG keyring. KEEP_SCRATCH=1 leaves the scratch database for a look.
set -euo pipefail
dump="${1:?usage: restore-check.sh <file.dump|file.dump.gpg>}"
: "${ADMIN_URL:?set ADMIN_URL to a database the user can CREATE DATABASE from}"
start=$(date +%s)
scratch="mango_restore_check_$(date +%s)"
# Keep the connection options (?sslmode=require on Neon) when swapping the database name.
params=""
case "$ADMIN_URL" in *\?*) params="?${ADMIN_URL#*\?}" ;; esac
noparams="${ADMIN_URL%%\?*}"
target="${noparams%/*}/$scratch$params"
tmp=""
cleanup() {
  [ -n "$tmp" ] && rm -f "$tmp"
  if [ -z "${KEEP_SCRATCH:-}" ]; then psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $scratch" >/dev/null; else echo "kept $scratch"; fi
}
trap cleanup EXIT
if [[ "$dump" == *.gpg ]]; then
  tmp="$(mktemp)"
  gpg --batch --quiet --yes --output "$tmp" --decrypt "$dump"
  dump="$tmp"
fi
psql "$ADMIN_URL" -qc "CREATE DATABASE $scratch"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" "$dump"
restored=$(date +%s)
q() { psql "$target" -Atqc "$1"; }
echo "migrations: $(q "SELECT string_agg(version, ' ' ORDER BY version) FROM schema_migrations")"
for t in batches batch_lines batch_ledger orders order_items customers preorders notifications; do
  echo "$t: $(q "SELECT COUNT(*) FROM $t") rows"
done
# Every batch line's on-hand must equal the sum of its ledger rows, and held
# and committed must equal the order stock in those states.
drift=$(q "SELECT COUNT(*) FROM batch_lines l WHERE l.on_hand <> COALESCE((SELECT SUM(delta) FROM batch_ledger g
             WHERE g.batch_id = l.batch_id AND g.sku = l.sku AND g.event_type IN ('INTAKE','ADJUST','CONDEMN','RETIRE','PACK','RESTOCK')), 0)")
held=$(q "SELECT COUNT(*) FROM batch_lines l WHERE l.held <> COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.line_id = l.id AND s.state = 'held'), 0)
             OR l.committed <> COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.line_id = l.id AND s.state = 'committed'), 0)")
# The reserve buffer too, as the app's own audit (src/inventory.js auditLedger) checks it.
buffer=$(q "SELECT COUNT(*) FROM batch_lines l WHERE l.reserve_buffer <> COALESCE((SELECT SUM(delta) FROM batch_ledger g
             WHERE g.batch_id = l.batch_id AND g.sku = l.sku AND g.event_type = 'ADJUST_BUFFER'), 0)")
# Labelled boxes (WAREHOUSE_V2): a tracked line's on-hand must equal its boxes
# that can be sold off the shelf, as the box check (src/warehouse/reports.js
# reconciliation) counts them. A dump from before the warehouse tables has none.
boxes=0
if [ "$(q "SELECT to_regprocedure('box_shelf_sellable(uuid)') IS NOT NULL")" = "t" ]; then
  boxes=$(q "SELECT COUNT(*) FROM batch_lines l JOIN products p ON p.sku = l.sku JOIN batches bt ON bt.id = l.batch_id
              WHERE p.box_tracking_enabled AND bt.status NOT IN ('EXHAUSTED','CONDEMNED')
                AND l.on_hand <> (SELECT COUNT(*) FROM boxes b WHERE b.line_id = l.id AND box_shelf_sellable(b.id))")
fi
if [ "$drift" != "0" ] || [ "$held" != "0" ] || [ "$buffer" != "0" ] || [ "$boxes" != "0" ]; then
  echo "FAILED: $drift on-hand, $held held/committed, $buffer reserve-buffer and $boxes labelled-box lines disagree with their sources"; exit 1
fi
echo "restore check passed: restore $((restored - start))s, checks $(( $(date +%s) - restored ))s"
