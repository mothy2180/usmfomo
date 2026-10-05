// Plain-fetch client for the Supabase APIs the owner CLI uses: Auth Admin
// (/auth/v1/admin/...), PostgREST RPC (/rest/v1/rpc/admin_*) and Storage
// (/storage/v1/object/posters). The secret key goes in the `apikey` header
// only (docs/api.md): never in Authorization, a URL or an error message.

export type Service = 'auth' | 'rest' | 'storage'

export const REQUEST_TIMEOUT_MS = 30_000

const PREFIX: Readonly<Record<Service, string>> = {
  auth: '/auth/v1',
  rest: '/rest/v1',
  storage: '/storage/v1',
}

/** A failed API call. `status` 0 means there was no HTTP response at all. */
export class ApiError extends Error {
  readonly service: Service
  readonly status: number
  /** Auth error_code, PostgREST/SQLSTATE code or Storage error name; '' when absent. */
  readonly code: string

  constructor(service: Service, status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.service = service
    this.status = status
    this.code = code
  }
}

export interface RestClient {
  /** Sends one request and returns the parsed JSON body (null when empty). */
  request(service: Service, method: string, path: string, body?: unknown): Promise<unknown>
}

export type Target = { url: string; key: string }

function parseBody(text: string): unknown {
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function field(data: unknown, name: string): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>)[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** One printable line, so an error body cannot mess up the terminal. */
function clean(message: string): string {
  return message.replace(/[\p{Cc}]+/gu, ' ').trim().slice(0, 300)
}

export function apiErrorFrom(service: Service, status: number, data: unknown): ApiError {
  const fallback = `HTTP ${status}`
  if (service === 'auth') {
    const code = field(data, 'error_code') ?? field(data, 'code') ?? ''
    const message = field(data, 'msg') ?? field(data, 'message') ?? field(data, 'error_description') ?? fallback
    return new ApiError(service, status, code, clean(message))
  }
  if (service === 'rest') {
    return new ApiError(service, status, field(data, 'code') ?? '', clean(field(data, 'message') ?? fallback))
  }
  const code = field(data, 'error') ?? field(data, 'code') ?? ''
  return new ApiError(service, status, code, clean(field(data, 'message') ?? fallback))
}

export function createRestClient(
  target: Target,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): RestClient {
  const base = target.url.replace(/\/+$/, '')
  const host = new URL(base).host
  return {
    async request(service, method, path, body) {
      const headers: Record<string, string> = { apikey: target.key, Accept: 'application/json' }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      let res: Response
      try {
        res = await fetchImpl(`${base}${PREFIX[service]}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        throw timedOut
          ? new ApiError(service, 0, 'timeout', `no answer from ${host} within ${timeoutMs / 1000} s`)
          : new ApiError(service, 0, 'network', `cannot reach ${host}`)
      }
      const data = parseBody(await res.text())
      if (!res.ok) throw apiErrorFrom(service, res.status, data)
      return data
    },
  }
}
