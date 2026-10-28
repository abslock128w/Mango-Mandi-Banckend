// The Sentry SDK and its settings: a chunk of its own, loaded by index.ts once the
// page is idle and only when the build has a DSN.
import {
  breadcrumbsIntegration,
  captureException,
  consoleIntegration,
  dedupeIntegration,
  eventFiltersIntegration,
  globalHandlersIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
  withScope,
} from '@sentry/browser'
import type { App, Caught } from './index.ts'
import { scrubBreadcrumb, scrubEvent } from './scrub.ts'

interface Settings {
  app: App
  dsn: string
  environment: string
  release: string | undefined
}

/** Starts the SDK and returns the function that sends what index.ts caught. */
export function start({ app, dsn, environment, release }: Settings) {
  init({
    dsn,
    environment,
    release,
    // Only the integrations listed here: no session tracking, performance tracing,
    // Session Replay or feedback widget, each of which sends more than errors.
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
      breadcrumbsIntegration({ sentry: false }),
      consoleIntegration({ levels: ['warn', 'error'] }),
    ],
    // This SDK version has no sendDefaultPii; dataCollection is its replacement, and
    // everything about the person is off: no user or IP, cookies, bodies or query strings.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // No extra requests (client reports) and no changes to the app's own fetch errors.
    sendClientReports: false,
    enhanceFetchErrorMessages: false,
    maxBreadcrumbs: 50,
    initialScope: { tags: { app } },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb, hint) => scrubBreadcrumb(breadcrumb, hint),
  })
  return ({ error, how, componentStack }: Caught) =>
    withScope((scope) => {
      if (componentStack) scope.setContext('react', { componentStack })
      captureException(error, { mechanism: { type: how === 'react' ? 'react.error_boundary' : `auto.browser.held.${how}`, handled: false } })
    })
}
