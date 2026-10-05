// createOwnerAdminPort against the real supabase-js client (deps.ts) with a
// stubbed fetch: token verification through a JWKS with a real ES256 key, the
// error mapping of Auth responses, and the headers every request carries.
import { assertEquals, assertRejects } from '@std/assert'
import { createAdminClient } from '../_shared/client.ts'
import { HttpError } from '../_shared/http.ts'
import { createOwnerAdminPort } from './port.ts'
import type { OwnerAdminPort } from './types.ts'

const KEY = 'sb_secret_FakeForTests00000000000000000'
const BASE = 'http://kong.test'
const KID = 'test-kid'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const FACTOR_ID = '00000000-0000-4000-8000-0000000000f1'

type Handler = (url: URL, req: Request) => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))

const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }

async function signJwt(payload: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const input = `${b64urlJson({ alg: 'ES256', typ: 'JWT', kid: KID, ...header })}.${b64urlJson(payload)}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${b64url(new Uint8Array(signature))}`
}

const claims = (overrides: Record<string, unknown> = {}) => ({
  sub: USER_ID,
  role: 'authenticated',
  aal: 'aal2',
  session_id: '00000000-0000-4000-8000-0000000000aa',
  exp: Math.floor(Date.now() / 1000) + 600,
  ...overrides,
})

/**
 * Runs `fn` with a port whose client talks to `handler` instead of the network.
 * auth-js caches the JWKS per host for 10 minutes across clients, so a test
 * that needs an empty cache passes its own `base`.
 */
async function withPort<T>(
  handler: Handler,
  fn: (port: OwnerAdminPort, requests: Request[]) => Promise<T>,
  base = BASE,
) {
  const requests: Request[] = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    requests.push(req.clone())
    return Promise.resolve().then(() => handler(new URL(req.url), req))
  }) as typeof fetch
  try {
    const env: Record<string, string> = { SUPABASE_URL: base, SUPABASE_SECRET_KEYS: JSON.stringify({ default: KEY }) }
    return await fn(createOwnerAdminPort(createAdminClient((name) => env[name])), requests)
  } finally {
    globalThis.fetch = original
  }
}

const jwks: Handler = (url) =>
  url.pathname === '/auth/v1/.well-known/jwks.json' ? json({ keys: [publicJwk] }) : json({ msg: 'unexpected' }, 418)

async function failsWith(promise: Promise<unknown>, code: string) {
  const err = await assertRejects(() => promise, HttpError)
  assertEquals(err.code, code)
}

Deno.test('verifyToken: a valid ES256 token is verified against the JWKS', async () => {
  await withPort(jwks, async (port, requests) => {
    const token = await signJwt(claims())
    assertEquals(await port.verifyToken(token), { sub: USER_ID, role: 'authenticated', aal: 'aal2' })
    assertEquals(requests.map((r) => new URL(r.url).pathname), ['/auth/v1/.well-known/jwks.json'])
    // The secret key travels in apikey only, never as a bearer token.
    assertEquals(requests[0].headers.get('apikey'), KEY)
    assertEquals(requests[0].headers.get('Authorization'), null)
  })
})

Deno.test('verifyToken: tampered, expired, garbage or unsupported tokens are 401', async () => {
  await withPort(jwks, async (port) => {
    const valid = await signJwt(claims({ aal: 'aal1' }))
    const [h, , s] = valid.split('.')
    const tampered = `${h}.${b64urlJson(claims({ aal: 'aal2' }))}.${s}`
    const expired = await signJwt(claims({ exp: Math.floor(Date.now() / 1000) - 5 }))
    const noExp = await signJwt(claims({ exp: undefined }))
    const unsupportedAlg = `${b64urlJson({ alg: 'PS256', kid: KID })}.${b64urlJson(claims())}.${s}`
    for (const token of [tampered, expired, noExp, 'aaaa.bbbb.cccc', 'e30.e30.e30', unsupportedAlg]) {
      await failsWith(port.verifyToken(token), 'unauthorized')
    }
  })
})

Deno.test('verifyToken: a symmetric or unknown-key token falls back to getUser', async () => {
  const seen: string[] = []
  const handler: Handler = (url, req) => {
    seen.push(url.pathname)
    if (url.pathname === '/auth/v1/.well-known/jwks.json') return json({ keys: [publicJwk] })
    if (url.pathname === '/auth/v1/user') {
      assertEquals(req.headers.get('Authorization')?.startsWith('Bearer ey'), true)
      return json({ code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' }, 403)
    }
    return json({}, 418)
  }
  await withPort(handler, async (port) => {
    const hs256 = `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlJson(claims())}.c2ln`
    await failsWith(port.verifyToken(hs256), 'unauthorized')
    const otherKey = await signJwt(claims(), { kid: 'another-project' })
    await failsWith(port.verifyToken(otherKey), 'unauthorized')
  })
  assertEquals(seen.filter((p) => p === '/auth/v1/user').length, 2)
})

Deno.test('verifyToken: an unreachable JWKS is a 500, not a 401', async () => {
  const token = await signJwt(claims())
  await withPort(
    () => Promise.reject(new TypeError('connection refused')),
    (port) => failsWith(port.verifyToken(token), 'internal'),
    'http://jwks-down.test',
  )
})

Deno.test('sessionUserId: live session, ended session, Auth outage', async () => {
  const user = (status: number, body: unknown): Handler => (url, req) => {
    assertEquals(url.pathname, '/auth/v1/user')
    assertEquals(req.headers.get('Authorization'), 'Bearer a.b.c')
    assertEquals(req.headers.get('apikey'), KEY)
    return json(body, status)
  }
  await withPort(user(200, { id: USER_ID, aud: 'authenticated' }), async (port) => {
    assertEquals(await port.sessionUserId('a.b.c'), USER_ID)
  })
  const ended = {
    code: 403,
    error_code: 'session_not_found',
    msg: 'Session from session_id claim in JWT does not exist',
  }
  await withPort(user(403, ended), (port) => failsWith(port.sessionUserId('a.b.c'), 'unauthorized'))
  await withPort(
    user(401, { code: 401, error_code: 'bad_jwt', msg: 'x' }),
    (port) => failsWith(port.sessionUserId('a.b.c'), 'unauthorized'),
  )
  await withPort(user(500, { code: 500, msg: 'db down' }), (port) => failsWith(port.sessionUserId('a.b.c'), 'internal'))
  await withPort(user(503, { msg: 'unavailable' }), (port) => failsWith(port.sessionUserId('a.b.c'), 'internal'))
})

Deno.test('admin calls: paths, bodies and error mapping', async () => {
  const handler: Handler = async (url, req) => {
    assertEquals(req.headers.get('apikey'), KEY)
    assertEquals(req.headers.get('Authorization'), null)
    const route = `${req.method} ${url.pathname}`
    switch (route) {
      case `GET /auth/v1/admin/users/${USER_ID}/factors`:
        return json([{ id: FACTOR_ID, factor_type: 'totp', status: 'verified' }])
      case `DELETE /auth/v1/admin/users/${USER_ID}/factors/${FACTOR_ID}`:
        return json({ code: 404, error_code: 'mfa_factor_not_found', msg: 'Factor not found' }, 404)
      case `PUT /auth/v1/admin/users/${USER_ID}`:
        assertEquals(await req.json(), { ban_duration: '876000h' })
        return json({ id: USER_ID })
      case 'POST /auth/v1/admin/users':
        return json({ code: 422, error_code: 'email_exists', msg: 'already registered' }, 422)
      case 'POST /rest/v1/rpc/admin_is_owner':
        assertEquals(await req.json(), { p_uid: USER_ID })
        return json(true)
      case 'DELETE /storage/v1/object/posters':
        assertEquals(await req.json(), { prefixes: ['o/a.webp', 'o/a-thumb.webp'] })
        return json([{ name: 'o/a.webp' }])
      default:
        return json({ msg: route }, 418)
    }
  }
  await withPort(handler, async (port) => {
    assertEquals(await port.listFactorIds(USER_ID), [FACTOR_ID])
    await failsWith(port.deleteFactor(USER_ID, FACTOR_ID), 'not_found')
    await port.updateAuthUser(USER_ID, { ban_duration: '876000h' })
    await failsWith(port.createAuthUser('csoc@usmfomo.pages.dev', 'x'), 'conflict')
    assertEquals(await port.isOwner(USER_ID), true)
    assertEquals(await port.removeFiles(['o/a.webp', 'o/a-thumb.webp', null]), { removed: 1, failed: 0 })
  })
})
