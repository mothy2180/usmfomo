// JSON responses and the error codes of docs/api.md.
//
// Plain TypeScript with no runtime-specific imports or globals: the owner CLI
// (scripts/account.ts, Node) uses HttpError through owner-admin/actions.ts.

/** `HeadersInit`, spelled so that both Deno's and Node's type libraries accept it. */
type HeaderValues = ConstructorParameters<typeof Headers>[0]

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'mfa_required'
  | 'not_found'
  | 'conflict'
  | 'internal'

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  mfa_required: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
}

/** An expected failure. It becomes `{ ok: false, error: code }` with the code's status. */
export class HttpError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode) {
    super(code)
    this.name = 'HttpError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError
}

// Responses can carry generated passwords: never cache them anywhere.
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

export function json(status: number, body: unknown, headers?: HeaderValues): Response {
  const h = new Headers(headers)
  for (const [name, value] of Object.entries(BASE_HEADERS)) h.set(name, value)
  return new Response(JSON.stringify(body), { status, headers: h })
}

export function errorResponse(code: ErrorCode, headers?: HeaderValues): Response {
  return json(ERROR_STATUS[code], { ok: false, error: code }, headers)
}

/** Short, content-free description of an unexpected error for the logs. */
export function describeError(err: unknown): string {
  if (isHttpError(err)) return err.code
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown; status?: unknown }
    const parts = [e.name, e.code, e.status].filter((p) => typeof p === 'string' || typeof p === 'number')
    if (parts.length > 0) return parts.join(' ')
  }
  return 'error'
}
