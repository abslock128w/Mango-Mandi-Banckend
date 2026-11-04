import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Without turbopack.root, Next picks the repo root (it has several lockfiles) and every build
// warns "Next.js inferred your workspace root, but it may not be correct".
test("the shop builds from its own folder", () => {
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  expect(config).toMatch(/turbopack:\s*\{[^}]*root:\s*process\.cwd\(\)/);
});

test("the shop's and rider app's focus rings have the light halo (design/COMPONENTS.md, Focus)", () => {
  for (const app of ["customer-app", "rider-app"]) {
    const css = readFileSync(new URL(`../../../${app}/app/globals.css`, import.meta.url), "utf8");
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule, app).toMatch(/box-shadow:\s*0 0 0 2px var\(--color-surface\)/);
  }
});
