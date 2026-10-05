// main() end to end over a fake Supabase: argv in, exit code and output out.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { main } from './cli.ts'
import { captureIo, CLUB, OWNER } from './testing.ts'

const KEY = 'sb_secret_FakeForTests-0123456789_abcdef'
const PASSWORD = 'FakeForTests23456789abcd'
const NEW_USER = '00000000-0000-4000-8000-00000000c0de'
const NEW_ORG = '00000000-0000-4000-8000-0000000000fe'

type Seen = { method: string; path: string; headers: Headers; body: unknown }

function fakeSupabase() {
  const seen: Seen[] = []
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    seen.push({ method: init?.method ?? 'GET', path: url.pathname, headers: new Headers(init?.headers), body })
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
    switch (`${init?.method} ${url.pathname}`) {
      case 'POST /rest/v1/rpc/admin_list_accounts':
        return json([OWNER, CLUB])
      case 'POST /auth/v1/admin/users':
        return json({ id: NEW_USER })
      case 'POST /rest/v1/rpc/admin_create_org_account':
        return json(NEW_ORG)
      default:
        return json({ code: 'PGRST202', message: 'not found' }, 404)
    }
  }) as typeof globalThis.fetch
  return { fetch, seen }
}

const statusWithKey = () => `API_URL="http://127.0.0.1:54321"\nSECRET_KEY="${KEY}"\n`

async function run(argv: string[], env: Record<string, string> = {}) {
  const io = captureIo()
  const server = fakeSupabase()
  const code = await main(argv, {
    env,
    io,
    fetch: server.fetch,
    readLocalStatus: statusWithKey,
    generatePassword: () => PASSWORD,
  })
  return { code, io, seen: server.seen }
}

describe('main', () => {
  it('--help prints the usage and exits 0 without touching the network', async () => {
    const { code, io, seen } = await run(['--help'])
    assert.equal(code, 0)
    assert.match(io.stdout.join('\n'), /^usage: pnpm account <command>/)
    assert.equal(seen.length, 0)
  })

  it('a bad command line exits 2', async () => {
    for (const argv of [[], ['nope'], ['list', '--org', 'x'], ['create', 'csoc']]) {
      const { code, io, seen } = await run(argv)
      assert.equal(code, 2, argv.join(' '))
      assert.match(io.stderr.join('\n'), /^error: /)
      assert.equal(seen.length, 0)
    }
  })

  it('list: local stack key from supabase status, apikey header only', async () => {
    const { code, io, seen } = await run(['list'])
    assert.equal(code, 0)
    assert.match(io.stderr[0] ?? '', /^supabase: http:\/\/127\.0\.0\.1:54321 \(local stack\)$/)
    assert.match(io.stdout.join('\n'), /csoc\s+club\s+Computer Science Society/)
    assert.equal(seen[0]?.headers.get('apikey'), KEY)
    assert.equal(seen[0]?.headers.get('Authorization'), null)
    assert.equal(io.all().includes(KEY), false)
  })

  it('create: prints the new password once and never the key', async () => {
    const { code, io, seen } = await run(['create', 'robotics', '--org', 'Robotics Club', '--type', 'club'])
    assert.equal(code, 0)
    assert.deepEqual(seen.map((s) => `${s.method} ${s.path}`), [
      'POST /auth/v1/admin/users',
      'POST /rest/v1/rpc/admin_create_org_account',
    ])
    assert.deepEqual(seen[0]?.body, { email: 'robotics@usmfomo.pages.dev', password: PASSWORD, email_confirm: true })
    assert.equal(io.all().split(PASSWORD).length - 1, 1)
    assert.equal(io.all().includes(KEY), false)
  })

  it('a hosted project without a key exits 1 before any request', async () => {
    const { code, io, seen } = await run(['list'], { SUPABASE_URL: 'https://abcd.supabase.co' })
    assert.equal(code, 1)
    assert.match(io.stderr.join('\n'), /SUPABASE_SECRET_KEY is required/)
    assert.equal(seen.length, 0)
  })

  it('a hosted project with its key: no local status read, https target shown', async () => {
    const io = captureIo()
    const server = fakeSupabase()
    const code = await main(['list'], {
      env: { SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_SECRET_KEY: KEY },
      io,
      fetch: server.fetch,
      readLocalStatus: () => {
        throw new Error('must not run')
      },
    })
    assert.equal(code, 0)
    assert.equal(io.stderr[0], 'supabase: https://abcd.supabase.co')
  })

  it('API failures exit 1 with one line', async () => {
    const { code, io } = await run(['delete', 'nobody', '--yes'])
    assert.equal(code, 1)
    assert.deepEqual(io.stderr.slice(1), ['error: no account named "nobody" (see: pnpm account list)'])
  })
})
