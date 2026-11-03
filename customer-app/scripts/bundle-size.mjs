// First-load JS + CSS per page, gzipped (docs/design/shop-motion.md, section 6: the motion work
// must add under 6 kB to any page), plus two lines of their own ("Liquid glass", "Mango splash"):
// the glass script (the three hooks, minified; its CSS rules in the built stylesheet are counted
// in every page and printed beside it) must stay under 1.5 kB gzipped and the splash (the
// component's lazy chunk and its CSS rules) under 9 kB.
// Run against a production build that is being served:
//
//   ALLOW_NO_SUPPORT_WHATSAPP=1 npm run build && npx next start -p 5282 &
//   node scripts/bundle-size.mjs http://localhost:5282 > after.json
//   node scripts/bundle-size.mjs http://localhost:5282 --against before.json   (fails over 6 kB)
//
// It reads each page's HTML, collects every /_next/static script and stylesheet it references,
// and gzips the files from .next/static (level 9).
import { transformSync } from "esbuild";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [origin = "http://localhost:3000", flag, against] = process.argv.slice(2);
const BUDGET = 6 * 1024;
const GLASS_BUDGET = 1.5 * 1024;
const SPLASH_BUDGET = 9 * 1024;
const PAGES = ["/", "/c/all", "/p/alphonso", "/search", "/login", "/checkout", "/orders", "/help"];
const gz = (s) => gzipSync(s, { level: 9 }).length;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
/** The rules of the built stylesheets whose selector matches `selector` (the minified CSS, so one line). */
function cssRules(selector) {
  let out = "";
  for (const f of walk(path.join(root, ".next/static"))) {
    if (!f.endsWith(".css")) continue;
    const css = readFileSync(f, "utf8");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (selector.test(m[1])) out += `${m[1].trim()}{${m[2]}}`;
  }
  return out;
}
const minified = (files) => files.map((f) => transformSync(readFileSync(path.join(root, f), "utf8"), { loader: "tsx", minify: true, jsx: "automatic" }).code).join("");
/** The lazy chunk that holds `marker`, gzipped. */
function chunkWith(marker) {
  for (const f of walk(path.join(root, ".next/static/chunks"))) if (f.endsWith(".js") && readFileSync(f, "utf8").includes(marker)) return gz(readFileSync(f));
  return 0;
}
const glass = gz(minified(["lib/hooks/use-backdrop-tone.ts", "lib/hooks/use-stuck.ts", "components/ui/glass-press.tsx"]));
const glassCss = gz(cssRules(/\.glass/));
const splash = chunkWith("data-splash") + gz(cssRules(/\.splash/));

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
  console.log(JSON.stringify({ ...sizes, glass, glassCss, splash }, null, 2));
} else {
  const before = JSON.parse(readFileSync(against, "utf8"));
  let over = false;
  for (const [page, s] of Object.entries(sizes)) {
    const delta = s.total - (before[page]?.total ?? 0);
    over ||= delta > BUDGET;
    console.log(`${page.padEnd(14)} ${String(s.total).padStart(7)} B  ${delta >= 0 ? "+" : ""}${delta} B${delta > BUDGET ? "  over 6 kB" : ""}`);
  }
  over ||= glass > GLASS_BUDGET || splash > SPLASH_BUDGET;
  console.log(`${"glass".padEnd(14)} ${String(glass).padStart(7)} B  of ${GLASS_BUDGET} B${glass > GLASS_BUDGET ? "  over 1.5 kB" : ""}  (+ ${glassCss} B of CSS, in every page above)`);
  console.log(`${"splash".padEnd(14)} ${String(splash).padStart(7)} B  of ${SPLASH_BUDGET} B${splash > SPLASH_BUDGET ? "  over 9 kB" : ""}`);
  process.exit(over ? 1 : 0);
}
