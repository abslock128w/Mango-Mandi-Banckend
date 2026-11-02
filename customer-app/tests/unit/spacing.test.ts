import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// design/COMPONENTS.md: spacing in 4 px steps. Tailwind's half steps (1.5 = 6 px, 2.5 = 10 px,
// 3.5 = 14 px) are off the grid; 0.5 (2 px) is a hairline offset, allowed. Invisible hit areas
// (after:/before:) are not spacing. Applies to the shop and the rider app.
const UTIL = "(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|top|left|right|bottom|inset|inset-x|inset-y)";
const half = new RegExp(`(?<![\\w\\[-])((?:[a-z0-9]+:)*)-?${UTIL}-[123]\\.5(?![\\w.\\]])`, "g");

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (p.endsWith(".tsx")) yield p;
  }
}

test("shop and rider spacing is on the 4 px grid", () => {
  const root = new URL("../../..", import.meta.url).pathname;
  const found: string[] = [];
  for (const app of ["customer-app", "rider-app"]) {
    for (const dir of ["app", "features", "components"]) {
      let files: string[] = [];
      try {
        files = [...sources(join(root, app, dir))];
      } catch {
        continue;
      }
      for (const f of files) {
        for (const m of readFileSync(f, "utf8").matchAll(half)) if (!/(after|before):/.test(m[1])) found.push(`${f.slice(root.length)}: ${m[0]}`);
      }
    }
  }
  expect(found).toEqual([]);
});
