import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCommand, UsageError } from './args.ts'

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
    for (const name of ['reset-password', 'handover', 'deactivate', 'activate', 'remove-factors', 'owner-reset-mfa']) {
      assert.deepEqual(parseCommand([name, ' CSoc ']), { name, username: 'csoc' })
    }
    assert.deepEqual(parseCommand(['create-owner', 'Tim']), { name: 'create-owner', username: 'tim' })
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
