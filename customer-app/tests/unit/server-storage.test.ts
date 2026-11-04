import { afterEach, expect, test, vi } from "vitest";

// The persisted stores load on the server while a page renders. They must not touch the
// localStorage global there (Node 22+ has one that warns and stores nothing).
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("the persisted stores never read localStorage on the server", async () => {
  const reads = vi.fn();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => (reads(), undefined) });
  try {
    await import("@/features/cart/store");
    await import("@/features/location/store");
    await import("@/features/shell/ui-store");
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
  expect(reads).not.toHaveBeenCalled();
});
