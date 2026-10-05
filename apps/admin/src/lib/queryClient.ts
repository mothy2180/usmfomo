// One QueryClient for the console. Every failed query or mutation is offered
// to the session-problem bus (sessionEvents.ts), so an ended or downgraded
// session is noticed wherever it shows up first.
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { AdminApiError, type AdminErrorCode } from './api.ts'
import { NoRowsError } from './messages.ts'
import { reportSessionProblem, sessionProblem } from './sessionEvents.ts'

/** Failures worth one more try: the request may not have reached the server. */
const TRANSIENT: ReadonlySet<AdminErrorCode> = new Set(['network', 'unavailable', 'internal'])

/** Retry a read once, but never for a session problem or a definite answer
 * from the server (forbidden, bad request, …), which would only repeat. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  if (sessionProblem(error) !== null) return false
  if (error instanceof NoRowsError) return false
  if (error instanceof AdminApiError) return TRANSIENT.has(error.code)
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined
  // PostgREST/Auth 4xx answers are definite too.
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return true
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error) => reportSessionProblem(error) }),
    mutationCache: new MutationCache({ onError: (error) => reportSessionProblem(error) }),
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: shouldRetry },
      // A write must never run twice by itself (deletes, kill switches).
      mutations: { retry: false },
    },
  })
}
