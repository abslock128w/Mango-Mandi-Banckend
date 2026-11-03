import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "vitest";

// Every photo in public/images arrives over its own blurred colours (components/ui/blur-image.tsx,
// styles/blur-placeholders.css). A new photo needs `npm run blur` (also run by `npm run build`).
test("every public photo has a blur placeholder", () => {
  const app = new URL("../..", import.meta.url).pathname;
  const pub = join(app, "public");
  const photos: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jpe?g|png|webp)$/i.test(name)) photos.push(`/${relative(pub, p).split(sep).join("/")}`);
    }
  })(join(pub, "images"));
  const css = readFileSync(join(app, "styles/blur-placeholders.css"), "utf8");
  const covered = [...css.matchAll(/\[data-blur="([^"]+)"\] \{\s*background-image: url\(data:image\/webp;base64,[A-Za-z0-9+/=]+\);/g)].map((m) => m[1]);
  expect(photos.length).toBeGreaterThan(0);
  expect(covered.sort()).toEqual(photos.sort());
});
