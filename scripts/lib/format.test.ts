import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HttpError } from '../../supabase/functions/_shared/http.ts'
import { UsageError } from './args.ts'
import { accountStatus, CliError, describeFailure, formatAccounts } from './format.ts'
import { ApiError } from './rest.ts'
import { ConfigError } from './target.ts'
import { accountRow, CLUB, OWNER } from './testing.ts'

const NOW = new Date('2026-10-05T06:00:00Z')

describe('formatAccounts', () => {
  it('one aligned row per account, times in MYT', () => {
    const text = formatAccounts([
      OWNER,
      CLUB,
      accountRow({ username: 'never-in', last_sign_in_at: null, org_type: 'school' }),
    ], NOW)
    const lines = text.split('\n')
    assert.match(
      lines[0] ?? '',
      /^USERNAME\s+KIND\s+ORGANISATION\s+SLUG\s+CAMPUS\s+STATUS\s+2FA\s+LIVE\s+LAST SIGN-IN \(MYT\)$/,
    )
    // 04:30 UTC is 12:30 in Malaysia.
    assert.match(
      lines[2] ?? '',
      /^csoc\s+club\s+Computer Science Society\s+csoc\s+main\s+active\s+1\s+3\s+2026-10-05 12:30$/,
    )
    assert.match(lines[1] ?? '', /^owner\s+owner\s+-\s+-\s+-\s+active\s+2\s+-\s+2026-10-05 12:30$/)
    assert.match(lines[3] ?? '', /never$/)
    assert.equal(lines.at(-1), '3 account(s): 1 owner, 1 club, 1 school')
    // Columns line up: every row starts its KIND column at the same offset.
    const kindAt = (lines[0] ?? '').indexOf('KIND')
    for (const line of lines.slice(1, 4)) assert.match(line.slice(kindAt), /^(owner|club|school)/)
  })

  it('long organisation names are shortened', () => {
    const text = formatAccounts([accountRow({ org_name: 'x'.repeat(100) })], NOW)
    assert.ok(text.includes(`${'x'.repeat(39)}…`))
    assert.equal(text.includes('x'.repeat(41)), false)
  })

  it('no accounts yet', () => {
    assert.match(formatAccounts([], NOW), /create-owner/)
  })
})

describe('accountStatus', () => {
  it('inactive, org inactive, banned', () => {
    assert.equal(accountStatus(CLUB, NOW), 'active')
    assert.equal(accountStatus(accountRow({ account_active: false }), NOW), 'inactive')
    assert.equal(accountStatus(accountRow({ org_active: false }), NOW), 'org inactive')
    assert.equal(
      accountStatus(accountRow({ account_active: false, banned_until: '2126-01-01T00:00:00Z' }), NOW),
      'inactive, banned',
    )
    assert.equal(accountStatus(accountRow({ banned_until: '2026-01-01T00:00:00Z' }), NOW), 'active')
  })
})

describe('describeFailure', () => {
  it('own errors pass their message through', () => {
    assert.equal(describeFailure(new CliError('a')), 'a')
    assert.equal(describeFailure(new UsageError('b')), 'b')
    assert.equal(describeFailure(new ConfigError('c')), 'c')
  })

  it('explains common API failures', () => {
    const cases: Array<[ApiError, RegExp]> = [
      [new ApiError('auth', 422, 'email_exists', 'x'), /sign-in for this username already exists/],
      [new ApiError('auth', 403, 'not_admin', 'User not allowed'), /API key was refused/],
      [new ApiError('rest', 401, '42501', 'permission denied'), /API key was refused/],
      [new ApiError('rest', 409, '23505', 'violates unique constraint "orgs_slug_key"'), /slug already exists/],
      [new ApiError('rest', 409, '23505', 'violates unique constraint "orgs_name_unique"'), /name already exists/],
      [
        new ApiError('rest', 409, '23505', 'violates unique constraint "accounts_username_key"'),
        /username is already taken/,
      ],
      [new ApiError('rest', 400, 'P0001', 'account_not_found'), /no such account/],
      [new ApiError('rest', 404, 'PGRST202', 'Could not find the function'), /migrations/],
      [new ApiError('rest', 0, 'network', 'cannot reach 127.0.0.1:54321'), /^cannot reach 127\.0\.0\.1:54321$/],
      [new ApiError('storage', 500, 'internal', 'boom'), /^storage API answered 500 internal: boom$/],
    ]
    for (const [err, expected] of cases) assert.match(describeFailure(err), expected)
  })

  it('maps the shared action errors', () => {
    assert.match(describeFailure(new HttpError('forbidden')), /not the owner account/)
    assert.match(describeFailure(new HttpError('not_found')), /no such account/)
    assert.match(describeFailure(new HttpError('internal')), /run the command again/)
    assert.match(describeFailure(new Error('x')), /^unexpected error: x$/)
  })
})
