// A small lint (TST-3): the rules of hooks, and unused variables. Types and
// everything else are tsc's job (npm run typecheck).
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  // The API has its own tests; only the two apps are linted here.
  { ignores: ['mango-api/**', 'dist/**', 'playwright-report*/**', 'test-results*/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'customer-app/src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // The TypeScript version: the core rule counts parameter names in function types as unused.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },
]
