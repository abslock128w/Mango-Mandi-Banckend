import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Without turbopack.root, Next picks the repo root (it has several lockfiles) and every build
// warns "Next.js inferred your workspace root, but it may not be correct".
test("the shop builds from its own folder", () => {
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  expect(config).toMatch(/turbopack:\s*\{[^}]*root:\s*process\.cwd\(\)/);
});
