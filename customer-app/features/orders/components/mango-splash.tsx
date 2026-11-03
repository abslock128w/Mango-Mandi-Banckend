"use client";

/*
 * The mango splash on the order success view (docs/design/shop-motion.md, "Mango splash"): a
 * mango drops into thick juice, which bursts into long tapered tendrils with beads at their tips,
 * flung droplets and a ripple, then rests and breathes. Ported from docs/design/splash-prototype.html.
 *
 * One SVG. The liquid's silhouette is a mask: the pool and the tendrils, blurred and alpha-cranked
 * (the goo filter) so they fuse into one shape, and through that mask three full-size rects paint
 * the whole merged liquid at once (a radial juice body, a rim gradient with a brown foot, a
 * specular hotspot), which is what makes it read as one thick glossy fluid rather than flat blobs.
 * A second filter darkens a band along every lower edge for thickness. Tendrils and droplets are
 * animated by CSS (globals.css, .splash-*) from custom properties: angle, length, delay, wobble;
 * the numbers are fixed, jittered once by hand, so it never looks like a gear and never flickers.
 * Transform and opacity only; the blur filters are static.
 *
 * `still`: the resting frame with no animation (reduced motion, and the visual baseline).
 */

// Tendrils: angle, length scale, extra delay (s), wobble; the ligament path and the bead at its tip.
// Four of the long ones curve (their control points lean off the axis), so it reads as poured, not sprayed.
const TENDRILS: [number, number, number, number, string, number, number, number][] = [
  [-102, 0.93, 0.01, -8, "M-11 0 C-6 -32 -13 -63 -12 -90 L-6 -90 C-5 -63 6 -32 11 0 Z", -9, -96, 7.9],
  [-78, 0.81, 0.02, -11, "M-8 0 C-5 -30 -6 -61 -5 -87 L1 -87 C2 -61 5 -30 8 0 Z", -2, -94, 8.9],
  [-56, 0.82, 0.01, 11, "M-8 0 C-5 -43 14 -86 18 -123 L24 -123 C22 -86 5 -43 8 0 Z", 21, -128, 7],
  [-30, 1.11, 0.06, -11, "M-11 0 C-6 -31 -10 -62 -9 -88 L-3 -88 C-2 -62 6 -31 11 0 Z", -6, -92, 6.3],
  [-10, 0.87, 0.02, -8, "M-10 0 C-6 -40 4 -81 5 -115 L11 -115 C12 -81 6 -40 10 0 Z", 8, -120, 7.3],
  [10, 0.79, 0.05, -13, "M-10 0 C-5 -36 -5 -73 -4 -104 L2 -104 C3 -73 5 -36 10 0 Z", -1, -110, 8.1],
  [31, 1.04, 0.09, 10, "M-8 0 C-5 -36 -16 -72 -14 -104 L-8 -104 C-8 -72 5 -36 8 0 Z", -11, -110, 8.7],
  [56, 0.88, 0.07, -8, "M-12 0 C-7 -36 -13 -73 -12 -104 L-6 -104 C-5 -73 7 -36 12 0 Z", -9, -108, 6.3],
  [82, 0.94, 0.07, -14, "M-13 0 C-7 -38 2 -77 3 -110 L9 -110 C10 -77 7 -38 13 0 Z", 6, -115, 7],
  [101, 1.12, 0.04, 8, "M-10 0 C-6 -38 -22 -76 -24 -108 L-18 -108 C-14 -76 6 -38 10 0 Z", -21, -113, 7],
  [124, 0.89, 0.04, 12, "M-12 0 C-7 -37 2 -74 3 -106 L9 -106 C10 -74 7 -37 12 0 Z", 6, -113, 9],
  [146, 0.76, 0.08, -10, "M-8 0 C-5 -33 -11 -65 -10 -93 L-4 -93 C-3 -65 5 -33 8 0 Z", -7, -100, 8.3],
  [164, 1.1, 0.05, -11, "M-10 0 C-5 -35 -3 -71 -2 -101 L4 -101 C5 -71 5 -35 10 0 Z", 1, -108, 9.3],
  [197, 0.95, 0.05, 8, "M-11 0 C-6 -43 11 -85 14 -122 L20 -122 C17 -85 6 -43 11 0 Z", 17, -127, 7.4],
  [210, 0.75, 0.02, -14, "M-9 0 C-5 -32 -7 -65 -6 -92 L0 -92 C1 -65 5 -32 9 0 Z", -3, -97, 6.2],
  [239, 1.23, 0.06, 9, "M-9 0 C-5 -30 -6 -61 -5 -87 L1 -87 C2 -61 5 -30 9 0 Z", -2, -93, 8.2],
];
// Two of them keep stretching slowly for 2 s after the burst.
const SLOW = new Set([2, 9]);

// Droplets flung clear of the goo, so they stay crisp beads: angle, distance, size scale, delay, radius.
const DROPS: [number, number, number, number, number][] = [
  [-80, 150, 1, 0, 4.5],
  [-40, 168, 0.8, 0.03, 3.5],
  [-10, 140, 1, 0.05, 4],
  [30, 175, 0.7, 0.02, 3],
  [66, 150, 1, 0.06, 4.5],
  [104, 160, 0.9, 0.01, 3.5],
  [140, 172, 0.7, 0.04, 3],
  [176, 146, 1, 0.07, 4],
  [210, 164, 0.8, 0.02, 3.5],
  [246, 152, 1, 0.05, 4],
  [282, 178, 0.6, 0.03, 2.5],
  [318, 156, 0.9, 0.08, 3.5],
  [-62, 120, 0.6, 0.1, 2.5],
  [52, 126, 0.6, 0.09, 2.5],
  [160, 118, 0.6, 0.11, 2.5],
  [236, 124, 0.6, 0.1, 2.5],
];

// The mango, traced from public/images/mangoes/m00.jpg: a wide kidney with its shoulder at the
// left, a slight beak at the right end and a flatter underside.
const BODY = "M-86 -2 C-90 -38 -56 -62 -10 -62 C34 -62 74 -46 88 -16 C96 2 92 16 80 24 C62 38 24 48 -16 46 C-54 44 -84 30 -86 -2 Z";
const SPECKLES: [number, number, number][] = [
  [-30, -22, 1.6],
  [24, -12, 1.2],
  [-50, 8, 1.4],
  [44, 14, 1.3],
  [4, 24, 1],
  [-10, -40, 1.1],
  [58, -4, 1.2],
  [-66, -14, 1],
  [16, 4, 0.9],
  [-26, 30, 1.2],
  [36, -30, 1],
  [70, 10, 0.9],
];

const RECTS = ["url(#splash-juice)", "url(#splash-rim)", "url(#splash-spec)"];

export default function MangoSplash({ still = false }: { still?: boolean }) {
  return (
    <svg data-splash viewBox="-200 -200 400 400" aria-hidden className="splash size-full overflow-visible" data-still={still ? "" : undefined}>
      <defs>
        {/* Gooey: blur, then crank the alpha so neighbouring blobs fuse. */}
        <filter id="splash-goo" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
        {/* Soft shadows: the crater in the pool, the shade inside the mango. */}
        <filter id="splash-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        {/* Thickness: a darker band along every lower edge of the liquid (the shape minus itself lifted 3 px). */}
        <filter id="splash-thick" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceAlpha" dy="-3" result="up" />
          <feComposite in="SourceAlpha" in2="up" operator="out" result="band" />
          <feFlood floodColor="#7a3a00" floodOpacity="0.38" result="brown" />
          <feComposite in="brown" in2="band" operator="in" result="shade" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shade" />
          </feMerge>
        </filter>
        {/* Juice body, lit from top-left, deeper orange towards the rim. */}
        <radialGradient id="splash-juice" cx="40%" cy="38%" r="70%">
          <stop offset="0" stopColor="#ffd84d" />
          <stop offset=".45" stopColor="#ffb627" />
          <stop offset=".8" stopColor="#f28c0f" />
          <stop offset="1" stopColor="#d9700a" />
        </radialGradient>
        {/* A thin bright rim at the top, a brown foot at the bottom: without it the juice floats on the cream canvas. */}
        <linearGradient id="splash-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".3" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#8a3d00" stopOpacity=".35" />
        </linearGradient>
        <radialGradient id="splash-spec" cx="36%" cy="30%" r="40%">
          <stop offset="0" stopColor="#fff" stopOpacity=".75" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".18" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* Mango skin: three layers (skin, the shaded side, a blush) and a gloss. */}
        <radialGradient id="splash-skin" cx="36%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset=".3" stopColor="#ffd84d" />
          <stop offset=".7" stopColor="#edb21c" />
          <stop offset="1" stopColor="#b07408" />
        </radialGradient>
        <linearGradient id="splash-shade" x1="0.2" y1="0" x2="0.9" y2="1">
          <stop offset=".45" stopColor="#8a4b0c" stopOpacity="0" />
          <stop offset="1" stopColor="#8a4b0c" stopOpacity=".42" />
        </linearGradient>
        <radialGradient id="splash-blush" cx="74%" cy="28%" r="42%">
          <stop offset="0" stopColor="#f08a2a" stopOpacity=".5" />
          <stop offset="1" stopColor="#f08a2a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="splash-gloss" cx="30%" cy="22%" r="35%">
          <stop offset="0" stopColor="#fff" stopOpacity=".8" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="splash-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cb342" />
          <stop offset="1" stopColor="#2f6b1e" />
        </linearGradient>
        <clipPath id="splash-body">
          <path d={BODY} />
        </clipPath>

        {/* The liquid's silhouette: pool and tendrils, goo'd, as a mask so one paint covers the merged shape. */}
        <mask id="splash-liquid" maskUnits="userSpaceOnUse" x="-220" y="-220" width="440" height="440">
          <g fill="#fff" filter="url(#splash-goo)">
            <ellipse className="splash-pool" cx="0" cy="18" rx="92" ry="64" />
            {TENDRILS.map(([a, l, d, w, path, bx, by, br], i) => (
              <g key={i} className="splash-tendril" style={{ "--a": `${a}deg`, "--l": l, "--d": `${d}s`, "--w": `${w}deg` } as React.CSSProperties}>
                <g className={SLOW.has(i) ? "splash-stretch" : undefined}>
                  <path d={path} />
                  <circle cx={bx} cy={by} r={br} />
                </g>
              </g>
            ))}
          </g>
        </mask>
        {/* The front lip: a little juice drawn after the mango, so it sits in the pool rather than on it. */}
        <mask id="splash-lip" maskUnits="userSpaceOnUse" x="-220" y="-220" width="440" height="440">
          <g fill="#fff" filter="url(#splash-goo)">
            <ellipse className="splash-pool" cx="2" cy="46" rx="72" ry="14" />
            <ellipse className="splash-pool" cx="-34" cy="42" rx="20" ry="11" />
            <ellipse className="splash-pool" cx="42" cy="44" rx="22" ry="11" />
          </g>
        </mask>
      </defs>

      {/* Ripple on the canvas. */}
      <ellipse className="splash-ring" cx="0" cy="22" rx="110" ry="76" fill="none" stroke="#ffb627" strokeWidth="3" />

      {/* Flung droplets, outside the goo. One detaches late: a bead that goes 12 px further and shrinks. */}
      <g fill="url(#splash-juice)" filter="url(#splash-thick)">
        {DROPS.map(([a, r, l, d, size], i) => (
          <g key={i} className="splash-drop" style={{ "--a": `${a}deg`, "--r": r, "--l": l, "--d": `${d}s` } as React.CSSProperties}>
            <circle r={size} />
          </g>
        ))}
        <g className="splash-drop splash-drop--late" style={{ "--a": "118deg", "--r": 128, "--l": 0.8, "--d": "0.06s" } as React.CSSProperties}>
          <circle r="3.2" />
        </g>
      </g>

      {/* The liquid: body, rim shading and specular through one mask; a dark band on its lower edges; the crater under the mango. */}
      <g filter="url(#splash-thick)">
        <g mask="url(#splash-liquid)">
          {RECTS.map((fill) => (
            <rect key={fill} x="-220" y="-220" width="440" height="440" fill={fill} />
          ))}
          <ellipse className="splash-crater" cx="0" cy="34" rx="78" ry="24" fill="#5a2a00" opacity=".2" filter="url(#splash-soft)" />
        </g>
      </g>

      {/* Contact shadow, then the mango. */}
      <ellipse className="splash-shadow" cx="4" cy="46" rx="60" ry="14" fill="#8a3d00" />
      <g className="splash-mango">
        <path d={BODY} fill="url(#splash-skin)" />
        <path d={BODY} fill="url(#splash-shade)" />
        <path d={BODY} fill="url(#splash-blush)" />
        {/* A soft shade inside the lower right: a darker copy, blurred, clipped to the body. */}
        <g clipPath="url(#splash-body)">
          <path d={BODY} fill="#7a4208" opacity=".3" filter="url(#splash-soft)" transform="translate(6 9)" />
        </g>
        <path d={BODY} fill="url(#splash-gloss)" />
        <g fill="#7f8f2c" opacity=".38">
          {SPECKLES.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
        {/* Stem and leaf at the left shoulder. */}
        <path d="M-72 -40 C-78 -48 -82 -56 -86 -64" stroke="#6b4a2b" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M-84 -62 C-64 -80 -34 -78 -16 -62 C-38 -56 -64 -50 -84 -62 Z" fill="url(#splash-leaf)" />
        <path d="M-82 -61 C-62 -70 -40 -70 -20 -62" stroke="#d9efc4" strokeWidth="1" fill="none" opacity=".7" />
      </g>
      <g filter="url(#splash-thick)">
        <g mask="url(#splash-lip)">
          {RECTS.map((fill) => (
            <rect key={fill} x="-220" y="-220" width="440" height="440" fill={fill} />
          ))}
        </g>
      </g>
    </svg>
  );
}
