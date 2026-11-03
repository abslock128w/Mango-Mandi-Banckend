// Prints the CSS mirror of the springs in lib/motion.ts (docs/design/shop-motion.md, section 4):
// a `linear()` easing and a duration per preset, for CSS transitions (the sheet, the press state)
// that cannot run Motion. The curve is cut where it is within 1% of rest, so a CSS transition
// ends when the motion is no longer visible. Paste the output into styles/theme.css.
//
//   node scripts/spring-css.mjs
import { spring } from "motion";

// Keep in step with `spring` in lib/motion.ts (visual duration in seconds, bounce). CSS uses only
// these two; bouncy and gentle run in Motion.
const PRESETS = { smooth: [0.3, 0], snappy: [0.28, 0.12] };

for (const [name, [visualDuration, bounce]] of Object.entries(PRESETS)) {
  const gen = spring({ keyframes: [0, 1], visualDuration, bounce });
  const step = 1000 / 60;
  const points = [];
  let t = 0;
  for (;;) {
    const { value, done } = gen.next(t);
    points.push(value);
    if (done) break;
    t += step;
  }
  // The last frame from which the curve stays within 1% of 1.
  let end = points.length - 1;
  while (end > 1 && Math.abs(points[end - 1] - 1) < 0.01) end--;
  const kept = points.slice(0, end + 1).map((v, i, a) => (i === a.length - 1 ? 1 : Math.round(v * 1000) / 1000));
  console.log(`  --ease-spring-${name}: linear(${kept.join(", ")});`);
  console.log(`  --dur-spring-${name}: ${Math.round(end * step)}ms;`);
}
