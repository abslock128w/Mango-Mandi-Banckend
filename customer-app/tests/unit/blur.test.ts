import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "vitest";
import { blurFor, blurredImages } from "@/lib/blur-placeholders";

// Every photo in public/images arrives over its own blurred colours (components/ui/blur-image.tsx).
// A new photo needs `npm run blur` (also run by `npm run build`).
test("every public photo has a blur placeholder", () => {
  const pub = new URL("../../public", import.meta.url).pathname;
  const photos: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jpe?g|png|webp)$/i.test(name)) photos.push(`/${relative(pub, p).split(sep).join("/")}`);
    }
  })(join(pub, "images"));
  expect(photos.length).toBeGreaterThan(0);
  expect(photos.filter((p) => !blurFor(p))).toEqual([]);
  expect(blurredImages().sort()).toEqual(photos.sort());
  for (const p of photos) expect(blurFor(p)).toMatch(/^data:image\/webp;base64,/);
});
