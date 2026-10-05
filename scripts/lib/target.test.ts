import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigError, DEFAULT_SUPABASE_URL, parseStatusEnv, parseSupabaseUrl, resolveTarget } from './target.ts'

const KEY = 'sb_secret_FakeForTests-0123456789_abcdef'
const STATUS = [
  'ANON_KEY="eyJhbGciOiJIUzI1NiJ9.FakeForTests.x"',
  'API_URL="http://127.0.0.1:54321"',
  'PUBLISHABLE_KEY="sb_publishable_local"',
  `SECRET_KEY="${KEY}"`,
  'SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiJ9.FakeForTests.y"',
].join('\n')

const noStatus = () => {
  throw new Error('must not run')
}

/** Expects a ConfigError matching `message` that mentions none of `secrets`. */
function failsWith(fn: () => unknown, message: RegExp, secrets: string[] = [KEY]) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof ConfigError, String(err))
    assert.match(err.message, message)
    for (const secret of secrets) assert.equal(err.message.includes(secret), false, 'message echoes a key')
    return true
  })
}

describe('parseSupabaseUrl', () => {
  it('accepts project origins; plain http only for the local stack', () => {
    assert.deepEqual(parseSupabaseUrl('http://127.0.0.1:54321'), { url: 'http://127.0.0.1:54321', local: true })
    assert.deepEqual(parseSupabaseUrl('http://localhost:54321/'), { url: 'http://localhost:54321', local: true })
    assert.deepEqual(parseSupabaseUrl('http://[::1]:54321'), { url: 'http://[::1]:54321', local: true })
    assert.deepEqual(parseSupabaseUrl(' https://abcd.supabase.co '), { url: 'https://abcd.supabase.co', local: false })
  })

  it('refuses http for hosted projects, paths, credentials and other schemes', () => {
    failsWith(() => parseSupabaseUrl('http://abcd.supabase.co'), /https:\/\//)
    failsWith(() => parseSupabaseUrl('https://abcd.supabase.co/rest/v1'), /project URL only/)
    failsWith(() => parseSupabaseUrl('https://user:pw@abcd.supabase.co'), /project URL only/)
    failsWith(() => parseSupabaseUrl('https://abcd.supabase.co?x=1'), /project URL only/)
    failsWith(() => parseSupabaseUrl('ftp://abcd.supabase.co'), /http\(s\)/)
    failsWith(() => parseSupabaseUrl('abcd.supabase.co'), /not a valid URL/)
    // Not local just because it starts with 127.0.0.1.
    failsWith(() => parseSupabaseUrl('http://127.0.0.1.evil.example'), /https:\/\//)
  })
})

describe('parseStatusEnv', () => {
  it('reads KEY="value" lines', () => {
    const env = parseStatusEnv(`${STATUS}\nnot a line\nEMPTY=\nPLAIN=value\nSINGLE='q'\n`)
    assert.equal(env.SECRET_KEY, KEY)
    assert.equal(env.API_URL, 'http://127.0.0.1:54321')
    assert.equal(env.EMPTY, '')
    assert.equal(env.PLAIN, 'value')
    assert.equal(env.SINGLE, 'q')
  })
})

describe('resolveTarget', () => {
  it('defaults to the local stack and reads its secret key from supabase status', () => {
    let runs = 0
    const target = resolveTarget({}, () => {
      runs++
      return STATUS
    })
    assert.deepEqual(target, { url: DEFAULT_SUPABASE_URL, key: KEY, local: true })
    assert.equal(runs, 1)
  })

  it('uses SUPABASE_SECRET_KEY when given, without running supabase status', () => {
    const target = resolveTarget(
      { SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_SECRET_KEY: ` ${KEY} ` },
      noStatus,
    )
    assert.deepEqual(target, { url: 'https://abcd.supabase.co', key: KEY, local: false })
  })

  it('a hosted project needs the key passed explicitly', () => {
    failsWith(
      () => resolveTarget({ SUPABASE_URL: 'https://abcd.supabase.co' }, noStatus),
      /SUPABASE_SECRET_KEY is required/,
    )
  })

  it('explains a stopped local stack', () => {
    failsWith(() => resolveTarget({}, noStatus), /is the local stack running/)
    failsWith(() => resolveTarget({}, () => 'API_URL="http://127.0.0.1:54321"'), /printed no SECRET_KEY/)
  })

  it('refuses keys that are not secret API keys, without echoing them', () => {
    for (const key of ['sb_publishable_abc', 'eyJhbGciOiJIUzI1NiJ9.FakeForTests.x', 'sb_secret_a b', 'sb_secret_x;y']) {
      failsWith(() => resolveTarget({ SUPABASE_SECRET_KEY: key }, noStatus), /must be a secret API key/, [key])
    }
    failsWith(() => resolveTarget({ SUPABASE_SECRET_KEY: 'sb_secret_' }, noStatus), /must be a secret API key/)
  })
})
