/**
 * The page under the sheets. While a phone sheet is open, components/ui/drawer.tsx marks it
 * data-active and mirrors the sheet's drag progress onto it (--drawer-swipe-progress), and
 * globals.css pushes it back (scale, round corners, follows the finger). Plain markup: no sheet
 * code ships with the page until a sheet is opened.
 */
export function AppIndent({ children }: { children: React.ReactNode }) {
  return <div className="app-root bg-canvas">{children}</div>;
}
