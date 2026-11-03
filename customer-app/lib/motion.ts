import type { Transition } from "motion/react";

/*
 * Motion tokens (docs/design/shop-motion.md). One material: every interactive motion is a spring
 * described by how long it looks (`visualDuration`, Apple's perceptual duration) and its bounce.
 * Four presets only. Tweens are for opacity crossfades and scroll-linked values.
 * The CSS mirror (`--ease-spring-*`, `--dur-spring-*` in styles/theme.css) comes from
 * scripts/spring-css.mjs; keep the two in step.
 */
export const spring = {
  /** Default for anything that moves: sheets, indicators, page-level slides. */
  smooth: { type: "spring", visualDuration: 0.3, bounce: 0 },
  /** Small, direct controls: ADD to stepper, toggles, toasts, press release. */
  snappy: { type: "spring", visualDuration: 0.28, bounce: 0.12 },
  /** Delight only: the cart bar arriving, add-to-cart, order placed. */
  bouncy: { type: "spring", visualDuration: 0.42, bounce: 0.28 },
  /** Large, calm entrances (the order card on the success page). */
  gentle: { type: "spring", visualDuration: 0.5, bounce: 0 },
} as const satisfies Record<string, Transition>;

/** Cubic curves for tweens; mirrored as --ease-standard / --ease-emphasized. */
export const ease = {
  standard: [0.2, 0, 0, 1],
  emphasized: [0.32, 0.72, 0, 1],
} as const;

/** Crossfades (skeleton to content, text that changes). */
export const fade: Transition = { duration: 0.16, ease: ease.standard };

/** The press state of anything tappable. */
export const press = { scale: 0.97, transition: spring.snappy } as const;

/** Durations in seconds, mirrored as --dur-xs … --dur-l. */
export const dur = { xs: 0.1, s: 0.16, m: 0.24, l: 0.36 } as const;

// Older names, kept so nothing breaks: they now point at the presets above.
/** ADD to stepper morph. */
export const morphSpring: Transition = spring.snappy;
/** General UI spring (cart bar, rail indicator, progress). */
export const uiSpring: Transition = spring.smooth;
export const softSpring: Transition = spring.gentle;

/** Staggered fade-and-rise, 30 ms per item, capped at 8 items (beyond that everything arrives together). */
export const STAGGER_MS = 30;
export const STAGGER_CAP = 8;
export const riseDelay = (i: number) => (Math.min(i, STAGGER_CAP) * STAGGER_MS) / 1000;
