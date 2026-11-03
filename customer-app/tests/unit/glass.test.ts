import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Liquid glass guard rails (docs/design/shop-motion.md, "Liquid glass", perf): backdrop-filter is
// expensive, so it lives only in the .glass rules of globals.css, never in a component's classes,
// and a handful of surfaces carry it.
const app = new URL("../..", import.meta.url).pathname;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|css)$/.test(name)) yield p;
  }
}

/** Every rule of a stylesheet as [selector, body], including rules nested in at-rules. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push([m[1].trim(), m[2]]);
  return out;
}

test("backdrop-filter is declared only by .glass rules", () => {
  const css = readFileSync(join(app, "app/globals.css"), "utf8");
  const offenders = rules(css)
    .filter(([, body]) => /backdrop-filter/.test(body))
    .filter(([selector]) => !/^\.glass|^\.glass-edge|^:where\(\.glass\)|\.glass::after$/.test(selector.split(",")[0].trim()) && !/\.glass/.test(selector))
    .map(([selector]) => selector);
  expect(offenders).toEqual([]);
});

test("no component sets its own backdrop-filter", () => {
  const found: string[] = [];
  for (const dir of ["app", "components", "features"]) {
    for (const f of sources(join(app, dir))) {
      if (f.endsWith(".css")) continue;
      // Comments may explain it; code may not set it.
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/backdrop-blur|backdrop-saturate|backdropFilter|backdrop-filter/.test(src)) found.push(f.slice(app.length));
    }
  }
  expect(found).toEqual([]);
});

test("glass has every fallback: no backdrop-filter, reduced transparency, more contrast, reduced motion", () => {
  const css = readFileSync(join(app, "app/globals.css"), "utf8");
  for (const q of ["@supports not ((backdrop-filter: blur(1px))", "@media (prefers-reduced-transparency: reduce)", "@media (prefers-contrast: more)", "@media (prefers-reduced-motion: reduce)"]) {
    const i = css.indexOf(q, css.indexOf(".glass {"));
    expect(i, q).toBeGreaterThan(0);
    expect(css.slice(i, i + 1200)).toMatch(/\.glass/);
  }
});
