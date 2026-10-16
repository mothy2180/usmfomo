// Command line of the owner CLI (docs/api.md, "Owner CLI"). Usernames and new
// organisations are validated with the shared schemas the owner console uses,
// passwords given with --password-stdin with the shared password rules.
import { parseArgs } from 'node:util'
import { PASSWORD_RULES, passwordProblems } from '../../packages/shared/src/password.ts'
import { createAccountSchema, slugify, usernameSchema } from '../../packages/shared/src/schemas.ts'
import type { CreateAccountInput } from '../../supabase/functions/owner-admin/request.ts'

export const USAGE = `usage: pnpm account <command> [args]

commands:
  list                         every account: status, live posts, last sign-in
  create-owner <username>      the owner account
  create <username> --org "<name>" --type club|school [--campus main] [--slug <slug>]
                               a club or school account; the slug defaults to one made from --org
  reset-password <username>    new password; ends every session of that account (works on the owner too)
  handover <username>          new committee: new password, every session ended
  rename <username> <new-username>
                               new login name for a club or school account; sessions stay signed in
  deactivate <username>        stop sign-in and posting
  activate <username>          undo deactivate
  delete <username> --yes      delete a club or school account, its organisation, posts and posters
  seed-local                   local stack only: an owner and two demo accounts

options:
  --password-stdin             create-owner, create, reset-password, handover: read the new password
                               from stdin (a pipe, never a terminal) instead of generating one:
                                 read -rs 'p?New password: '; echo; printf %s "$p" | pnpm account handover <username> --password-stdin; unset p
                               12+ characters (at most 72 bytes) with a lowercase letter, an uppercase
                               letter and a digit; it is not printed

environment:
  SUPABASE_URL           project URL (default http://127.0.0.1:54321)
  SUPABASE_SECRET_KEY    secret API key; may be omitted for the local stack

Generated passwords are printed once and never written to disk.`

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export type AccountCommand =
  | 'reset-password'
  | 'handover'
  | 'deactivate'
  | 'activate'

/** --password-stdin: the new password comes from stdin, not the generator. */
export type PasswordSource = { passwordStdin?: true }

export type Command =
  | { name: 'help' }
  | { name: 'list' }
  | { name: 'seed-local' }
  | ({ name: 'create-owner'; username: string } & PasswordSource)
  | ({ name: 'create'; input: CreateAccountInput } & PasswordSource)
  | ({ name: AccountCommand; username: string } & PasswordSource)
  | { name: 'rename'; username: string; newUsername: string }
  | { name: 'delete'; username: string; yes: boolean }

type OptionName = 'org' | 'type' | 'campus' | 'slug' | 'yes' | 'password-stdin'

type Spec = { args: readonly string[]; options: readonly OptionName[] }

const USER: Spec = { args: ['<username>'], options: [] }
const USER_PASSWORD: Spec = { args: ['<username>'], options: ['password-stdin'] }

// A Map, so that names such as "toString" are not found on Object.prototype.
const SPECS: ReadonlyMap<string, Spec> = new Map<string, Spec>([
  ['list', { args: [], options: [] }],
  ['seed-local', { args: [], options: [] }],
  ['create-owner', USER_PASSWORD],
  ['create', { args: ['<username>'], options: ['org', 'type', 'campus', 'slug', 'password-stdin'] }],
  ['reset-password', USER_PASSWORD],
  ['handover', USER_PASSWORD],
  ['rename', { args: ['<username>', '<new-username>'], options: [] }],
  ['deactivate', USER],
  ['activate', USER],
  ['delete', { args: ['<username>'], options: ['yes'] }],
])

const USERNAME_RULE =
  '3-32 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit'

function username(raw: string): string {
  const parsed = usernameSchema.safeParse(raw)
  if (!parsed.success) throw new UsageError(`invalid username "${raw}": ${USERNAME_RULE}`)
  return parsed.data
}

/** One readable message for the first problem createAccountSchema found. */
function createProblem(path: PropertyKey | undefined, slugGiven: boolean): string {
  switch (path) {
    case 'username':
      return `invalid username: ${USERNAME_RULE}`
    case 'orgName':
      return '--org must be 2-100 characters without control characters'
    case 'orgSlug':
      return slugGiven
        ? '--slug must be 1-50 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit'
        : 'cannot make a URL slug from --org; pass one with --slug'
    case 'type':
      return '--type must be club or school'
    case 'campus':
      return '--campus must be main, engineering, health or other'
    default:
      return 'invalid account details'
  }
}

function parseCreate(name: string, values: Partial<Record<OptionName, string | boolean>>): CreateAccountInput {
  const org = values.org
  const type = values.type
  if (typeof org !== 'string' || typeof type !== 'string') {
    throw new UsageError('create needs --org "<name>" and --type club|school')
  }
  const slug = typeof values.slug === 'string' ? values.slug : slugify(org)
  const parsed = createAccountSchema.safeParse({
    username: name,
    orgName: org,
    orgSlug: slug,
    type,
    campus: typeof values.campus === 'string' ? values.campus : 'main',
  })
  if (!parsed.success) {
    throw new UsageError(createProblem(parsed.error.issues[0]?.path[0], typeof values.slug === 'string'))
  }
  // The schema's refine() narrows campus: organisations have a physical campus.
  return parsed.data
}

const PARSE_CONFIG = {
  allowPositionals: true,
  strict: true,
  options: {
    org: { type: 'string' },
    type: { type: 'string' },
    campus: { type: 'string' },
    slug: { type: 'string' },
    yes: { type: 'boolean' },
    'password-stdin': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ ...PARSE_CONFIG, args: [...argv] })
  } catch (err) {
    // Unknown options and missing option values.
    throw new UsageError(err instanceof Error ? err.message : 'invalid arguments')
  }
}

export function parseCommand(argv: readonly string[]): Command {
  const { values, positionals } = parse(argv)
  const [name, ...args] = positionals
  if (values.help || name === 'help') return { name: 'help' }
  if (name === undefined) throw new UsageError('missing command')

  const spec = SPECS.get(name)
  if (!spec) throw new UsageError(`unknown command "${name}"`)
  if (args.length !== spec.args.length) {
    throw new UsageError(`usage: pnpm account ${[name, ...spec.args].join(' ')}`)
  }
  for (const option of ['org', 'type', 'campus', 'slug', 'yes', 'password-stdin'] as const) {
    if (values[option] !== undefined && !spec.options.includes(option)) {
      throw new UsageError(`--${option} does not apply to "${name}"`)
    }
  }

  const [first = '', second = ''] = args
  const source: PasswordSource = values['password-stdin'] === true ? { passwordStdin: true } : {}
  switch (name) {
    case 'list':
    case 'seed-local':
      return { name }
    case 'create-owner':
      return { name, username: username(first), ...source }
    case 'create':
      return { name, input: parseCreate(first, values), ...source }
    case 'delete':
      return { name, username: username(first), yes: values.yes === true }
    case 'rename':
      return { name, username: username(first), newUsername: username(second) }
    case 'reset-password':
    case 'handover':
      return { name, username: username(first), ...source }
    case 'deactivate':
    case 'activate':
      return { name, username: username(first) }
    default:
      throw new UsageError(`unknown command "${name}"`)
  }
}

/**
 * A password read with --password-stdin: one trailing line break (from echo or
 * a file) is dropped, nothing else. It must meet the shared password rules.
 */
export function chosenPassword(raw: string): string {
  const password = raw.replace(/\r?\n$/, '')
  const problems = new Set(passwordProblems(password))
  if (problems.size > 0) {
    const broken = PASSWORD_RULES.filter((r) => problems.has(r.rule)).map((r) => r.label.toLowerCase())
    throw new UsageError(`the password from stdin is not accepted; it needs: ${broken.join('; ')}`)
  }
  return password
}
