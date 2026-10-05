// HTTP layer of owner-admin: CORS → authorisation → body → action → JSON.
import { corsHeaders, isAllowedOrigin, preflightResponse } from '../_shared/cors.ts'
import { httpErrorFromRpc, RpcError } from '../_shared/db.ts'
import { describeError, errorResponse, HttpError, json } from '../_shared/http.ts'
import { generatePassword } from '../_shared/password.ts'
import { MAX_BODY_BYTES, parseActionBody } from './request.ts'
import { authorise } from './authorise.ts'
import { runAction } from './actions.ts'
import type { OwnerAdminPort } from './types.ts'

export type OwnerAdminDeps = {
  allowedOrigins: ReadonlySet<string>
  /** Created lazily, so a refused origin never touches configuration. */
  port: () => OwnerAdminPort
  generatePassword?: () => string
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  if (err instanceof RpcError) return httpErrorFromRpc(err)
  return new HttpError('internal')
}

async function readBody(req: Request): Promise<string> {
  const declared = Number(req.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError('bad_request')
  return await req.text()
}

export async function handleOwnerAdmin(req: Request, deps: OwnerAdminDeps): Promise<Response> {
  const origin = req.headers.get('Origin')
  if (!isAllowedOrigin(origin, deps.allowedOrigins)) {
    // No CORS headers: the browser blocks the response, and so does the preflight.
    return errorResponse('forbidden', { Vary: 'Origin' })
  }
  if (req.method === 'OPTIONS') return preflightResponse(origin)

  const cors = corsHeaders(origin)
  let action = '-'
  try {
    if (req.method !== 'POST') throw new HttpError('bad_request')
    const port = deps.port()
    await authorise(req, port)
    const request = parseActionBody(await readBody(req))
    action = request.action
    const data = await runAction(request, { port, generatePassword: deps.generatePassword ?? generatePassword })
    // Action names and status codes only: never parameters, results or passwords.
    console.log(JSON.stringify({ event: 'owner_admin', action, status: 200 }))
    return json(200, { ok: true, data }, cors)
  } catch (err) {
    const failure = toHttpError(err)
    console.log(JSON.stringify({
      event: 'owner_admin',
      action,
      status: failure.status,
      error: failure.code,
      ...(failure.code === 'internal' ? { cause: describeError(err) } : {}),
    }))
    return errorResponse(failure.code, cors)
  }
}
