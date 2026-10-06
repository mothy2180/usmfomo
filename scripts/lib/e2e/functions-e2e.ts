// End-to-end check of the maintenance and owner-admin Edge Functions and the
// owner CLI against the running LOCAL stack (docs/runbooks/functions-local.md):
//
//   node scripts/lib/e2e/functions-e2e.ts
//
// It creates throwaway accounts named zz-e2e-<run>-* (the owner through the
// CLI), signs in with the CAPTCHA test token, enrols TOTP with codes computed
// here (RFC 6238), runs every owner-admin action, checks that a club cannot
// change its own password and that lists, lookups and deletes still work past
// PostgREST's 100-row cap (101 more accounts, an org with 105 files), and
// removes everything it created, also when a check fails. Output is one line
// per check; passwords, tokens and keys are never printed.
import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { usernameToEmail } from '../../../packages/shared/src/supabase.ts'
import { generatePassword, hasRequiredClasses, PASSWORD_LENGTH } from '../../../supabase/functions/_shared/password.ts'
import { createAccount, deleteAccount } from '../../../supabase/functions/owner-admin/actions.ts'
import { main } from '../cli.ts'
import { createCliPort } from '../port.ts'
import { createRestClient } from '../rest.ts'
import { parseStatusEnv, readLocalStatus, resolveTarget } from '../target.ts'

const CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
// 1x1 lossless WebP.
const TINY_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

const target = resolveTarget(process.env)
if (!target.local) throw new Error('functions-e2e only runs against the local stack')
const API = target.url
const PUBLISHABLE = parseStatusEnv(readLocalStatus()).PUBLISHABLE_KEY ?? ''
const dotenv = parseStatusEnv(readFileSync(fileURLToPath(new URL('../../../supabase/.env', import.meta.url)), 'utf8'))
const CRON_SECRET = dotenv.CRON_SECRET ?? ''
const ADMIN_ORIGIN = (dotenv.ADMIN_ORIGINS ?? '').split(',')[0]?.trim() ?? ''
if (!PUBLISHABLE || !CRON_SECRET || !ADMIN_ORIGIN) {
  throw new Error('need PUBLISHABLE_KEY, CRON_SECRET and ADMIN_ORIGINS')
}

const port = createCliPort(createRestClient(target))
const RUN = randomBytes(3).toString('hex')
const names = { owner: `zz-e2e-${RUN}-owner`, club: `zz-e2e-${RUN}-club`, fresh: `zz-e2e-${RUN}-new` }

// ---------------------------------------------------------------------------
// Checks and HTTP
// ---------------------------------------------------------------------------
let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
}
const info = (label: string) => console.log(`INFO  ${label}`)

// `any` on purpose: this script reads many fields of arbitrary API replies,
// and each read is checked by the assertion that uses it.
type Reply = { status: number; headers: Headers; json: any }

async function http(
  method: string,
  path: string,
  opts: { token?: string; apikey?: string | null; origin?: string; body?: unknown; headers?: Record<string, string> } =
    {},
): Promise<Reply> {
  const headers = new Headers(opts.headers)
  const apikey = opts.apikey === undefined ? PUBLISHABLE : opts.apikey
  if (apikey) headers.set('apikey', apikey)
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`)
  if (opts.origin) headers.set('Origin', opts.origin)
  let body: RequestInit['body']
  if (opts.body instanceof Uint8Array || typeof opts.body === 'string') body = opts.body
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${API}${path}`, { method, headers, body, signal: AbortSignal.timeout(60_000) })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, headers: res.headers, json }
}

/** `origin` null sends no Origin header at all. */
const ownerAdmin = (token: string | undefined, body: unknown, origin: string | null = ADMIN_ORIGIN) =>
  http('POST', '/functions/v1/owner-admin', { token, origin: origin ?? undefined, body })

// The local Kong answers every preflight under /functions/v1 itself and
// rewrites Access-Control-Allow-Origin to "*", so the function's own CORS
// answers are checked by talking to the edge runtime directly, from inside the
// Docker network (no tokens involved). Hosted Supabase passes them through.
const KONG_CONTAINER = 'supabase_kong_usmfomo'

function direct(head: string[], body = ''): { status: number; headers: Map<string, string> } | null {
  const lines = [...head, 'Host: edge_runtime:8081', 'Connection: close']
  if (body) lines.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`)
  try {
    const out = execFileSync('docker', [
      'exec',
      '-i',
      KONG_CONTAINER,
      'sh',
      '-c',
      '(cat; sleep 2) | nc edge_runtime 8081',
    ], {
      input: `${lines.join('\r\n')}\r\n\r\n${body}`,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const [statusLine = '', ...rest] = out.split('\r\n\r\n')[0]?.split('\r\n') ?? []
    const headers = new Map(
      rest.map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]),
    )
    return { status: Number(statusLine.split(' ')[1]), headers }
  } catch {
    return null
  }
}

const maintenance = (secret: string | null, method = 'POST', query = '') =>
  http(method, `/functions/v1/maintenance${query}`, {
    apikey: null,
    headers: secret === null ? {} : { 'x-cron-secret': secret },
  })

function signIn(username: string, password: string) {
  return http('POST', '/auth/v1/token?grant_type=password', {
    body: { email: usernameToEmail(username), password, gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN } },
  })
}

async function session(username: string, password: string): Promise<string> {
  const res = await signIn(username, password)
  if (res.status !== 200) throw new Error(`sign-in of ${username} answered ${res.status}`)
  return res.json.access_token as string
}

function claims(token: string): { aal?: string; session_id?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
}

const postingState = async (token: string) =>
  (await http('POST', '/rest/v1/rpc/my_posting_status', { token, body: {} })).json?.state as string | undefined

// ---------------------------------------------------------------------------
// TOTP (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits)
// ---------------------------------------------------------------------------
function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    const i = alphabet.indexOf(c)
    if (i < 0) throw new Error('bad base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32(secret)).update(counter).digest()
  const o = (h[h.length - 1] ?? 0) & 0xf
  const code = (((h[o] ?? 0) & 0x7f) << 24) | ((h[o + 1] ?? 0) << 16) | ((h[o + 2] ?? 0) << 8) | (h[o + 3] ?? 0)
  return String(code % 1_000_000).padStart(6, '0')
}

const usedStep = new Map<string, number>()
/** A code from a time step not used before for this secret (waits for the next step if needed). */
async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const step = Math.floor(Date.now() / 30_000)
    if (usedStep.get(secret) !== step) {
      usedStep.set(secret, step)
      return totp(secret, step)
    }
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 250))
  }
}

async function verifyFactor(token: string, factorId: string, secret: string): Promise<string> {
  const challenge = await http('POST', `/auth/v1/factors/${factorId}/challenge`, { token, body: {} })
  if (challenge.status !== 200) throw new Error(`challenge answered ${challenge.status}`)
  const verified = await http('POST', `/auth/v1/factors/${factorId}/verify`, {
    token,
    body: { challenge_id: challenge.json.id, code: await freshCode(secret) },
  })
  if (verified.status !== 200) throw new Error(`verify answered ${verified.status}`)
  return verified.json.access_token as string
}

async function enrolTotp(token: string, name: string): Promise<{ factorId: string; secret: string; token: string }> {
  const enrol = await http('POST', '/auth/v1/factors', { token, body: { factor_type: 'totp', friendly_name: name } })
  if (enrol.status !== 200) throw new Error(`enrol answered ${enrol.status}`)
  const factorId = enrol.json.id as string
  const secret = enrol.json.totp.secret as string
  return { factorId, secret, token: await verifyFactor(token, factorId, secret) }
}

// ---------------------------------------------------------------------------
// Storage and posts as a club
// ---------------------------------------------------------------------------
const publicObject = async (path: string) => (await http('GET', `/storage/v1/object/public/posters/${path}`)).status

async function upload(token: string, path: string): Promise<number> {
  const res = await http('POST', `/storage/v1/object/posters/${path}`, {
    token,
    body: TINY_WEBP,
    headers: { 'Content-Type': 'image/webp', 'x-upsert': 'false', 'cache-control': '3600' },
  })
  return res.status
}

async function postWithPoster(token: string, orgId: string): Promise<{ id: string; files: string[] }> {
  const id = randomUUID()
  const files = [`${orgId}/${id}.webp`, `${orgId}/${id}-thumb.webp`]
  for (const f of files) if ((await upload(token, f)) !== 200) throw new Error('poster upload failed')
  const now = Date.now()
  const res = await http('POST', '/rest/v1/posts', {
    token,
    headers: { Prefer: 'return=representation' },
    body: {
      campus: 'main',
      title: `ZZ e2e ${RUN}`,
      venue: 'DK A',
      starts_at: new Date(now + 2 * 3600e3).toISOString(),
      ends_at: new Date(now + 4 * 3600e3).toISOString(),
      poster_path: files[0],
      thumb_path: files[1],
    },
  })
  if (res.status !== 201) throw new Error(`post insert answered ${res.status}`)
  return { id: res.json[0].id as string, files }
}

const ownPost = async (token: string, id: string) =>
  (await http('GET', `/rest/v1/posts?id=eq.${id}&select=id,poster_path,thumb_path`, { token })).json as Array<
    { poster_path: string | null }
  >

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
async function heartbeat(): Promise<string | null> {
  return ((await port.status()) as { last_maintenance_at: string | null }).last_maintenance_at
}

async function maintenanceChecks(): Promise<void> {
  for (
    const [label, secret, method] of [
      ['without x-cron-secret', null, 'POST'],
      ['with a wrong secret', 'wrong-secret', 'POST'],
      ['with the right secret but GET', CRON_SECRET, 'GET'],
    ] as const
  ) {
    const res = await maintenance(secret, method)
    check(`maintenance ${label} -> 401`, res.status === 401 && res.json?.error === 'unauthorized', String(res.status))
  }
  const before = await heartbeat()
  await new Promise((r) => setTimeout(r, 1100))
  const res = await maintenance(CRON_SECRET)
  const keys = Object.keys(res.json ?? {}).sort().join(',')
  check('maintenance with the right secret -> 200 with counts', res.status === 200 && res.json.ok === true, keys)
  info(`maintenance counts: ${JSON.stringify({ purged: res.json?.purged, files: res.json?.files })}`)
  const after = await heartbeat()
  check('heartbeat moved', after !== null && (before === null || Date.parse(after) > Date.parse(before)))
}

async function corsAndAuthChecks(ownerAal1: string, ownerAal2: string): Promise<void> {
  // Through the gateway: the function itself refuses other origins.
  for (const origin of ['https://evil.example', 'https://usmfomo.pages.dev', null]) {
    const res = await ownerAdmin(ownerAal2, { action: 'status' }, origin)
    check(
      `aal2 owner from ${origin ?? 'no Origin'} -> 403 forbidden`,
      res.status === 403 && res.json?.error === 'forbidden',
      String(res.status),
    )
  }
  const viaKong = await http('OPTIONS', '/functions/v1/owner-admin', {
    apikey: null,
    origin: 'https://evil.example',
    headers: { 'Access-Control-Request-Method': 'POST' },
  })
  info(
    `local Kong answers a preflight from any origin itself: ${viaKong.status}, ` +
      `Access-Control-Allow-Origin ${viaKong.headers.get('access-control-allow-origin')}`,
  )

  // Directly against the edge runtime: the function's own CORS answers.
  const preflight = (origin: string) =>
    direct([
      'OPTIONS /owner-admin HTTP/1.1',
      `Origin: ${origin}`,
      'Access-Control-Request-Method: POST',
      'Access-Control-Request-Headers: authorization,apikey,content-type,x-client-info',
    ])
  const pre = preflight(ADMIN_ORIGIN)
  if (!pre) {
    info('docker not reachable: direct CORS checks skipped')
  } else {
    const allowHeaders = pre.headers.get('access-control-allow-headers') ?? ''
    check(
      'direct: preflight from the admin origin -> 204, exact origin, supabase-js headers',
      pre.status === 204 && pre.headers.get('access-control-allow-origin') === ADMIN_ORIGIN &&
        pre.headers.get('access-control-allow-methods') === 'POST, OPTIONS' &&
        ['authorization', 'apikey', 'content-type', 'x-client-info'].every((h) => allowHeaders.includes(h)),
      String(pre.status),
    )
    const badPre = preflight('https://evil.example')
    check(
      'direct: preflight from another origin -> 403 without CORS headers',
      badPre?.status === 403 && !badPre.headers.has('access-control-allow-origin'),
      String(badPre?.status),
    )
    const allowed = direct(['POST /owner-admin HTTP/1.1', `Origin: ${ADMIN_ORIGIN}`], '{}')
    check(
      'direct: allowed origin without a token -> 401 with its exact origin',
      allowed?.status === 401 && allowed.headers.get('access-control-allow-origin') === ADMIN_ORIGIN,
      String(allowed?.status),
    )
    for (const head of [['Origin: https://evil.example'], []]) {
      const res = direct(['POST /owner-admin HTTP/1.1', ...head], '{}')
      check(
        `direct: POST from ${head[0] ?? 'no Origin'} -> 403 without CORS headers`,
        res?.status === 403 && !res.headers.has('access-control-allow-origin'),
        String(res?.status),
      )
    }
  }

  for (
    const [label, token] of [
      ['no token', undefined],
      ['a garbage token', 'aaaa.bbbb.cccc'],
      ['the publishable key as bearer', PUBLISHABLE],
    ] as const
  ) {
    const res = await ownerAdmin(token, { action: 'status' })
    check(`${label} -> 401`, res.status === 401 && res.json?.error === 'unauthorized', String(res.status))
  }
  const aal1 = await ownerAdmin(ownerAal1, { action: 'status' })
  check(
    `owner at ${claims(ownerAal1).aal} -> 403 mfa_required`,
    aal1.status === 403 && aal1.json?.error === 'mfa_required',
  )
}

/** Runs the owner CLI in-process; stdout comes back, stderr is dropped. */
async function cli(...argv: string[]): Promise<{ code: number; out: string }> {
  const out: string[] = []
  const code = await main(argv, { env: process.env, io: { out: (l) => out.push(l), err: () => {} } })
  return { code, out: out.join('\n') }
}

const printedPassword = (out: string) => /password: (\S+)/.exec(out)?.[1] ?? ''

/** A club session sets a valid new password itself (PUT /auth/v1/user); the database must refuse it (0052). */
async function selfChange(token: string): Promise<{ refused: boolean; attempted: string; detail: string }> {
  const attempted = generatePassword()
  const res = await http('PUT', '/auth/v1/user', { token, body: { password: attempted } })
  return {
    refused: res.status >= 400 && res.json?.message === 'password_change_refused',
    attempted,
    detail: `${res.status} ${res.json?.message ?? res.json?.error_code ?? ''}`,
  }
}

/** A poster file uploaded with the secret key, which the 40-file limit for clubs does not cover. */
async function uploadAsService(path: string): Promise<void> {
  const res = await http('POST', `/storage/v1/object/posters/${path}`, {
    apikey: target.key,
    body: TINY_WEBP,
    headers: { 'Content-Type': 'image/webp', 'x-upsert': 'false' },
  })
  if (res.status !== 200) throw new Error(`service upload answered ${res.status}`)
}

/**
 * More accounts and files than PostgREST's max_rows (100), which cuts every
 * set-returning RPC: the account list, per-account actions and deletes on
 * accounts past the first page, and an org with more than 100 poster files.
 */
async function beyondMaxRowsChecks(ok: (body: Record<string, unknown>) => Promise<any>): Promise<void> {
  const inputs = Array.from({ length: 101 }, (_, i) => {
    const n = String(i + 1).padStart(3, '0')
    const name = `zz-e2e-${RUN}-b${n}`
    return { username: name, orgName: `ZZ E2E ${RUN} Bulk ${n}`, orgSlug: name, type: 'club', campus: 'main' } as const
  })
  const bulk: Array<{ userId: string; orgId: string; username: string }> = []
  for (let i = 0; i < inputs.length; i += 10) {
    const batch = inputs.slice(i, i + 10).map((input) => createAccount({ port, generatePassword }, input))
    bulk.push(...(await Promise.all(batch)))
  }
  const [big, last] = bulk.slice(-2)
  if (!big || !last) throw new Error('bulk accounts missing')

  const listed = (await ok({ action: 'list_accounts' })) as Array<{ username: string }>
  const ours = listed.filter((a) => a.username.startsWith(`zz-e2e-${RUN}-b`)).length
  check(`list_accounts returns every account (${listed.length}, more than 100)`, listed.length > 100 && ours === 101)
  const reset = await ok({ action: 'reset_password', userId: last.userId })
  check('reset_password of an account past the first page', typeof reset.password === 'string')

  const list = await cli('list')
  const total = /^(\d+) account\(s\)/m.exec(list.out)?.[1]
  check('CLI list shows every account and the true total', list.code === 0 && total === String(listed.length), total)
  const off = await cli('deactivate', last.username)
  const on = await cli('activate', last.username)
  check('CLI deactivate and activate an account past the first page', off.code === 0 && on.code === 0)

  // delete_account lists the org's files in one jsonb value (0051), so all 105 go.
  const files = Array.from({ length: 105 }, () => `${big.orgId}/${randomUUID()}.webp`)
  for (let i = 0; i < files.length; i += 15) await Promise.all(files.slice(i, i + 15).map(uploadAsService))
  check('an org with 105 poster files', (await port.orgObjects(big.orgId)).length === 105)
  const bigGone = await ok({ action: 'delete_account', userId: big.userId })
  check(
    'delete_account removes all 105 files, the org and the account',
    bigGone.removedFiles === 105 && (await port.orgObjects(big.orgId)).length === 0 &&
      (await port.getAccount(big.userId)) === null && (await publicObject(files[104] ?? '')) !== 200,
    JSON.stringify(bigGone),
  )

  // The direct lookup finds the account, so delete_account takes the full path
  // and the org goes too (not only the sign-in).
  const lastGone = await ok({ action: 'delete_account', userId: last.userId })
  const orgLeft = await http('GET', `/rest/v1/orgs?select=id&slug=eq.${last.username}`)
  check(
    'delete_account of the last-sorting account removes its org, not just the sign-in',
    lastGone.removedFiles === 0 && (await port.getAccount(last.userId)) === null &&
      Array.isArray(orgLeft.json) && orgLeft.json.length === 0,
    JSON.stringify(orgLeft.json),
  )
}

async function run(): Promise<void> {
  await maintenanceChecks()

  // Owner, created with the CLI.
  const out: string[] = []
  const code = await main(['create-owner', names.owner], {
    env: process.env,
    io: { out: (l) => out.push(l), err: () => {} },
  })
  const ownerPassword = /password: (\S+)/.exec(out.join('\n'))?.[1] ?? ''
  check('CLI create-owner', code === 0 && ownerPassword.length === PASSWORD_LENGTH)
  const ownerAal1 = await session(names.owner, ownerPassword)
  const ownerFactor = await enrolTotp(ownerAal1, 'e2e phone')
  const owner = ownerFactor.token
  check('owner enrolled TOTP -> aal2 token', claims(owner).aal === 'aal2')
  await corsAndAuthChecks(ownerAal1, owner)

  const ok = async (body: Record<string, unknown>) => {
    const res = await ownerAdmin(owner, body)
    if (res.status !== 200 || res.json?.ok !== true) {
      throw new Error(`${body.action} answered ${res.status} ${res.json?.error}`)
    }
    return res.json.data
  }
  const expectError = async (label: string, body: unknown, status: number, error: string) => {
    const res = await ownerAdmin(owner, body)
    check(
      `${label} -> ${status} ${error}`,
      res.status === status && res.json?.error === error,
      `${res.status} ${res.json?.error}`,
    )
  }

  const status = await ok({ action: 'status' })
  check('status', typeof status === 'object' && 'last_maintenance_at' in status && 'settings' in status)

  // create_account (+ conflicts and validation)
  const club = await ok({
    action: 'create_account',
    username: names.club,
    orgName: `ZZ E2E ${RUN} Club`,
    orgSlug: names.club,
    type: 'club',
    campus: 'main',
  })
  check(
    'create_account',
    club.username === names.club && club.password.length === PASSWORD_LENGTH && hasRequiredClasses(club.password),
  )
  const fresh = await ok({
    action: 'create_account',
    username: names.fresh,
    orgName: `ZZ E2E ${RUN} New`,
    orgSlug: names.fresh,
    type: 'school',
    campus: 'health',
  })
  await expectError(
    'create_account with a taken username',
    {
      action: 'create_account',
      username: names.club,
      orgName: `ZZ E2E ${RUN} X`,
      orgSlug: `zz-e2e-${RUN}-x`,
      type: 'club',
      campus: 'main',
    },
    409,
    'conflict',
  )
  const dup = `zz-e2e-${RUN}-dup`
  await expectError(
    'create_account with a taken slug',
    {
      action: 'create_account',
      username: dup,
      orgName: `ZZ E2E ${RUN} Dup`,
      orgSlug: names.club,
      type: 'club',
      campus: 'main',
    },
    409,
    'conflict',
  )
  const dupSignIn = await signIn(dup, 'Whatever-password-1234')
  check(
    'a failed create_account leaves no sign-in behind',
    dupSignIn.status === 400 && dupSignIn.json?.error_code === 'invalid_credentials',
    dupSignIn.json?.error_code,
  )
  await expectError(
    'create_account with campus online',
    {
      action: 'create_account',
      username: `zz-e2e-${RUN}-y`,
      orgName: 'ZZ Y',
      orgSlug: `zz-e2e-${RUN}-y`,
      type: 'club',
      campus: 'online',
    },
    400,
    'bad_request',
  )

  type Row = {
    user_id: string
    username: string
    factor_count: number
    account_active: boolean
    org_name: string | null
    banned_until: string | null
  }
  const accounts = (await ok({ action: 'list_accounts' })) as Row[]
  check(
    'list_accounts shows the new accounts',
    [names.owner, names.club, names.fresh].every((n) => accounts.some((a) => a.username === n)),
  )
  const ownerId = accounts.find((a) => a.username === names.owner)?.user_id ?? ''

  // A club account is refused: mfa_required at aal1, forbidden at aal2.
  const clubAal1 = await session(names.club, club.password)
  const clubAt1 = await ownerAdmin(clubAal1, { action: 'status' })
  check('club account at aal1 -> 403 mfa_required', clubAt1.status === 403 && clubAt1.json?.error === 'mfa_required')

  // A club cannot change its own password: the database refuses it (0052).
  const selfAal1 = await selfChange(clubAal1)
  check('club changes its own password (no 2FA) -> refused by the database', selfAal1.refused, selfAal1.detail)
  check(
    'after the refused change the owner-issued password still works, the attempted one does not',
    (await signIn(names.club, club.password)).status === 200 &&
      (await signIn(names.club, selfAal1.attempted)).status === 400,
  )

  const clubFactor = await enrolTotp(clubAal1, 'club phone')
  const clubToken = clubFactor.token
  const clubAt2 = await ownerAdmin(clubToken, { action: 'status' })
  check('club account at aal2 -> 403 forbidden', clubAt2.status === 403 && clubAt2.json?.error === 'forbidden')
  const selfAal2 = await selfChange(clubToken)
  check('club changes its own password at aal2 -> refused by the database', selfAal2.refused, selfAal2.detail)

  // Posters: remove_post_image and delete_post remove the files at once.
  const p1 = await postWithPoster(clubToken, club.orgId)
  const p2 = await postWithPoster(clubToken, club.orgId)
  check('club uploaded posters and posted', (await publicObject(p1.files[0] ?? '')) === 200)
  const img = await ok({ action: 'remove_post_image', postId: p1.id })
  const afterImg = await ownPost(clubToken, p1.id)
  check(
    'remove_post_image -> files gone, post kept',
    img.removedFiles === 2 && img.failedFiles === 0 && afterImg.length === 1 && afterImg[0]?.poster_path === null &&
      (await publicObject(p1.files[0] ?? '')) !== 200,
    JSON.stringify(img),
  )
  const del = await ok({ action: 'delete_post', postId: p2.id })
  check(
    'delete_post -> post and files gone',
    del.removedFiles === 2 && del.failedFiles === 0 && (await ownPost(clubToken, p2.id)).length === 0 &&
      (await publicObject(p2.files[1] ?? '')) !== 200,
    JSON.stringify(del),
  )
  await expectError('delete_post of an unknown post', { action: 'delete_post', postId: randomUUID() }, 404, 'not_found')
  await expectError(
    'remove_post_image of an unknown post',
    { action: 'remove_post_image', postId: randomUUID() },
    404,
    'not_found',
  )
  const orphan = `${club.orgId}/${randomUUID()}.webp`
  check('club uploaded a file without a post', (await upload(clubToken, orphan)) === 200)

  // remove_factors, then handover (ends sessions, new password).
  const removed = await ok({ action: 'remove_factors', userId: club.userId })
  check('remove_factors', removed.removed === 1, JSON.stringify(removed))
  const handed = await ok({ action: 'handover', userId: club.userId })
  check('handover: old session ended', (await postingState(clubToken)) === 'session_ended')
  const clubAfter = await signIn(names.club, handed.password)
  const clubOld = await signIn(names.club, club.password)
  check('handover: new password works, old one does not', clubAfter.status === 200 && clubOld.status === 400)
  const clubRow = ((await ok({ action: 'list_accounts' })) as Row[]).find((a) => a.username === names.club)
  check(
    'handover: active, no factors, not banned',
    clubRow?.account_active === true && clubRow.factor_count === 0 && clubRow.banned_until === null,
  )

  // reset_password ends sessions at once (database writes too).
  const freshToken = await session(names.fresh, fresh.password)
  check('new school account can sign in', (await postingState(freshToken)) === 'ok')
  const reset = await ok({ action: 'reset_password', userId: fresh.userId })
  check('reset_password: old session ended in the database', (await postingState(freshToken)) === 'session_ended')
  const userAfterReset = await http('GET', '/auth/v1/user', { token: freshToken })
  check(
    'reset_password: Auth refuses the old session',
    userAfterReset.status === 403 || userAfterReset.status === 401,
    String(userAfterReset.status),
  )
  const freshToken2 = await session(names.fresh, reset.password)

  // set_account_active: false stops writes at once and bans sign-in.
  await ok({ action: 'set_account_active', userId: fresh.userId, active: false })
  check('deactivated: database says inactive', (await postingState(freshToken2)) === 'inactive')
  const banned = await signIn(names.fresh, reset.password)
  check(
    'deactivated: sign-in refused (banned)',
    banned.status === 400 && banned.json?.error_code === 'user_banned',
    `${banned.status} ${banned.json?.error_code}`,
  )
  const bannedUser = await http('GET', '/auth/v1/user', { token: freshToken2 })
  info(`GET /auth/v1/user with a banned user's live token answers ${bannedUser.status}`)
  await ok({ action: 'set_account_active', userId: fresh.userId, active: true })
  check('reactivated: sign-in works', (await signIn(names.fresh, reset.password)).status === 200)

  // The CLI asks the database for the one-time grant too.
  const cliReset = await cli('reset-password', names.fresh)
  check(
    'CLI reset-password: the new password works',
    cliReset.code === 0 && (await signIn(names.fresh, printedPassword(cliReset.out))).status === 200,
  )

  // update_org
  await ok({
    action: 'update_org',
    orgId: fresh.orgId,
    name: `ZZ E2E ${RUN} Renamed`,
    slug: `zz-e2e-${RUN}-renamed`,
    type: 'school',
    campus: 'main',
    active: true,
  })
  const renamed = ((await ok({ action: 'list_accounts' })) as Row[]).find((a) => a.username === names.fresh)
  check('update_org', renamed?.org_name === `ZZ E2E ${RUN} Renamed`)
  await expectError(
    'update_org to a taken slug',
    {
      action: 'update_org',
      orgId: fresh.orgId,
      name: `ZZ E2E ${RUN} Renamed`,
      slug: names.club,
      type: 'school',
      campus: 'main',
      active: true,
    },
    409,
    'conflict',
  )
  await expectError(
    'update_org of an unknown org',
    {
      action: 'update_org',
      orgId: randomUUID(),
      name: 'ZZ Nobody',
      slug: `zz-e2e-${RUN}-nobody`,
      type: 'club',
      campus: 'main',
      active: true,
    },
    404,
    'not_found',
  )

  // Owner account is refused by every account action; bad input is 400; unknown ids 404.
  for (const action of ['reset_password', 'handover', 'remove_factors', 'delete_account']) {
    await expectError(`${action} of the owner`, { action, userId: ownerId }, 403, 'forbidden')
  }
  await expectError(
    'set_account_active of the owner',
    { action: 'set_account_active', userId: ownerId, active: false },
    403,
    'forbidden',
  )
  await expectError(
    'reset_password of an unknown user',
    { action: 'reset_password', userId: randomUUID() },
    404,
    'not_found',
  )
  await expectError('an unknown action', { action: 'drop_everything' }, 400, 'bad_request')
  await expectError('a non-uuid userId', { action: 'handover', userId: 'csoc' }, 400, 'bad_request')
  const bigBody = await http('POST', '/functions/v1/owner-admin', {
    token: owner,
    origin: ADMIN_ORIGIN,
    body: { action: 'status', pad: 'x'.repeat(9000) },
  })
  check('a body over 8 KiB -> 400', bigBody.status === 400)
  const notJson = await http('POST', '/functions/v1/owner-admin', {
    token: owner,
    origin: ADMIN_ORIGIN,
    body: 'not json',
    headers: { 'Content-Type': 'application/json' },
  })
  check('a body that is not JSON -> 400', notJson.status === 400)

  // delete_account removes the org's files (here: the post-less upload) first.
  const gone = await ok({ action: 'delete_account', userId: club.userId })
  check(
    'delete_account removes files, org and sign-in',
    gone.removedFiles === 1 && (await publicObject(orphan)) !== 200 &&
      (await signIn(names.club, handed.password)).status === 400,
    JSON.stringify(gone),
  )
  const gone2 = await ok({ action: 'delete_account', userId: fresh.userId })
  check('delete_account of an account without files', gone2.removedFiles === 0)

  await beyondMaxRowsChecks(ok)

  // An ended owner session is refused even while its access token is unexpired.
  const second = await session(names.owner, ownerPassword)
  const secondAal2 = await verifyFactor(second, ownerFactor.factorId, ownerFactor.secret)
  check('owner second session at aal2 works', (await ownerAdmin(secondAal2, { action: 'status' })).status === 200)
  const logout = await http('POST', '/auth/v1/logout?scope=local', { token: secondAal2 })
  const ended = await ownerAdmin(secondAal2, { action: 'status' })
  check(
    'owner session ended by sign-out -> 401',
    logout.status === 204 && ended.status === 401 && ended.json?.error === 'unauthorized',
    `${logout.status}/${ended.status}`,
  )
  check('the other owner session is unaffected', (await ownerAdmin(owner, { action: 'status' })).status === 200)

  // Break-glass: the CLI resets the owner's own password through a grant too.
  // Last, because it ends every owner session.
  const ownerReset = await cli('reset-password', names.owner)
  check(
    'CLI reset-password of the owner: the new password works',
    ownerReset.code === 0 && (await signIn(names.owner, printedPassword(ownerReset.out))).status === 200,
  )
}

async function cleanup(): Promise<void> {
  const ours = (await port.listAccounts()).filter((x) => x.username.startsWith(`zz-e2e-${RUN}-`))
  // Ten at a time: the bulk check leaves about a hundred accounts behind.
  for (let i = 0; i < ours.length; i += 10) {
    await Promise.all(
      ours.slice(i, i + 10).map((a) => a.is_owner ? port.deleteAuthUser(a.user_id) : deleteAccount(port, a.user_id)),
    )
  }
  // Sign-ins left without an account row (only if a rollback had failed).
  const users = (await createRestClient(target).request('auth', 'GET', '/admin/users?page=1&per_page=1000')) as {
    users: Array<{ id: string; email?: string }>
  }
  for (const u of users.users.filter((x) => x.email?.startsWith(`zz-e2e-${RUN}-`))) await port.deleteAuthUser(u.id)
  const left = (await port.listAccounts()).filter((a) => a.username.startsWith(`zz-e2e-${RUN}-`))
  check('cleanup: no zz-e2e accounts left', left.length === 0)
}

console.log(`functions-e2e run ${RUN} against ${API}`)
try {
  await run()
} catch (err) {
  failures++
  console.log(`FAIL  aborted: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  await cleanup()
}
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
