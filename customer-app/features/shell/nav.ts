"use client";

/*
 * Which way a navigation goes, for the page transitions in globals.css (docs/design/shop-motion.md,
 * "Page transitions"). Sets html[data-nav] to forward | back | present | dismiss as each navigation
 * starts; the ::view-transition rules read it when React runs the page's <ViewTransition>.
 * - Flow pages (checkout, account, orders, sign-in, location) present from the bottom over the shop
 *   and dismiss downwards, like an iOS modal.
 * - Everything else slides: forward in from the right, back the exact reverse.
 * Direction comes from the Navigation API (push, or a traverse to an earlier or later entry); where
 * it is missing, any popstate counts as back. A back arrow that pushes a fixed href calls markBack().
 *
 * The browser's own back and forward (and the iOS/Android back swipe, which draw their own
 * animation) are not animated by the app: Next.js restores those pages outside a React transition.
 * The app's back arrows use animatedBack(), which snapshots the page, goes back and animates the
 * whole page (html[data-vt="root"]).
 */
export type NavKind = "forward" | "back" | "present" | "dismiss";

const FLOW = /^\/(checkout|account|orders|order|login|location)(\/|$)/;
export const isFlow = (path: string) => FLOW.test(path);

export function navKind(from: string, to: string, back: boolean): NavKind {
  // Order placed: the confirmation presents over checkout like a modal, whatever came before.
  if (/^\/order\/[^/]+\/success$/.test(to) && !back) return "present";
  const a = isFlow(from);
  const b = isFlow(to);
  if (!a && b) return "present";
  if (a && !b) return "dismiss";
  return back ? "back" : "forward";
}

type NavEvent = Event & { navigationType: string; destination: { url: string; index: number } };
type NavigationLike = EventTarget & { currentEntry: { index: number } | null };

let backIntent = false;
/** The next navigation is a step back up the hierarchy, even though it pushes (a back arrow with an href). */
export const markBack = () => {
  backIntent = true;
};

let pathWaiter: (() => void) | null = null;
// PageTransition says when the new path has committed (an event, so it need not import this file).
const PATH_COMMITTED = "mm:path";
if (typeof window !== "undefined")
  window.addEventListener(PATH_COMMITTED, () => {
    pathWaiter?.();
    pathWaiter = null;
  });

type DocWithVT = Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };
type NavigationEntries = { entries?: () => { url: string | null }[]; currentEntry: { index: number } | null };

/**
 * history.back() with the page transition: snapshot the page as it is, go back, and let the CSS
 * animate the whole page (back, or dismiss when leaving a flow page). Falls back to a plain back.
 */
export function animatedBack(back: () => void) {
  const doc = document as DocWithVT;
  const nav = (window as unknown as { navigation?: NavigationEntries }).navigation;
  const index = nav?.currentEntry?.index ?? -1;
  const prev = index > 0 ? nav?.entries?.()[index - 1]?.url : null;
  if (!doc.startViewTransition || !prev) {
    back();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = navKind(window.location.pathname, new URL(prev).pathname, true);
  root.dataset.vt = "root";
  const t = doc.startViewTransition(
    () =>
      new Promise<void>((done) => {
        pathWaiter = done;
        // Never hold the screen for long if the page is slow to come back.
        window.setTimeout(done, 500);
        back();
      }),
  );
  t.finished.finally(() => delete root.dataset.vt);
}

let installed = false;
export function installNavDirection() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const root = document.documentElement;
  const set = (to: string, back: boolean) => {
    const from = window.location.pathname;
    const intent = backIntent;
    backIntent = false;
    if (from === to) return; // the product sheet and filters change the query only
    root.dataset.nav = navKind(from, to, back || intent);
  };
  const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
  if (navigation) {
    navigation.addEventListener("navigate", (e) => {
      const ev = e as NavEvent;
      const to = new URL(ev.destination.url).pathname;
      if (ev.navigationType === "push" || ev.navigationType === "replace") set(to, false);
      else if (ev.navigationType === "traverse") set(to, ev.destination.index < (navigation.currentEntry?.index ?? 0));
    });
    return;
  }
  // No Navigation API: links and router.push go through pushState, the browser buttons through popstate.
  const push = history.pushState.bind(history);
  history.pushState = (data, unused, url) => {
    if (url) set(new URL(String(url), window.location.href).pathname, false);
    push(data, unused, url);
  };
  // popstate fires after the URL changed, so remember the path we came from.
  let last = window.location.pathname;
  window.addEventListener("popstate", () => {
    const to = window.location.pathname;
    if (to !== last) root.dataset.nav = navKind(last, to, true);
    last = to;
  });
  const sync = () => (last = window.location.pathname);
  window.addEventListener("click", () => queueMicrotask(sync), true);
}
