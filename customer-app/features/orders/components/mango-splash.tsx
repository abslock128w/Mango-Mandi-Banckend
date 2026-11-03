"use client";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { ease } from "@/lib/motion";

/*
 * The mango splash (docs/design/shop-motion.md, "Splash"): a mango drops into thick juice and
 * sends up a slow, glossy crown of splash, droplets and a ripple, then rests in a puddle. About
 * 1.6 s, once per mount. SVG and Motion transforms/opacity only; the gooey filter sits on one small
 * group (the crown, ≤ 12 blobs) with a capped region. Under reduced motion the mango simply rests
 * in its puddle. Loaded with next/dynamic by the success view, so only that route carries it.
 */

// Seeded once per mount (mulberry32), so a re-render never re-scatters the blobs mid-flight.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CROWN = 10;
const DROPS = 20;
const FLOOR = 136; // y of the juice surface in the 200 × 200 box

function scatter() {
  const r = rng(Math.floor(Math.random() * 1e9));
  const jitter = (spread: number) => (r() * 2 - 1) * spread;
  // The crown: blobs in an arc over the mango, ±15° and ±10% of distance.
  const crown = Array.from({ length: CROWN }, (_, i) => {
    const a = (-180 + (i + 0.5) * (180 / CROWN) + jitter(15)) * (Math.PI / 180);
    const d = 54 * (1 + jitter(0.1));
    return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85, s: 0.7 + r() * 0.5, dur: 0.56 + r() * 0.1 };
  });
  // Droplets: further, faster, no goo.
  const drops = Array.from({ length: DROPS }, () => {
    const a = (-180 + r() * 180 + jitter(10)) * (Math.PI / 180);
    const d = 70 + r() * 40;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 1 + r() * 1.5, delay: 0.4 + r() * 0.2, dur: 0.5 + r() * 0.2 };
  });
  return { crown, drops };
}

/** Scattered once per mount (a lazy initial state, so the random seed is not drawn in a render). */
function useScatter() {
  return useState(scatter)[0];
}

/** A rounded blob of juice, pointing along +y (it rises). */
const BLOB = "M0 -9 C5 -9 7 -3 6 2 C5 7 2 9 0 9 C-2 9 -5 7 -6 2 C-7 -3 -5 -9 0 -9 Z";

function Mango() {
  return (
    <g>
      {/* Leaf */}
      <path d="M4 -24 C10 -32 20 -32 24 -26 C16 -24 10 -22 4 -24 Z" fill="var(--color-action)" />
      <path d="M2 -22 C3 -26 4 -28 6 -30" stroke="var(--color-deep)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {/* Body: saffron blushing to orange, a highlight top-left */}
      <path d="M-20 -8 C-20 -22 -6 -26 4 -24 C18 -22 24 -8 20 6 C16 18 4 24 -8 20 C-20 16 -24 4 -20 -8 Z" fill="url(#mango-skin)" />
      <ellipse cx="-8" cy="-10" rx="7" ry="4" fill="rgba(255,255,255,0.35)" transform="rotate(-30 -8 -10)" />
    </g>
  );
}

export function MangoSplash() {
  const reduce = useReducedMotion();
  const { crown, drops } = useScatter();
  const still = Boolean(reduce);
  return (
    <div data-testid="mango-splash" aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <svg viewBox="0 0 200 200" className="size-full overflow-visible">
        <defs>
          <linearGradient id="mango-skin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-blush)" />
          </linearGradient>
          <linearGradient id="juice" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="var(--color-ripe)" />
            <stop offset="1" stopColor="var(--color-brand)" />
          </linearGradient>
          {/* Gooey: blur then sharpen the alpha, so touching blobs merge like liquid. Region capped. */}
          <filter id="goo" x="-40" y="-90" width="280" height="200" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            {/* The sharp blobs back on top of the merged shape: no dark fringe where the blur thins out. */}
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>

        {/* The puddle the mango rests in (settles in from 900 ms). */}
        <m.ellipse
          cx="100"
          cy={FLOOR + 8}
          rx="44"
          ry="9"
          fill="url(#juice)"
          initial={still ? false : { opacity: 0, scaleX: 0.6 }}
          animate={{ opacity: 0.9, scaleX: 1 }}
          transition={{ duration: 0.4, delay: 0.9, ease: ease.standard }}
          style={{ transformOrigin: `100px ${FLOOR + 8}px` }}
        />

        {!still && (
          <>
            {/* Ripple: two rings behind the mango (600 to 1000 ms). */}
            {[0, 0.12].map((d) => (
              <m.ellipse
                key={d}
                cx="100"
                cy={FLOOR + 8}
                rx="44"
                ry="9"
                fill="none"
                stroke="var(--color-brand)"
                strokeWidth="1.5"
                initial={{ opacity: 0.35, scale: 0.6 }}
                animate={{ opacity: 0, scale: 1.6 }}
                transition={{ duration: 0.4, delay: 0.6 + d, ease: ease.standard }}
                style={{ transformOrigin: `100px ${FLOOR + 8}px` }}
              />
            ))}
            {/* Impact: a juice ring that flashes out as the mango lands (250 ms). */}
            <m.ellipse
              cx="100"
              cy={FLOOR}
              rx="30"
              ry="8"
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth="6"
              initial={{ opacity: 0.6, scale: 0.3 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{ duration: 0.3, delay: 0.25, ease: ease.emphasized }}
              style={{ transformOrigin: `100px ${FLOOR}px` }}
            />
            {/* Crown: blobs rise in an arc, merge through the goo, then fall and thin out (300 to 900 ms). */}
            <g filter="url(#goo)" transform={`translate(100 ${FLOOR})`}>
              {crown.map((b, i) => (
                <m.path
                  key={i}
                  d={BLOB}
                  fill="url(#juice)"
                  initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                  animate={{ x: [0, b.x, b.x * 1.05], y: [0, b.y, 12], scale: [0, b.s, b.s * 0.6], opacity: [1, 1, 0] }}
                  transition={{ duration: b.dur, delay: 0.3, times: [0, 0.55, 1], ease: [ease.emphasized, "easeIn"] }}
                />
              ))}
            </g>
            {/* Droplets: further and faster, no goo (400 to 1100 ms). */}
            <g transform={`translate(100 ${FLOOR})`}>
              {drops.map((d, i) => (
                <m.circle
                  key={i}
                  r={d.r}
                  fill="var(--color-ripe)"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: d.x, y: [0, d.y, d.y + 30], opacity: [1, 1, 0] }}
                  transition={{ duration: d.dur, delay: d.delay, times: [0, 0.6, 1], ease: [ease.emphasized, "easeIn"] }}
                />
              ))}
            </g>
          </>
        )}

        {/* The mango: drops from above (0 to 250 ms, easing in like gravity), squashes for a beat on
            impact, then rests in the puddle. */}
        <m.g
          initial={still ? false : { y: -110, rotate: -12, opacity: 0 }}
          animate={{ y: 0, rotate: 4, opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeIn", opacity: { duration: 0.05 } }}
          style={{ transformOrigin: `100px ${FLOOR}px` }}
        >
          <m.g
            initial={false}
            animate={still ? { scaleX: 1, scaleY: 1 } : { scaleX: [1, 1.08, 1], scaleY: [1, 0.9, 1] }}
            transition={{ duration: 0.14, delay: 0.25, ease: ease.standard }}
            style={{ transformOrigin: `100px ${FLOOR}px` }}
          >
            <g transform={`translate(100 ${FLOOR - 12})`}>
              <Mango />
            </g>
          </m.g>
        </m.g>
      </svg>
    </div>
  );
}
