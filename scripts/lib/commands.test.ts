import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HttpError } from '../../supabase/functions/_shared/http.ts'
import { BAN_DURATION } from '../../supabase/functions/owner-admin/actions.ts'
import type { Command } from './args.ts'
import { type CommandDeps, runCommand, SEED_ACCOUNTS, SEED_OWNER } from './commands.ts'
import { CliError } from './format.ts'
import type { CliPort } from './port.ts'
import { ApiError } from './rest.ts'
import { captureIo, CLUB, CLUB_ID, fakePort, OWNER, OWNER_ID, PASSWORD } from './testing.ts'

function setup(overrides: Partial<CliPort> = {}, accounts = [OWNER, CLUB], local = true) {
  const fake = fakePort(accounts, overrides)
  const io = captureIo()
  const deps: CommandDeps = { port: fake.port, io, generatePassword: () => PASSWORD, local }
  const run = (cmd: Command) => runCommand(cmd, deps)
  return { ...fake, io, run }
}

/** The generated password appears exactly once in all output. */
function printedOnce(all: string, password = PASSWORD) {
  assert.equal(all.split(password).length - 1, 1, 'password must be printed exactly once')
}

async function failsWith(promise: Promise<unknown>, message: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof CliError, String(err))
    assert.match(err.message, message)
    assert.equal(err.message.includes(PASSWORD), false)
    return true
  })
}

describe('list', () => {
  it('prints the accounts table', async () => {
    const { run, io } = setup()
    await run({ name: 'list' })
    assert.match(io.stdout.join('\n'), /USERNAME\s+KIND/)
    assert.match(io.stdout.join('\n'), /2 account\(s\): 1 owner, 1 club, 0 school/)
  })
})

describe('create-owner', () => {
  it('creates the sign-in, links it as owner and prints the password once', async () => {
    const { run, io, writes, calls } = setup({}, [CLUB])
    await run({ name: 'create-owner', username: 'tim' })
    assert.deepEqual(writes(), ['createAuthUser', 'linkOwner'])
    assert.deepEqual(calls.find(([op]) => op === 'createAuthUser'), [
      'createAuthUser',
      'tim@usmfomo.pages.dev',
      PASSWORD,
    ])
    printedOnce(io.all())
    assert.match(io.all(), /enrol two TOTP devices/)
  })

  it('refuses an existing username before creating anything', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'create-owner', username: 'owner' }), /already exists/)
    assert.deepEqual(writes(), [])
  })

  it('removes the sign-in again when linking fails', async () => {
    const { run, writes, io } = setup(
      { linkOwner: () => Promise.reject(new ApiError('rest', 409, '23505', 'dup')) },
      [],
    )
    await assert.rejects(run({ name: 'create-owner', username: 'tim' }), ApiError)
    assert.deepEqual(writes(), ['createAuthUser', 'linkOwner', 'deleteAuthUser'])
    assert.equal(io.all().includes(PASSWORD), false)
  })
})

describe('create', () => {
  const input = {
    username: 'robotics',
    orgName: 'Robotics Club',
    orgSlug: 'robotics-club',
    type: 'club',
    campus: 'main',
  } as const

  it('runs the console create_account logic and prints the password once', async () => {
    const { run, io, writes } = setup()
    await run({ name: 'create', input })
    assert.deepEqual(writes(), ['createAuthUser', 'createOrgAccount'])
    assert.match(
      io.stdout[0] ?? '',
      /Created the club account "robotics" for Robotics Club \(slug robotics-club, campus main\)/,
    )
    printedOnce(io.all())
  })

  it('a failed org insert deletes the new sign-in and prints no password', async () => {
    const { run, io, writes } = setup({
      createOrgAccount: () => Promise.reject(new ApiError('rest', 409, '23505', 'duplicate "orgs_slug_key"')),
    })
    await assert.rejects(run({ name: 'create', input }), ApiError)
    assert.deepEqual(writes(), ['createAuthUser', 'createOrgAccount', 'deleteAuthUser'])
    assert.equal(io.all().includes(PASSWORD), false)
  })
})

describe('reset-password', () => {
  it('works for club accounts and, as break-glass, for the owner', async () => {
    for (const [username, id] of [['csoc', CLUB_ID], ['owner', OWNER_ID]] as const) {
      const { run, io, calls } = setup()
      await run({ name: 'reset-password', username })
      assert.deepEqual(calls.at(-1), ['updateAuthUser', id, { password: PASSWORD }])
      printedOnce(io.all())
    }
  })

  it('unknown username', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'reset-password', username: 'nobody' }), /no account named "nobody"/)
    assert.deepEqual(writes(), [])
  })
})

describe('handover', () => {
  it('deactivate, new password, remove every factor, reactivate', async () => {
    const { run, io, calls } = setup()
    await run({ name: 'handover', username: 'csoc' })
    assert.deepEqual(calls.filter(([op]) => op !== 'listAccounts'), [
      ['setAccountActive', CLUB_ID, false],
      ['updateAuthUser', CLUB_ID, { ban_duration: BAN_DURATION }],
      ['updateAuthUser', CLUB_ID, { password: PASSWORD }],
      ['listFactorIds', CLUB_ID],
      ['deleteFactor', CLUB_ID, 'f1'],
      ['deleteFactor', CLUB_ID, 'f2'],
      ['setAccountActive', CLUB_ID, true],
      ['updateAuthUser', CLUB_ID, { ban_duration: 'none' }],
    ])
    printedOnce(io.all())
  })

  it('refuses the owner account', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'handover', username: 'owner' }), /is the owner account/)
    assert.deepEqual(writes(), [])
  })
})

describe('deactivate / activate', () => {
  it('database flag first, then the Auth ban; the owner is allowed (break-glass)', async () => {
    const off = setup()
    await off.run({ name: 'deactivate', username: 'owner' })
    assert.deepEqual(off.calls.filter(([op]) => op !== 'listAccounts'), [
      ['setAccountActive', OWNER_ID, false],
      ['updateAuthUser', OWNER_ID, { ban_duration: BAN_DURATION }],
    ])
    assert.match(off.io.all(), /pnpm account activate owner/)

    const on = setup()
    await on.run({ name: 'activate', username: 'csoc' })
    assert.deepEqual(on.calls.filter(([op]) => op !== 'listAccounts'), [
      ['setAccountActive', CLUB_ID, true],
      ['updateAuthUser', CLUB_ID, { ban_duration: 'none' }],
    ])
  })
})

describe('remove-factors', () => {
  it('removes every factor of a club account and tolerates one already gone', async () => {
    const { run, io } = setup({
      deleteFactor: (_u, id) => (id === 'f2' ? Promise.reject(new HttpError('not_found')) : Promise.resolve()),
    })
    await run({ name: 'remove-factors', username: 'csoc' })
    assert.match(io.all(), /Removed 1 2FA factor\(s\) from "csoc"/)
  })

  it('points the owner to owner-reset-mfa', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'remove-factors', username: 'owner' }), /owner-reset-mfa/)
    assert.deepEqual(writes(), [])
  })
})

describe('delete', () => {
  it('without --yes only says what would be deleted', async () => {
    const { run, writes } = setup()
    await failsWith(
      run({ name: 'delete', username: 'csoc', yes: false }),
      /Computer Science Society, 3 live post\(s\).*--yes/,
    )
    assert.deepEqual(writes(), [])
  })

  it('stops writes, removes the files, deletes the org and the sign-in', async () => {
    const { run, io, writes } = setup()
    await run({ name: 'delete', username: 'csoc', yes: true })
    assert.deepEqual(writes(), ['setAccountActive', 'orgObjects', 'removeFiles', 'deleteOrg', 'deleteAuthUser'])
    assert.match(io.all(), /Deleted "csoc" .* and 2 poster file\(s\)/)
  })

  it('keeps the account when poster files could not be removed', async () => {
    const { run, writes } = setup({ removeFiles: () => Promise.resolve({ removed: 0, failed: 2 }) })
    await failsWith(run({ name: 'delete', username: 'csoc', yes: true }), /account was kept/)
    assert.equal(writes().includes('deleteOrg'), false)
  })

  it('refuses the owner account', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'delete', username: 'owner', yes: true }), /cannot be deleted/)
    assert.deepEqual(writes(), [])
  })
})

describe('owner-reset-mfa', () => {
  it('new password first (ends sessions), then every factor', async () => {
    const { run, io, calls } = setup()
    await run({ name: 'owner-reset-mfa', username: 'owner' })
    assert.deepEqual(calls.filter(([op]) => op !== 'listAccounts'), [
      ['updateAuthUser', OWNER_ID, { password: PASSWORD }],
      ['listFactorIds', OWNER_ID],
      ['deleteFactor', OWNER_ID, 'f1'],
      ['deleteFactor', OWNER_ID, 'f2'],
    ])
    printedOnce(io.all())
    assert.match(io.all(), /2 2FA factor\(s\) removed/)
  })

  it('is for the owner account only', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'owner-reset-mfa', username: 'csoc' }), /not the owner account/)
    assert.deepEqual(writes(), [])
  })
})

describe('seed-local', () => {
  it('refuses anything but the local stack', async () => {
    const { run, writes } = setup({}, [], false)
    await failsWith(run({ name: 'seed-local' }), /only runs against the local stack/)
    assert.deepEqual(writes(), [])
  })

  it('creates the owner and two demo accounts, each password printed once', async () => {
    let n = 0
    const fake = fakePort([])
    const io = captureIo()
    await runCommand({ name: 'seed-local' }, {
      port: fake.port,
      io,
      local: true,
      generatePassword: () => `Pw${++n}xxxxxxxxxxxxxxxxxxxxx`,
    })
    assert.deepEqual(fake.accounts.map((a) => a.username), [SEED_OWNER, ...SEED_ACCOUNTS.map((a) => a.username)])
    assert.deepEqual(fake.accounts.map((a) => a.org_type), [null, 'club', 'school'])
    for (let i = 1; i <= 3; i++) printedOnce(io.all(), `Pw${i}xxxxxxxxxxxxxxxxxxxxx`)
  })

  it('skips accounts that already exist instead of resetting them', async () => {
    const { run, io, writes } = setup({}, [{ ...OWNER, username: SEED_OWNER }])
    await run({ name: 'seed-local' })
    assert.equal(writes().includes('updateAuthUser'), false)
    assert.deepEqual(writes(), ['createAuthUser', 'createOrgAccount', 'createAuthUser', 'createOrgAccount'])
    assert.match(io.all(), /"owner" already exists, skipped/)
  })
})
