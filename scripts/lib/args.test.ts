import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chosenPassword, parseCommand, USAGE, UsageError } from './args.ts'

const fails = (argv: string[], message: RegExp) =>
  assert.throws(() => parseCommand(argv), (err: unknown) => {
    assert.ok(err instanceof UsageError, String(err))
    assert.match(err.message, message)
    return true
  })

describe('parseCommand', () => {
  it('help', () => {
    for (const argv of [['--help'], ['-h'], ['help'], ['list', '--help']]) {
      assert.deepEqual(parseCommand(argv), { name: 'help' })
    }
  })

  it('commands without arguments', () => {
    assert.deepEqual(parseCommand(['list']), { name: 'list' })
    assert.deepEqual(parseCommand(['seed-local']), { name: 'seed-local' })
  })

  it('username commands normalise the username like the console', () => {
    for (const name of ['reset-password', 'handover', 'deactivate', 'activate']) {
      assert.deepEqual(parseCommand([name, ' CSoc ']), { name, username: 'csoc' })
    }
    assert.deepEqual(parseCommand(['create-owner', 'Tim']), { name: 'create-owner', username: 'tim' })
  })

  it('rename: two usernames, both normalised and checked', () => {
    assert.deepEqual(parseCommand(['rename', ' CSoc ', 'CS-Society']), {
      name: 'rename',
      username: 'csoc',
      newUsername: 'cs-society',
    })
    fails(['rename', 'csoc'], /usage: pnpm account rename <username> <new-username>/)
    fails(['rename', 'csoc', 'has space'], /invalid username "has space"/)
    fails(['rename', 'csoc', 'cs-society', '--password-stdin'], /--password-stdin does not apply to "rename"/)
    assert.match(USAGE, /rename <username> <new-username>/)
  })

  it('--password-stdin for the commands that set a password, and only those', () => {
    for (const name of ['reset-password', 'handover', 'create-owner']) {
      assert.deepEqual(parseCommand([name, 'csoc', '--password-stdin']), { name, username: 'csoc', passwordStdin: true })
    }
    assert.deepEqual(
      parseCommand(['create', 'robotics', '--org', 'Robotics Club', '--type', 'club', '--password-stdin']),
      {
        name: 'create',
        input: { username: 'robotics', orgName: 'Robotics Club', orgSlug: 'robotics-club', type: 'club', campus: 'main' },
        passwordStdin: true,
      },
    )
    for (const argv of [['deactivate', 'csoc'], ['activate', 'csoc'], ['delete', 'csoc', '--yes'], ['list']]) {
      fails([...argv, '--password-stdin'], /--password-stdin does not apply/)
    }
  })

  it('delete reads --yes', () => {
    assert.deepEqual(parseCommand(['delete', 'csoc']), { name: 'delete', username: 'csoc', yes: false })
    assert.deepEqual(parseCommand(['delete', 'csoc', '--yes']), { name: 'delete', username: 'csoc', yes: true })
  })

  it('create: campus defaults to main and the slug to one made from --org', () => {
    assert.deepEqual(parseCommand(['create', 'robotics', '--org', 'Robotics Club', '--type', 'club']), {
      name: 'create',
      input: { username: 'robotics', orgName: 'Robotics Club', orgSlug: 'robotics-club', type: 'club', campus: 'main' },
    })
    assert.deepEqual(
      parseCommand([
        'create',
        'pps',
        '--org',
        '  Pusat Pengajian Sains Perubatan ',
        '--type',
        'school',
        '--campus',
        'health',
        '--slug',
        'PPSP',
      ]),
      {
        name: 'create',
        input: {
          username: 'pps',
          orgName: 'Pusat Pengajian Sains Perubatan',
          orgSlug: 'ppsp',
          type: 'school',
          campus: 'health',
        },
      },
    )
  })

  it('create: refuses what createAccountSchema refuses', () => {
    const base = ['create', 'csoc', '--org', 'CS Society', '--type', 'club']
    fails([...base, '--campus', 'online'], /--campus must be main, engineering, health or other/)
    fails([...base, '--campus', 'penang'], /--campus/)
    fails(['create', 'csoc', '--org', 'CS Society', '--type', 'society'], /--type must be club or school/)
    fails(['create', 'csoc', '--org', 'C', '--type', 'club'], /--org must be 2-100 characters/)
    fails(['create', 'csoc', '--org', 'Bad\u0007Name', '--type', 'club'], /--org/)
    fails([...base, '--slug=-bad-'], /--slug must be/)
    fails([...base, '--slug', 'bad slug'], /--slug must be/)
    fails(['create', 'csoc', '--org', '日本語', '--type', 'club'], /pass one with --slug/)
    fails(['create', 'a', '--org', 'CS Society', '--type', 'club'], /username/)
    fails(['create', 'csoc', '--type', 'club'], /needs --org/)
    fails(['create', 'csoc', '--org', 'CS Society'], /needs --org "<name>" and --type/)
  })

  it('refuses unknown commands, wrong arity and options that do not apply', () => {
    fails([], /missing command/)
    fails(['frobnicate'], /unknown command "frobnicate"/)
    fails(['toString'], /unknown command/)
    fails(['remove-factors', 'csoc'], /unknown command "remove-factors"/)
    fails(['owner-reset-mfa', 'owner'], /unknown command "owner-reset-mfa"/)
    fails(['__proto__'], /unknown command/)
    fails(['constructor', 'x'], /unknown command/)
    fails(['list', 'extra'], /usage: pnpm account list$/)
    fails(['reset-password'], /usage: pnpm account reset-password <username>/)
    fails(['reset-password', 'a', 'b'], /usage/)
    fails(['list', '--yes'], /--yes does not apply to "list"/)
    fails(['handover', 'csoc', '--org', 'x'], /--org does not apply/)
    fails(['list', '--frobnicate'], /Unknown option/)
    fails(['create', 'csoc', '--org'], /argument missing/)
    fails(['reset-password', 'has space'], /invalid username "has space"/)
    fails(['reset-password', 'x'], /invalid username/)
  })
})

describe('chosenPassword', () => {
  it('drops one trailing line break and nothing else', () => {
    assert.equal(chosenPassword('Typed by the Owner 2026'), 'Typed by the Owner 2026')
    assert.equal(chosenPassword('Typed by the Owner 2026\n'), 'Typed by the Owner 2026')
    assert.equal(chosenPassword('Typed by the Owner 2026\r\n'), 'Typed by the Owner 2026')
    assert.equal(chosenPassword(' Typed by the Owner 2026 '), ' Typed by the Owner 2026 ')
  })

  it('names the rules a refused password breaks, never the password', () => {
    const refused = (raw: string, message: RegExp) =>
      assert.throws(() => chosenPassword(raw), (err: unknown) => {
        assert.ok(err instanceof UsageError)
        assert.match(err.message, message)
        assert.equal(raw.trim() !== '' && err.message.includes(raw.trim()), false)
        return true
      })
    refused('', /at least 12 characters; a lowercase letter.*a digit/)
    refused('short1A\n', /at least 12 characters/)
    refused('abcdefghijk1', /an uppercase letter/)
    refused('ABCDEFGHIJK1', /a lowercase letter/)
    refused('abcdefghiJKl', /a digit/)
    refused('Typed by the Owner 2026\n\n', /control characters/)
    refused('aB3'.repeat(25), /at most 72 bytes/)
  })
})
