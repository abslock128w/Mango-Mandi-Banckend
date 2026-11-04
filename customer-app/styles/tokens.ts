/**
 * Mirror of styles/theme.css for places CSS variables can't reach
 * (manifest, viewport theme colour, OG/icon images). Keep in sync.
 */
export const tokens = {
  brand: "#FFB627",
  blush: "#FF8552",
  action: "#0B6E5B",
  deep: "#0A4A40",
  ripe: "#E8590C",
  raw: "#7CB342",
  canvas: "#FFF8EE",
} as const;

/** Colours handed to the Google Maps JS API (it can't read CSS variables). */
export const mapTokens = { route: tokens.action, routeFaint: "#0B6E5Baa" } as const;
