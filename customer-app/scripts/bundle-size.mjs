// First-load JS + CSS per page, gzipped (docs/design/shop-motion.md, section 6: the motion work
// must add under 6 kB to any page). Run against a production build that is being served:
//
//   ALLOW_NO_SUPPORT_WHATSAPP=1 npm run build && npx next start -p 5282 &
//   node scripts/bundle-size.mjs http://localhost:5282 > after.json
//   node scripts/bundle-size.mjs http://localhost:5282 --against before.json   (fails over 6 kB)
//
// It reads each page's HTML, collects every /_next/static script and stylesheet it references,
// and gzips the files from .next/static (level 9).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [origin = "http://localhost:3000", flag, against] = process.argv.slice(2);
const BUDGET = 6 * 1024;
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

if (flag !== "--against") {
  console.log(JSON.stringify(sizes, null, 2));
} else {
  const before = JSON.parse(readFileSync(against, "utf8"));
  let over = false;
  for (const [page, s] of Object.entries(sizes)) {
    const delta = s.total - (before[page]?.total ?? 0);
    over ||= delta > BUDGET;
    console.log(`${page.padEnd(14)} ${String(s.total).padStart(7)} B  ${delta >= 0 ? "+" : ""}${delta} B${delta > BUDGET ? "  over 6 kB" : ""}`);
  }
  process.exit(over ? 1 : 0);
}
