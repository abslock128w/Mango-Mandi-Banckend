import { RuleTester, type Rule } from "eslint";
import { describe, it } from "vitest";
import tsParser from "@typescript-eslint/parser";
import rule from "../../eslint-rules/compositor-only.mjs";

// The lint rule behind docs/design/shop-motion.md section 6: Motion animates transform, opacity,
// filter and clip-path only.
RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run("compositor-only", rule as unknown as Rule.RuleModule, {
  valid: [
    "<m.div animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ clipPath: 'inset(0 0 100% 0)' }} />",
    "<m.div initial={false} animate={open ? { x: 0 } : { x: '100%' }} transition={{ duration: 0.2 }} />",
    "animate(mv, 10, { duration: 0.3 })",
    "<div style={{ height: 40 }} />",
  ],
  invalid: [
    { code: "<m.div animate={{ height: 'auto', opacity: 1 }} />", errors: [{ messageId: "layout" }] },
    { code: "<m.ul initial={{ height: 0 }} exit={{ height: 0, marginTop: 0 }} />", errors: [{ messageId: "layout" }, { messageId: "layout" }, { messageId: "layout" }] },
    { code: "<m.span animate={on ? { width: 20 } : { width: 6 }} />", errors: [{ messageId: "layout" }, { messageId: "layout" }] },
    { code: "<m.span animate={{ left: '50%' }} />", errors: [{ messageId: "layout" }] },
    { code: "<m.div variants={{ open: { top: 0 }, closed: { top: 40 } }} />", errors: [{ messageId: "layout" }, { messageId: "layout" }] },
    { code: "animate(el, { width: 100 })", errors: [{ messageId: "layout" }] },
  ],
});
