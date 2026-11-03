import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import compositorOnly from "./eslint-rules/compositor-only.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Motion: compositor-only properties (docs/design/shop-motion.md, section 6).
  {
    files: ["**/*.tsx", "**/*.ts"],
    plugins: { shop: { rules: { "compositor-only": compositorOnly } } },
    rules: { "shop/compositor-only": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "storybook-static/**",
    "public/**",
    "playwright-report/**",
    "test-results/**",
    ".lighthouseci/**",
  ]),
]);

export default eslintConfig;
