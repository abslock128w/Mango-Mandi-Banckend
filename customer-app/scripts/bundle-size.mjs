// First-load JS + CSS per page, gzipped (docs/design/shop-motion.md, section 6: the motion work
// must add under 6 kB to any page). Run against a production build that is being served:
//
//   ALLOW_NO_SUPPORT_WHATSAPP=1 npm run build && npx next start -p 5282 &
//   node scripts/bundle-size.mjs http://localhost:5282 > after.json
//   node scripts/bundle-size.mjs http://localhost:5282 --against before.json   (fails over 6 kB)
//
// It reads each page's HTML, collects every /_next/static script and stylesheet it references,
// and gzips the files from .next/static (level 9).
//
// The mango splash (features/orders/components/mango-splash.tsx) loads as its own chunk with the
// order-success view; it has its own budget, 8 kB gzipped, checked on every run from .next/static.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [origin = "http://localhost:3000", flag, against] = process.argv.slice(2);
const BUDGET = 6 * 1024;
const SPLASH_BUDGET = 8 * 1024;
const PAGES = ["/", "/c/all", "/p/alphonso", "/search", "/login", "/checkout", "/orders", "/help"];

const sizes = {};
for (const page of PAGES) {
  const html = await (await fetch(origin + page)).text();
  const files = new Set([...html.matchAll(/\/_next\/static\/[^"'\s)]+\.(?:js|css)/g)].map((m) => decodeURIComponent(m[0])));
  let js = 0;
  let css = 0;
  for (const f of files) {
    const file = path.join(root, ".next", f.replace("/_next/", ""));
    if (!existsSync(file)) continue;
    const gz = gzipSync(readFileSync(file), { level: 9 }).length;
    if (f.endsWith(".css")) css += gz;
    else js += gz;
  }
  sizes[page] = { js, css, total: js + css };
}

// The splash chunk: the one client chunk that carries its test id.
const chunks = path.join(root, ".next/static/chunks");
const splash = readdirSync(chunks)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ f, src: readFileSync(path.join(chunks, f)) }))
  .filter(({ src }) => src.includes("mango-splash"));
const splashGz = splash.reduce((n, { src }) => n + gzipSync(src, { level: 9 }).length, 0);
const splashOver = splash.length === 0 || splashGz > SPLASH_BUDGET;
console.error(`splash chunk ${splash.map((s) => s.f).join(", ") || "not found"}: ${splashGz} B gzipped (budget ${SPLASH_BUDGET} B)${splashOver ? "  OVER" : ""}`);

if (flag !== "--against") {
  console.log(JSON.stringify({ ...sizes, splash: { js: splashGz, css: 0, total: splashGz } }, null, 2));
  process.exit(splashOver ? 1 : 0);
} else {
  const before = JSON.parse(readFileSync(against, "utf8"));
  let over = false;
  for (const [page, s] of Object.entries(sizes)) {
    if (page === "splash") continue;
    const delta = s.total - (before[page]?.total ?? 0);
    over ||= delta > BUDGET;
    console.log(`${page.padEnd(14)} ${String(s.total).padStart(7)} B  ${delta >= 0 ? "+" : ""}${delta} B${delta > BUDGET ? "  over 6 kB" : ""}`);
  }
  process.exit(over || splashOver ? 1 : 0);
}
