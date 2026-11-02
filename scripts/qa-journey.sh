#!/bin/bash
# Runs tests/cross-app.spec.ts: one order through the shop, the panel and the rider app, and the
# failure paths, against a QA stack of its own. Needs the local stack's Postgres (scripts/start-local.mjs
# running, port 54329). It creates the database mango_journey, builds the three apps for it, and runs
# the API on 3100 with its clock set by QA_NOW (src/clock.js's test hook, preloaded), so the delivery
# day can come. Nothing it starts touches the local stack's own database or ports.
#
#   bash scripts/qa-journey.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${QA_JOURNEY_DIR:-$ROOT/.local/journey}"
mkdir -p "$WORK"

cat > "$WORK/clock.mjs" <<CLOCK
import { setNow } from '$ROOT/mango-api/src/clock.js'
if (process.env.QA_NOW) setNow(process.env.QA_NOW)
CLOCK

cat > "$WORK/api.sh" <<API
#!/bin/bash
cd "$ROOT/mango-api"
exec env DATABASE_URL=postgres://mango:mango@localhost:54329/mango_journey PORT=3100 NODE_ENV=development COOKIE_SECURE=false \\
  ENABLE_DEV_ROUTES=true DEMO_PAYMENTS=true SEED_DEMO_DATA=true WAREHOUSE_V2=true SHOW_ERROR_DETAILS=true LOG_LEVEL=warn \\
  CUSTOMER_ORIGIN=http://localhost:3400 ADMIN_ORIGIN=http://localhost:4317 RIDER_ORIGIN=http://localhost:3410 \\
  WHATSAPP_PROVIDER=log MANGO_CHECK=shadow API_RATE_LIMIT=1000000 QA_NOW="\$1" node --import "$WORK/clock.mjs" src/index.js
API

cat > "$WORK/restart.sh" <<RESTART
#!/bin/bash
for p in \$(lsof -ti tcp:3100 -sTCP:LISTEN); do kill \$p; done
for i in \$(seq 1 30); do lsof -ti tcp:3100 -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
nohup "$WORK/api.sh" "\$1" >> "$WORK/api.log" 2>&1 &
RESTART
chmod +x "$WORK/api.sh" "$WORK/restart.sh"

echo "==> A fresh mango_journey database"
node -e "
const {Client}=require('$ROOT/mango-api/node_modules/pg');(async()=>{const c=new Client('postgres://mango:mango@localhost:54329/postgres');await c.connect();
await c.query(\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='mango_journey'\");await c.query('DROP DATABASE IF EXISTS mango_journey');
await c.query(\"CREATE DATABASE mango_journey TEMPLATE template0 ENCODING 'UTF8'\");await c.end()})()"

echo "==> Building the shop, the panel and the rider app for the QA API"
(cd "$ROOT/customer-app" && NEXT_PUBLIC_API_URL=/ SHOP_API_PROXY=http://localhost:3100 NEXT_PUBLIC_SUPPORT_WHATSAPP=919800000000 npx next build > "$WORK/shop-build.log" 2>&1) &
(cd "$ROOT/rider-app" && NEXT_DIST_DIR=.next-journey NEXT_PUBLIC_API_URL=http://localhost:3100 NEXT_PUBLIC_OPS_PHONE=+919800000001 npx next build > "$WORK/rider-build.log" 2>&1) &
(cd "$ROOT" && VITE_API_URL=http://localhost:3100 npx vite build --outDir "$WORK/panel-dist" > "$WORK/panel-build.log" 2>&1) &
wait

echo "==> Starting them"
pids=()
"$WORK/restart.sh" 2026-11-03T04:30:00Z
(cd "$ROOT/customer-app" && SHOP_API_PROXY=http://localhost:3100 exec npx next start -p 3400 > "$WORK/shop.log" 2>&1) & pids+=($!)
(cd "$ROOT/rider-app" && NEXT_DIST_DIR=.next-journey exec npx next start -p 3410 > "$WORK/rider.log" 2>&1) & pids+=($!)
(cd "$ROOT" && VITE_API_URL=http://localhost:3100 exec npx vite preview --outDir "$WORK/panel-dist" --port 4317 --strictPort > "$WORK/panel.log" 2>&1) & pids+=($!)
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; for p in $(lsof -ti tcp:3100,3400,3410,4317 -sTCP:LISTEN); do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
for i in $(seq 1 90); do
  ok=0; for u in http://localhost:3100/health http://localhost:3400 http://localhost:3410 http://localhost:4317; do curl -s -o /dev/null -m 3 "$u" && ok=$((ok+1)); done
  [ "$ok" = 4 ] && break; sleep 2
done

echo "==> The journeys"
cd "$ROOT" && CROSS_APP=1 QA_API_RESTART="$WORK/restart.sh" npx playwright test tests/cross-app.spec.ts --project=desktop --workers=1 --reporter=list
