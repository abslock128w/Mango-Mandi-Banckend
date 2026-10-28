// Build settings for browser error reports (shared/error-reports), used by both
// apps' vite.config.ts:
// - the environment and release the reports are tagged with, from Vercel's
//   build variables;
// - optional readable stack traces: with SENTRY_AUTH_TOKEN, SENTRY_ORG and
//   SENTRY_PROJECT set, the build makes hidden source maps (no sourceMappingURL
//   comment), Sentry's Vite plugin uploads them, and the .map files are deleted
//   before the folder is served. scripts/scan-bundle.mjs fails the deploy if a map
//   is left or the token's value is in the bundle. Without the token nothing changes.
import path from 'node:path'
import type { PluginOption } from 'vite'

export interface ErrorReportEnv {
  VITE_SENTRY_DSN?: string
  VITE_SENTRY_ENVIRONMENT?: string
  VERCEL_ENV?: string
  VERCEL_GIT_COMMIT_SHA?: string
  SENTRY_AUTH_TOKEN?: string
  SENTRY_ORG?: string
  SENTRY_PROJECT?: string
  /** A self-hosted Sentry; sentry.io when unset. */
  SENTRY_URL?: string
}

/** Vite `define`: the environment and release tags. VITE_SENTRY_DSN itself is an ordinary VITE_ variable. */
export function errorReportDefine(env: ErrorReportEnv, mode: string): Record<string, string> {
  return {
    'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(env.VITE_SENTRY_ENVIRONMENT || env.VERCEL_ENV || mode),
    'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(env.VERCEL_GIT_COMMIT_SHA ?? ''),
  }
}

/** True when the build uploads source maps: all three Sentry settings are set. */
export const uploadsSourceMaps = (env: ErrorReportEnv) => Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT)

/**
 * The source map upload, or nothing. The plugin loads only when it is needed, so a
 * normal build or dev server never starts it. An upload that fails warns and the
 * build goes on (the reports then show minified stack traces); the maps are deleted
 * either way.
 */
export async function sourceMapUpload(env: ErrorReportEnv): Promise<PluginOption[]> {
  if (!uploadsSourceMaps(env)) return []
  const { sentryVitePlugin } = await import('@sentry/vite-plugin')
  // The maps to delete are wherever this build writes (dist, or --outDir).
  let setOutDir = (_dir: string) => {}
  const outDir = new Promise<string>((resolve) => (setOutDir = resolve))
  const outDirPlugin: PluginOption = {
    name: 'mango-source-map-dir',
    configResolved: (config) => setOutDir(path.resolve(config.root, config.build.outDir)),
  }
  const upload = sentryVitePlugin({
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    authToken: env.SENTRY_AUTH_TOKEN,
    url: env.SENTRY_URL,
    // No usage data about the plugin itself.
    telemetry: false,
    // Only the upload: the SDK's settings name the release, and nothing is created,
    // finalised or linked to commits in Sentry.
    release: { name: env.VERCEL_GIT_COMMIT_SHA, inject: false, create: false, finalize: false, setCommits: false, deploy: false },
    sourcemaps: { filesToDeleteAfterUpload: outDir.then((dir) => `${dir.replace(/\\/g, '/')}/**/*.map`) },
    errorHandler: (err) => console.warn(`Sentry source map upload failed; the deploy goes on without readable stack traces: ${err.message}`),
  })
  return [outDirPlugin, ...upload]
}
