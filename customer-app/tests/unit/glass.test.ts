import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// docs/design/shop-motion.md, "Glass": backdrop-filter is expensive, so it lives in the .glass
// recipe (globals.css) and nowhere else: not in another stylesheet, not as a Tailwind
// backdrop-blur-* class, not inline. At most four surfaces blur at once (header, cart bar, a
// sheet's head, a toast; the listing's chip row gives its blur up under a sheet).

function* files(dir: string, ext: RegExp): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p, ext);
    else if (ext.test(name)) yield p;
  }
}

const app = new URL("../..", import.meta.url).pathname;

/** Every declaration block that writes backdrop-filter, with the selector that owns it. */
function backdropRules(css: string) {
  const out: { selector: string }[] = [];
  const stack: string[] = [];
  let text = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      stack.push(text.trim());
      text = "";
    } else if (ch === "}") {
      if (/(^|[^-\w])backdrop-filter\s*:/.test(text)) out.push({ selector: stack[stack.length - 1] ?? "" });
      stack.pop();
      text = "";
    } else if (ch === ";") {
      if (/(^|[^-\w])backdrop-filter\s*:/.test(text)) out.push({ selector: stack[stack.length - 1] ?? "" });
      text = "";
    } else text += ch;
  }
  return out;
}

test("backdrop-filter is written only by the .glass recipe", () => {
  const offenders: string[] = [];
  for (const f of files(join(app, "app"), /\.css$/)) {
    for (const r of backdropRules(readFileSync(f, "utf8"))) {
      if (!/\.glass(?![\w])/.test(r.selector)) offenders.push(`${relative(app, f)}: ${r.selector}`);
    }
  }
  for (const f of files(join(app, "styles"), /\.css$/)) {
    for (const r of backdropRules(readFileSync(f, "utf8"))) offenders.push(`${relative(app, f)}: ${r.selector}`);
  }
  expect(offenders).toEqual([]);
});

test("no component blurs its backdrop on its own", () => {
  const found: string[] = [];
  for (const dir of ["app", "components", "features"]) {
    for (const f of files(join(app, dir), /\.tsx?$/)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/backdrop-blur|backdropFilter|backdrop-filter/g)) found.push(`${relative(app, f)}: ${m[0]}`);
    }
  }
  expect(found).toEqual([]);
});

test("the glass recipe has its fallbacks", () => {
  const css = readFileSync(join(app, "app/globals.css"), "utf8");
  expect(css).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)/);
  expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
});
