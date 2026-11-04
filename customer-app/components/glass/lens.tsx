import { LENS_MAP } from "./lens-map";

/**
 * The SVG filter behind the liquid glass lens (docs/design/shop-motion.md, "Liquid glass"): on
 * Chromium, `.glass::after` applies `backdrop-filter: url(#glass-lens)`, which displaces the
 * backdrop by the edge map (scripts/glass-lens-map.mjs), so what shows through bends at the rim
 * like light at the edge of a lens. Rendered once, in the root layout; invisible itself.
 * Safari and Firefox ignore url() in backdrop-filter and keep the blur, rim and sheen.
 */
export function GlassLens() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute" focusable="false">
      <filter id="glass-lens" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={LENS_MAP} preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="24" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
