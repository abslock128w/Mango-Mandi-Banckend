import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Shapes on glass (docs/design/shop-motion.md, "Liquid glass", shapes): pills are capsules
// (radius = height / 2) and what sits inside them is concentric: inner radius = outer radius minus
// the padding between them, so the corners share a centre and nothing looks pinched or flared.
const app = new URL("../..", import.meta.url).pathname;
const read = (f: string) => readFileSync(join(app, f), "utf8");

/** Pixels of a Tailwind size or spacing utility: h-14 → 56, h-[60px] → 60, pl-2 → 8, rounded-[20px] → 20. */
function px(cls: string) {
  const m = /-\[(\d+)px\]$/.exec(cls) ?? /-(\d+)$/.exec(cls);
  if (!m) throw new Error(`not a pixel utility: ${cls}`);
  return cls.includes("[") ? Number(m[1]) : Number(m[1]) * 4;
}
/** The radius of a box given its classes: rounded-full is half its height, rounded-N is N × 4, rounded-[Npx] is N. */
function radius(classes: string, height: number) {
  const r = /\brounded(?:-t)?(?:-\[(\d+)px\]|-(\d+)|-(full))(?![\w-])/.exec(classes);
  if (!r) throw new Error(`no radius in: ${classes}`);
  if (r[3]) return height / 2;
  return r[1] ? Number(r[1]) : Number(r[2]) * 4;
}
/** The first className string after `mark` (an attribute or class on that element). */
function classesOf(src: string, mark: string) {
  const i = src.indexOf(mark);
  const m = i < 0 ? null : /className=\{?(?:cn\()?"([^"]*)"/.exec(src.slice(i));
  if (!m) throw new Error(`no element with ${mark}`);
  return m[1];
}

test("the cart bar is a capsule and its thumbnails and badge are concentric with it", () => {
  const src = read("features/cart/components/cart-bar.tsx");
  const bar = classesOf(src, 'data-testid="cart-bar"');
  const height = px(/\bh-(?:\[\d+px\]|\d+)(?![\w-])/.exec(bar)![0]);
  const outer = radius(bar, height);
  expect(outer, "a capsule").toBe(height / 2);
  const pad = px(/\bpl-(?:\[\d+px\]|\d+)\b/.exec(bar)![0]);
  const thumb = classesOf(src, "data-thumb");
  expect(radius(thumb, px(/\bsize-\d+\b/.exec(thumb)![0]))).toBe(outer - pad);
  // The delivery badge is a circle of (height − 2 × padding), so its radius is outer − padding too.
  const badge = /<DeliveryBadge size=\{(\d+)\}/.exec(src);
  expect(badge && Number(badge[1]) / 2).toBe(outer - pad);
});

test("a toast is a capsule and its dismiss button is concentric with it", () => {
  const src = read("features/shell/toaster.tsx");
  const toast = classesOf(src, 'role="status"');
  const height = px(/\b(?:min-)?h-(?:\[\d+px\]|\d+)(?![\w-])/.exec(toast)![0].replace("min-", ""));
  const outer = radius(toast, height);
  expect(outer).toBe(height / 2);
  const pad = px(/\bpr-(?:\[\d+px\]|\d+)\b/.exec(toast)![0]);
  const close = classesOf(src, "data-dismiss");
  expect(radius(close, px(/\bsize-\d+\b/.exec(close)![0]))).toBe(outer - pad);
});

test("the sheet's corners and its header controls are concentric", () => {
  const src = read("components/ui/drawer.tsx");
  const sheet = /"w-full (rounded-t-\[\d+px\]|rounded-t-\d+) shadow-sheet"/.exec(src);
  expect(sheet).not.toBeNull();
  const outer = radius(sheet![1], 0);
  const close = classesOf(src, "data-sheet-close");
  const pad = px(/\bpx-(?:\[\d+px\]|\d+)\b/.exec(classesOf(src, "data-sheet-head"))![0]);
  expect(radius(close, 0)).toBe(outer - pad);
});
