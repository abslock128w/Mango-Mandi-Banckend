import type { StateStorage } from "zustand/middleware";

const none: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/**
 * localStorage for the persisted stores, and a no-op on the server. The stores are built when
 * their module loads, which on the server is during rendering: Node 22+ has its own
 * localStorage global there (a warning and no storage without --localstorage-file).
 */
export const browserStorage = (): StateStorage => (typeof window === "undefined" ? none : window.localStorage);
