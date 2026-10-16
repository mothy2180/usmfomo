import { assert, assertEquals } from '@std/assert'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { RpcError } from '../_shared/db.ts'
import { HttpError } from '../_shared/http.ts'
import { handleOwnerAdmin } from './handler.ts'
import { account, ALLOWED_ORIGIN, captureLogs, fakePort, OWNER_ID, TOKEN } from './testing.ts'

const allowedOrigins = parseAllowedOrigins(`${ALLOWED_ORIGIN},https://usmfomo-admin.pages.dev`)
const PASSWORD = 'Generated-Password-24ch9'

function post(body: unknown, opts: { origin?: string | null; token?: string | null; method?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const origin = opts.origin === undefined ? ALLOWED_ORIGIN : opts.origin
  if (origin !== null) headers.set('Origin', origin)
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)
  const method = opts.method ?? 'POST'
  return new Request('http://localhost/functions/v1/owner-admin', {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
}

async function call(req: Request, port = fakePort().port) {
  let portCreated = false
  const res = await handleOwnerAdmin(req, {
    allowedOrigins,
    port: () => {
      portCreated = true
      return port
    },
    generatePassword: () => PASSWORD,
  })
  const text = await res.text()
  return { res, text, body: text ? JSON.parse(text) : null, portCreated }
}

Deno.test('a refused origin gets 403 without CORS headers, before any auth work', async () => {
  for (const origin of [null, 'https://evil.example', 'https://usmfomo.pages.dev', 'null']) {
    const { res, body, portCreated } = await call(post({ action: 'status' }, { origin }))
    assertEquals(res.status, 403)
    assertEquals(body, { ok: false, error: 'forbidden' })
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), null)
    assertEquals(portCreated, false)
  }
})

Deno.test('preflight: 204 for allowed origins only', async () => {
  const ok = await call(new Request('http://localhost/x', { method: 'OPTIONS', headers: { Origin: ALLOWED_ORIGIN } }))
  assertEquals(ok.res.status, 204)
  assertEquals(ok.res.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
  assert(ok.res.headers.get('Access-Control-Allow-Headers')?.includes('authorization'))
  assertEquals(ok.portCreated, false)

  const bad = await call(
    new Request('http://localhost/x', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
  )
  assertEquals(bad.res.status, 403)
  assertEquals(bad.res.headers.get('Access-Control-Allow-Origin'), null)
})

Deno.test('only POST', async () => {
  const { res, body } = await call(post(null, { method: 'GET' }))
  assertEquals(res.status, 400)
  assertEquals(body, { ok: false, error: 'bad_request' })
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
})

Deno.test('authorisation failures map to 401 / 403', async () => {
  const noToken = await call(post({ action: 'status' }, { token: null }))
  assertEquals([noToken.res.status, noToken.body.error], [401, 'unauthorized'])

  const anon = await call(
    post({ action: 'status' }),
    fakePort({
      verifyToken: () => Promise.resolve({ sub: OWNER_ID, role: 'anon' }),
    }).port,
  )
  assertEquals([anon.res.status, anon.body.error], [401, 'unauthorized'])

  const ended = await call(
    post({ action: 'status' }),
    fakePort({
      sessionUserId: () => Promise.reject(new HttpError('unauthorized')),
    }).port,
  )
  assertEquals([ended.res.status, ended.body.error], [401, 'unauthorized'])

  const club = await call(post({ action: 'status' }), fakePort({ isOwner: () => Promise.resolve(false) }).port)
  assertEquals([club.res.status, club.body.error], [403, 'forbidden'])
  assertEquals(club.res.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
})

Deno.test('the body is only parsed after authorisation', async () => {
  const unauth = await call(post('not json', { token: null }))
  assertEquals(unauth.res.status, 401)
  const bad = await call(post('not json'))
  assertEquals([bad.res.status, bad.body.error], [400, 'bad_request'])
  const unknown = await call(post({ action: 'nope' }))
  assertEquals([unknown.res.status, unknown.body.error], [400, 'bad_request'])
})

Deno.test('success: 200 { ok, data }, CORS and no-store', async () => {
  const { res, body } = await call(post({ action: 'status' }))
  assertEquals(res.status, 200)
  assertEquals(body, { ok: true, data: { live_posts: 3 } })
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  assertEquals(res.headers.get('Content-Type'), 'application/json; charset=utf-8')
})

Deno.test('database errors map to 404 / 409 / 400', async () => {
  const cases: Array<[RpcError, number, string]> = [
    [new RpcError('admin_update_org', 'P0001', 'org_not_found'), 404, 'not_found'],
    [
      new RpcError('admin_update_org', '23505', 'duplicate key value violates unique constraint "orgs_slug_key"'),
      409,
      'conflict',
    ],
    [new RpcError('admin_update_org', '23514', 'new row violates check constraint'), 400, 'bad_request'],
  ]
  for (const [err, status, code] of cases) {
    const { port } = fakePort({ updateOrg: () => Promise.reject(err) })
    const { res, body, text } = await call(
      post({
        action: 'update_org',
        orgId: '11111111-1111-4111-8111-111111111111',
        name: 'CS Society',
        slug: 'cs-society',
        type: 'club',
        campus: 'main',
        active: true,
      }),
      port,
    )
    assertEquals([res.status, body], [status, { ok: false, error: code }])
    assertEquals(text.includes('constraint'), false)
  }
})

Deno.test('rename_account: a taken username is 409, the owner account 403, an unknown one 404', async () => {
  const CLUB = '00000000-0000-4000-8000-000000000002'
  const cases: Array<[Partial<Parameters<typeof fakePort>[0]>, string, number, string]> = [
    [{ getAccountByUsername: () => Promise.resolve(account({ username: 'robotics' })) }, CLUB, 409, 'conflict'],
    [
      { renameAccount: () => Promise.reject(new RpcError('admin_rename_account', 'P0001', 'username_taken')) },
      CLUB,
      409,
      'conflict',
    ],
    [
      { renameAccount: () => Promise.reject(new RpcError('admin_rename_account', 'P0001', 'account_is_owner')) },
      CLUB,
      403,
      'forbidden',
    ],
    [
      { renameAccount: () => Promise.reject(new RpcError('admin_rename_account', '23514', 'check constraint')) },
      CLUB,
      400,
      'bad_request',
    ],
    [{}, OWNER_ID, 403, 'forbidden'],
    [{}, '99999999-9999-4999-8999-999999999999', 404, 'not_found'],
  ]
  for (const [overrides, userId, status, code] of cases) {
    const { port } = fakePort(overrides)
    const { res, body } = await call(post({ action: 'rename_account', userId, username: 'robotics' }), port)
    assertEquals([res.status, body], [status, { ok: false, error: code }])
  }
  const { res, body } = await call(post({ action: 'rename_account', userId: CLUB, username: 'Robotics' }))
  assertEquals([res.status, body], [200, { ok: true, data: { username: 'robotics' } }])
})

Deno.test('unexpected errors are a bare 500: no message, no stack', async () => {
  const { port } = fakePort({ status: () => Promise.reject(new Error('boom: sb_secret_leak at line 3')) })
  const { result, logs } = await captureLogs(() => call(post({ action: 'status' }), port))
  assertEquals(result.res.status, 500)
  assertEquals(result.body, { ok: false, error: 'internal' })
  assertEquals(result.text.includes('boom'), false)
  assertEquals(logs.includes('sb_secret_leak'), false)
})

Deno.test('a generated password is returned once and never logged', async () => {
  const { result, logs } = await captureLogs(() =>
    call(
      post({
        action: 'create_account',
        username: 'csoc',
        orgName: 'CS Society',
        orgSlug: 'csoc',
        type: 'club',
        campus: 'main',
      }),
    )
  )
  assertEquals(result.res.status, 200)
  assertEquals(result.body.data.password, PASSWORD)
  assertEquals(logs.includes(PASSWORD), false)
  assertEquals(logs.includes('csoc'), false)
  assert(logs.includes('"action":"create_account"'))
})

Deno.test('a password the owner typed is used, returned once and never logged', async () => {
  const typed = 'Typed by the Owner 2026'
  const { port, calls } = fakePort()
  const { result, logs } = await captureLogs(() =>
    call(post({ action: 'reset_password', userId: '00000000-0000-4000-8000-000000000002', password: typed }), port)
  )
  assertEquals([result.res.status, result.body], [200, { ok: true, data: { password: typed } }])
  assert(calls.some((c) => c.op === 'updateAuthUser' && JSON.stringify(c.args).includes(typed)))
  assertEquals(logs.includes(typed), false)

  const weak = await call(
    post({ action: 'handover', userId: '00000000-0000-4000-8000-000000000002', password: 'short1A' }),
  )
  assertEquals([weak.res.status, weak.body], [400, { ok: false, error: 'bad_request' }])
  assertEquals(weak.text.includes('short1A'), false)
})
