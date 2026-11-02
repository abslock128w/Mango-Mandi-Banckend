import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// One word for signing in across the shop: "Sign in" (and "Sign out"), as the sign-in page says.
// "Log in" and "Login" had crept into eleven places, "Login to proceed" among them.
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (p.endsWith(".tsx")) yield p;
  }
}

test("the shop says Sign in, never Log in or Login", () => {
  const root = new URL("../..", import.meta.url).pathname;
  const found: string[] = [];
  for (const dir of ["app", "features", "components"]) {
    for (const file of sources(join(root, dir))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/\bLog in\b|["'>]\s*Login\b|Login to\b/.test(line)) found.push(`${file.slice(root.length)}:${i + 1}`);
        });
    }
  }
  expect(found).toEqual([]);
});
