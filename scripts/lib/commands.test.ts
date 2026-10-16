import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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
  it('works for club accounts and, as break-glass, for the owner: database grant, then Auth', async () => {
    for (const [username, id] of [['csoc', CLUB_ID], ['owner', OWNER_ID]] as const) {
      const { run, io, writeCalls } = setup()
      await run({ name: 'reset-password', username })
      assert.deepEqual(writeCalls(), [
        ['allowPasswordChange', id],
        ['updateAuthUser', id, { password: PASSWORD }],
      ])
      printedOnce(io.all())
    }
  })

  it('a refused grant stops before Auth and prints no password', async () => {
    const { run, io, writes } = setup({
      allowPasswordChange: () => Promise.reject(new ApiError('rest', 400, 'P0001', 'user_not_found')),
    })
    await assert.rejects(run({ name: 'reset-password', username: 'csoc' }), ApiError)
    assert.deepEqual(writes(), ['allowPasswordChange'])
    assert.equal(io.all().includes(PASSWORD), false)
  })

  it('unknown username', async () => {
    const { run, writes } = setup()
    await failsWith(run({ name: 'reset-password', username: 'nobody' }), /no account named "nobody"/)
    assert.deepEqual(writes(), [])
  })
})

describe('handover', () => {
  it('deactivate, new password, reactivate', async () => {
    const { run, io, writeCalls } = setup()
    await run({ name: 'handover', username: 'csoc' })
    assert.deepEqual(writeCalls(), [
      ['setAccountActive', CLUB_ID, false],
      ['updateAuthUser', CLUB_ID, { ban_duration: BAN_DURATION }],
      ['allowPasswordChange', CLUB_ID],
      ['updateAuthUser', CLUB_ID, { password: PASSWORD }],
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

describe('a password the owner gave (--password-stdin)', () => {
  const GIVEN = 'Typed by the Owner 2026'
  const given = (overrides: Partial<CliPort> = {}, accounts = [OWNER, CLUB]) => {
    const fake = fakePort(accounts, overrides)
    const io = captureIo()
    const deps: CommandDeps = {
      port: fake.port,
      io,
      password: GIVEN,
      generatePassword: () => {
        throw new Error('must not generate')
      },
      local: true,
    }
    return { ...fake, io, run: (cmd: Command) => runCommand(cmd, deps) }
  }

  it('replaces the generated one in create-owner, create, reset-password and handover, and is never printed', async () => {
    const commands: Array<[Command, string]> = [
      [{ name: 'create-owner', username: 'tim' }, 'createAuthUser'],
      [
        {
          name: 'create',
          input: { username: 'robotics', orgName: 'Robotics Club', orgSlug: 'robotics', type: 'club', campus: 'main' },
        },
        'createAuthUser',
      ],
      [{ name: 'reset-password', username: 'csoc' }, 'updateAuthUser'],
      [{ name: 'handover', username: 'csoc' }, 'updateAuthUser'],
    ]
    for (const [cmd, op] of commands) {
      const { run, io, calls } = given({}, cmd.name === 'create-owner' ? [CLUB] : [OWNER, CLUB])
      await run(cmd)
      assert.ok(calls.some(([o, ...args]) => o === op && JSON.stringify(args).includes(GIVEN)), cmd.name)
      assert.equal(io.all().includes(GIVEN), false, cmd.name)
      assert.match(io.all(), /password: the one you gave \(not shown\)/, cmd.name)
    }
  })
})

describe('rename', () => {
  it('runs the console rename_account logic: Auth email, then the account row', async () => {
    const { run, io, writeCalls, accounts } = setup()
    await run({ name: 'rename', username: 'csoc', newUsername: 'cs-society' })
    assert.deepEqual(writeCalls(), [
      ['updateAuthUser', CLUB_ID, { email: 'cs-society@usmfomo.pages.dev', email_confirm: true }],
      ['renameAccount', CLUB_ID, 'cs-society'],
    ])
    assert.equal(accounts.find((a) => a.user_id === CLUB_ID)?.username, 'cs-society')
    assert.match(io.all(), /Renamed "csoc" to "cs-society"\. Computer Science Society signs in with "cs-society"/)
    assert.match(io.all(), /already signed in keep working/)
  })

  it('the same username changes nothing', async () => {
    const { run, io, writes } = setup()
    await run({ name: 'rename', username: 'csoc', newUsername: 'csoc' })
    assert.deepEqual(writes(), [])
    assert.match(io.all(), /already has this username; nothing changed/)
  })

  it('refuses a taken username, the owner account and unknown accounts before any change', async () => {
    const taken = setup()
    await failsWith(taken.run({ name: 'rename', username: 'csoc', newUsername: 'owner' }), /"owner" is already taken/)
    assert.deepEqual(taken.writes(), [])

    const owner = setup()
    await failsWith(
      owner.run({ name: 'rename', username: 'owner', newUsername: 'tim' }),
      /"owner" is the owner account: its username cannot be changed/,
    )
    assert.deepEqual(owner.writes(), [])

    const unknown = setup()
    await failsWith(unknown.run({ name: 'rename', username: 'nobody', newUsername: 'x-y-z' }), /no account named "nobody"/)
    assert.deepEqual(unknown.writes(), [])
  })

  it('a refused account row puts the old Auth email back', async () => {
    const { run, writeCalls } = setup({
      renameAccount: () => Promise.reject(new ApiError('rest', 400, 'P0001', 'username_taken')),
    })
    await assert.rejects(run({ name: 'rename', username: 'csoc', newUsername: 'cs-society' }), ApiError)
    assert.deepEqual(writeCalls(), [
      ['updateAuthUser', CLUB_ID, { email: 'cs-society@usmfomo.pages.dev', email_confirm: true }],
      ['renameAccount', CLUB_ID, 'cs-society'],
      ['updateAuthUser', CLUB_ID, { email: 'csoc@usmfomo.pages.dev', email_confirm: true }],
    ])
  })
})

describe('deactivate / activate', () => {
  it('database flag first, then the Auth ban; the owner is allowed (break-glass)', async () => {
    const off = setup()
    await off.run({ name: 'deactivate', username: 'owner' })
    assert.deepEqual(off.writeCalls(), [
      ['setAccountActive', OWNER_ID, false],
      ['updateAuthUser', OWNER_ID, { ban_duration: BAN_DURATION }],
    ])
    assert.match(off.io.all(), /pnpm account activate owner/)

    const on = setup()
    await on.run({ name: 'activate', username: 'csoc' })
    assert.deepEqual(on.writeCalls(), [
      ['setAccountActive', CLUB_ID, true],
      ['updateAuthUser', CLUB_ID, { ban_duration: 'none' }],
    ])
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

describe('account lookups', () => {
  // As if the account sorted past a page that PostgREST cut at 100 rows: only
  // the direct lookup by username may decide whether an account exists.
  const noListScans = { listAccounts: () => Promise.reject(new Error('commands must not search the list')) }

  it('every account command finds its account directly, never in the account list', async () => {
    const commands: Command[] = [
      { name: 'reset-password', username: 'csoc' },
      { name: 'handover', username: 'csoc' },
      { name: 'deactivate', username: 'csoc' },
      { name: 'activate', username: 'csoc' },
      { name: 'rename', username: 'csoc', newUsername: 'cs-society' },
      { name: 'delete', username: 'csoc', yes: true },
    ]
    for (const cmd of commands) {
      const { run, calls } = setup(noListScans)
      await run(cmd)
      assert.deepEqual(calls[0], ['getAccountByUsername', 'csoc'], cmd.name)
      assert.equal(calls.some(([op]) => op === 'listAccounts'), false, cmd.name)
    }
  })

  it('create-owner and seed-local check existing usernames directly too', async () => {
    const owner = setup(noListScans, [CLUB])
    await owner.run({ name: 'create-owner', username: 'tim' })
    assert.deepEqual(owner.calls[0], ['getAccountByUsername', 'tim'])

    const seed = setup(noListScans, [])
    await seed.run({ name: 'seed-local' })
    assert.deepEqual(seed.writes(), [
      'createAuthUser',
      'linkOwner',
      'createAuthUser',
      'createOrgAccount',
      'createAuthUser',
      'createOrgAccount',
    ])
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
