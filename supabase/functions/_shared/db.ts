// PostgREST RPC calls (service-only maint_* / admin_* functions in 0050) and
// the mapping from database errors to owner-admin error codes.
import type { AdminClient } from './client.ts'
import { HttpError } from './http.ts'

export class RpcError extends Error {
  readonly fn: string
  readonly code: string

  constructor(fn: string, code: string | undefined, message: string | undefined) {
    // The database message is a fixed code such as "account_not_found" for our
    // own raises; it is kept for mapping but never sent to clients.
    super(message ?? 'rpc failed')
    this.name = 'RpcError'
    this.fn = fn
    this.code = code ?? ''
  }
}

/** Calls a public RPC with the secret key. The result type is declared by the caller (see 0050_service_rpcs.sql). */
export async function rpc<T>(client: AdminClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new RpcError(fn, error.code, error.message)
  return data as T
}

// SQLSTATEs caused by bad input rather than by the server.
const BAD_INPUT = new Set(['22001', '22023', '22P02', '23502', '23514'])

/** not_found for our "*_not_found" raises, conflict for unique violations, bad_request for invalid input. */
export function httpErrorFromRpc(err: RpcError): HttpError {
  if (err.code === 'P0001' && /^[a-z_]+_not_found$/.test(err.message)) return new HttpError('not_found')
  if (err.code === '23505') return new HttpError('conflict')
  if (BAD_INPUT.has(err.code)) return new HttpError('bad_request')
  return new HttpError('internal')
}
