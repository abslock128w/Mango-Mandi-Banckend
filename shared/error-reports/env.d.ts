// Build settings the error reports read (both apps; scripts/sentry.ts fills in the last two).
interface ImportMetaEnv {
  /** The Sentry project's DSN. Unset: no reports and no SDK in the build. */
  readonly VITE_SENTRY_DSN?: string
  /** VITE_SENTRY_ENVIRONMENT, else Vercel's environment (production, preview), else the Vite mode. */
  readonly VITE_SENTRY_ENVIRONMENT?: string
  /** The git commit Vercel builds (VERCEL_GIT_COMMIT_SHA); empty elsewhere. */
  readonly VITE_SENTRY_RELEASE?: string
}
